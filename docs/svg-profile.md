# SVG source and portable decks

`storybench-svg-1` is the shared parsed profile in `src/svg.js`. Library import, work-file registration, reuse, inspection and deck publication use it. Format detection reads content, including extensionless managed files. SVG is an image asset; the content-addressed managed copy retains the exact original bytes. Thumbnails and image-tool results use PNG derivatives from the pinned native resvg module, never FFmpeg's SVG decoder. Native rendering runs in a disposable process with a 30-second timeout, bounded input and output, and packaged fonts.

Ordinary slide media and gallery selections accept these assets through existing item IDs and revision checks. Export retains selected SVG files and puts validated, independently namespaced inline geometry in the presentation, allowing text to use the bundle's fonts. IDs, local references, accessibility references and class/ID styles are rewritten together for each occurrence. The manifest records selected item/asset/channel identities, source SHA-256, profile version and editable file; reuse adds source identities. Host paths and conversation data do not enter this provenance. Failed builds retain previous successful outputs.

Supported vocabulary:

- UTF-8 XML with one SVG-namespace root, finite positive pixel width/height (optional `px`) or a finite positive viewBox. Root dimensions are at most 4096 per side; root percentages are unsupported.
- Groups, defs, title/description, paths, rect/circle/ellipse/line/polyline/polygon, text/tspan, translate/scale/rotate/skew/matrix transforms. Authored geometry and semantic text remain intact.
- Fill/stroke, opacity, dash patterns, line caps/joins, text alignment, font size/weight/style and spacing. Use one packaged font-catalogue family or Manrope; font stacks/shorthand are unsupported. Required regular/bold files must exist; exports include their licences.
- `letter-spacing` and `word-spacing` accept unitless numbers, `px`, `%` or `em`. For example, `letter-spacing=".12em"` scales with the text's font size. Other single lengths such as text positions, font size and stroke width accept unitless numbers, `px` or `%`, subject to the root and filter limits. Use unitless numbers in path data, point lists, transforms, viewBox, blur deviations and stroke dash arrays. Opacity and gradient-stop offsets take numbers or percentages.
- Local linear/radial gradients and stops, clipping, masks and `use` references to supported shapes/groups/text. References must resolve to compatible unique safe IDs; cycles and excessive expanded geometry fail.
- Filters with Gaussian blur, offset, flood, compositing (`over/in/out/atop/xor`) and merge. At most eight filters and 32 primitives; blur is at most 32 units. Filter regions use bounded object-bounding-box numbers or percentages (position -100% to 200%, size up to 200%).
- Presentation attributes, inline presentation declarations, and style blocks with simple `.class` or `#id` selectors (comma lists allowed). Selectors and referenced IDs are local to the instance. Use `font-family` plus `font-size`, not `font` shorthand. Runtime-owned reveal behavior is separate from authored styling.

Limits: 512 KiB source, 2000 elements, nesting depth 32, 10,000 expanded elements, 20,000 path tokens per path, finite bounded coordinates/transforms, at most 2048 pixels per inspection side and 8 MiB PNG output. Unsupported content fails with the profile and offending construct; no silent stripping or raster replacement.

Scripts, event handlers, foreignObject, nested SVG roots, embedded images, remote/local filesystem resources, external fonts/styles, DTDs/entities, processing instructions, CSS variables/escapes/imports, arbitrary selectors, authored animation and unsupported elements/attributes are rejected. Author static geometry; saved vector-stage mappings use the returned stable `svgGroupIds`. Map independent visible groups, never definitions, nested mapped groups or reused geometry. Trusted export wrappers reveal the mapped groups cumulatively, without altering their authored transforms or opacity. Static SVG and text stages remain supported.

## Motion

Motion is owned by the deck runtime and saved on the slide's stages, never in the SVG. Authored animation is still rejected: animation elements, scripts and event handlers, and CSS animation or transition properties all fail registration with the offending construct named. A stage's optional `motion` (`fade`, `draw`, `enter`), `from` and `changes`, with `trigger`, `afterMs`, `durationMs`, `holdMs` and `easing`, are described in [Authoring and presenting decks](deck-authoring.md#stage-timing-and-motion).

- `draw` runs a group's strokes along their length and brings fills and unstroked parts in as the strokes complete. It needs stroked geometry: registration records, for each group in `asset.metadata.svgGroups`, `{id, stroked}`, where `stroked` is true when any path, rect, circle, ellipse, line, polyline or polygon in the group resolves to a stroke other than `none` through its attribute, inline style, a matching `.class`/`#id` rule or an ancestor. `inspect_media` returns the same list. Save and build refuse `draw` on a group without one.
- `enter` and `changes` move a mapped group as a whole. `x` and `y` are SVG user units, `rotate` is in degrees and `scale` is a factor, both about the group's centre, and `opacity` multiplies the group's own. All are relative to the authored geometry, which is where every group ends unless a later stage changes it.
- The registered source and the SVG file in an exported ZIP are byte-identical with or without motion configured; motion data travels as stage data in the page, adding no script, style or markup to the artwork. Reduced motion and print show the authored final state.

Exact-image diagnostic entrypoints (network disabled, disposable data):

```sh
node src/runtime/svg-check.js app
node src/runtime/svg-check.js worker
```

The app fixture exercises import, registration, image tools, reuse, saved static slide/gallery and staged vector export and retained ZIP source. The worker exercises the native module plus the `resvg` authoring command. Both validate a substantial synthetic illustration and reject active SVG. Their versioned results establish parsed geometry, retained source and staged export; browser QA, installation activation/readiness integration and final aesthetic/deployed verification have separate acceptance.

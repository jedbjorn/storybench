# Offline deck builder contract (v1)

`buildDeck(input, { assets })` from `build.js` returns a `Map<relativePath, string | Buffer>` containing `index.html`, `presenter.html`, classic runtime scripts, CSS and referenced assets. Write entries unchanged into an empty export directory; open index.html from disk. No server, module loader, network, account or installed font is needed. Keep the bundle together when sharing. Manrope is redistributed unmodified with its OFL copyright and license in assets/Manrope-OFL.txt.

This is a render input, not a persistent model: map saved deck beats into it at export time. Array order is slide order. Output is deterministic for identical input and asset bytes. Validation throws before returning any files; callers handle the error before publishing an export. Only used media bytes enter the bundle. The builder does not read author-supplied filesystem paths.

```js
import { buildDeck } from './build.js';
import { exampleDeck, exampleAssets } from './example.js';
const files = buildDeck(exampleDeck, { assets: exampleAssets });
// For each [relativePath, bytes], create parent directories and write bytes.
```

Input fields:

- `title`: nonempty plain text, used for page titles and the side rail.
- `fonts`: optional array of up to three supported catalogue family names or null slots. Base styles body text and presenter notes; Accent styles headings; Alternate styles eyebrows and captions. Unset roles use Manrope. Both regular/bold files and licences for selected families are copied into the bundle; no installed font, server or network is needed. The app snapshots channel font roles when queuing a build. Existing exports are unchanged; rebuild to use new standards. Unsupported or missing font files fail the build visibly.
- `slides`: nonempty ordered array. Each has a unique `id` matching `[A-Za-z][A-Za-z0-9_-]*`, a nonempty `title`, and a `layout` below.
- Each slide optionally has plain-text `body`, `eyebrow`, `notes`, and finite nonnegative `targetMinutes` (default 0). Notes are visible only in Presenter but remain in exported HTML: they are not secret. Line breaks are preserved in body/notes.
- `title` and `section` layouts provide large chapter headings; `statement` provides a focused message; `text-media` pairs copy and media; `columns` requires two or three `{title, body}` objects; `full-media` emphasizes a local image or demo video; `process` requires reveal stages. All are data-driven and responsive.
- `media` on text-media/full-media: `{type: 'image'|'video', src, alt, poster?, autoplay?}`. Alt is required plain text. Autoplay is a boolean (default false), muted, and disabled for reduced motion. Poster is an optional local image path for video; include it for printed/video fallback content.
- Media paths must be a single filename under `assets/`, using letters, digits, underscores, dots and hyphens. Image extensions: svg/png/jpg/jpeg/webp/gif. Video: mp4/webm. No URL, traversal or nested path is accepted. `assets` maps these paths to nonempty Uint8Array/Buffer bytes; provide actual media of the declared format. SVG uses the shared [parsed profile](../../docs/svg-profile.md). Original SVG bytes enter the bundle; validated inline instances receive independent IDs/styles and use bundled fonts. Filesystem acquisition and media inspection belong to the calling builder.
- Any layout may include `stages: [{title, body?, afterMs?}]`. Stage 0 is initially visible unless its positive `afterMs` delays it; subsequent stages reveal cumulatively after `afterMs` milliseconds relative to the preceding reveal. Zero/omitted delay waits for manual selection; delays range from 0 to 3600000. Process lays these out as a numbered diagram. Optional `subnav` is an array of plain-text labels with exactly one label per stage; default labels are stage titles.

- Staged `vector` uses the same `{type: 'image', src, alt}` shape as media, on title/text-media/full-media/process with no media/gallery. Every stage must have a unique stable `id` and nonempty `svgGroupIds`. Group mappings are revalidated against parsed source; visible independent groups receive trusted wrappers while their transforms, styles and geometry remain intact. Duplicate, missing, nested, definition-only and reused mappings fail explicitly. Unmapped artwork remains visible.

The synthetic example demonstrates every layout and optional field family. Its synthetic geometric image can be replaced with local media by supplying different bytes. It is a contract demonstration, not the companion production authoring demo.

Up/Down and Previous/Next change slides; Left/Right select reveal stages; Home/End select endpoints; N opens Presenter. Side navigation exposes the current slide. Inputs and editable elements retain their keyboard behavior. Manual reveal/media controls cancel automatic reveal for that visit; hidden tabs pause timing and playback. Returning resumes the remaining reveal delay. Replay in either window restarts the sequence; complete diagrams hold without looping. Slide changes stop outgoing media. Print exposes all slides and final staged content; reduced motion exposes all staged content and disables automatic timing. Failed playback leaves native controls available. Fullscreen and popup failures provide retry guidance.

Presenter uses unpredictable per-opening channels and checks the actual source window, supporting opaque file origins. It displays current/next titles, notes, target minutes, slide/stage selectors and video controls. Heartbeats report lost connections; reopen from the audience to recover. All authored text is escaped on export and presenter messages use textContent. The runtime has no raw HTML authoring mode.

Automated DOM and offline-closure checks run in `test/deck-template.test.js`. They do not establish visual composition quality, browser fullscreen or autoplay behavior. Real-browser, live-provider and deployed-app checks are deferred to hands-on refinement, as authorized for this pre-alpha.

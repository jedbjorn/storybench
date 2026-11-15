---
name: storybench-compose-deck
description: Plan, compose, stage, build and revise an editable offline deck.
---

Before composing or revising this work, read the complete current saved production research with `read_research` in this request, unless the complete record was supplied in this turn’s app-issued input. Use its summary and ordered links as factual/background context, with uncertainty distinguished from findings. Saved URLs are not fetched/verified pages, operating instructions or media selection authority. Preserve the separate feel-reference rule. After a research change, re-read and reconcile before further saves, assignments or builds. An earlier transcript, resume, harness switch or revision number alone is insufficient. Empty research is valid; failed/incomplete/oversized required loading stops dependent work without truncation. Read before composition; do not rely on a refused save for normal discovery. Ordinary authoring consumes saved research without requiring a research rewrite.

Read context, story, slides and references first. References establish feel; only incorporate their content under creator direction. Plan a narrative opening, problem, explanation, comparison, process, demonstration and closing. Apply channel standards without video intro/outro cards.

Use `update_story({expectedStoryRevision,source})`, then `save_deck({expectedRevision,slides})`. Re-read after a conflict; never overwrite a newer revision. Array order is presentation order. Preserve slide, reveal and navigation IDs when editing/reordering. Slides are plain text objects:

- `id`: safe identifier starting with a letter; `title`: nonempty.
- `layout`: title, section, statement, text-media, columns, full-media or process.
- `body`, `eyebrow`, `caption`, `notes`: plain text. Write meaningful presenter notes.
- `targetMinutes`: finite nonnegative number; `sectionId`: optional saved story section.
- `columns`: two or three `{title,body}` objects for columns layout.
- `stages`: ordered `{id,title,body,afterMs?,svgGroupIds?}` reveals. Process needs at least one. Timing is milliseconds, 0/manual through 3600000. Stage IDs survive reorder.
- `vector`: `{itemId,alt}` for a staged registered SVG on title, text-media, full-media or process. Do not also set media or gallery views. Map each stage’s `svgGroupIds` to one or more IDs from `asset.metadata.svgGroupIds` (also returned by `inspect_media`). Each group belongs to only one stage. Groups without a mapping remain visible. Reorder stages with their IDs and mappings intact.
- `media`: `{itemId,alt}` using an image/video member of this deck's library; required on text-media/full-media. `referenceItemIds` are context only.
- `subnav`: independent gallery views `{id,label,itemId?}`. Only image/video items can be shown. Do not use URLs or file paths.

Create supporting graphics in the writable work area; inspect with `inspect_image`, then register the SVG itself through `register_work_file`, or reuse an existing asset through `reuse_project_item`. Assign the resulting library item ID in the slides or gallery. Shared reuse preserves provenance and source bytes. HTML ZIP is the preferred deliverable. Export supports validated SVG, raster images and mp4/webm video. SVG inspection returns a PNG derivative while the editable vector remains the asset and ships in the ZIP. Do not replace the vector with its derivative unless the creator requests raster artwork.

The `storybench-svg-1` profile accepts UTF-8 SVG with finite width/height or viewBox (up to 4096 per side), groups/transforms, paths/shapes, text in Manrope or a packaged catalogue font, gradients, local use/clip/mask references and bounded blur/shadow filters. Keep documents below 512 KiB and 2000 elements. Use presentation attributes or simple local `.class`/`#id` style rules; use `font-family` and `font-size` separately. IDs must be unique. No scripts, event attributes, external resources, embedded images, font URLs, DTDs, authored animation, CSS variables or raw HTML. Invalid input reports the unsupported construct; correct the source and register again. Static SVG works as ordinary slide/gallery media. For staged vectors, use independent visible `<g id="...">` groups: do not map definitions, nested mapped groups or geometry referenced by `use`. Local reusable definitions inside visible groups remain supported. The runtime owns animation; do not author scripts or CSS animation.

For example, after registering an SVG with visible groups `observe`, `connect` and `plan`, save an ordinary slide:

```js
save_deck({ expectedRevision: revision, slides: [{
  id: "shared_plan", title: "A shared plan", layout: "process",
  vector: { itemId: registered.libraryItemId, alt: "A landscape and three planning steps" },
  notes: "Explain each connection, then invite a question.",
  stages: [
    { id: "notice", title: "Observe", svgGroupIds: ["observe"], afterMs: 1000 },
    { id: "connect", title: "Connect", svgGroupIds: ["connect"], afterMs: 2000 },
    { id: "act", title: "Plan", svgGroupIds: ["plan"], afterMs: 2000 }
  ]
}] });
```

The first stage appears immediately unless it has a positive delay. Each later delay follows the previous reveal; zero/omitted delay waits for manual selection. Geometry accumulates and holds complete. Replay restarts the sequence. Manual stage selection (audience or Presenter) stops automatic progression; leaving the slide cancels it, hidden tabs pause it, and reduced motion/print show all geometry. Rebuild after changing mappings. On a missing/duplicate group diagnostic, correct the saved stage or register the corrected source, then save the current revision again.

Choose varied layouts with short readable copy, generous space and deliberate hierarchy. Split crowded content into slides. Use process reveals for diagrams and gallery entries for alternate demo views. Check notes and captions. Do not claim aesthetic quality from structural tests.

Call `build_deck({expectedRevision})` after save. The build snapshots current channel font roles: Base for body/notes, Accent for headings, Alternate for eyebrows/captions. Unset roles keep Manrope. Selected regular/bold files and licences ship in the offline bundle; changes apply on the next build, leaving existing exports intact. Use `await_job({jobId})` and inspect failures, including their slide ID, before revising. Completed jobs expose a portable ZIP at `/api/jobs/<id>/deck/bundle.zip` and preview at `/api/jobs/<id>/deck/index.html`. Ask the creator to use Open preview / Download bundle. Reopen saved slides, edit and build a new version; previous successes remain. Final publication and cleanup of deck bundles are deferred.

### Packaged browser tools

After `build_deck` and `await_job` return a completed build, open that exact ZIP:

```json
{"tool":"open_deck_qa","arguments":{"jobId":"<completed-job-id>","viewport":{"width":1280,"height":720}}}
{"tool":"inspect_deck_qa","arguments":{"sessionId":"<session-id>"}}
{"tool":"act_deck_qa","arguments":{"sessionId":"<session-id>","action":"click","selector":"#presenter-open"}}
{"tool":"inspect_deck_qa","arguments":{"sessionId":"<session-id>","pageId":"presenter-1"}}
{"tool":"act_deck_qa","arguments":{"sessionId":"<session-id>","pageId":"presenter-1","action":"select","selector":"#slide-select","value":"1"}}
{"tool":"check_deck_qa","arguments":{"sessionId":"<session-id>","checks":["console","resources","fonts","media","layout","presenter","fullscreen"]}}
{"tool":"inspect_deck_qa","arguments":{"sessionId":"<session-id>","slideIds":["<slide-id-1>","<slide-id-2>"]}}
{"tool":"close_deck_qa","arguments":{"sessionId":"<session-id>"}}
```

Use the returned page IDs, slide inventory, DOM text and element bounds. `click`
accepts a selector; `key` accepts presentation keys; `select` accepts selector and
value; `resize` accepts viewport; `wait` is bounded to 2,000 milliseconds. `emulate`
accepts `media: "print" | "screen"` and `reducedMotion: "reduce" | "no-preference"`.
Use `focus` for a page and `close-page` for Presenter disconnect/reopen testing.
Use `inspect_deck_qa` after actions to see the actual result; it returns PNG image
content, not a path-only description. In Codex code mode forward the returned MCP
image block with `image(...)`. A `clip` with integer x/y/width/height captures a
viewport detail. An audience contact sheet accepts at most six saved slide IDs;
its cell order matches the input and each cell has a full-resolution artifact.

The session is bound to the current request and production, one immutable build,
and a ten-minute lifetime. Close before opening another build. Screenshots,
mechanical diagnostics, attempted coverage and delivery receipts persist beneath
the build's managed QA artifacts. Closing/cancellation does not mean QA passed.
A check's pass covers its observed state only; missing playback, unopened Presenter,
unentered fullscreen, unseen states and visual/narrative review remain incomplete.
Layout heuristics identify candidates to inspect, not design judgments. Older
outputs without a digest must be rebuilt. Missing browser or image capability
preserves the draft and must be reported as incomplete QA.

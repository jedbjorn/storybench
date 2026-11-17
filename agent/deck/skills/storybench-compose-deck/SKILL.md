---
name: storybench-compose-deck
description: Plan, compose, stage, build and revise an editable offline deck.
---

Read the complete saved research with `read_research` before composition; the boot's Saved production research section is the full rule.

### Direction

Read context, story, slides and references first. Before planning a slide, settle the feel the creator intends: mood, imagery, how it moves. The brief, references, channel standards and research tell you; then bring it alive with your own judgment. References establish feel; incorporate their content only under creator direction. Apply channel standards without video intro/outro cards.

**Show, don't tell.** Carry each idea with an animated subject or scene, a diagram, or a few well-chosen words, mixed thoughtfully for the idea at hand. What the presenter says belongs in `notes`. When a slide is turning into paragraphs, find the picture, build or comparison that says it instead; draw the SVG yourself when the library lacks it.

**Composition follows the idea.** Each slide earns its form: choose layout, media and staging because this idea needs them. Neighbouring slides need not share one.

**Creator direction wins.** Anything the creator asks for explicitly overrides these defaults, text-heavy slides and manual reveals included.

### Saving slides

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

Create supporting graphics in the writable work area; inspect with `inspect_image`, then register the SVG itself through `register_work_file`, or reuse an existing asset through `reuse_project_item`. Assign the resulting library item ID in the slides or gallery. HTML ZIP is the preferred deliverable. Export supports validated SVG, raster images and mp4/webm video. SVG inspection returns a PNG derivative while the editable vector remains the asset and ships in the ZIP. Do not replace the vector with its derivative unless the creator requests raster artwork.

The `storybench-svg-1` profile accepts UTF-8 SVG with finite width/height or viewBox (up to 4096 per side), groups/transforms, paths/shapes, text in Manrope or a packaged catalogue font, gradients, local use/clip/mask references and bounded blur/shadow filters. Keep documents below 512 KiB and 2000 elements. Use presentation attributes or simple local `.class`/`#id` style rules; use `font-family` and `font-size` separately. IDs must be unique. No scripts, event attributes, external resources, embedded images, font URLs, DTDs, authored animation, CSS variables or raw HTML. Invalid input reports the unsupported construct; correct the source and register again. Static SVG works as ordinary slide/gallery media. For staged vectors, use independent visible `<g id="...">` groups: do not map definitions, nested mapped groups or geometry referenced by `use`. Local reusable definitions inside visible groups remain supported.

### Reveal timing

By default a slide's reveals start on their own. Give the first stage an `afterMs` near 1,500 so it begins about 1.5 seconds after navigation, and every later stage a positive delay, measured from the previous reveal, so stages run one at a time. Pace to what is animating: text lands in distinct, evenly spaced beats; a diagram or scene that builds across stages uses delays that keep it moving rather than stopping and starting. A zero or omitted `afterMs` waits for manual selection: use it for a moment that needs the presenter's control or when the creator asks, not by default. A first stage without a positive delay is visible on arrival.

The runtime plays one fixed fade per reveal. Delays are the only pacing control; do not promise continuous or eased motion.

This example shows fields and two pacings, not a pattern to repeat. It assumes a registered SVG with visible groups `observe`, `connect` and `plan`:

```js
save_deck({ expectedRevision: revision, slides: [{
  id: "shared_plan", title: "A shared plan", layout: "process",
  vector: { itemId: registered.libraryItemId, alt: "A landscape and three planning steps" },
  stages: [ // one drawing building: keep it moving
    { id: "notice", title: "Observe", svgGroupIds: ["observe"], afterMs: 1500 },
    { id: "connect", title: "Connect", svgGroupIds: ["connect"], afterMs: 700 },
    { id: "act", title: "Plan", svgGroupIds: ["plan"], afterMs: 700 }
  ]
}, {
  id: "three_questions", title: "Three questions", layout: "statement",
  stages: [ // text beats: evenly spaced
    { id: "who", title: "Who is it for?", afterMs: 1500 },
    { id: "why", title: "Why now?", afterMs: 2500 },
    { id: "next", title: "What changes?", afterMs: 2500 }
  ]
}] });
```

Geometry accumulates and holds complete. Replay restarts the sequence. Manual stage selection (audience or Presenter) stops automatic progression; leaving the slide cancels it, hidden tabs pause it, and reduced motion/print show all geometry. Rebuild after changing mappings. On a missing/duplicate group diagnostic, correct the saved stage or register the corrected source, then save the current revision again.

Split crowded content into slides. Use gallery entries for alternate demo views. Check notes and captions. Do not claim aesthetic quality from structural tests.

### Building

Call `build_deck({expectedRevision})` after save. The build snapshots current channel font roles: Base for body/notes, Accent for headings, Alternate for eyebrows/captions. Unset roles keep Manrope. Selected regular/bold files and licences ship in the offline bundle; changes apply on the next build, leaving existing exports intact. Use `await_job({jobId})` and inspect failures, including their slide ID, before revising. Completed jobs expose a portable ZIP at `/api/jobs/<id>/deck/bundle.zip` and preview at `/api/jobs/<id>/deck/index.html`. Ask the creator to use the build's Preview / Download bundle buttons. Reopen saved slides, edit and build a new version; previous successes remain.

### Packaged browser tools

Read `get_capabilities` first (`deck.runtime`, `deck.installation`, `deck.screenshotInput`), as the boot describes. After `build_deck` and `await_job` return a completed build, open that exact ZIP:

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
and a fifteen-minute lifetime. Close before opening another build. Screenshots,
mechanical diagnostics, attempted coverage and delivery receipts persist beneath
the build's managed QA artifacts. Closing/cancellation does not mean QA passed.
A check's pass covers its observed state only; missing playback, unopened Presenter,
unentered fullscreen, unseen states and visual/narrative review remain incomplete.
Layout heuristics identify candidates to inspect, not design judgments. Older
outputs without a digest must be rebuilt.

### Mandatory create and edit correction loop

Creation: build the first representative composition early, inspect it, then repeat after meaningful content/layout/interaction batches. Editing: read the latest saved revision, preserve slide/stage IDs and notes, make the requested changes, rebuild and drive changed slides, adjacent transitions and affected Presenter/reveal/gallery/media states. Shared font/style/runtime changes require every affected state. Finish both workflows with full coverage of the actual delivered ZIP.

Read brief, research, reference direction and channel standards. Assess each returned image for hierarchy, spacing, clipping, contrast, diagram clarity, reference adherence, consistency, copy, and note/narrative coherence. Record specific observations, not a generic “looks good”. Contact sheets establish overview; use full-resolution single-state images and crops for legibility. A contact sheet or cropped image alone cannot establish complete state coverage.

Concrete correction sequence (replace IDs and copy with actual observations):

```js
const opened = open_deck_qa({jobId: completedJob.id, viewport: {width:1280,height:720}});
const image = inspect_deck_qa({sessionId: opened.sessionId}); // LOOK at the returned PNG image block
check_deck_qa({sessionId:opened.sessionId, checks:["console","resources","fonts","layout"]});
report_deck_qa({sessionId:opened.sessionId,
  summary:"Draft: the opening title clips at the right edge.", changesMade:[],
  reviews:[{artifactId:image.screenshots[0].artifactId,
    assessment:"Opening title is clipped; the diagram is legible but has too little heading space.",
    findings:[{severity:"blocking",description:"Opening title clips at 1280x720."}]}]});
close_deck_qa({sessionId:opened.sessionId});
const current = read_deck();
// Edit saved source, not generated HTML. Preserve IDs, mappings and notes.
current.slides[0].title = "A shorter title";
const saved = save_deck({expectedRevision:current.revision, slides:current.slides});
const rebuilt = build_deck({expectedRevision:saved.revision});
await_job({jobId:rebuilt.id}); // require completed; fix errors before continuing
const fresh = open_deck_qa({jobId:rebuilt.id, viewport:{width:1280,height:720}});
act_deck_qa({sessionId:fresh.sessionId, action:"click", selector:'[data-go="0"]'});
act_deck_qa({sessionId:fresh.sessionId, action:"key", key:"ArrowRight"});
act_deck_qa({sessionId:fresh.sessionId, action:"click", selector:"#presenter-open"});
act_deck_qa({sessionId:fresh.sessionId, pageId:"presenter-1", action:"select", selector:"#slide-select", value:"0"});
const corrected = inspect_deck_qa({sessionId:fresh.sessionId}); // assess the NEW image
report_deck_qa({sessionId:fresh.sessionId, summary:"Title corrected; remaining coverage is pending.",
  changesMade:["Shortened opening title in saved slides; rebuilt and checked the new image."],
  reviews:[{artifactId:corrected.screenshots[0].artifactId,
    assessment:"The shortened title fits with clear separation from the diagram.",findings:[]}]});
```

Continue with `act_deck_qa` and `inspect_deck_qa` for **every slide, every distinct reveal/gallery combination and matching Presenter notes**. Use the inventory and DOM selectors returned by the browser. Select each stage (`[data-stage="0"]` or Presenter `#stage-select`) and gallery (`[data-gallery="1"]`), exercise `[data-command="replay"]`, wait through timed reveals, and verify manual takeover stops automatic progression. For a positive first-stage delay inspect the initial pre-reveal state too. Navigate via audience controls, keyboard and Presenter. For each video state at each viewport, click Presenter `[data-command="video-restart"]` or `[data-command="video-toggle"]` and require an advancing `media` check on the visible audience video, not metadata or a paused frame. Use these exact selectors and resize Presenter to the same viewport as the audience. Autoplay or playback started in the audience does not replace the Presenter control operation. Check resource/font/console/layout and matching `presenter` results for each normal audience state. Never treat unverified checks as passed.

Inspect normal screen states with both audience and Presenter at a normal viewport (at least 1200x700) and a constrained viewport (at most 1000x800), for example 1280x720 and 960x720. Resize both pages explicitly with `act_deck_qa({sessionId,pageId,action:"resize",viewport:{width:960,height:720}})`. Capture/assess fresh images after each state change; record each artifact with its actual visual findings. Use `report_deck_qa` in batches; already-reviewed images are immutable evidence, so take another image for a new assessment. Reports return concrete `missing` items until full evidence exists.

Exercise Presenter disconnect/reopen with `close-page` and `#presenter-open`, then check the newly returned page ID and notes. Click `#fullscreen`, check actual `fullscreen` state, and exit with Escape or the fullscreen toggle. Denied fullscreen remains unverified with its diagnostic. Inspect each slide under `emulate` with `reducedMotion:"reduce"`, and separately `media:"print"`, then restore normal screen/no-preference. Check complete geometry in these modes. Read errors and test affected recovery paths. A failed or skipped required operation leaves QA incomplete; retain the draft if blocked.

A rebuild invalidates prior QA completion even at the same saved revision. Old findings remain useful history but never supply fresh coverage for a new build. Correct saved source/assets, preserve conflict handling (re-read on stale revisions), rebuild, repeat the checks and record what changed. Blocking visual findings require correction and a fresh build; do not erase the observation to manufacture a pass.

`report_deck_qa` derives status; there is no caller-supplied complete flag. It retains build identity, coverage, images, assessments, findings and changes separately from successful export. Explicitly close each session before ending the request; closed-session evidence can be accumulated by reopening the same build for another batch. Cancellation, timeout, browser failure, missing/replaced screenshots and stale output cannot establish completion. Unknown/rejected image input permits draft editing/export only. Never switch models or rasterize output to conceal a missing capability.

After the final report, call `close_deck_qa` and `get_deck_qa_report({jobId:deliveredJob.id})`. Deliver the ZIP with the exact build's QA status, evidence paths, concise summary and unresolved limitations. If `qaStatus` is incomplete, label it as a draft; creator-directed early handoff stays explicitly incomplete. Model self-QA does not guarantee the creator's aesthetic judgment or physical dual-display behavior.

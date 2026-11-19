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
- `stages`: ordered `{id,title,body,svgGroupIds?}` reveals with the optional timing and motion fields under Reveal timing and motion. Process needs at least one. Stage IDs survive reorder.
- `vector`: `{itemId,alt}` for a staged registered SVG on title, text-media, full-media or process. Do not also set media or gallery views. Map each stage’s `svgGroupIds` to one or more IDs from `asset.metadata.svgGroupIds` (also returned by `inspect_media`). Each group belongs to only one stage. Groups without a mapping remain visible. Reorder stages with their IDs and mappings intact.
- `media`: `{itemId,alt}` using an image/video member of this deck's library; required on text-media/full-media. `referenceItemIds` are context only.
- `subnav`: independent gallery views `{id,label,itemId?}`. Only image/video items can be shown. Do not use URLs or file paths.
- `design`: this slide's overrides of the deck's layout primitives (below).

Create graphics in the work area and inspect with `inspect_image`. Register the original with `register_work_file` or reuse an asset with `reuse_project_item`, then follow the pick and candidate rules below. Prefer HTML ZIP (SVG, raster, mp4/webm). SVG inspection returns PNG. Ship editable SVG unless the creator requests raster artwork.

`storybench-svg-1` accepts UTF-8 SVG up to 512 KiB, 2000 elements and 4096 pixels per side. Set root dimensions in unitless pixels or `px`, or supply a viewBox. Use groups/transforms, paths/shapes, gradients, local use/clip/mask references and bounded blur/shadow filters. Set `font-family` (Manrope or a packaged font) and `font-size` separately. Use presentation attributes or simple local `.class`/`#id` styles. IDs must be unique. Scripts, events, external resources, embedded images, font URLs, DTDs, authored animation, CSS variables and HTML are forbidden.

Single lengths accept numbers, `px` or `%`. Letter and word spacing also accept `em`, e.g. `letter-spacing=".12em"` or `word-spacing=".2em"`. Filter regions, opacity and stop offsets accept numbers or percentages. Path data, points, transforms, viewBox, blur deviations and dash arrays take unitless numbers.

Use static SVG in slides or galleries. Map stages to independent visible `<g id="...">` groups. Exclude definitions, nested mapped groups and geometry referenced by `use` outside the group. Groups may contain their own reusable definitions.

### Candidates, picks and iterations

A slide's `candidates` are its unpicked visuals, `{itemId,alt,label?}`; the pick (the star) is what `media`, `vector` or `subnav` holds; a gallery's starred views play in `subnav` order.

- Always send every slide's `candidates`, edited from `read_deck`. A save without them can still replace or clear a pick, dropping the creator's choice.
- Add candidates freely. Star only when the creator's message says to use one; otherwise name it (label, iteration, item ID) and propose it. Never unstar the creator's pick without direction.
- A revision is a new iteration: `register_work_file` with `iterationOf` set to the revised item adds the next vN under the group's label. A drawing iteration keeps every group ID the slide's stages reveal, or the editor shows "v4 has no part route-a, so a step reveals nothing." and refuses the star.

Where a request starts decides where its result lands (after the redline skill's go-ahead, when it applies):

- **A slide:** the creator names it, or the note begins `Redline on slide 06 “…” (id) in the slide editor` (Markup or Send to chat). Add the iteration to that slide's candidates, unstarred unless the request says to use it, and propose it. A slide redline may instead need slide changes or a different pick; propose those.
- **The asset preview:** `Make another iteration of “…” (library item …, v2). … do not add it to a slide.` or `Redline on library item “…” (…), iteration v2 of 3, a candidate for slide 06 “…”`. It joins the group only; offer to add it to the slides the note lists.

### Theme and layout primitives

`save_deck` takes an optional top-level `design`, which `read_deck` returns. Omitted, the saved design stays; supplied, it replaces the saved one whole, so edit what `read_deck` returned.

**Theme** (deck level only): `theme.colors` {base, accent, background} as six-digit hex and `theme.fonts` {base, accent, alternate} from the `get_context` catalogue.

- Colours: Base is text (headings, body, controls); Accent marks rules, eyebrows, step numbers, the current rail item, the active stage button and focus; Background is the page (slide, rail, footer, Presenter). Every other template hue derives from these three.
- Fonts: Base for body and notes, Accent for headings, Alternate for eyebrows and captions.
- Per role the build uses the deck value, else the channel's current Brand Standards, else the template (today's palette, Manrope). The boot text lists each role's value and source. A value you change records `setBy: agent`; a null role returns to Brand Standards.
- Creator colours apply as chosen, readable or not; explain their effect only when asked. Contrast among colours you choose is yours to get right.

**Layout primitives** take bounded values only, never CSS:

- `copy` {position, align, valign}: the title and body block.
- `stageText` {style, position, align, valign, numbered, flipMs}: how stage titles and bodies show. `style`: `chips` (titles as buttons, bodies hidden; the vector default), `steps` (numbered sections revealed cumulatively; the text default), `list` (bulleted or numbered items revealed cumulatively, current marked) or `card` (one card that flips to each stage as it starts, with a numbered row and Replay under it). `numbered` applies to list and card; `flipMs` (0 to 2,000) is how long a flip takes. `align` also aligns stage and gallery buttons: `center` centres every wrapped row.
- `type` {scale}: compact, standard or large. `spacing` {density}: compact, standard or spacious.
- `timing` {betweenMs} (0 to 60,000): one gap per slide. Every stage after the first starts that long after the previous stage's motion ends, card, diagram and text alike, and those stages then take no `afterMs`, `holdMs` or manual trigger. The first stage keeps its `afterMs`.

`position` is top, bottom, left or right of the slide's visual (media, vector or gallery) and is refused on a slide without one. `align` is start (left), center or end (right); `valign` is start (top), center or end (bottom). `layout` still sets the slide's form; the primitives arrange text within it.

Two levels: the deck `design` holds defaults and a slide `design` overrides them per argument; the effective value is the slide's, else the deck's, else the template's. Unset values are yours to choose; with none set the template renders as today. Use a deck default for a deck-wide change and a slide override for one slide. Unknown primitives, arguments or values are refused naming the slide or deck, primitive and argument. For example, centred reveal buttons and a flipping card beside the diagram on every slide:

```js
save_deck({ expectedRevision: current.revision, slides: current.slides,
  design: { ...current.design, stageText: { style: "card", position: "right", align: "center" } } });
```

### Reveal timing and motion

By default a slide's reveals start on their own. Give the first stage an `afterMs` near 1,500 so it begins about 1.5 seconds after navigation, and make every later stage automatic so stages run one at a time. Pace to what is animating: text lands in distinct, evenly spaced beats; a diagram or scene that builds across stages flows from one stage into the next without stopping or jumping. A manual stage waits for selection: use it for a moment that needs the presenter's control or when the creator asks, not by default. A first stage without a positive delay is visible on arrival.

Every field here is optional; a stage that sets none fades in over a fixed short time.

- `trigger`: `"auto"` or `"manual"`. Unset, a positive `afterMs` is automatic and zero or none is manual.
- `afterMs` (0 to 3,600,000): delay before the stage begins. With `trigger: "auto"` it may be 0, so one stage flows straight into the next.
- `durationMs` (0 to 60,000): how long the stage's motion takes. Unset keeps the short fade, which does not push the next stage.
- `holdMs` (0 to 3,600,000): rest after the motion before the next stage's delay starts.
- `easing`: `linear`, `ease-in`, `ease-out` or `ease-in-out`.
- `motion`: `fade` (default; text and SVG groups), `draw` (strokes run along their length and fills arrive as they complete; only for groups `inspect_media` lists in `svgGroups` with `stroked: true`) or `enter` (groups arrive from `from`). `draw` and `enter` need `svgGroupIds`.
- `from`, and each `to` in `changes`: `{x?,y?,scale?,rotate?,opacity?}` relative to the authored geometry. `x`/`y` are SVG units within ±8,192, `scale` 0 to 16, `rotate` within ±3,600 degrees, `opacity` 0 to 1.
- `changes`: up to 64 `{groupId,to}` entries that move groups an earlier stage revealed, from the state the previous stage left to `to`, over `durationMs` with `easing`. State accumulates. A vector stage needs `svgGroupIds`, `changes` or both.

A stage begins at the previous stage's start, plus that stage's `durationMs` when it set one, plus its `holdMs`, plus its own `afterMs`. Save and build refuse an unknown value, a number out of bounds, `draw` on a group without strokes, and `changes` naming a group that no earlier stage revealed; the error names the slide and stage. The runtime plays the motion: the SVG stays static source, and authored animation is still rejected.

This example shows the fields, not a pattern to repeat: a diagram that draws itself and flows through its stages, then text in even beats. It assumes a registered SVG whose groups `route` and `stops` hold stroked geometry, with a third group `parcel`:

```js
save_deck({ expectedRevision: revision, slides: [{
  id: "order_route", title: "How an order travels", layout: "process",
  vector: { itemId: registered.libraryItemId, alt: "A route with three stops and a parcel moving along it" },
  stages: [ // one drawing: each stage starts as the last one ends
    { id: "route", title: "The route", svgGroupIds: ["route"], motion: "draw", afterMs: 1500, durationMs: 1200, easing: "ease-in-out" },
    { id: "stops", title: "Three stops", svgGroupIds: ["stops"], motion: "draw", trigger: "auto", afterMs: 0, durationMs: 800 },
    { id: "parcel", title: "A parcel", svgGroupIds: ["parcel"], motion: "enter", from: { y: -30, opacity: 0 }, trigger: "auto", afterMs: 0, durationMs: 400, holdMs: 300 },
    { id: "travel", title: "On its way", changes: [{ groupId: "parcel", to: { x: 320 } }], trigger: "auto", afterMs: 0, durationMs: 2000, easing: "ease-in-out" }
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

Geometry accumulates and holds complete. Replay restarts the sequence. Manual stage selection in either view stops progression. Leaving cancels it, hidden tabs pause it, and reduced motion/print show all geometry. For missing or duplicate groups, follow the correction loop below. Rebuild after changing mappings.

Split crowded content into slides. Use gallery entries for alternate demo views. Check notes and captions. Do not claim aesthetic quality from structural tests.

### Building

After saving, call `build_deck({expectedRevision})` and `await_job({jobId})`. Inspect failures and slide IDs before revising. Builds snapshot effective theme and design and bundle selected regular/bold fonts and licences. Later channel changes apply on the next build. Completed jobs expose `/api/jobs/<id>/deck/bundle.zip` and `/api/jobs/<id>/deck/index.html` via Download bundle and Preview. Previous exports remain intact.

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
{"tool":"act_deck_qa","arguments":{"sessionId":"<session-id>","action":"seek","timeMs":2100}}
{"tool":"inspect_deck_qa","arguments":{"sessionId":"<session-id>","frames":{"fromMs":1500,"toMs":5900,"count":6}}}
{"tool":"check_deck_qa","arguments":{"sessionId":"<session-id>","checks":["motion"]}}
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

Every `inspect_deck_qa` and `act_deck_qa` state carries the current slide's
`timeline`: each stage's `id`, `trigger`, `startMs`, `motionEndMs` and `holdEndMs`,
the current `timeMs`, and `state` (`playing`, `paused`, `waiting` on a manual stage,
or `complete`). `seek` with `timeMs` pauses the slide exactly as it is at that
time, with no real-time wait; `resume` plays on from there. `frames` on
`inspect_deck_qa` takes `timesMs` (up to eight) or `fromMs`, `toMs` and `count`,
and returns one filmstrip in time order, labelled with its times, plus a
full-resolution artifact per frame; review it by `filmstrip.artifactId`. Frames
count toward the screenshot limit and leave the timeline paused at the last one.
`check_deck_qa` with `checks: ["motion"]`, requested on its own, plays the current
slide from navigation in real time for at most 15 seconds, reports each stage's
observed start against its saved start, then leaves and re-enters the slide and
confirms nothing is still running. Stages beyond the window are `unobserved` and
stages behind a manual one are `manual`; neither is passed, so seek to them.

The session is bound to the current request and production, one immutable build,
and a fifteen-minute lifetime. Close before opening another build. Screenshots,
mechanical diagnostics, attempted coverage and delivery receipts persist beneath
the build's managed QA artifacts. Closing/cancellation does not mean QA passed.
A check's pass covers its observed state only; missing playback, unopened Presenter,
unentered fullscreen, unseen states and visual/narrative review remain incomplete.
Layout heuristics identify candidates to inspect, not design judgments. Older
outputs without a digest must be rebuilt.

### Mandatory create and edit correction loop

Creation: build and inspect a representative composition early and after meaningful batches. Editing: read the latest revision, preserve slide/stage IDs and notes, make requested changes, rebuild and drive changed slides, adjacent transitions and affected Presenter/reveal/gallery/media states. Shared font/style/runtime changes require every affected state. Cover the exact delivered ZIP.

Keep creator-directed picks through every QA pass and rebuild. “Use it” selects only the proposed iteration. Preserve the rest of the slide for a pick-only request. If a pick has a blocking defect, report it with `report_deck_qa` and propose a corrected unstarred iteration as a candidate. Register it with `iterationOf`. Star it only after a new creator instruction to use that iteration.

Assess each image against the brief, research, references and standards. Record specific findings on hierarchy, spacing, clipping, contrast, diagram clarity, consistency, copy and note/narrative coherence. Use contact sheets for overview, full-resolution state images for coverage, and crops for legibility. A contact sheet or crop alone leaves state coverage incomplete.

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
// Correct the saved source within creator direction. Preserve picks, IDs, mappings and notes.
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

Motion needs filmstrip evidence. For every slide with an automatic stage, `draw`, `enter` or `changes`, review a filmstrip of at least two times at a normal viewport and at a constrained one, with times inside each stage's motion, and pass a `motion` check. End-state screenshots do not show motion. Judge pacing from the frames: text in distinct beats, a diagram that flows without a jump or a reset.

Inspect normal screen states with both audience and Presenter at a normal viewport (at least 1200x700) and a constrained viewport (at most 1000x800), for example 1280x720 and 960x720. Resize both pages explicitly with `act_deck_qa({sessionId,pageId,action:"resize",viewport:{width:960,height:720}})`. Capture/assess fresh images after each state change; record each artifact with its actual visual findings. Use `report_deck_qa` in batches; already-reviewed images are immutable evidence, so take another image for a new assessment. Reports return concrete `missing` items until full evidence exists.

Exercise Presenter disconnect/reopen with `close-page` and `#presenter-open`, then check the newly returned page ID and notes. Click `#fullscreen`, check actual `fullscreen` state, and exit with Escape or the fullscreen toggle. Denied fullscreen remains unverified with its diagnostic. Inspect each slide under `emulate` with `reducedMotion:"reduce"`, and separately `media:"print"`, then restore normal screen/no-preference. Check complete geometry in these modes. Read errors and test affected recovery paths. A failed or skipped required operation leaves QA incomplete; retain the draft if blocked.

A rebuild requires fresh QA even at the same revision. Retain prior findings as history. Correct saved source within creator direction, re-read on conflicts, rebuild, repeat checks and record changes. Blocking findings stay open until a fresh build confirms the fix. If a correction needs creator direction, retain a draft and report QA incomplete.

`report_deck_qa` derives status; there is no caller-supplied complete flag. It retains build identity, coverage, images, assessments, findings and changes separately from successful export. Explicitly close each session before ending the request; closed-session evidence can be accumulated by reopening the same build for another batch. Cancellation, timeout, browser failure, missing/replaced screenshots and stale output cannot establish completion. Unknown/rejected image input permits draft editing/export only. Never switch models or rasterize output to conceal a missing capability.

After the final report, call `close_deck_qa` and `get_deck_qa_report({jobId:deliveredJob.id})`. Deliver the ZIP with the exact build's QA status, evidence paths, concise summary and unresolved limitations. If `qaStatus` is incomplete, label it as a draft; creator-directed early handoff stays explicitly incomplete. Model self-QA does not guarantee the creator's aesthetic judgment or physical dual-display behavior.

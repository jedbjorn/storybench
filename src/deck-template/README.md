# Offline deck builder contract (v2)

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
- `fonts`: optional array of up to three supported catalogue family names or null slots. Base styles body text and presenter notes; Accent styles headings; Alternate styles eyebrows and captions. Unset roles use Manrope. Both regular/bold files and licences for selected families are copied into the bundle; no installed font, server or network is needed. The app snapshots the effective font roles (deck theme, else channel Brand Standards) when queuing a build. Existing exports are unchanged; rebuild to use new standards. Unsupported or missing font files fail the build visibly.
- `colors`: optional object of `base`, `accent` and `background` six-digit hex values (null or absent = unset). Base is the text colour (`--ink`), Accent the accent (`--accent`), Background the page (`--paper`). Every other template hue (muted text, lines, rail fill, hover, current rail item, slide glow, section-slide tint, figure placeholder, active stage button, skip link, print page) is mixed from the roles it depends on and written as build-time literals; a hue whose roles are all unset keeps the template value, so a deck with no colours keeps today's stylesheet. Colours are applied as given, with no contrast correction. The app resolves each role from the deck theme, else the channel's current Brand Standards, and records the effective roles and their sources in `manifest.json` (`colors`, `fonts`, `theme`).
- `slides`: nonempty ordered array. Each has a unique `id` matching `[A-Za-z][A-Za-z0-9_-]*`, a nonempty `title`, and a `layout` below.
- Each slide optionally has plain-text `body`, `eyebrow`, `notes`, and finite nonnegative `targetMinutes` (default 0). Notes are visible only in Presenter but remain in exported HTML: they are not secret. Line breaks are preserved in body/notes.
- `title` and `section` layouts provide large chapter headings; `statement` provides a focused message; `text-media` pairs copy and media; `columns` requires two or three `{title, body}` objects (an empty or missing `body` shows the column title only); `full-media` emphasizes a local image or demo video; `process` requires reveal stages. All are data-driven and responsive.
- `media` on text-media/full-media: `{type: 'image'|'video', src, alt, poster?, autoplay?}`. Alt is required plain text. Autoplay is a boolean (default false), muted, and disabled for reduced motion. Poster is an optional local image path for video; include it for printed/video fallback content.
- Media paths must be a single filename under `assets/`, using letters, digits, underscores, dots and hyphens. Image extensions: svg/png/jpg/jpeg/webp/gif. Video: mp4/webm. No URL, traversal or nested path is accepted. `assets` maps these paths to nonempty Uint8Array/Buffer bytes; provide actual media of the declared format. SVG uses the shared [parsed profile](../../docs/svg-profile.md). Original SVG bytes enter the bundle; validated inline instances receive independent IDs/styles and use bundled fonts. Filesystem acquisition and media inspection belong to the calling builder.
- Any layout may include `stages: [{title, body?, afterMs?}]`. Stage 0 is initially visible unless its positive `afterMs` delays it; subsequent stages reveal cumulatively after `afterMs` milliseconds relative to the preceding reveal. Zero/omitted delay waits for manual selection; delays range from 0 to 3600000. Process lays these out as a numbered diagram. Optional `subnav` is an array of plain-text labels with exactly one label per stage; default labels are stage titles.
- Stage timing and motion (all optional; a stage that sets none plays as above, and its HTML is unchanged):
  - `trigger`: `"auto"` or `"manual"`. Unset: a positive `afterMs` is automatic. With `"auto"`, `afterMs` may be 0 so one stage flows straight into the next. `afterMs` is ignored on a manual stage.
  - `durationMs` (0 to 60000): how long the stage's motion takes. Unset keeps the 450 ms fade and does not push the next stage.
  - `holdMs` (0 to 3600000): rest after the motion before the next stage's delay starts.
  - `easing`: `linear`, `ease-in`, `ease-out`, `ease-in-out`. Unset keeps the fade's curve (CSS `ease`).
  - `motion`: `fade` (default; text and SVG groups), `draw` (SVG groups with stroked geometry: strokes run along their length, fills and unstroked parts arrive over the last fifth), `enter` (SVG groups arrive from `from` to their authored state).
  - `from` and each `changes[].to`: `{x?, y?, scale?, rotate?, opacity?}` relative to the authored geometry. `x`/`y` are SVG user units (±8192), `scale` 0 to 16 and `rotate` ±3600 degrees about the group's centre, `opacity` 0 to 1.
  - `changes: [{groupId, to}]` (at most 64) moves groups revealed by an earlier stage from the state the previous stage left to `to`, over `durationMs` with `easing`. State accumulates; a property `to` omits keeps its value. A vector stage needs `svgGroupIds`, `changes` or both.
  - Refusals name the slide and the stage: an unknown value or a number out of bounds; `draw` on a group with no stroked geometry; `draw` or `enter` on a stage with no SVG groups; `changes` on a group that is unknown, unmapped, revealed by the same or a later stage, or named twice.

- Staged `vector` uses the same `{type: 'image', src, alt}` shape as media, on title/text-media/full-media/process with no media/gallery. Every stage must have a unique stable `id` and nonempty `svgGroupIds` (or `changes`, below). Group mappings are revalidated against parsed source; visible independent groups receive trusted wrappers while their transforms, styles and geometry remain intact. Duplicate, missing, nested, definition-only and reused mappings fail explicitly. Unmapped artwork remains visible.

- `design` on a slide: optional layout primitives, the slide's effective values (the app resolves each argument from the slide, else the deck's defaults, and records both in `manifest.json` `design`). See Layout primitives below. Absent or `{}`, the slide renders exactly as without it.

The synthetic example demonstrates every layout and optional field family. Its synthetic geometric image can be replaced with local media by supplying different bytes. It is a contract demonstration, not the companion production authoring demo.

Up/Down and Previous/Next change slides; Left/Right select reveal stages; Home/End select endpoints; N opens Presenter. Side navigation exposes the current slide. Inputs and editable elements retain their keyboard behavior. Manual reveal/media controls cancel automatic reveal for that visit; hidden tabs pause timing, motion and playback. Returning resumes from the same point. Replay in either window restarts the sequence; complete diagrams hold without looping. Slide changes stop outgoing media. Print exposes all slides and final staged content; reduced motion exposes all staged content and disables automatic timing. Failed playback leaves native controls available. Fullscreen and popup failures provide retry guidance.

## Layout primitives

Bounded arguments only; no colour, font, raw style or markup. Refusals name the slide, primitive and argument. Deck aspectRatio defaults to 16:9 and also accepts 16:10. A 1920-wide frame uses 68 units of padding at each side and 28 above and below. It scales uniformly inside the available audience area.

| Primitive | Arguments |
|---|---|
| `copy` | `position`, `align`, `valign` for the block, plus independent `titleWidth` and `bodyWidth` percentages (20–100) |
| `stageText` | `style` (`chips`, `steps`, `list`, `card`), `position`, `align`, `valign`, `numbered` (list and card), `flipMs` (card, 0 to 2000) |
| `type` | `scale`: `compact`, `standard`, `large` (headings and body together) |
| `spacing` | `density`: `compact`, `standard`, `spacious` (internal gaps) |
| `timing` | `betweenMs` (0 to 60000) |

- `position` (`top`, `bottom`, `left`, `right`) places the block on that side of the slide's visual: rendered media (text-media, full-media), a vector or a gallery. It needs a visual. With a position set, stage text sits on its side of the visual and the copy on its side of both; an unset copy position stays left on text-media and above otherwise, an unset stage text position below.
- `align` (`start`, `center`, `end`) aligns the block's content horizontally. Stage text alignment also aligns the stage and gallery buttons, each wrapped row on its own.
- `valign` (`start` = top, `end` = bottom) aligns the block within its area: beside the visual, the row; otherwise the slide's column (the copy moves the column's content, stage text `end` sits at its foot). In a card, it also aligns each face within the card's height.
- `chips` shows stage navigation labels as buttons (vector default). `steps` shows cumulative numbered sections with selectable titles (text default). `list` shows cumulative selectable items. `card` shows the current face. Each style shares footer Replay, arrow-key navigation and Presenter's stage selector. Presenter uses each stage's saved navigation label.
- The card reserves the height of its tallest stage. Its flip takes `flipMs` (unset 400 ms) from the moment its stage starts and is part of that stage's motion (`motionEndMs`). Reduced motion swaps faces without turning; print shows every stage as a list.
- `timing.betweenMs`: every stage after the first starts `betweenMs` after the previous stage's motion ends (card flip, diagram and stage text alike) and is automatic; the first stage keeps its own `afterMs`. Stages after the first may then set no `afterMs`, `holdMs` or manual `trigger`.

## Timeline

Each slide has one timeline, computed from its stages. A stage begins at the previous stage's start, plus that stage's `durationMs` when it set one, plus its `holdMs`, plus this stage's `afterMs`; the first begins `afterMs` after navigation. A manual stage sits where everything before it has come to rest, and the clock stops there until someone steps into it. The whole look of a slide is a function of the timeline's time, so any moment can be shown exactly. The motion data lives in `data-delay` and a JSON `data-motion` attribute on each stage; it adds no script, style or markup to the artwork, and the bundled SVG file is byte-identical to its source.

The audience page exposes the timeline as `window.storybenchDeck` for editors and QA. Every method returns the current slide's timeline as it then is:

```js
storybenchDeck.timeline()   // read
storybenchDeck.seek(timeMs) // pause and show the slide exactly as it is at timeMs (clamped to 0..durationMs); no real-time wait
storybenchDeck.pause()      // hold the clock where it is
storybenchDeck.resume()     // play on in real time from the current time
storybenchDeck.replay()     // restart from zero, as the Replay button does

{ version: 1, slideId, index, visit, state, timeMs, durationMs, stage,
  stages: [{ id, trigger: 'auto' | 'manual', startMs, motionEndMs, holdEndMs }] }
```

- `state`: `playing`; `paused` (by `pause`/`seek`, a hidden tab or print); `waiting` (stopped before a manual stage, or after a person selected a stage, with stages left); `complete` (nothing further will happen; always the case under reduced motion).
- `timeMs` is the time shown. `durationMs` is when the last motion and hold have ended. `stage` is the index of the latest stage begun, or null before the first begins or when the slide has none. `holdEndMs` is when the next stage's delay starts counting; with an unset duration it precedes `motionEndMs`, because the short fade does not push the next stage.
- `visit` increases each time the slide is entered or replayed, so a caller can tell a restart from a continuation.
- After `seek`, stages are begun by time alone, manual ones included, so a manual stage's motion can be inspected; `resume` then plays on from there.

Leaving a slide cancels its timeline; returning starts it from zero. Selecting a stage stops automatic progression for that visit: one stage forward plays that stage's motion once, any other selection shows the selected stage's end state at once. Presenter's stage controls and Replay go through the same paths. A hidden tab holds the clock and resumes from the same time. Reduced motion and print show every group in its final state with nothing running; print applies it to every slide. Print emulation is noticed on the next frame, or at once by any call above.

When the audience page runs inside a frame, it posts `{type: 'storybench-deck-state', version: 1, slideId, index, stage, gallery}` to the embedding page on every change, and again when the parent window posts `{type: 'storybench-deck-state-request'}`. `stage` and `gallery` are the reveal stage and gallery view indexes, or null when the slide has none. The message carries no titles, notes or slide content; opened standalone (no parent frame), the page posts nothing. Builds with this runtime record `stateReporting: 1` in `manifest.json`; Storybench treats builds without it as unable to report their viewed slide.

## Slides canvas

The app's Slides canvas shows one saved slide built by this builder with the deck's effective theme and design, in a sandboxed frame under the bundle's own Content Security Policy. The app adds `canvas-frame.js` beside `audience.js` there; it never enters a bundle. It seeks the slide to its full reveal (or a stage the editor asks for, shown at the end of its motion), pauses any media, and posts `{type: 'storybench-canvas', version: 1, slideId, stage, stages, area, blocks, fields, overflow, scroll, playing, pulse}` to the editor: the slide area and the boxes of `.copy`, `.stage-text` and `.visual` (a `display: contents` wrapper reports its children's boxes). The editor draws selection over the frame from those boxes and may post `storybench-canvas-show` (`stage`), `storybench-canvas-width` (`field`, `width`) and `storybench-canvas-play`. The frame never reaches the editor's page.

Text on the slide (spec #46): the frame is inert except during one text edit. On a double-click the editor makes it live, focuses it and posts `storybench-canvas-edit` (`x`, `y` in frame coordinates). If the point is on the title (`.copy > h1`), the body (`.copy > .lede`), a column's title or body, or a step label (a step's `h2` or its `[data-stage]` button), that element becomes `contenteditable="plaintext-only"` in place, so it keeps the slide's own font, size and position. The frame posts `{type: 'storybench-canvas-text', version: 1, phase, field: {name, index}, text}`: `start`, `input` on each change, then `end`, or `none` when nothing editable is at the point. `name` is the saved field (`title`, `body`, `columns.title`, `columns.body`, `stages.title`). In `input` and `end`, `text` is the text a commit saves; it is null when nothing would be saved (the text is unchanged, or a required field is empty). Enter (single-line fields), a click off or focus leaving commits; Escape restores the saved text. Pasted text is inserted as plain text. While editing, keys and clicks do not reach the runtime's stage controls.

Play (the slide editor's Play slide and the slide list's Play) replays the slide's own timeline from its start. Where the timeline waits for a person, the bridge reports the next stage as `pulse`, waits a short pause and selects that stage through the timeline; an automatic stage held back by that click waits its own gap. Each report carries the stage reached and `playing: true`; at the end the slide is held at the full reveal and reported with `playing: false`. Showing a stage stops Play. The slide list's inline preview is the same frame, with Play and no selection.

Presenter uses unpredictable per-opening channels and checks the actual source window, supporting opaque file origins. It displays current/next titles, notes, target minutes, slide/stage selectors and video controls. Heartbeats report lost connections; reopen from the audience to recover. All authored text is escaped on export and presenter messages use textContent. The runtime has no raw HTML authoring mode.

Automated DOM and offline-closure checks run in `test/deck-template.test.js`. They do not establish visual composition quality, browser fullscreen or autoplay behavior. Real-browser, live-provider and deployed-app checks are deferred to hands-on refinement, as authorized for this pre-alpha.

# Authoring and presenting decks

Create a production and choose **Deck**, or load the editable synthetic demo below. Open Slides to add, duplicate, reorder and delete slides. Edit titles, copy, notes, layout, duration, columns and reveal stages directly. Import images or video in Library, then choose the member on a slide or gallery entry. Story and chat remain available. Changes save with revision checks; reload/resolve a conflict before building or sending chat.

Choose **Build saved deck** in Slides. The job shows progress and errors (media errors identify the slide). Cancel an active build if needed. The newest build stays in view and older ones fold under **Earlier builds**. A completed build offers **Preview** (eye icon), which opens the deck in a popup closed only by its X, and **Download bundle (ZIP)** (download icon). Preview is sandboxed; use the downloaded bundle for presenter windows/fullscreen. Unzip and open `index.html`; keep the directory together. Press N or Presenter to open notes and presentation controls. Presenter notes are included in the shared files. No Storybench server or network is required for exported playback.

Keyboard: Up/Down changes slides, Left/Right changes reveals, Home/End jumps, N opens presenter. Gallery buttons select independent views. Replay restarts the reveal sequence; manual stage selection stops automatic progression. Hidden tabs pause timing. Reduced motion and print show complete content. Native video controls remain available. Local browser popup, autoplay and file-window behavior can vary; reopen Presenter from the audience if disconnected.

To let the agent author a deck, describe the audience, narrative and desired feel in chat. Deck skills instruct it to read current state, save story/slides, register or reuse media, build and await completion. All harnesses share the same validated fields and revisions. Images may be supported SVG or PNG/JPEG/GIF/WebP; videos MP4/WebM. Register SVG source directly: inspection/thumbnail PNGs supplement the retained editable vector. HTML ZIP is the preferred output. See the [SVG profile](svg-profile.md) for supported geometry, styles, fonts and limits. Scripts and raw HTML are not authoring fields. A missing/unsupported asset or invalid layout fails the build without replacing earlier successes.

## Staged vector illustrations

Import a supported SVG in Library. In Slides, use title, text-media, full-media or process layout and select it under **Staged SVG**. Leave ordinary Media empty and remove gallery views on that slide. Add reveal stages; select one or more SVG group IDs for each stage (Ctrl/Command selects multiple). Reorder with the stage arrows: IDs and mappings move together. Duplicate creates new stage IDs while retaining the geometry mappings.

The SVG must give visible groups stable IDs, for example `<g id="foundation">…</g>`. Each stage needs at least one group; a group may appear in only one mapping. Unmapped artwork stays visible. Definitions, nested mapped groups and mapped geometry reused through `use` are rejected with an asset/slide error; use independent visible groups. Group IDs come from the registered source, not exported instance names. Choosing a static SVG under ordinary Media still works without stages.

A positive first reveal delay holds the opening geometry back; subsequent delays run relative to the previous reveal. Zero on later stages waits for manual selection. The diagram holds complete until Replay or slide re-entry. Audience and Presenter stage controls share the same state. Download and unzip the bundle to use Presenter/fullscreen; use extended displays, move Presenter to the notes screen and the audience window to the presentation screen.

## Try the editable demo

Requires Node 24, installed dependencies and ffmpeg. Create a fresh disposable workspace:

```sh
node scripts/create-deck-demo.mjs --workspace /absolute/path/to/deck-demo
node src/server.js --workspace /absolute/path/to/deck-demo --port 4173
```

Open `http://127.0.0.1:4173`, select **A clearer path — editable demo**, then Slides and Build saved deck. Use your configured port if 4173 is occupied. To add the demo to an existing initialized installation, run the script with `--data-root /absolute/existing/data-root` while the app is stopped; it adds a new deck and does not alter existing productions. Each invocation adds a new example.

The eight slides use exactly the same persisted schema as ordinary editing: title, focused statement, section, text/media, comparison, staged process, local video/gallery and closing. Media are an original synthetic illustration and an ffmpeg-generated motion study; Manrope's license ships in the bundle. Edit the notes or process stages manually, ask the agent to refine a slide, build, reopen and build again. Every successful build is a separate versioned draft. Deck Final publication and automatic bundle cleanup are deferred; video Draft/Final controls remain unchanged.

## Evidence and remaining exploration

Automated integration covers manual DOM editing and API save, deterministic fake-agent tools through the request bridge, three native adapter schema/filter fixtures, build/ZIP file equality, reopen/rebuild, missing/unsafe media, cancellation, stale revisions, sandbox headers and video regression in CI. Fake agents establish tool semantics, not real-model design ability.

Local reference source/structure review compared reusable composition and interaction patterns: navigation rail and hierarchy, chapter/statement contrast, paired copy/media, comparison columns, cumulative process reveals, gallery tabs and presenter notes/control synchronization. The generic template retains these patterns; gallery media is mapped separately from reveals so authoring preserves both. No private reference copy, screenshots or assets are distributed. The demo uses synthetic text and media through saved state rather than special-case HTML.

No real-provider, manual-browser, deployed-app or final aesthetic/presentation-use pass is claimed. These are accepted pre-alpha uncertainties for hands-on refinement. No deployment is part of this delivery.

### Packaged browser inspection

Deck requests expose `open_deck_qa`, `act_deck_qa`, `inspect_deck_qa`,
`check_deck_qa` and `close_deck_qa` through the same scoped MCP bridge on Codex,
Claude and OpenCode. The app image contains Playwright 1.63.0 and its matching
Chromium revision 1243 (153.0.8010.12), installed at image build time; no personal
browser, provider call or runtime browser download is involved. Browser OS
libraries use the image's pinned Debian snapshot. The worker needs no browser.

Open accepts a completed build ID, validates the saved ZIP digest and extracts a
private snapshot. Changed/older undigested bundles require rebuilding. Browser
navigation and resources stay within that snapshot; external HTTP/WebSockets and
outside files are refused. The browser receives a fresh temporary profile and an
explicit environment without provider/account/proxy credentials. Only trusted
exported runtime and validated assets are supported browser input.

Sessions are request-owned, limited to one per request/two per app, fifteen minutes,
four pages, 120 screenshots and 600 actions. Operations time out after 20 seconds;
individual browser actions use five seconds. Viewports are bounded to 1920×1080,
V8 heaps to 128 MiB and renderer count to two. Release checks run with a 1536 MiB
container memory ceiling. Close, cancellation, request teardown, browser failure
and expiration reclaim the profile/extraction; managed evidence remains at
`outputs/decks/<job>/qa/<session>/`. Each session JSON identifies the build digest,
revision, browser, page/state/viewport coverage, checks and screenshot artifacts.
Screenshots acknowledged by the MCP transport are marked delivered, which does
not assert that the model reviewed them. A closed session is still QA incomplete.

Font checks explicitly load every bundled face, including unused weights, and
report family, weight, style and load status. This checks package integrity;
an initially unloaded face alone does not prove a rendering defect. Layout
diagnostics account for scrollable content, flag oversized content, inaccessible
clipping and overlap with fixed or sticky footer/status controls, and still require image
review. Print contact sheets select slides through the runtime even though
print CSS hides the screen navigation.

The real-browser proof is `node src/runtime/browser-check.js`. It tests all three
MCP routes without inference, including image decoding, file-URL ZIP rendering,
local fonts, presenter notes/control, SVG reveals, MP4 and WebM playback, gallery,
contact sheets and retained evidence. Missing Chromium fails this proof. The CI
release image runs it with networking disabled; Node CI also installs the pinned
browser for the mandatory regression suite. This proves exercised Chromium states,
not a live model's aesthetic judgment, another browser, or physical dual displays.


## Installed deck readiness

Install/update and reused releases must pass network-disabled checks against both exact image IDs before activation. The app diagnostic exercises retained SVG source, saved stages, extracted ZIP playback, Presenter, local fonts, MP4/WebM and screenshot image blocks through all three harness routes. The worker diagnostic proves SVG parsing, native raster inspection and the authoring command. Failed checks preserve the previous release. `storybench doctor` reruns these disposable diagnostics; use a normal update to repair an image rather than installing packages inside a running container.

The manifest retains versioned, commit/image-bound deck evidence separately from command versions. Old manifests remain readable but cannot advertise verified deck support. Startup runs a bounded parser/renderer/template/font/browser screenshot check once per runtime identity. `/api/health`, `get_context` and `get_capabilities` report startup results separately from installation evidence. A local development check is identified as local. Screenshot tool availability and tested MCP image transport do not prove that an unknown selected model can interpret images; text-only routes may edit/export drafts but cannot finish visual QA.

## Reproduce the synthetic delivery

The editable demo includes a retained SVG illustration and four saved reveal groups, seven composition layouts, a local gallery/video and Presenter notes. Its source SVG is also kept in the deck work directory. It uses no private reference assets.

```sh
node src/runtime/deck-demo-check.js /absolute/path/to/demo-artifacts
```

This generates `demo.zip`, `editable-source.json`, `report.json` and a reopenable `workspace/` containing saved slides, media, build-bound screenshots and session evidence. Open the workspace using `node src/server.js --workspace /absolute/path/to/demo-artifacts/workspace --port <available-port>`, or unzip `demo.zip` and open `index.html` offline. Report image paths are relative to `workspace/`. The script exercises both pages at normal/constrained viewports, every reveal/gallery state, media, fullscreen and print/reduced motion. Its image assessments are explicitly scripted automated evidence. Deployment, live-model interpretation, physical displays and final aesthetic judgment remain pending for the installation owner after deployment.

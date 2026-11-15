# Authoring and presenting decks

Create a production and choose **Deck**, or load the editable synthetic demo below. Open Slides to add, duplicate, reorder and delete slides. Edit titles, copy, notes, layout, duration, columns and reveal stages directly. Import images or video in Library, then choose the member on a slide or gallery entry. Story and chat remain available. Changes save with revision checks; reload/resolve a conflict before building or sending chat.

Choose **Build saved deck** in Slides. The job shows progress and errors (media errors identify the slide). Cancel an active build if needed. A completed build offers **Open preview** and **Download bundle (ZIP)**. Preview is sandboxed; use the downloaded bundle for presenter windows/fullscreen. Unzip and open `index.html`; keep the directory together. Press N or Presenter to open notes and presentation controls. Presenter notes are included in the shared files. No Storybench server or network is required for exported playback.

Keyboard: Up/Down changes slides, Left/Right changes reveals, Home/End jumps, N opens presenter. Gallery buttons select independent views. Reduced motion disables automatic reveals. Native video controls remain available. Local browser popup, autoplay and file-window behavior can vary; reopen Presenter from the audience if disconnected.

To let the agent author a deck, describe the audience, narrative and desired feel in chat. Deck skills instruct it to read current state, save story/slides, register or reuse media, build and await completion. All harnesses share the same validated fields and revisions. Images may be supported SVG or PNG/JPEG/GIF/WebP; videos MP4/WebM. Register SVG source directly: inspection/thumbnail PNGs supplement the retained editable vector. HTML ZIP is the preferred output. See the [SVG profile](svg-profile.md) for supported geometry, styles, fonts and limits. Scripts and raw HTML are not authoring fields. A missing/unsupported asset or invalid layout fails the build without replacing earlier successes.

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

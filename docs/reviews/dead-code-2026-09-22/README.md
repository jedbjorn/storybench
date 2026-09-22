# Dead code and dependency audit

Reviewed commit: `2a29c0b19982426ae791bcd6e25d39cd386ff4db` (main, 2026-09-22).

**Recommendation: keep all declared dependencies; schedule a bounded code cleanup.**
The dependency inventory is clean for unused direct packages. The source is not entirely
clean: an obsolete rendering implementation, unused declarations/imports and obsolete
styles remain. These are maintenance findings, not demonstrated merge-blocking defects.
This review changes no application code and opens no blocker flags.

## Confirmed cleanup

### 1. Legacy renderer has only test callers

`src/media.js:226` (`validateRenderPlan`) and `src/media.js:279` (`renderEpisode`)
are used only by `test/media.test.js` and each other. The app's live path is
`src/render-service.js:45` → `buildRenderPlan`, then `src/render-service.js:86` →
`renderCompositionImpl` (defaulting to `src/composition-renderer.js:47`). No server,
CLI, worker, browser or proof script invokes the old renderer.

Remove the old renderer and its exclusive helpers (`number`, `assetMap`,
`FPS`, `EPSILON`, `frameTime`) after moving any still-useful assertions to the active
composition tests. **Keep** `importMedia`, `probeMedia`, `within`, `mediaError`,
`workspacePath`, `run` and `capture`: import/probe/thumbnail work still uses them. Narrow the progress
handling in `run` only after confirming the remaining thumbnail caller's needs.

The old tests cover decoded fractional cuts, narration timing, cancellation,
source preservation, 1080p output and optional real VP9 input. Existing
`test/composition-renderer.test.js` and `test/composition-plan.test.js` already cover
several of these, but deletion must not silently remove the remaining useful checks.
Keep the import/deduplication test in `test/media.test.js`.

### 2. Three declarations have no callers or consumers

| Location | Declaration | Recommendation |
| --- | --- | --- |
| `src/services/channels.js:36` | `listChannelEpisodes` | Remove unused wrapper; keep `Store.listEpisodes`. |
| `src/runtime/app-runtime.js:108` | `createWorkerCodexFactory` | Remove obsolete alias and update the introductory comment; callers use `createWorkerHarnessFactory`. |
| `src/store.js:39` | `MESSAGE_ORIGINS` | Remove unused constant; do not alter database constraints or message validation. |

### 3. Six unused application imports

| File | Unused imports |
| --- | --- |
| `src/cli/backup.js:2` and `:8` | `existsSync`, `lifecyclePaths` |
| `src/composition-renderer.js:3` | `access`, `stat` |
| `src/library.js:7` | `createReadStream` |
| `src/services/outputs.js:3` | `stat` |

The support/test scan also found:

- `scripts/continuity-proof.mjs:49`: unused `driver` function; its private `copied` state becomes removable with it. Retain `DRIVER`, which the seed command uses.
- `scripts/media-tools-proof.mjs:11–12`: unused `randomBytes`, `stat` imports.
- `scripts/runtime-slice-proof.mjs:12`: unused `spawn` import.
- `test/cli-install.test.js:3`: unused `symlinkSync` import.
- `test/cli-update.test.js:12`: unused `assertUpdateFreeSpace` import.
- `test/cli.test.js:5`: unused `spawnSync` import.
- `test/outputs.test.js:9`: unused `Store` import.
- `test/schema-v9.test.js:4`: unused `mkdirSync` import.
- `test/render-service.test.js:78`: unused final assignment to `changed`. Preserve the `store.updateEpisode(...)` call and the earlier binding, which supplies the revision and cards.

That is 16 ESLint findings: 14 imports, one function and one unused assigned value.

### 4. Obsolete UI styles

These selectors in `public/styles.css` have no corresponding nodes in current
HTML or the browser's generated templates:

- `.card-main > .card-purpose` (330).
- `.placements` (336 and the responsive rule at 698), `.placement` and its child rules (342–357).
- `.import-box` and its paragraph rule (381–389), `#importForm` and its input rule (390–401).
- `.welcome` (623–628), `#chatForm` and its child rules (644–659).

Remove these in the cleanup and run existing browser coverage for cards, library,
chat and narrow layouts. This was a source/template audit, not runtime CSS coverage.
Do not remove `.cm-editor` or `.cm-scroller`: CodeMirror creates those classes.

### 5. Optional export-surface cleanup

Several declarations are used locally but exported unnecessarily. Examples:
`storyMarkdown`, `GRAPHIC_LIMITS`, `parseWorkDir`, `DATABASE_FILE`, `topHelp`,
`canonicalPath`, and `validateDirection`. Remove only the export modifier if desired;
their implementations remain live. The unused default aliases at the ends of
`src/store.js`, `src/chat.js` and `public/chat-workspace.js`, and the re-export of
`formatBytes` in `public/draft-cleanup.js`, can also be removed independently.

Do not apply automated export deletion without tracing callers. In particular,
the installer dynamically loads `src/runtime/release.js` from a staged release
(`src/cli/install.js:182–185`) and calls `module.buildRelease`. Knip cannot resolve
that constructed path and reports a false positive. The Docker module is also
passed as an object and destructured in `createHost`; its apparent unused members
are live.

## Dependencies: retain all ten

| Package | Live purpose |
| --- | --- |
| `@codemirror/commands` | Editor history and keymaps in `src/story-editor.js`. |
| `@codemirror/lang-markdown` | Markdown editor language and keymap. |
| `@codemirror/state` | Editor state. |
| `@codemirror/view` | Editor view and keymap. |
| `markdown-it` | Story parsing/rendering in `src/story-markdown.js` and the editor. |
| `@mozilla/readability` | Web-reference extraction in `src/library.js`. |
| `jsdom` | DOM for web-reference extraction; also used by tests. |
| `@resvg/resvg-js` | Live graphic rendering in `src/graphics.js`. |
| `esbuild` (development) | Builds the shipped `public/story-editor.js` bundle. |
| `playwright-core` (development) | Browser test suites. |

Knip reported no unused or undeclared npm dependencies. `npm ls --all --omit=optional
--depth=1` succeeded; missing optional binaries for other platforms are expected.
The dependency installation also reported zero known vulnerabilities at audit time;
this is not a separate security assessment.

Docker's media, reference and agent command tools are intentional capabilities:
FFmpeg/ffprobe, Python/Pillow, Poppler, resvg, fonts, Git, ripgrep and the two harnesses
are described/probed by the runtime or agent boot/skills. Lack of a JavaScript import
does not make an operating-system tool dead. This audit does not quantify container
size or propose splitting app/worker base images.

## Method and verification

- Read the current app, CLI, installer, container entry points, scripts, tests,
  browser imports and relevant specs #10/#11. Excluded Subfloor engine state/code.
- Ran Knip 6.37.0 over the complete project and separately over production roots,
  then traced candidates manually. Test-only use alone does not establish dead code:
  `createMemoryConversationPersistence` is an intentional test adapter; proof scripts
  and migration CLIs are explicit entry points.
- Ran ESLint 10.11.0 with unused-variable, unreachable-code and constant-condition
  checks. Arguments/caught errors were excluded to avoid interface noise. No
  unreachable-code or constant-condition findings. Generated editor code was excluded.
- Parsed CSS selectors and checked HTML, scripts and dynamic templates; retained
  known generated classes. This establishes removal candidates, not exhaustive
  browser-state reachability or coverage of arbitrary computed properties.
- Verified the reviewed commit's existing `node` CI job succeeded:
  <https://github.com/jedbjorn/storybench/actions/runs/35783642959/job/106935011636>.
  It runs the declared lint/build and test suite. No application changes were made,
  so those checks were not rerun merely to duplicate green evidence.
- No wholly unused JavaScript files were confirmed after accounting for executable
  and dynamically loaded entry points.

The adjacent configs retain the audit roots and exclusions. To reproduce from the
repository root after installing project dependencies:

```sh
audit_tools=$(mktemp -d)
npm install --prefix "$audit_tools" --ignore-scripts --no-audit --no-fund knip@6.37.0 eslint@10.11.0
"$audit_tools/node_modules/.bin/knip" --config docs/reviews/dead-code-2026-09-22/knip.json
"$audit_tools/node_modules/.bin/knip" --production --config docs/reviews/dead-code-2026-09-22/knip-production.json
"$audit_tools/node_modules/.bin/eslint" --config docs/reviews/dead-code-2026-09-22/eslint.config.mjs src public bin scripts test test-support
```

Knip exits nonzero for the findings described above, including the documented
dynamic-import/object-use false positives and host binaries outside npm. The configs
are review evidence, not a zero-warning CI gate or added project dependencies.

## Proposed developer handoff (not sent)

To DEV1: Clean up the confirmed dead code/imports/styles in the 2026-09-22 audit of
`2a29c0b`. Keep all ten npm dependencies. Remove the test-only old renderer only after
preserving useful coverage on the active composition renderer; retain media import,
probe and thumbnail functionality. Remove the three unused declarations, unused
imports and obsolete selectors; keep side-effecting test setup calls. Treat export
surface cleanup as optional, preserve dynamic release loading, migrations, proof
tools and generated editor assets. Run declared lint/tests and relevant browser
coverage, then open a PR with the removal diff and validation evidence.

Reviewer recommendation: approve this bounded cleanup handoff. Per the review
mandate, sending it awaits the operator's approval; no implementation was requested
from another shell during this audit.

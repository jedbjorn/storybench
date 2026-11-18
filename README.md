# Storybench

[![test](https://github.com/jedbjorn/storybench/actions/workflows/test.yml/badge.svg)](https://github.com/jedbjorn/storybench/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

<img width="1877" height="955" alt="storybench" src="https://github.com/user-attachments/assets/cb35f2a2-7287-43db-8d3c-41d942f44a42" />

## What Storybench does

Storybench is a local workspace for developing videos with a production agent. Its browser UI keeps stories, cards, references, B-roll, graphics, drafts, finals and chat together. A creator can choose Codex or Claude Code and an available model, then ask the agent to inspect material, edit assets and assemble or revise a video.

One local Node 24 application serves every channel from one SQLite database. A systemd user service supervises separate Docker app and request-scoped worker containers, and the `storybench` CLI manages installation and lifecycle. The browser is published only on loopback; there is no Storybench account or remote server.

Storybench is built with [Subfloor](https://subfloor.designs-os.com), an open-source meta-harness for running coding agents against a repository.

Storybench is released under the [MIT License](LICENSE).

This is a single-creator alpha, developed on CachyOS and open-source. The supported platform contract is Linux with Docker and a systemd user manager; macOS, Windows, remote hosting and alternative service managers are not supported. Technical readiness is tested, but output quality and real-footage evaluation remain post-delivery work for the creator.

## Requirements and diagnostics

The host needs:

- Node.js 24 or newer and npm, for the installer and CLI;
- Git, to clone the repository and reuse the host credential helper for updates;
- rootless Docker usable by the current user; `docker info --format '{{json .SecurityOptions}}'` must report `name=rootless`;
- a working `systemctl --user` session and a writable, absolute `XDG_RUNTIME_DIR`;
- at least 5 GiB free by default in the application store and Docker image store.

The installer never uses `sudo`, changes Docker configuration or edits shell startup files. Run it as the same normal OS user who will run Storybench.

The release images package the production tools rather than relying on host copies:

| Tool | Packaged version/source |
|---|---|
| Node.js | `node:24-trixie-slim` at the digest pinned in `docker/Dockerfile` (`24.21.0` in the verified image) |
| Codex CLI | `0.155.1` |
| Claude Code | `2.1.278` |
| OpenCode | `1.19.5` |
| Media and extraction | FFmpeg/ffprobe, Poppler, Python 3/Pillow and resvg from Debian's `20260922T000000Z` snapshot |
| Fonts | DejaVu, Noto Core and Liberation 2 from the same snapshot |

The base image is digest pinned; both Debian install layers use the same dated, signed snapshot, and the app and harness npm trees use lockfiles with `npm ci`. npm install scripts are disabled except for Claude's reviewed local binary placement script, which selects its lockfile-pinned native package. Upgrading any of these inputs is a reviewed source change. Every installed release records its exact image IDs, base-image identity and detected binary versions in its manifest and install receipt. Before activation, installation and updates probe required tools in each exact app/worker image, then run bounded Pillow, SVG, PDF, AAC audio, H.264/AAC animation, metadata and decode checks without network access. A missing or broken tool stops staging before the active database or service is touched. `storybench doctor` reports per-tool failures against the installed images; it does not claim a pass from partial version output.

The production agent may delegate to subagents on all three harnesses: Codex collaboration threads (`multi_agent` stays enabled; six other Codex integrations are disabled), Claude Code's `Agent` tool and OpenCode's `task` tool. Subagents run inside the same worker container with the same Storybench tools and the same single provider credential, and Stop removes the container and every subagent with it. Chat shows only the production agent's reply; each delegation appears as one tool activity entry, and the conversation always resumes the production agent's own session. Delegation adds model requests to the selected provider's usage; there is no per-conversation switch or spend limit.

Storybench reuses the current host logins at `~/.codex/auth.json` and `~/.claude/.credentials.json`. Sign in on the host with `codex login` and by running `claude`. Only the selected login material is staged for a worker; it is not baked into images or release metadata. The host login is the live authority: if its usable token is absent, that harness is unavailable, with no cached credential, alternate harness or model fallback. A provider warning does not prevent use of the editor.

## Install

Clone the repository, then run the bootstrap from its root.

```sh
git clone https://github.com/jedbjorn/storybench /tmp/storybench-src
cd /tmp/storybench-src
./install.sh
```

The installer verifies the host, records the exact clean commit and origin/ref, builds and checks the paired app/worker images, and installs commit-addressed releases under the current user's XDG directories. It does not start Storybench. The clone is not needed after installation; updates fetch from the recorded origin into the application-owned mirror. Re-running it at the same commit is safe.

The executable is installed as `~/.local/bin/storybench`. If the installer reports that directory is not on `PATH`, add it for the current shell before continuing:

```sh
export PATH="$HOME/.local/bin:$PATH"
storybench version
```

## First run

Initialization is explicit: `up` will never invent a replacement data root. Choose a durable directory you own; the example below uses `~/Storybench-data`.

```sh
storybench init "$HOME/Storybench-data"
storybench channel create "Example channel"
storybench up
storybench status
storybench open
```

`open` uses the desktop's configured opener. The default URL is `http://127.0.0.1:4173/`. Use `storybench up --port 4180` while stopped to validate and persist a different loopback port, or `storybench up --open` to start and open in one step.

Stop the service gracefully when wanted:

```sh
storybench down
```

Storybench is not enabled at login. `up` starts it now; repeated `up` and `down` calls are safe.

## Channels and agent context

Channels are records in the shared database, with media and episode directories beneath the configured data root. The first channel becomes the default.

```sh
storybench channel create "Second channel"
storybench channel list
storybench channel current
storybench channel use "Second channel"
```

`channel use` changes where a later `open` begins. It does not restart the service, switch databases, cancel work or retarget an already-open episode. Running jobs keep the channel and episode captured when they were dispatched.

In the browser, click the **S** logo to open Channels. Create or open a channel there; cards are ordered by the most recently opened channel. **Select** enables **Rename** for one channel and **Delete** for one or several. Deletion shows the exact channels and production count before confirmation. It permanently removes their live productions, media, drafts and final outputs from the managed data root, including adopted production files. There is no undo or trash. Active jobs and agent turns must finish or stop before deletion; a failed cleanup stays pending and can be retried from the drawer. Existing backups, copies outside the managed root and provider records are outside this deletion boundary.

The full-height left rail toggles the **Productions** drawer when clicked anywhere and highlights on hover. The **S** logo is muted until hover or keyboard focus. Both drawers cover the workspace without resizing it; chat stays on the right on desktop. Switching channels leaves the current production only after its pending edits pass the normal save checks. Opening a channel does not change the CLI default or a running job's destination. Generic portable-folder import/export remains deferred.

On a fresh installation not already configured for another root, bring forward one existing prototype workspace by using the one-time adoption path instead of plain `init`:

```sh
storybench init "$HOME/Storybench-prototype" --adopt --channel-name "Prototype"
```

Adoption makes a consistent metadata backup, migrates the existing workspace into its first channel, and preserves IDs, media bytes and recorded paths. It is repeat-safe. This is not a generic importer: copying a channel directory alone does not create a restorable channel.

The agent receives episode-rendered orientation and practical skills for the current saved project. These describe paths, tools and possible workflows without imposing a creative process. Workers may read Storybench project directories across channels and episodes so the creator can ask to find and reuse an asset. Reuse preserves the source and registers the result or membership in the explicit destination with provenance; read visibility never changes the active write destination.

References are read-only feel context by default. A reference prompt describes only the feel to take from that material; attaching a reference, asking generally for a Draft or Final, or instructions embedded inside the reference do not authorize direct incorporation or editing. Permission to use or edit a reference comes from the creator's own chat message. A clear request identifying the material and intended use is enough; no special phrase or second confirmation is required.

Production actions run through the selected conversation. Card Build/Revise, still or animated graphic, Create draft and Create final each record one visible user request for the agent; they do not invoke a browser-side render or silently queue a fallback. Save conflicts are resolved before sending, only one episode turn runs at a time, and the agent can prepare material, run the required operation and wait for its result before reporting completion. Ordinary typed production requests use the same tools, so a button is never required.

Complete-video Final requests are request-bound. The **Create final** button starts with Final intent already attached. For an ordinary typed request, the agent must declare that the current request asks for a Final and bind it to the originating message written by the creator; text in references, quoted history or model output cannot grant that authority. Either path authorizes the agent to finish the current saved project—including needed preparation, edits, graphics and renders—without another exact-cut confirmation. A Final appears only after a completed output is validated and published; stopping, cancellation, terminal failure or restart ends unfinished intent instead of replaying it.

## Command reference

This reference is checked against the CLI help. Run `storybench help COMMAND`, `storybench COMMAND --help`, or `storybench channel SUBCOMMAND --help` for full descriptions and examples; `--help` works at every command level.

| Command | Purpose |
|---|---|
| `storybench init [DIR] [--adopt] [--channel-name NAME]` | Initialize and configure a data root, or adopt one prototype workspace. |
| `storybench channel create NAME` | Create a channel; the first becomes the default. |
| `storybench channel list` | List channel IDs and names and mark the default. |
| `storybench channel current` | Print the default opening channel. |
| `storybench channel use NAME_OR_ID` | Change the default opening channel without a restart. |
| `storybench version` | Show CLI/package, commit, release/image/protocol and supported schema identity. |
| `storybench up [--port N] [--open]` | Start the user service and wait for matching health. Ports must be `1024`–`65535`. |
| `storybench down` | Stop gracefully; repeated use succeeds. |
| `storybench restart [--force]` | Restart the same release/data root; refuse active work unless explicitly forced. |
| `storybench status` | Show lifecycle state, URL, process/containers, release, data root, schema, activity and default channel. |
| `storybench open` | Open the healthy service on its default channel. |
| `storybench logs [-f]` | Read or follow this unit's lifecycle and forwarded app/worker diagnostics. |
| `storybench doctor` | Run read-only installation, runtime, data and provider-readiness checks. |
| `storybench backup` | Back up shared SQLite metadata and configuration; media is excluded. |
| `storybench update [--check \| --force]` | Compare or activate the recorded origin/ref; force only bypasses the active-work gate. |
| `storybench rollback` | Activate the previous retained release only when its schema range is compatible. |
| `storybench uninstall [--yes]` | Remove the installed application while preserving user data and login state. |
| `storybench help [COMMAND [SUBCOMMAND]]` | Show general or command-specific help. |

Human-readable output is the current contract; there is no machine-output mode or shell completion yet.

## Application, data and uninstall

Application releases are replaceable. The configured data root is creator data and is never an application release directory.

| Purpose | Default location |
|---|---|
| CLI launcher | `~/.local/bin/storybench` |
| Source mirror | `~/.local/share/storybench/source.git` |
| Releases | `~/.local/share/storybench/releases/<commit>/` |
| Active release pointer | `~/.local/share/storybench/current` |
| Configuration | `~/.config/storybench/config.json` |
| User unit | `~/.config/systemd/user/storybench.service` |
| Native harness sessions | `~/.local/state/storybench/harnesses/` |
| Backups and update receipts | `~/.local/state/storybench/` |
| Logs | the systemd user journal |
| Creator data | the absolute directory passed to `storybench init` |

The data root contains one authoritative `storybench.sqlite` plus managed channel/episode media, work and outputs. A channel directory is not an independent database. Migrations and metadata backups therefore cover every channel together. Top-level `cache/` and `imports/` are app-only and are never mounted into workers.

`storybench uninstall` stops and removes only this installation's launcher, unit, source mirror, releases, owned containers and unreferenced installation images. It preserves the entire configured data root, configuration, backups, native sessions, and host Codex/Claude login files. It never performs a global Docker prune. Reinstalling the app and deliberate creator cleanup are separate operations.

## Updates, backups and recovery

Check the recorded origin/ref without changing the installed release or data:

```sh
storybench update --check
```

A real `storybench update` fetches with the host's existing Git authentication, stages and verifies a new commit-addressed release and both images, then checks activity. Before the new release can open the database, it stops the service if needed and creates a timestamped, integrity-checked SQLite/configuration backup. Activation switches the release atomically and proves the exact app/worker pair, database identity, schema and health. A pre-readiness failure automatically restores the prior pointer, image pair and metadata backup, and restores the prior running/stopped state when possible.

`storybench update --force` may interrupt active renders or agent turns; interrupted work is not replayed. It does not bypass origin, free-space, release, backup, schema or health checks.

Create the same kind of metadata-only backup directly with:

```sh
storybench backup
```

If Storybench is running and idle, backup stops it safely and restarts it. Active work is refused. Media is not included, so separately back up the data root for complete disaster recovery.

`storybench rollback` selects the previous retained exact app/worker release only when that release supports the current shared-database schema. It takes another metadata backup and proves health. If newer work followed an incompatible migration, rollback refuses and identifies the relevant backup/recovery boundary; it never silently restores old metadata and discards newer changes. At most three releases are retained by this pruning policy: the current release, the previous release and, when available, another recently proven release; the retained set also ensures that a proven schema-compatible release is kept, which may already be the current or previous release. Rollback is one step back. Older release directories and their images are removed after each successful update or rollback only when those images are unreferenced.

Metadata backups are under `~/.local/state/storybench/backups/`. Atomic update/rollback receipts are under `~/.local/state/storybench/updates/`. `status` and `doctor` report an interrupted transition; rerun the named update or rollback command to reconcile it. Restoring an older backup is a separate, deliberate recovery operation because it can discard newer metadata.

### Updating an install from before deck template `staged-svg-2`

Each release now checks a staged release, and reads any other release's manifest, with that release's own modules, so a later change to the deck evidence contract does not stop an update, a rollback or an uninstall.

Releases installed before that change cannot do this. Their updater judges every new release by its own deck template, so from a release on template `staged-svg-1` the update builds both images and then stops, leaving the installed release and data untouched:

```text
storybench: app deck check: missing or incompatible SVG profile/template evidence
```

`storybench update` cannot get past this, because the check runs in the release that is already installed. Move that install forward once with the installer from a clean clone of the recorded origin:

```sh
storybench backup
storybench down
git clone https://github.com/jedbjorn/storybench /tmp/storybench-src
cd /tmp/storybench-src
./install.sh
storybench up
storybench doctor
```

The installer runs the new release's own image, media and deck checks in full; nothing is skipped. It keeps the configuration, data root, backups and retained releases, and refuses to switch releases while the service is running. It takes no metadata backup and writes no update receipt, which is why `storybench backup` comes first and why `storybench rollback` has no previous release to select until the next `storybench update` succeeds. After this one step, `storybench update` works again.

## Troubleshooting

Start with these two commands:

```sh
storybench status
storybench doctor
```

`status` distinguishes `stopped`, `starting`, `healthy`, `mismatched`, `stopping` and `failed`, and compares the expected release/data root with what is served. `doctor` is intentionally stricter about installation readiness while treating missing provider login as a warning to the otherwise usable editor.

For service detail:

```sh
storybench logs
storybench logs -f
systemctl --user status storybench.service
```

The journal contains lifecycle events, bounded/rate-limited app diagnostics, and allowlisted worker-launch diagnostics. Worker prompts, model output, chat content and credentials are not forwarded. Do not paste credentials or an environment dump into a bug report.

Common checks:

- **Port:** the default is loopback-only `127.0.0.1:4173`. Stop first, then choose a free port with `storybench up --port N`. A conflicting listener is reported rather than replaced.
- **Git access:** installation needs a clean clone with `origin`; updates reuse the host credential helper or SSH configuration. Keep credentials out of the origin URL. Check access with `git ls-remote origin` in a clean clone and `storybench update --check` after installation.
- **Provider access:** run `codex login` or launch `claude` to sign in on the host, then rerun `storybench doctor`. Missing/expired live login means that harness is unavailable; Storybench never silently substitutes another provider or model.
- **Docker:** `docker info` must succeed as the same user, without `sudo`, and its security options must report `name=rootless`. `doctor` enforces that rootless seat, checks the immutable app/worker image IDs and runs packaged-tool probes. Rootless Docker preserves host ownership for the mounted data/work directories; if a production job cannot write its episode work area, stop and correct the rootless mapping or directory ownership rather than running Storybench as root.
- **Mount scope:** the app mounts the whole data root and owns SQLite/registered writes. Workers see only read-only Storybench project trees, writable work for the current episode, app-owned session state and one staged login file. Neither container receives the Docker socket or runs privileged.
- **systemd user manager:** `systemctl --user is-system-running` may report `degraded` because of an unrelated unit. Judge Storybench with `storybench status`, `doctor`, its exact unit status and its journal. If the user bus is unavailable, start from a normal login session. `XDG_RUNTIME_DIR` must be set to that session's writable absolute runtime directory; Storybench will not start its managed service without it.

Lifecycle failures do not implicitly create storage, switch channels, delete media or bypass validation. If the configured data root is missing or has a different identity, restore the expected directory from a known backup rather than initializing a replacement at the same path.

## Reporting a problem to the project

Ask the production agent in chat to report a Storybench problem or idea. It checks the project's public tracker (`jedbjorn/storybench`) for an existing issue, prepares a report, and gives you one link. Open the link in your default browser, where you are normally signed in to GitHub: it opens GitHub's new-issue form with the title and body filled in. Read it, attach files there if you want, and press **Submit**. Tell the agent when it is submitted and it reads the issue back and gives you its address.

- Storybench holds no GitHub login, token or app. Nothing is filed until you press Submit, under your own GitHub account.
- What leaves the machine before that: unauthenticated read requests from the app to GitHub's public API, carrying only search words or an issue number. The report text leaves only inside the address your own browser opens.
- GitHub limits unauthenticated requests to 60 an hour and 10 searches a minute per network address. When the limit or the network stops a check, the agent says the check did not run; it never reports that as "no duplicates".
- The link is best effort. If it does not open or does not fill the form, say so: the agent posts the draft in chat to copy, and what you do with it is yours. Reports too long for a link are given as a draft the same way.
- The destination is fixed in the app's package metadata (`repository` and `bugs` in `package.json`) and cannot be changed from chat. A fork that wants its own tracker changes that metadata and ships its own build.
- Security problems are not prepared as public issues; see [SECURITY.md](SECURITY.md).

## Current limitations

- The repository is public and MIT-licensed. There are still no published packages, images, badges, `curl | sh` installer or release-hosting promises — install from a clone as described above.
- Support is limited to a single local Linux creator account with Docker and `systemd --user`. There is no LAN binding, multi-user tenancy, remote host, app authentication or automatic login startup.
- All channels share one SQLite database and one service. Portable self-contained channels, arbitrary workspace merging and generic channel import/export are not delivered.
- Codex and Claude Code are the supported production harnesses. Available models and effort controls depend on the installed harness and account; failed discovery or access is reported without substitution.
- Agent tools and episode-rendered skills provide capabilities and orientation, not a guarantee of creative quality or a prescribed editorial workflow. Evaluation with the creator's real footage, including whether the output is good enough, remains pending after technical delivery.
- Two host checks remain for the operator after delivery and are not covered by the automated evidence: that a rotated host Codex/Claude token is inherited by the next worker request, and that published Final output is validated on real footage.

## Development

Use Node 24 or newer in a clean checkout:

```sh
npm ci
npm test
npm run lint
```

`npm test` runs the Node test suite. `npm run lint` rebuilds the browser editor bundle and checks the declared server, browser, CLI and runtime JavaScript entry points. CI also builds the exact app/worker images and runs their tool probes and media smoke checks. Development commands do not install or start the user service; exercise installer/lifecycle work only with disposable XDG paths, data, ports and a namespaced unit. Because `systemd --user` reads units only from its own configuration directory, a disposable `XDG_CONFIG_HOME` needs `STORYBENCH_UNIT_DIR` set to a directory the live manager searches (for example `$XDG_RUNTIME_DIR/systemd/user`), plus `STORYBENCH_UNIT_NAME` for the namespaced unit.

## More projects

Storybench is part of [Designs/OS](https://designs-os.com). Other open-source projects by the same author:

- **[FAI Browser](https://jedbjorn.github.io/fai-browser/)** — lets a coding agent work in one browser tab you approve, with permission levels, secret redaction and compact page summaries. ([source](https://github.com/jedbjorn/fai-browser))
- **[Subfloor](https://subfloor.designs-os.com)** — a standing team of coding agents for your Git repository, with durable identity, memory, specs and handoffs, run through your coding harness. ([source](https://github.com/jedbjorn/subfloor))
- **[RST](https://jedbjorn.github.io/rst-c/)** — a native Revit add-in for curated ribbon profiles: admins build them, users load them with one click. ([source](https://github.com/jedbjorn/rst-c))
- **[Gantt-It](https://jedbjorn.github.io/gantt-it/)** — a Revit add-in that draws Gantt charts in your project, ready to place on sheets. ([source](https://github.com/jedbjorn/gantt-it))
- **[Splash-It](https://jedbjorn.github.io/splash-it/)** — a Revit add-in that colors view tabs by file, so open models and families are easy to tell apart. ([source](https://github.com/jedbjorn/splash-it))
- **[md-converter](https://md-converter.designs-os.com)** — a static web app that renders themed Markdown into styled, shareable HTML. ([source](https://github.com/jedbjorn/md-converter))
- **[AnJ Cloud](https://jedbjorn.github.io/anj-cloud/)** — household file sync from a gateway you host yourself, with clients for Linux, macOS, Windows and Android. ([source](https://github.com/jedbjorn/anj-cloud))
- **[Pick-It](https://jedbjorn.github.io/pick-it/)** — a Revit add-in that picks any colour on screen, shows its RGB values on the ribbon button and adds it to Revit's custom colours. ([source](https://github.com/jedbjorn/pick-it))

Deck productions support editable slides, presenter notes, reveal diagrams, local media and portable offline HTML/ZIP builds. See [deck authoring and the editable eight-slide demo](docs/deck-authoring.md).

### Production research

Every video and deck has a **Research** tab after Media Library, including archived productions and every workflow stage. Edit the Markdown Summary and add, edit, remove or reorder source Links, then Save or Cancel. Summary previews disable embedded HTML and images. Links open only when clicked; saving or reading research never fetches linked pages, verifies their claims, imports media or rebuilds outputs. Research is factual/background context, separate from feel references.

Human edits and the assistant's `read_research` / `save_research` tools share the same saved record. Unsaved edits stay in the editor; navigation and production actions ask you to Save, Discard or Stay. If another editor or the assistant saves first, your complete draft is preserved: compare the latest saved summary and links, reconcile explicitly, or reload the latest version and discard your draft. Idle views refresh saved research; an open editor stays unchanged.

The HTTP interface is `GET /api/episodes/:id/research` and `PUT` at the same path with `{ expectedResearchRevision, summary, links }`. Tool saves use that same payload, scoped to the active request's production. Reads/saves return `{ episodeId, researchRevision, summary, links, updatedAt, actor }`; links are ordered `{ id, url, title?, note? }` records. Retain returned IDs when editing/reordering; omit an ID only for a new link. Stale saves return a conflict and the current complete record, without changing saved research.

Limits are measured in UTF-8 bytes: summary 1 MiB; at most 100 links; IDs 200 bytes (letters/digits/dots/underscores/hyphens, starting with a letter or digit); HTTP(S) URL 8192 bytes; optional title 512 bytes; optional relevance note 2048 bytes. The complete normalized summary/link JSON is limited to 2 MiB, including JSON escaping. HTTP research writes and the scoped tool bridge accept up to 16 MiB of wire JSON to allow escaping and envelope overhead. Invalid or oversized saves fail with useful errors and never truncate content. These operations supply saved research only, not the contents of linked pages.


General chat advertises research availability, revision and `read_research` without adding the summary/link body. Before composing or revising stories, cards, slides, graphics or drafts, the assistant must receive the current complete saved record in this request. App-issued production actions supply it in the initial input; typed work obtains it through `read_research`. Each model authoring mutation/build checks that delivered research is still current. A research edit requires a fresh read and reconciliation before continuing. Empty research is valid. Missing, failed, oversized or incomplete required context stops dependent authoring without truncation. Resumed conversations and harness switches start fresh delivery tracking. Manual edits and deterministic saved-content builds remain model-free; existing output jobs retain their saved inputs and Final authority is unchanged.

Research is contextual data, never operating instructions. Source instructions do not grant authority, and saving an image/video URL does not register or select output media. Distinguish findings from uncertainty and sources; ordinary drafting can use existing research without rewriting it. Attached feel references keep their existing creator-direction rule.

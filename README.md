# Storybench

[![test](https://github.com/jedbjorn/storybench/actions/workflows/test.yml/badge.svg)](https://github.com/jedbjorn/storybench/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

<img width="1877" height="955" alt="storybench" src="https://github.com/user-attachments/assets/cb35f2a2-7287-43db-8d3c-41d942f44a42" />

## What Storybench does

Storybench is a local workspace for developing videos with a production agent. Its browser UI keeps stories, cards, references, B-roll, graphics, drafts, finals and chat together. A creator can choose Codex or Claude Code and an available model, then ask the agent to inspect material, edit assets and assemble or revise a video.

One local Node 24 application serves every channel from one SQLite database. A systemd user service supervises separate Docker app and request-scoped worker containers, and the `storybench` CLI manages installation and lifecycle. The browser is published only on loopback; there is no Storybench account or remote server.

Storybench is built with [Subfloor](https://github.com/jedbjorn/subfloor), an open-source meta-harness for running coding agents against a repository.

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
| Media and extraction | FFmpeg/ffprobe, Poppler, Python 3/Pillow and resvg from Debian's `20260922T000000Z` snapshot |
| Fonts | DejaVu, Noto Core and Liberation 2 from the same snapshot |

The base image is digest pinned; both Debian install layers use the same dated, signed snapshot, and the app and harness npm trees use lockfiles with `npm ci`. npm install scripts are disabled except for Claude's reviewed local binary placement script, which selects its lockfile-pinned native package. Upgrading any of these inputs is a reviewed source change. Every installed release records its exact image IDs, base-image identity and detected binary versions in its manifest and install receipt. Before activation, installation and updates probe required tools in each exact app/worker image, then run bounded Pillow, SVG, PDF, AAC audio, H.264/AAC animation, metadata and decode checks without network access. A missing or broken tool stops staging before the active database or service is touched. `storybench doctor` reports per-tool failures against the installed images; it does not claim a pass from partial version output.

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

`channel use` changes where a later `open` begins. It does not restart the service, switch databases, cancel work or retarget an already-open episode. Running jobs keep the channel and episode captured when they were dispatched. An in-app channel picker and generic portable-folder import/export are deferred.

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

## Current limitations

- The repository is public and MIT-licensed. There are still no published packages, images, badges, `curl | sh` installer or release-hosting promises — install from a clone as described above.
- Support is limited to a single local Linux creator account with Docker and `systemd --user`. There is no LAN binding, multi-user tenancy, remote host, app authentication or automatic login startup.
- All channels share one SQLite database and one service. Portable self-contained channels, arbitrary workspace merging, generic channel import/export and channel deletion are not delivered.
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

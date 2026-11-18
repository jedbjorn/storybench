# Native tool stream fixtures

Real harness output, captured live on Halo on 2026-11-18 at the Codex version pinned in
`docker/harness/package-lock.json` (installed with the worker image's `npm ci` steps), with
the argv the worker launch table builds minus the Storybench MCP bridge, in a throwaway
directory holding one `options.txt`. `test/codex-native-tools.test.js` replays it (spec #40
E2).

| File | Harness | Model | What was recorded |
|---|---|---|---|
| `codex-0.155.1.jsonl` | Codex CLI 0.155.1 | account default (`gpt-6-astra`) | stdout of `codex app-server --listen stdio://` with the six `--disable` flags; requests were `initialize` (id 1), `thread/start` (id 2), `turn/start` (id 3). The turn asked the agent to run `cat options.txt`, create `choice.txt` with `apply_patch`, search the web, then answer in one sentence |

Lines are verbatim except for the removal of the `account/rateLimits/updated`,
`remoteControl/status/changed` and `turn/moderationMetadata` notifications (account and
host telemetry), none of which an adapter reads.

## What the stream shows

- With the worker's default argv, Codex's own tools arrive as `commandExecution`,
  `fileChange` and `webSearch` items, each as one `item/started` + `item/completed` pair on
  the production thread.
- `commandExecution` and `fileChange` carry a `status` (`inProgress`, then `completed`).
  `webSearch` carries none: its started item has an empty `query`, and its completed item
  holds the query, the action and the full search results.
- The items hold the command and its output, the file diff, and the query and results;
  Storybench records none of these.

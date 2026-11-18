# Subagent stream fixtures

Real harness output, captured live on Halo on 2026-11-18 at the versions pinned in
`docker/harness/package-lock.json` (installed with the worker image's `npm ci` steps). Each
harness ran with the argv the worker launch table builds, minus the Storybench MCP bridge,
in a throwaway directory holding one `options.txt`. Each turn asked the agent to announce
the delegation, have exactly one subagent read the file and recommend an option, then
answer in one sentence. `test/subagent-streams.test.js` replays them.

| File | Harness | Model | What was recorded |
|---|---|---|---|
| `claude-code-2.1.278.jsonl` | Claude Code 2.1.278 | `sonnet` (resolved `claude-sonnet-5`) | stdout of `claude -p --output-format stream-json --input-format stream-json --verbose` |
| `codex-0.155.1.jsonl` | Codex CLI 0.155.1 | account default | stdout of `codex app-server --listen stdio://` with the six `--disable` flags and no `multi_agent` disable; requests were `initialize` (id 1), `thread/start` (id 2), `turn/start` (id 3) |
| `codex-0.155.1-two-subagents.jsonl` | Codex CLI 0.155.1 | account default (`gpt-6-astra`) | same launch and requests as above; the turn asked for two subagents, a wait for both, then one follow-up input to the first subagent and a wait for its reply |
| `opencode-1.19.5.jsonl` | OpenCode 1.19.5 | Ollama Cloud `kimi-k2.7-code` | stdout of `opencode run --pure --format json`, config built by `openCodeConfig` |

Lines are verbatim except for these removals, none of which an adapter reads:

- Claude: the `rate_limit_event` line and the init event's `messaging_socket_path`.
- Codex: `account/rateLimits/updated`, `remoteControl/status/changed` and
  `turn/moderationMetadata` notifications (account and host telemetry).
- Codex, two-subagent capture only: it ran against the host's Codex home, so the
  `mcpServer/startupStatus/updated` notifications (the host's own MCP servers) are removed
  and the Codex home path is replaced with `/tmp/dev3-cap/codex-home` in its three
  occurrences (`codexHome`, and the thread `path` in the `thread/start` response and the
  `thread/started` notification).

## What the streams show

- **Claude Code** offers the delegation tool: the `init` event lists `Task` in `tools` and
  five `agents`; the model calls it as `Agent`. Subagent events (`assistant`, `user`) carry
  `parent_tool_use_id` set to the delegating call and the production agent's `session_id`.
  In this capture the subagent made one inner `Read` call and wrote no assistant text.
- **Codex** runs the subagent as a second app-server thread. Its `turn/started`, deltas,
  items and `turn/completed` arrive on the same connection under that thread's id. The
  production thread reports the delegation as two `subAgentActivity` items (`kind`
  `started`, then `completed`), each sent as an `item/started` + `item/completed` pair, and
  the wait as a `collabAgentToolCall`. The schema's kinds are `started`, `interacted`,
  `interrupted` and `completed`. In the two-subagent capture each subagent has its own
  `agentThreadId`; the one that received a follow-up after finishing is reported
  `started`, `completed`, `interacted`, `completed`, and one `completed` pair arrives with
  the subagent's own `turn/completed` between its `item/started` and `item/completed`.
- **OpenCode** offers and uses the `task` tool on this route. `opencode run` printed only
  the production session's events: the `task` call arrives once, already `completed`, and
  its `state.metadata` names the subagent session (`sessionId`) and the production session
  (`parentSessionId`). No event carried the subagent's session id.

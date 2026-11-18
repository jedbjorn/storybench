import test from "node:test";
import assert from "node:assert/strict";
import { agentRows, agentStatus, contextLabel, formatTokens } from "../public/chat-agents.js";

test("token figures read as k and M", () => {
  assert.deepEqual([950, 1_499, 312_400, 1_000_000, 1_250_000, null].map(formatTokens), ["950", "1k", "312k", "1M", "1.3M", "—"]);
  assert.equal(contextLabel({ tokens: 312_400, trigger: 500_000 }), "312k / 500k");
  assert.equal(contextLabel({ tokens: 8_000, trigger: null }), "8k tokens");
  assert.equal(contextLabel(null), "— tokens");
});

test("agent rows: the conversation's agent, then its latest turn's delegations", () => {
  const at = (s) => new Date(Date.UTC(2026, 10, 18, 10, 0, s)).toISOString();
  const value = {
    state: "running", settings: { model: "opus" }, context: { tokens: 40_000, trigger: 500_000 },
    runs: [{ state: "running", modelResolved: "claude-opus-5-5", startedAt: at(0) }],
    events: [
      { type: "agent.updated", createdAt: at(1), payload: { id: "old", label: "Earlier turn" } },
      { type: "turn.started", createdAt: at(2), payload: {} },
      { type: "agent.updated", createdAt: at(3), payload: { id: "a", label: "Rework assets", state: "running" } },
      { type: "agent.updated", createdAt: at(5), payload: { id: "a", model: "claude-sonnet-5", tokens: 12_000 } },
      { type: "agent.updated", createdAt: at(9), payload: { id: "a", state: "completed", tokens: 16_461 } },
      { type: "agent.updated", createdAt: at(4), payload: { id: "b", label: "closing", state: "running" } },
    ],
  };
  const [main, a, b] = agentRows(value);
  assert.deepEqual([main.name, main.model, main.tokens, main.state, main.endedAt], ["Assistant", "claude-opus-5-5", 40_000, "working", null]);
  assert.deepEqual([a.name, a.model, a.tokens, a.state, a.endedAt - a.startedAt], ["Rework assets", "claude-sonnet-5", 16_461, "completed", 6_000]);
  assert.deepEqual([b.name, b.model, b.state, b.endedAt], ["closing", "claude-opus-5-5", "running", null], "an unreported model is the conversation's");
  assert.equal(agentRows(value).length, 3, "earlier turns' agents are not listed");
  // The turn ended without the delegation reporting back: it ended with the turn.
  const ended = agentRows({ ...value, state: "idle", runs: [{ ...value.runs[0], state: "completed", finishedAt: at(20) }] });
  assert.deepEqual([ended[0].state, ended[2].state, ended[2].endedAt], ["completed", "ended", Date.parse(at(20))]);
});

test("each card's status line reads like the turn status line", () => {
  const sub = (fields) => ({ id: "a", state: "running", activity: "", ...fields });
  assert.equal(agentStatus(sub({})), "Thinking");
  assert.equal(agentStatus(sub({ activity: "Read" })), "Researching");
  assert.equal(agentStatus(sub({ activity: "mcp__storybench__save_deck".replace("mcp__storybench__", "") }), { kind: "deck" }), "Building the deck");
  assert.equal(agentStatus(sub({ activity: "apply_patch" })), "Creating assets");
  assert.equal(agentStatus(sub({ activity: "some_new_tool" })), "Working");
  assert.deepEqual(["completed", "failed", "interrupted", "ended"].map((state) => agentStatus(sub({ state }))), ["Done", "Failed", "Stopped", "Ended"]);
  assert.equal(agentStatus({ id: "main", state: "working" }, { live: "Checking my work" }), "Checking my work", "the transcript's own label");
  assert.equal(agentStatus({ id: "main", state: "working" }), "Thinking");
  assert.equal(agentStatus({ id: "main", state: "compacting" }), "Compacting context");
  assert.equal(agentStatus({ id: "main", state: "completed" }), "Done");
  // A delegation's activity follows its tool calls.
  const at = (s) => new Date(Date.UTC(2026, 10, 18, 10, 0, s)).toISOString();
  const rows = (events) => agentRows({ state: "running", runs: [], events: [{ type: "turn.started", createdAt: at(0), payload: {} }, ...events] });
  const started = { type: "agent.updated", createdAt: at(1), payload: { id: "a", label: "Rework", state: "running" } };
  assert.equal(agentStatus(rows([started, { type: "agent.updated", createdAt: at(2), payload: { id: "a", activity: "Grep" } }])[1]), "Researching");
  assert.equal(agentStatus(rows([started, { type: "agent.updated", createdAt: at(2), payload: { id: "a", activity: "Grep" } }, { type: "agent.updated", createdAt: at(3), payload: { id: "a", activity: "" } }])[1]), "Thinking");
});

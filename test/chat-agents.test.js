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

// Spec #42 'Agents panel and chat' (task #115, A11): agent jobs outlive the turn that started them.
test("agent job rows persist across turns: running first, then ended newest first, up to 20", () => {
  const at = (s) => new Date(Date.UTC(2026, 10, 18, 10, 0, s)).toISOString();
  const job = (id, state, fields = {}) => ({ id, label: `Job ${id}`, harness: "codex", model: "gpt-5.5", state, createdAt: at(0), startedAt: at(1), endedAt: ["queued", "running"].includes(state) ? null : at(31), ...fields });
  const ended = Array.from({ length: 22 }, (_, index) => job(`e${index}`, ["completed", "failed", "timed_out", "cancelled", "interrupted"][index % 5]));
  const value = {
    state: "completed", settings: { model: "gpt-5.5" }, waitingForAgents: 2,
    runs: [{ state: "completed", modelResolved: "gpt-5.5", startedAt: at(0), finishedAt: at(40) }],
    // A later turn started after the jobs did: its delegations are the only ones listed, the jobs stay.
    events: [
      { type: "agent_job.updated", createdAt: at(2), payload: { id: "r1", tokens: 9_000 } },
      { type: "agent_job.updated", createdAt: at(3), payload: { id: "r1", activity: "read_research" } },
      { type: "agent_job.updated", createdAt: at(4), payload: { id: "r1", tokens: 12_400 } },
      { type: "agent_job.updated", createdAt: at(4), payload: { id: "e0", tokens: 3_000, activity: "read_deck" } },
      { type: "turn.started", createdAt: at(5), payload: {} },
      { type: "agent.updated", createdAt: at(6), payload: { id: "native", label: "Check", state: "completed" } },
    ],
    agentJobs: [...ended.slice(0, 3), job("r1", "running"), job("q1", "queued", { harness: "claude", model: null, startedAt: null }), ...ended.slice(3)],
  };
  const rows = agentRows(value);
  assert.deepEqual(rows.map((row) => row.id).slice(0, 5), ["main", "native", "job:r1", "job:q1", "job:e0"], "main, the latest turn's delegations, live jobs, then ended jobs");
  assert.equal(rows.filter((row) => row.job).length, 20, "at most 20 job rows");
  const [main, , running, queued, done] = rows;
  assert.deepEqual([main.state, agentStatus(main)], ["waiting", "Waiting for agents (2)"]);
  assert.deepEqual([running.name, running.harness, running.model, running.tokens, running.endedAt], ["Job r1", "codex", "gpt-5.5", 12_400, null]);
  assert.equal(agentStatus(running), "Running · Researching", "a job's activity uses the delegations' phase table");
  assert.deepEqual([queued.model, queued.startedAt, agentStatus(queued)], ["default model", Date.parse(at(0)), "Waiting to start"]);
  assert.deepEqual([done.tokens, done.activity, done.endedAt - done.startedAt], [3_000, "", 30_000], "an ended job keeps its tokens, not its activity");
  assert.deepEqual(rows.slice(4, 9).map((row) => agentStatus(row)), ["Done", "Failed", "Timed out", "Stopped", "Interrupted"]);
  // Between tools the job is thinking; once nothing runs the main row is no longer waiting.
  assert.equal(agentStatus({ ...running, activity: "" }), "Running · Thinking");
  const settled = agentRows({ ...value, waitingForAgents: 0, agentJobs: ended });
  assert.equal(settled[0].state, "completed");
  // A turn in flight is working, not waiting, even while jobs run.
  assert.equal(agentRows({ ...value, state: "running", runs: [{ state: "running", startedAt: at(50) }] })[0].state, "working");
});

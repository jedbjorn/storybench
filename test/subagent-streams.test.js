// Subagent containment (spec #33 A4-A7). The fixtures under test-support/fixtures/subagents
// are streams captured live from the pinned harness versions; see the README beside them.
import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { readFileSync } from "node:fs";
import { WorkerCodexConnection, ClaudeChatConnection } from "../src/runtime/harnesses.js";
import { OpenCodeConnection, openCodeRunEvent } from "../src/runtime/opencode.js";

const fixture = (name) => readFileSync(new URL(`../test-support/fixtures/subagents/${name}`, import.meta.url), "utf8").trim().split("\n");
const delay = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check) { const end = Date.now() + 2000; while (Date.now() < end) { if (check()) return; await delay(5); } throw new Error("timeout"); }

// What src/chat.js puts in the transcript: assistant deltas and tool entries.
const prose = (events) => events.filter((event) => event.method === "item/agentMessage/delta").map((event) => event.params.delta).join("");
const toolEntries = (events) => events.filter((event) => ["item/started", "item/completed"].includes(event.method) && ["dynamicToolCall", "mcpToolCall"].includes(event.params.item?.type))
  .map((event) => `${event.method.slice(5)} ${event.params.item.tool}`);
const completions = (events) => events.filter((event) => event.method === "turn/completed").map((event) => event.params.turn.status);

function streamChild() {
  const child = new EventEmitter();
  child.stdout = new PassThrough(); child.stdin = new PassThrough(); child.exitCode = null;
  child.kill = () => { child.exitCode = 0; child.emit("exit", 0, null); };
  return child;
}

test("A4: Codex launches with subagents enabled and the other six integrations disabled", async () => {
  const previous = process.env.STORYBENCH_HARNESS;
  process.env.STORYBENCH_HARNESS = "codex";
  const { launchArgv } = await import("../src/runtime/worker/agent.mjs?codex");
  if (previous === undefined) delete process.env.STORYBENCH_HARNESS; else process.env.STORYBENCH_HARNESS = previous;
  const [command, args] = launchArgv({ harness: "codex" });
  assert.equal(command, "codex");
  const disabled = args.flatMap((value, index) => value === "--disable" ? [args[index + 1]] : []);
  assert.deepEqual(disabled.sort(), ["apps", "browser_use", "computer_use", "image_generation", "in_app_browser", "plugins"]);
  assert.ok(!args.includes("multi_agent"));
});

test("A5: a captured Claude Code delegation shows only the production agent's prose and one tool entry", async () => {
  const lines = fixture("claude-code-2.1.278.jsonl"), stream = lines.map((line) => JSON.parse(line));
  // The capture really contains subagent traffic: its prompt, an inner Read call and its result.
  const inner = stream.filter((event) => event.parent_tool_use_id);
  assert.ok(inner.some((event) => event.type === "assistant" && event.message.content.some((block) => block.type === "tool_use" && block.name === "Read")));
  assert.ok(inner.some((event) => event.type === "user" && event.message.content.some((block) => block.type === "tool_result")));
  assert.ok(stream[0].tools.includes("Task") && stream[0].agents.includes("general-purpose"), "the init event offers the delegation tool");
  assert.equal(stream[0].claude_code_version, "2.1.278");

  const replay = async (events) => {
    const seen = [], child = streamChild();
    const connection = new ClaudeChatConnection({ model: "sonnet", onEvent: (event) => seen.push(event), spawnSession: async () => child });
    const threadId = await connection.startThread();
    await connection.startTurn(threadId, "Explore two openings with a subagent.");
    for (const event of events) child.stdout.write(JSON.stringify(event) + "\n");
    await until(() => completions(seen).length);
    return { seen, connection, threadId };
  };
  const mainProse = stream.filter((event) => event.type === "assistant" && !event.parent_tool_use_id).flatMap((event) => event.message.content).filter((block) => block.type === "text").map((block) => block.text).join("");
  const { seen, connection, threadId } = await replay(stream);
  assert.equal(prose(seen), mainProse);
  assert.deepEqual(toolEntries(seen), ["started Agent", "completed Agent"]);
  assert.deepEqual(completions(seen), ["completed"]);
  assert.equal(connection.threadId, threadId);
  assert.equal(new Set(stream.map((event) => event.session_id).filter(Boolean)).size, 1, "every event carries the production agent's session");

  // This capture's subagent wrote no assistant text of its own. Derived case: the captured
  // subagent assistant event with a text block added, as a subagent that narrates would send.
  const narrated = stream.map((event) => event.parent_tool_use_id && event.type === "assistant"
    ? { ...event, message: { ...event.message, content: [{ type: "text", text: "SUBAGENT-PROSE" }, ...event.message.content] } } : event);
  const derived = await replay(narrated);
  assert.equal(prose(derived.seen), mainProse);
  assert.deepEqual(toolEntries(derived.seen), ["started Agent", "completed Agent"]);
});

test("A6: a captured Codex app-server delegation keeps the subagent thread out of the transcript", async () => {
  const lines = fixture("codex-0.155.1.jsonl"), stream = lines.map((line) => JSON.parse(line));
  let cursor = 0;
  const child = streamChild();
  // Replay server output up to each response as the connection sends the matching request.
  child.stdin = new Writable({ write(chunk, _encoding, callback) {
    for (const text of String(chunk).split("\n").filter(Boolean)) {
      const { id } = JSON.parse(text);
      if (id == null) continue;
      while (cursor < lines.length) { const message = stream[cursor]; child.stdout.write(lines[cursor++] + "\n"); if (message.id === id && !message.method) break; }
      if (id === 3) while (cursor < lines.length) child.stdout.write(lines[cursor++] + "\n");
    }
    callback();
  } });
  const seen = [];
  const connection = new WorkerCodexConnection({ child, cwd: "/tmp/dev3-cap/ws", tools: { definitions: [], call() {} }, onEvent: (event) => seen.push(event) });
  await connection.open();
  const threadId = await connection.startThread();
  const turnId = await connection.startTurn(threadId, "Explore two openings with a subagent.");
  await until(() => completions(seen).length);
  connection.close();

  const notifications = stream.filter((message) => message.method);
  const subagentThreads = new Set(notifications.map((message) => message.params.threadId).filter((id) => id && id !== threadId));
  assert.equal(subagentThreads.size, 1, "the capture contains one subagent thread");
  const delta = (own) => notifications.filter((message) => message.method === "item/agentMessage/delta" && (message.params.threadId === threadId) === own).map((message) => message.params.delta).join("");
  assert.ok(delta(false).length > 0, "the capture contains subagent prose");
  assert.equal(prose(seen), delta(true));
  assert.ok(!prose(seen).includes(delta(false)));
  assert.ok(seen.every((event) => !event.params?.threadId || event.params.threadId === threadId));
  assert.deepEqual(toolEntries(seen), ["started subagent", "completed subagent"]);
  assert.deepEqual(completions(seen), ["completed"]);
  assert.equal(seen.find((event) => event.method === "turn/completed").params.turn.id, turnId);
  assert.equal(connection.threadId, threadId);
});

test("A7: a captured OpenCode delegation keeps the production agent's session and transcript", async () => {
  const stream = fixture("opencode-1.19.5.jsonl").map((line) => JSON.parse(line));
  const task = stream.find((event) => event.type === "tool_use" && event.part.tool === "task");
  const production = task.part.state.metadata.parentSessionId, subagent = task.part.state.metadata.sessionId;
  assert.ok(production && subagent && production !== subagent, "the capture delegated to a subagent session");

  // The worker's loop: every stdout event passes through openCodeRunEvent.
  const run = (events) => {
    let native = null, failed = false; const output = [];
    for (const event of events) { const result = openCodeRunEvent(event, native); native = result.session; failed ||= Boolean(result.failed); if (result.output) output.push(result.output); }
    return { native, failed, output };
  };
  const worker = run(stream);
  assert.equal(worker.native, production);
  assert.equal(worker.failed, false);

  const seen = [], child = streamChild();
  const connection = new OpenCodeConnection({ model: "kimi-k2.7-code", onEvent: (event) => seen.push(event), spawnSession: async () => child });
  const threadId = await connection.startThread();
  await connection.startTurn(threadId, "Explore two openings with a subagent.");
  for (const event of [...worker.output, { type: "storybench.complete", ok: true }]) child.stdout.write(JSON.stringify(event) + "\n");
  await until(() => completions(seen).length);
  assert.equal(prose(seen), stream.filter((event) => event.type === "text").map((event) => event.part.text).join(""));
  assert.ok(!JSON.stringify(seen).includes("task_result"), "the subagent's report stays inside the worker");
  assert.deepEqual(toolEntries(seen), ["started task", "completed task", "started read", "completed read"]);
  assert.deepEqual(completions(seen), ["completed"]);
  assert.equal(connection.threadId, threadId);

  // `opencode run` 1.19.5 printed no subagent-session events. Derived case: the captured text
  // and error shapes re-addressed to the captured subagent session, first and mid-stream.
  const text = stream.find((event) => event.type === "text");
  const foreign = [{ ...text, sessionID: subagent, part: { ...text.part, sessionID: subagent, text: "SUBAGENT-PROSE" } }, { type: "error", sessionID: subagent }];
  const mixed = run([stream[0], ...foreign, ...stream.slice(1), ...foreign]);
  assert.equal(mixed.native, production);
  assert.equal(mixed.failed, false);
  assert.deepEqual(mixed.output, worker.output);
  // A resumed turn already knows its session; a subagent event arriving first cannot replace it.
  assert.equal(run([...foreign, ...stream]).native, subagent, "without a stored session the first event defines it");
  assert.equal(openCodeRunEvent(foreign[0], production).session, production);
  assert.equal(openCodeRunEvent({ type: "error", sessionID: production }, production).failed, true);
});

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

// Replay a captured app-server stream: server output up to each response is written as the
// connection sends the matching request, and the rest follows turn/start (id 3).
async function replayCodex(name) {
  const lines = fixture(name), stream = lines.map((line) => JSON.parse(line));
  let cursor = 0;
  const child = streamChild();
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
  const delta = (own) => notifications.filter((message) => message.method === "item/agentMessage/delta" && (message.params.threadId === threadId) === own).map((message) => message.params.delta).join("");
  const activity = notifications.filter((message) => message.method === "item/completed" && message.params.item.type === "subAgentActivity").map((message) => message.params.item);
  return { seen, connection, threadId, turnId, notifications, delta, activity };
}

test("A6: a captured Codex app-server delegation keeps the subagent thread out of the transcript", async () => {
  const { seen, connection, threadId, turnId, notifications, delta } = await replayCodex("codex-0.155.1.jsonl");
  const subagentThreads = new Set(notifications.map((message) => message.params.threadId).filter((id) => id && id !== threadId));
  assert.equal(subagentThreads.size, 1, "the capture contains one subagent thread");
  assert.ok(delta(false).length > 0, "the capture contains subagent prose");
  assert.equal(prose(seen), delta(true));
  assert.ok(!prose(seen).includes(delta(false)));
  assert.ok(seen.every((event) => !event.params?.threadId || event.params.threadId === threadId));
  assert.deepEqual(toolEntries(seen), ["started subagent", "completed subagent"]);
  assert.deepEqual(completions(seen), ["completed"]);
  assert.equal(seen.find((event) => event.method === "turn/completed").params.turn.id, turnId);
  assert.equal(connection.threadId, threadId);
});

test("A6: a captured Codex turn with two subagents and a follow-up shows one tool entry per subagent", async () => {
  const { seen, connection, threadId, turnId, notifications, delta, activity } = await replayCodex("codex-0.155.1-two-subagents.jsonl");
  // The capture really is two subagents, one of them sent a follow-up after it had finished:
  // its thread is reported "completed", then "interacted", then "completed" again.
  const subagents = [...new Set(activity.map((item) => item.agentThreadId))];
  assert.equal(subagents.length, 2, "the capture contains two subagents");
  const kinds = (id) => activity.filter((item) => item.agentThreadId === id).map((item) => item.kind);
  assert.deepEqual(subagents.map(kinds).sort((a, b) => a.length - b.length), [["started", "completed"], ["started", "completed", "interacted", "completed"]]);
  assert.ok(notifications.some((message) => message.params.item?.type === "collabAgentToolCall" && message.params.item.tool === "wait"), "the capture contains a wait");
  assert.deepEqual(new Set(notifications.map((message) => message.params.threadId).filter((id) => id && id !== threadId)), new Set(subagents));

  assert.deepEqual(toolEntries(seen), ["started subagent", "started subagent", "completed subagent", "completed subagent"]);
  assert.deepEqual(seen.filter((event) => event.params.item?.tool === "subagent").map((event) => event.params.item.status), ["inProgress", "inProgress", "completed", "completed"]);
  assert.ok(delta(false).length > 0, "the capture contains subagent prose");
  assert.equal(prose(seen), delta(true));
  for (const id of subagents) {
    const own = notifications.filter((message) => message.method === "item/agentMessage/delta" && message.params.threadId === id).map((message) => message.params.delta).join("");
    assert.ok(own.length > 0 && !prose(seen).includes(own), "no subagent prose reaches the transcript");
  }
  assert.ok(seen.every((event) => !event.params?.threadId || event.params.threadId === threadId));
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

// Agents panel and context meter (chat drawer): what the adapters report beside the transcript.
const agentUpdates = (events) => events.filter((event) => event.method === "agent/updated").map(({ params: { threadId, turnId, ...params } }) => params);

test("a captured Claude delegation reports its agent row and the production agent's context", async () => {
  const stream = fixture("claude-code-2.1.278.jsonl").map((line) => JSON.parse(line));
  const seen = [], child = streamChild();
  const connection = new ClaudeChatConnection({ model: "sonnet", autocompact: 500_000, onEvent: (event) => seen.push(event), spawnSession: async (header) => { connection.header = header; return child; } });
  await connection.startTurn(await connection.startThread(), "Explore two openings with a subagent.");
  for (const event of stream) child.stdout.write(JSON.stringify(event) + "\n");
  await until(() => completions(seen).length);
  assert.equal(connection.header.autocompact, 500_000);
  const updates = agentUpdates(seen), id = updates[0].id;
  assert.deepEqual(updates[0], { id, label: "Evaluate slide openings in options.txt", model: null, state: "running" });
  assert.ok(updates.some((update) => update.model === "claude-sonnet-5" && update.tokens > 0), "the subagent's model and context size");
  assert.deepEqual(updates.at(-1), { id, state: "completed", model: "claude-sonnet-5", tokens: 16461 });
  assert.deepEqual(updates.filter((update) => "activity" in update).map((update) => update.activity), ["Read", ""], "the subagent's Read call, then its result");
  const context = seen.filter((event) => event.method === "context/usage").map((event) => event.params);
  assert.ok(context.some((params) => params.tokens > 0) && context.every((params) => !params.tokens || params.tokens >= 1000), "the production agent's request sizes only");
  assert.equal(context.at(-1).window, 1_000_000, "the model window from the result's modelUsage");
});

test("Claude reports a compaction boundary and compacts with /compact", async () => {
  const seen = [], child = streamChild(), written = [];
  child.stdin.on("data", (chunk) => written.push(String(chunk)));
  const connection = new ClaudeChatConnection({ model: "sonnet", onEvent: (event) => seen.push(event), spawnSession: async () => child });
  await connection.resumeThread("11111111-1111-4111-8111-111111111111");
  const started = connection.compact("11111111-1111-4111-8111-111111111111");
  await delay();
  for (const event of [{ type: "system", subtype: "status", status: "compacting" }, { type: "system", subtype: "init", session_id: "11111111-1111-4111-8111-111111111111", model: "claude-sonnet-5" },
    { type: "system", subtype: "compact_boundary", compact_metadata: { trigger: "manual", pre_tokens: 22884, post_tokens: 6296 } }, { type: "result", subtype: "success", is_error: false, num_turns: 0, local_command: "compact" }])
    child.stdout.write(JSON.stringify(event) + "\n");
  await started; await until(() => completions(seen).length);
  assert.match(written.join(""), /"text":"\/compact"/);
  assert.deepEqual(seen.find((event) => event.method === "context/compacted").params.preTokens, 22884);
  assert.deepEqual(seen.find((event) => event.method === "context/compacted").params.postTokens, 6296);
  assert.deepEqual(completions(seen), ["completed"]);
});

test("a captured Codex turn reports subagent rows with their own token usage and the thread's context", async () => {
  const { seen, connection } = await replayCodex("codex-0.155.1-two-subagents.jsonl");
  const updates = agentUpdates(seen), threads = [...new Set(updates.map((update) => update.id))];
  assert.equal(threads.length, 2);
  assert.deepEqual(updates.filter((update) => update.label).map((update) => [update.label, update.state]).sort(), [["closing", "completed"], ["closing", "running"], ["opening", "completed"], ["opening", "running"]]);
  for (const id of threads) assert.ok(updates.some((update) => update.id === id && update.tokens > 0), "each subagent's usage");
  const notifications = fixture("codex-0.155.1-two-subagents.jsonl").map((line) => JSON.parse(line)).filter((message) => message.method);
  const tools = notifications.filter((message) => message.params?.threadId && threads.includes(message.params.threadId) && message.method === "item/started" && ["commandExecution", "mcpToolCall", "dynamicToolCall", "fileChange", "webSearch"].includes(message.params.item?.type));
  assert.equal(updates.filter((update) => update.activity).length, tools.length, "each subagent tool call is its activity");
  const context = seen.filter((event) => event.method === "context/usage").map((event) => event.params);
  assert.equal(context.length, 7, "only the conversation thread's usage feeds the meter");
  assert.equal(context.at(-1).window, 258_400);
  assert.equal(connection.threadParams().config, undefined, "no trigger, no config");
  connection.autocompact = 225_000;
  assert.deepEqual(connection.threadParams().config, { model_auto_compact_token_limit: 225_000 });
});

test("Codex reports a compaction item with the sizes around it", () => {
  const seen = [];
  const connection = new WorkerCodexConnection({ child: streamChild(), cwd: "/ws", tools: { definitions: [], call() {} }, onEvent: (event) => seen.push(event) });
  connection.threadId = "t1";
  const usage = (inputTokens, totalTokens) => ({ method: "thread/tokenUsage/updated", params: { threadId: "t1", turnId: "x", tokenUsage: { last: { inputTokens, totalTokens }, modelContextWindow: 258_400 } } });
  for (const event of [usage(215_900, 216_150), { method: "item/started", params: { threadId: "t1", item: { type: "contextCompaction", id: "c1" } } }, usage(0, 18_692),
    { method: "item/completed", params: { threadId: "t1", item: { type: "contextCompaction", id: "c1" } } }]) connection.onEvent(event);
  assert.deepEqual(seen.map((event) => event.method), ["context/usage", "context/usage", "context/compacted"]);
  assert.deepEqual(seen[1].params.tokens, 18_692, "the update after a compaction reads as its total");
  assert.deepEqual(seen[2].params, { threadId: "t1", trigger: "auto", preTokens: 215_900, postTokens: 18_692 });
});

test("the worker launches Claude with --autocompact only inside Claude's range", async () => {
  const previous = process.env.STORYBENCH_HARNESS;
  process.env.STORYBENCH_HARNESS = "claude";
  const { launchArgv } = await import("../src/runtime/worker/agent.mjs?claude-autocompact");
  if (previous === undefined) delete process.env.STORYBENCH_HARNESS; else process.env.STORYBENCH_HARNESS = previous;
  const [, args] = launchArgv({ harness: "claude", model: "sonnet", autocompact: 500_000 });
  assert.deepEqual(args.slice(args.indexOf("--autocompact"), args.indexOf("--autocompact") + 2), ["--autocompact", "500000"]);
  assert.ok(!launchArgv({ harness: "claude", model: "sonnet" })[1].includes("--autocompact"));
  assert.throws(() => launchArgv({ harness: "claude", model: "sonnet", autocompact: 50_000 }), /100000 to 1000000/);
});

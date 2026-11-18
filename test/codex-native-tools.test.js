// Spec #40 E2: Codex records its native tools. The fixture is a stream captured live from the
// pinned Codex version; see test-support/fixtures/native-tools/README.md.
import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { WorkerCodexConnection } from "../src/runtime/harnesses.js";
import { Store } from "../src/store.js";
import { createChatService } from "../src/chat.js";

const lines = readFileSync(new URL("../test-support/fixtures/native-tools/codex-0.155.1.jsonl", import.meta.url), "utf8").trim().split("\n");
const stream = lines.map((line) => JSON.parse(line));
const delay = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check) { const end = Date.now() + 2000; while (Date.now() < end) { const value = check(); if (value) return value; await delay(5); } throw new Error("timeout"); }

// A child that answers each request with the captured output up to its response; everything
// after the turn/start response (id 3) follows at once.
function replayChild() {
  let cursor = 0;
  const child = new EventEmitter();
  child.stdout = new PassThrough(); child.exitCode = null;
  child.kill = () => { child.exitCode = 0; child.emit("exit", 0, null); };
  child.stdin = new Writable({ write(chunk, _encoding, callback) {
    for (const text of String(chunk).split("\n").filter(Boolean)) {
      const { id } = JSON.parse(text);
      if (id == null) continue;
      while (cursor < lines.length) { const message = stream[cursor]; child.stdout.write(lines[cursor++] + "\n"); if (message.id === id && !message.method) break; }
      if (id === 3) while (cursor < lines.length) child.stdout.write(lines[cursor++] + "\n");
    }
    callback();
  } });
  return child;
}

const NATIVE = { commandExecution: "shell", fileChange: "apply_patch", webSearch: "web_search" };

test("E2: the capture really holds Codex's own shell, patch and web search items, with their arguments", () => {
  const items = stream.filter((message) => ["item/started", "item/completed"].includes(message.method) && NATIVE[message.params.item.type]);
  assert.deepEqual(items.map((message) => `${message.method.slice(5)} ${message.params.item.type}`), [
    "started commandExecution", "completed commandExecution", "started fileChange", "completed fileChange", "started webSearch", "completed webSearch",
  ]);
  const completed = (type) => items.find((message) => message.method === "item/completed" && message.params.item.type === type).params.item;
  assert.match(completed("commandExecution").command, /cat options\.txt/);
  assert.match(completed("fileChange").changes[0].diff, /Option A/);
  assert.equal(completed("webSearch").query, "storyboard opening hook techniques");
  assert.ok(items.filter((message) => message.params.item.type === "webSearch").every((message) => !("status" in message.params.item)), "webSearch items carry no status");
});

test("E2: the Codex adapter turns them into tool entries named shell, apply_patch and web_search", async () => {
  const seen = [];
  const connection = new WorkerCodexConnection({ child: replayChild(), cwd: "/tmp/dev1-cap/ws", tools: { definitions: [], call() {} }, onEvent: (event) => seen.push(event) });
  await connection.open();
  const threadId = await connection.startThread();
  await connection.startTurn(threadId, "Run, patch and search.");
  await until(() => seen.some((event) => event.method === "turn/completed"));
  connection.close();
  const entries = seen.filter((event) => ["item/started", "item/completed"].includes(event.method) && event.params.item?.type === "dynamicToolCall");
  assert.deepEqual(entries.map((event) => [event.method, event.params.item]), [
    ["item/started", { type: "dynamicToolCall", tool: "shell", status: "inProgress" }],
    ["item/completed", { type: "dynamicToolCall", tool: "shell", status: "completed" }],
    ["item/started", { type: "dynamicToolCall", tool: "apply_patch", status: "inProgress" }],
    ["item/completed", { type: "dynamicToolCall", tool: "apply_patch", status: "completed" }],
    ["item/started", { type: "dynamicToolCall", tool: "web_search", status: "inProgress" }],
    ["item/completed", { type: "dynamicToolCall", tool: "web_search", status: "completed" }],
  ]);
  assert.ok(!seen.some((event) => NATIVE[event.params?.item?.type]), "no raw native item passes through");
});

test("E2: a chat turn over the capture records tool.started and tool.completed with no arguments", async () => {
  const store = new Store(mkdtempSync(path.join(tmpdir(), "storybench-native-tools-")));
  const episode = store.createEpisode({ title: "Native tools" });
  const factory = async (options) => new WorkerCodexConnection({ child: replayChild(), cwd: "/tmp/dev1-cap/ws", tools: { definitions: [], call() {} }, onEvent: options.onEvent, onError: options.onError }).open();
  const chat = createChatService({ store, codexFactory: factory });
  await chat.send(episode.id, "Run, patch and search.");
  await until(() => chat.get(episode.id).state === "idle");
  const { events, messages } = chat.get(episode.id);
  const turnId = stream.find((message) => message.method === "turn/started").params.turn.id;
  const tools = events.filter((event) => event.type.startsWith("tool."));
  assert.deepEqual(tools.map(({ type, payload }) => [type, payload]), [
    ["tool.started", { name: "shell", status: "inProgress", turnId }],
    ["tool.completed", { name: "shell", status: "completed", turnId }],
    ["tool.started", { name: "apply_patch", status: "inProgress", turnId }],
    ["tool.completed", { name: "apply_patch", status: "completed", turnId }],
    ["tool.started", { name: "web_search", status: "inProgress", turnId }],
    ["tool.completed", { name: "web_search", status: "completed", turnId }],
  ]);
  // Nothing the tools ran, wrote or searched for is recorded outside the assistant's own prose,
  // and the tools add no chat message.
  assert.doesNotMatch(JSON.stringify(events.filter((event) => event.type !== "assistant.delta")), /cat options|choice\.txt|Option A|storyboard opening|uab\.edu/);
  assert.deepEqual(messages.map((message) => message.role), ["user", "assistant"]);
});

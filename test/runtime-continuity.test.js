// Harness/model selection and continuity: controlled adapters (no Docker/providers).
import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store } from "../src/store.js";
import { createChatService } from "../src/chat.js";
import { ClaudeChatConnection } from "../src/runtime/harnesses.js";
import { createMemoryConversationPersistence, validateSelection, SelectionError } from "../src/runtime/conversation-runtime.js";

const catalog = [
  { harness: "codex", available: true, exactModelIds: true, models: [
    { id: "gpt-6-astra", isDefault: true, efforts: ["low", "medium", "high"], defaultEffort: "medium" },
    { id: "gpt-5.6-terra", isDefault: false, efforts: ["low", "medium", "high"], defaultEffort: "medium" },
    { id: "gpt-5.6-luna", isDefault: false, efforts: ["low", "medium"], defaultEffort: "medium" },
  ] },
  { harness: "claude", available: true, advisory: true, exactModelIds: true, efforts: ["low", "medium", "high", "xhigh", "max"], models: [
    { id: "sonnet", efforts: ["low", "medium", "high", "xhigh", "max"] }, { id: "opus", efforts: ["low", "medium", "high", "xhigh", "max"] },
  ] },
];
const delay = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, timeout = 2000) { const end = Date.now() + timeout; while (Date.now() < end) { const value = check(); if (value) return value; await delay(5); } throw new Error("timeout"); }

// A controllable fake harness: records every launch/turn and completes each turn.
function harnessFactory({ failStart = null } = {}) {
  const log = [];
  let threadCounter = 0;
  const factory = async (options) => {
    if (failStart?.(options)) throw new Error(`${options.harness} could not start: model ${options.model} unavailable`);
    const entry = { harness: options.harness, model: options.model, effort: options.effort, segmentId: options.segmentId, requestId: options.requestId, resumed: null, started: null, prompts: [] };
    log.push(entry);
    return {
      resolved: { model: `${options.model ?? "default"}-resolved`, effort: options.effort },
      async resumeThread(id) { entry.resumed = id; return id; },
      async startThread() { entry.started = `${options.harness}-thread-${++threadCounter}`; return entry.started; },
      async startTurn(_thread, text) {
        entry.prompts.push(text);
        queueMicrotask(() => {
          options.onEvent({ method: "item/agentMessage/delta", params: { delta: `reply from ${options.harness}` } });
          options.onEvent({ method: "turn/completed", params: { turn: { id: `turn-${entry.requestId}`, status: "completed" }, usage: { input_tokens: 1 } } });
        });
        return `turn-${entry.requestId}`;
      },
      async interrupt() {}, close() {},
    };
  };
  return { factory, log };
}

function setup(t, options = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), "sb-cont-"));
  const store = new Store(root);
  const persistence = options.persistence ?? createMemoryConversationPersistence();
  const fake = harnessFactory(options);
  const chat = createChatService({ store, codexFactory: fake.factory, continuity: { persistence, catalog: async () => catalog } });
  t.after(async () => { await chat.close(); store.close(); rmSync(root, { recursive: true, force: true }); });
  const episode = store.createEpisode();
  return { store, chat, persistence, fake, episode, root };
}
const idle = (chat, episodeId, id) => until(() => { const value = chat.get(episodeId, id); return ["idle", "error", "interrupted"].includes(value.state) ? value : null; });

test("selection validation follows each harness/model contract", () => {
  assert.deepEqual(validateSelection(catalog, { harness: "codex", model: "gpt-5.6-terra", effort: "high" }).model, "gpt-5.6-terra");
  assert.throws(() => validateSelection(catalog, { harness: "codex", model: "gpt-5.6-luna", effort: "high" }), { code: "UNSUPPORTED_EFFORT" });
  assert.throws(() => validateSelection(catalog, { harness: "codex", model: "gpt-custom-x", effort: "low" }), { code: "UNSUPPORTED_EFFORT" });
  assert.match(validateSelection(catalog, { harness: "codex", model: "gpt-custom-x" }).notes[0], /verified when the next turn starts/);
  assert.equal(validateSelection(catalog, { harness: "claude", model: "claude-sonnet-5", effort: "max" }).effort, "max");
  assert.throws(() => validateSelection([{ ...catalog[0], available: false, reason: "No codex login found." }], { harness: "codex" }), { code: "HARNESS_UNAVAILABLE", message: /No codex login found/ });
  assert.throws(() => validateSelection(catalog, { harness: "gemini" }), { code: "UNKNOWN_HARNESS" });
  assert.throws(() => validateSelection(catalog, { harness: "claude", model: "sonnet --flag" }), { code: "INVALID_MODEL" });
});

test("same-harness model change resumes the exact session; cross-harness starts a seeded segment; returning starts fresh", async (t) => {
  const { chat, persistence, fake, episode } = setup(t);
  const c = chat.create(episode.id, { name: "Switching" });
  await chat.send(episode.id, c.id, "First, in Codex");
  await idle(chat, episode.id, c.id);
  const firstThread = fake.log[0].started;
  // Same harness, other model: exact resume with the new settings.
  let value = await chat.updateSettings(episode.id, c.id, { harness: "codex", model: "gpt-5.6-luna", effort: "low", expectedRevision: 1, clientRequestId: "req-a" });
  assert.equal(value.settingsResult.changed, true);
  await chat.send(episode.id, c.id, "Second, still Codex");
  await idle(chat, episode.id, c.id);
  assert.deepEqual([fake.log[1].harness, fake.log[1].model, fake.log[1].effort, fake.log[1].resumed, fake.log[1].started], ["codex", "gpt-5.6-luna", "low", firstThread, null]);
  assert.equal(fake.log[1].segmentId, fake.log[0].segmentId);
  // Cross-harness: new segment, never the Codex thread ID, seeded with a bounded excerpt.
  value = await chat.updateSettings(episode.id, c.id, { harness: "claude", model: "sonnet", expectedRevision: 2 });
  await chat.send(episode.id, c.id, "Third, now Claude");
  await idle(chat, episode.id, c.id);
  const claudeTurn = fake.log[2];
  assert.equal(claudeTurn.harness, "claude");
  assert.equal(claudeTurn.resumed, null, "no native ID crosses harnesses");
  assert.notEqual(claudeTurn.segmentId, fake.log[0].segmentId);
  assert.match(claudeTurn.prompts[0], /Earlier visible conversation[\s\S]*do not re-execute[\s\S]*First, in Codex[\s\S]*reply from codex[\s\S]*User request:\nThird, now Claude/);
  assert.equal(fake.log.filter((entry) => entry.prompts.some((prompt) => prompt.endsWith("First, in Codex"))).length, 1, "old prompts never re-sent as requests");
  // Back to Codex: a fresh segment (harness-return), not the stale Codex thread.
  await chat.updateSettings(episode.id, c.id, { harness: "codex", model: "gpt-5.6-terra", expectedRevision: 3 });
  await chat.send(episode.id, c.id, "Fourth, back to Codex");
  const final = await idle(chat, episode.id, c.id);
  const back = fake.log[3];
  assert.equal(back.resumed, null);
  assert.ok(back.started && back.started !== firstThread);
  const segments = persistence.listSegments(c.id);
  assert.deepEqual(segments.map((segment) => segment.reason), ["initial", "harness-switch", "harness-return"]);
  assert.equal(segments.filter((segment) => !segment.endedAt).length, 1);
  // Visible boundaries and run attribution.
  assert.equal(final.events.filter((event) => event.type === "settings.changed").length, 3);
  assert.equal(final.events.filter((event) => event.type === "segment.started").length, 2);
  assert.deepEqual(final.runs.map((run) => [run.harness, run.modelSelected, run.modelResolved, run.state]), [
    ["codex", null, "default-resolved", "completed"], ["codex", "gpt-5.6-luna", "gpt-5.6-luna-resolved", "completed"],
    ["claude", "sonnet", "sonnet-resolved", "completed"], ["codex", "gpt-5.6-terra", "gpt-5.6-terra-resolved", "completed"]]);
  assert.deepEqual(final.messages.map((message) => message.text).filter((text) => text.startsWith("First") || text.startsWith("Second")).length, 2, "transcript preserved");
});

test("settings changes are refused while busy, validated, idempotent and never rewrite other conversations", async (t) => {
  const { chat, store, fake, episode } = setup(t);
  const a = chat.create(episode.id, { name: "A" }), b = chat.create(episode.id, { name: "B" });
  await assert.rejects(chat.updateSettings(episode.id, a.id, { harness: "codex", model: "gpt-5.6-luna", effort: "high", expectedRevision: 1 }), { code: "UNSUPPORTED_EFFORT" });
  await assert.rejects(chat.updateSettings(episode.id, a.id, { harness: "codex", model: "gpt-5.6-luna", expectedRevision: 7 }), { code: "SETTINGS_CONFLICT" });
  const first = await chat.updateSettings(episode.id, a.id, { harness: "claude", model: "opus", expectedRevision: 1, clientRequestId: "same" });
  const repeat = await chat.updateSettings(episode.id, a.id, { harness: "claude", model: "opus", expectedRevision: 1, clientRequestId: "same" });
  assert.equal(first.settingsResult.changed, true);
  assert.equal(repeat.settingsResult.duplicate, true);
  assert.equal(repeat.events.filter((event) => event.type === "settings.changed").length, 1, "one boundary for a duplicate submit");
  assert.equal(chat.get(episode.id, b.id).settings.harness, "codex", "other conversation untouched");
  // A new conversation reuses the last explicit choice.
  assert.deepEqual((({ harness, model }) => ({ harness, model }))(chat.create(episode.id, { name: "C" }).settings), { harness: "claude", model: "opus" });
  // Busy: an active turn blocks switching.
  let release;
  const slow = createChatService({ store, codexFactory: async (options) => ({ async startThread() { return "t"; }, async startTurn() { await new Promise((resolve) => { release = () => { options.onEvent({ method: "turn/completed", params: { turn: { id: "x", status: "completed" } } }); resolve(); }; }); return "x"; }, async interrupt() {}, close() {} }),
    continuity: { persistence: createMemoryConversationPersistence(), catalog: async () => catalog } });
  t.after(() => slow.close());
  const s = slow.create(episode.id, { name: "busy" });
  slow.send(episode.id, s.id, "long running");
  await until(() => release);
  await assert.rejects(slow.updateSettings(episode.id, s.id, { harness: "claude", expectedRevision: 1 }), { code: "BUSY", message: /Stop/ });
  release();
  assert.equal(fake.log.length, 0);
});

test("a failed startup keeps history and the unsent draft and never falls back to the previous harness", async (t) => {
  const { chat, fake, episode } = setup(t, { failStart: (options) => options.harness === "claude" });
  const c = chat.create(episode.id, { name: "Fail" });
  await chat.send(episode.id, c.id, "hello codex");
  await idle(chat, episode.id, c.id);
  await chat.updateSettings(episode.id, c.id, { harness: "claude", model: "claude-nonexistent-9", expectedRevision: 1 });
  chat.update(episode.id, c.id, { draft: "unsent idea" });
  await chat.send(episode.id, c.id, "hello claude");
  const failed = await idle(chat, episode.id, c.id);
  assert.equal(failed.state, "error");
  assert.match(failed.error, /claude could not start: model claude-nonexistent-9 unavailable/);
  assert.equal(fake.log.length, 1, "no silent Codex fallback");
  assert.deepEqual(failed.messages.map((message) => message.text), ["hello codex", "reply from codex", "hello claude"]);
  assert.equal(failed.runs.at(-1).state, "failed");
  // The creator can choose another model and retry; the new segment is seeded.
  await chat.updateSettings(episode.id, c.id, { harness: "claude", model: "sonnet", expectedRevision: 2 });
  assert.equal(chat.get(episode.id, c.id).settings.model, "sonnet");
});

test("reopening a conversation keeps its settings, segments and runs", async (t) => {
  const persistence = createMemoryConversationPersistence();
  const { chat, store, episode } = setup(t, { persistence });
  const c = chat.create(episode.id, { name: "Reopen" });
  await chat.updateSettings(episode.id, c.id, { harness: "claude", model: "sonnet", effort: "high", expectedRevision: 1 });
  await chat.send(episode.id, c.id, "remember this");
  await idle(chat, episode.id, c.id);
  const reopened = createChatService({ store, codexFactory: harnessFactory().factory, continuity: { persistence, catalog: async () => catalog } });
  t.after(() => reopened.close());
  const value = reopened.get(episode.id, c.id);
  assert.deepEqual([value.settings.harness, value.settings.model, value.settings.effort], ["claude", "sonnet", "high"]);
  assert.equal(value.segments.length, 1);
  assert.equal(value.runs.length, 1);
});

function fakeClaudeChild() {
  const child = new EventEmitter();
  child.stdout = new PassThrough(); child.stdin = new PassThrough(); child.exitCode = null;
  child.kill = () => { child.exitCode = 0; child.emit("exit", 0, null); };
  return child;
}

test("Claude stream-json is normalized into the chat's turn/text/tool/completion events with reported model and usage", async () => {
  const launches = [], events = [];
  let child;
  const connection = new ClaudeChatConnection({ model: "sonnet", effort: "high", onEvent: (event) => events.push(event),
    spawnSession: async (header) => { launches.push(header); child = fakeClaudeChild(); return child; } });
  const threadId = await connection.startThread();
  const turnId = await connection.startTurn(threadId, "hello");
  assert.deepEqual(launches[0], { harness: "claude", model: "sonnet", effort: "high", sessionId: threadId });
  const write = (value) => child.stdout.write(JSON.stringify(value) + "\n");
  write({ type: "system", subtype: "init", session_id: threadId, model: "claude-sonnet-5" });
  write({ type: "assistant", message: { model: "claude-sonnet-5", content: [{ type: "text", text: "Reading the story." }, { type: "tool_use", id: "tu1", name: "mcp__storybench__get_context", input: {} }], usage: { output_tokens: 5 } } });
  write({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "tu1", is_error: false, content: [] }] } });
  write({ type: "result", subtype: "success", is_error: false, result: "done", session_id: threadId, usage: { input_tokens: 10, output_tokens: 7 } });
  await delay(10);
  assert.deepEqual(events.map((event) => event.method), ["turn/started", "item/agentMessage/delta", "item/started", "item/completed", "turn/completed"]);
  assert.equal(events[2].params.item.tool, "get_context");
  const completed = events.at(-1).params;
  assert.deepEqual([completed.turn.id, completed.turn.status, completed.model, completed.usage.output_tokens], [turnId, "completed", "claude-sonnet-5", 7]);
  assert.equal(connection.resolved.model, "claude-sonnet-5");
  // Resume uses the exact session ID; interrupt ends as interrupted.
  const resumed = new ClaudeChatConnection({ model: "opus", onEvent: (event) => events.push(event), spawnSession: async (header) => { launches.push(header); child = fakeClaudeChild(); return child; } });
  await resumed.resumeThread(threadId);
  await resumed.startTurn(threadId, "again");
  assert.deepEqual(launches[1], { harness: "claude", model: "opus", resume: threadId });
  await resumed.interrupt();
  assert.match(child.stdin.read()?.toString() ?? "", /"subtype":"interrupt"/);
  write({ type: "result", subtype: "error_during_execution", is_error: true, result: "interrupted" });
  await delay(10);
  assert.equal(events.at(-1).params.turn.status, "interrupted");
});

test("Claude exiting before a result completes the turn as failed, plainly", async () => {
  const events = [];
  let child;
  const connection = new ClaudeChatConnection({ model: "sonnet", onEvent: (event) => events.push(event), spawnSession: async () => { child = fakeClaudeChild(); return child; } });
  await connection.resumeThread("3ff05a59-8ffd-45bb-be71-f806f55e7c78");
  await connection.startTurn("3ff05a59-8ffd-45bb-be71-f806f55e7c78", "hi");
  child.kill();
  await delay(5);
  assert.equal(events.at(-1).params.turn.status, "failed");
  assert.match(events.at(-1).params.turn.error, /exited before the turn completed/);
  assert.ok(SelectionError);
});

test("the real v9 store persistence carries selection, segments and request attribution", async (t) => {
  const { createV9ConversationPersistence } = await import("../src/runtime/conversation-persistence.js");
  const root = mkdtempSync(path.join(os.tmpdir(), "sb-cont-v9-"));
  const store = new Store(root);
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
  const persistence = createV9ConversationPersistence(store);
  const fake = harnessFactory();
  const chat = createChatService({ store, codexFactory: fake.factory, continuity: { persistence, catalog: async () => catalog } });
  t.after(() => chat.close());
  const episode = store.createEpisode();
  const c = chat.create(episode.id, { name: "v9" });
  await chat.send(episode.id, c.id, "First");
  await idle(chat, episode.id, c.id);
  await chat.updateSettings(episode.id, c.id, { harness: "codex", model: "gpt-5.6-luna", effort: "low", expectedRevision: 1 });
  await chat.send(episode.id, c.id, "Second");
  await idle(chat, episode.id, c.id);
  await chat.updateSettings(episode.id, c.id, { harness: "claude", model: "sonnet", expectedRevision: 2 });
  await chat.send(episode.id, c.id, "Third");
  await idle(chat, episode.id, c.id);
  await chat.updateSettings(episode.id, c.id, { harness: "codex", model: "gpt-5.6-terra", expectedRevision: 3 });
  await chat.send(episode.id, c.id, "Fourth");
  const final = await idle(chat, episode.id, c.id);
  assert.equal(fake.log[1].resumed, fake.log[0].started, "same-harness change resumes the exact session");
  assert.equal(fake.log[2].resumed, null);
  assert.equal(fake.log[3].resumed, null, "returning to Codex starts fresh");
  assert.deepEqual(store.listSegments(c.id).map((segment) => [segment.harness, segment.reason, Boolean(segment.endedAt)]), [["codex", "initial", true], ["claude", "harness-switch", true], ["codex", "harness-return", false]]);
  const claudeSegment = store.listSegments(c.id)[1];
  assert.ok(claudeSegment.seedIncludedMessages >= 2, "seed recorded on the segment");
  const runs = store.listProductionRuns({ conversationId: c.id });
  assert.deepEqual(runs.map((run) => [run.harness, run.modelSelected, run.modelResolved, run.state]), [
    ["codex", null, "default-resolved", "completed"], ["codex", "gpt-5.6-luna", "gpt-5.6-luna-resolved", "completed"],
    ["claude", "sonnet", "sonnet-resolved", "completed"], ["codex", "gpt-5.6-terra", "gpt-5.6-terra-resolved", "completed"]]);
  assert.ok(runs.every((run) => run.originatingMessageId && run.assistantMessageId && run.segmentId));
  assert.deepEqual(final.messages.map((message) => message.role), ["user", "assistant", "user", "assistant", "user", "assistant", "user", "assistant"]);
  const origins = store.db.prepare("SELECT role, origin FROM conversation_messages WHERE conversation_id=? ORDER BY id").all(c.id).map((row) => `${row.role}:${row.origin}`);
  assert.deepEqual([...new Set(origins)], ["user:typed", "assistant:agent"]);
  // A new conversation preselects the last explicit choice.
  const next = chat.create(episode.id, { name: "next" });
  assert.deepEqual([next.settings.harness, next.settings.model], ["codex", "gpt-5.6-terra"]);
});

test("one active request per conversation and a request never opens another harness's segment", async (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "sb-cont-guard-"));
  const store = new Store(root);
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
  const { createV9ConversationPersistence } = await import("../src/runtime/conversation-persistence.js");
  const persistence = createV9ConversationPersistence(store);
  const chat = createChatService({ store, codexFactory: async () => { throw new Error("unused"); }, continuity: { persistence, catalog: async () => catalog } });
  t.after(() => chat.close());
  const episode = store.createEpisode();
  const c = chat.create(episode.id, { name: "guard" });
  const message = store.addConversationMessage({ conversationId: c.id, role: "user", text: "x" });
  const segment = store.createSegment({ conversationId: c.id, harness: "codex", reason: "initial" });
  const run = store.createProductionRun({ conversationId: c.id, harness: "codex", segmentId: segment.id, originatingMessageId: message.id }).run;
  await assert.rejects(chat.send(episode.id, c.id, "second request"), { statusCode: 409, message: /already running in this conversation/ });
  assert.throws(() => store.createSegment({ conversationId: c.id, harness: "claude", reason: "resume-unavailable", exceptRunId: run.id }), { statusCode: 409, message: /codex request cannot open a claude segment/ });
  assert.equal(store.createSegment({ conversationId: c.id, harness: "codex", reason: "resume-unavailable", exceptRunId: run.id }).harness, "codex");
});

// Context meter, compaction (manual, threshold, idle) and the Agents panel's events, with a
// controlled fake harness (no Docker/providers).
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store } from "../src/store.js";
import { createChatService } from "../src/chat.js";
import { createMemoryConversationPersistence } from "../src/runtime/conversation-runtime.js";

const catalog = [
  { harness: "codex", available: true, exactModelIds: true, models: [{ id: "gpt-6-astra", isDefault: true, efforts: ["medium"], defaultEffort: "medium" }] },
  { harness: "claude", available: true, exactModelIds: true, efforts: ["medium"], models: [{ id: "sonnet", efforts: ["medium"] }] },
];
const delay = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, timeout = 2000) { const end = Date.now() + timeout; while (Date.now() < end) { const value = check(); if (value) return value; await delay(5); } throw new Error("timeout"); }

// Each turn reports `turnEvents()`; a compaction reports `compactEvents()`.
function harness({ turnEvents = () => [], compactEvents = () => [] } = {}) {
  const control = { gate: null };
  const launches = [];
  let threads = 0;
  const factory = async (options) => {
    const launch = { ...options, resumed: null, compacted: null };
    launches.push(launch);
    const send = (events) => queueMicrotask(() => { for (const event of events) options.onEvent(event); });
    return {
      resolved: { model: options.model ?? "default", effort: options.effort },
      async resumeThread(id) { launch.resumed = id; return id; },
      async startThread() { return `thread-${++threads}`; },
      async startTurn() {
        const turn = { id: `turn-${options.requestId}` };
        const events = [...turnEvents(), { method: "turn/completed", params: { turn: { ...turn, status: "completed" } } }];
        Promise.resolve(control.gate).then(() => send(events));
        return turn.id;
      },
      async compact(threadId) {
        launch.compacted = threadId;
        send([{ method: "turn/started", params: { turn: { id: "compaction" } } }, ...compactEvents(), { method: "turn/completed", params: { turn: { id: "compaction", status: "completed" } } }]);
      },
      async interrupt() {}, close() {},
    };
  };
  return { factory, launches, control };
}

function setup(t, fake) {
  const root = mkdtempSync(path.join(os.tmpdir(), "sb-context-"));
  const store = new Store(root), persistence = createMemoryConversationPersistence();
  const chat = createChatService({ store, codexFactory: fake.factory, continuity: { persistence, catalog: async () => catalog } });
  t.after(async () => { await chat.close(); store.close(); rmSync(root, { recursive: true, force: true }); });
  const episode = store.createEpisode();
  const c = chat.create(episode.id, { name: "Work" });
  return { chat, episode, c, persistence };
}
const settled = (chat, episodeId, id) => until(() => { const value = chat.get(episodeId, id); return ["idle", "error", "interrupted"].includes(value.state) ? value : null; });
const usage = (tokens, window = null) => ({ method: "context/usage", params: { tokens, ...(window ? { window } : {}) } });
const ofType = (value, type) => value.events.filter((event) => event.type === type);
const useClaude = (chat, episodeId, c) => chat.updateSettings(episodeId, c.id, { harness: "claude", model: "sonnet", expectedRevision: chat.get(episodeId, c.id).settings.revision });

test("the meter follows the session; a manual compaction resumes the stored session and records the outcome", async (t) => {
  let tokens = 40_000;
  const fake = harness({ turnEvents: () => [usage(tokens, 258_400), usage(tokens, 258_400)], compactEvents: () => [{ method: "context/compacted", params: { trigger: "manual", preTokens: tokens, postTokens: 9_000 } }] });
  const { chat, episode, c } = setup(t, fake);
  const fresh = chat.get(episode.id, c.id).context;
  assert.deepEqual([fresh.canCompact, fresh.reason, fresh.trigger], [false, "Nothing to compact yet", 225_000]);
  await assert.rejects(chat.compact(episode.id, c.id), { statusCode: 409, message: "Nothing to compact yet" });

  await chat.send(episode.id, c.id, "hello");
  let value = await settled(chat, episode.id, c.id);
  assert.deepEqual([value.context.tokens, value.context.window, value.context.canCompact], [40_000, 258_400, true]);
  assert.equal(ofType(value, "context.usage").length, 1, "an unchanged reading is recorded once");
  assert.equal(fake.launches[0].autocompact, 225_000, "Codex is launched with the OpenAI trigger");

  const messages = value.messages.length;
  await chat.compact(episode.id, c.id);
  value = await until(() => { const current = chat.get(episode.id, c.id); return ofType(current, "context.compacted").length && current.state === "idle" ? current : null; });
  const compaction = fake.launches[1], segment = value.segments.at(-1);
  assert.deepEqual([compaction.resumed, compaction.compacted, compaction.segmentId], [segment.nativeSessionId, segment.nativeSessionId, segment.id]);
  assert.equal(ofType(value, "compaction.started")[0].payload.cause, "operator");
  assert.deepEqual(ofType(value, "context.compacted")[0].payload, { cause: "operator", trigger: "manual", preTokens: 40_000, postTokens: 9_000, segmentId: segment.id });
  assert.equal(value.context.tokens, 9_000);
  assert.equal(value.messages.length, messages, "the transcript is untouched");
});

test("a turn that ends at or above the trigger compacts once, unless the harness already did", async (t) => {
  let turnEvents = [usage(520_000)];
  const fake = harness({ turnEvents: () => turnEvents, compactEvents: () => [{ method: "context/compacted", params: { trigger: "manual", preTokens: 520_000, postTokens: 30_000 } }] });
  const { chat, episode, c } = setup(t, fake);
  await useClaude(chat, episode.id, c);
  await chat.send(episode.id, c.id, "big turn");
  const value = await until(() => { const current = chat.get(episode.id, c.id); return ofType(current, "context.compacted").length && current.state === "idle" ? current : null; });
  assert.equal(fake.launches[0].autocompact, 500_000, "Claude is launched with the Anthropic trigger");
  assert.equal(ofType(value, "compaction.started")[0].payload.cause, "threshold");
  assert.equal(value.context.tokens, 30_000);

  // The harness compacted during the turn: no second compaction follows.
  turnEvents = [usage(510_000), { method: "context/compacted", params: { trigger: "auto", preTokens: 510_000, postTokens: 20_000 } }, usage(21_000)];
  await chat.send(episode.id, c.id, "another");
  const after = await settled(chat, episode.id, c.id);
  await delay(20);
  assert.equal(fake.launches.length, 3, "two turns and one compaction");
  assert.equal(ofType(after, "context.compacted").at(-1).payload.cause, "harness");
  assert.equal(chat.get(episode.id, c.id).context.tokens, 21_000);
});

test("a refused compaction is reported and the conversation returns to its state", async (t) => {
  const fake = harness({ turnEvents: () => [usage(1_000)], compactEvents: () => [{ method: "item/agentMessage/delta", params: { delta: "Error: No messages to compact" } }] });
  const { chat, episode, c } = setup(t, fake);
  await chat.send(episode.id, c.id, "hello");
  await settled(chat, episode.id, c.id);
  await chat.compact(episode.id, c.id);
  const value = await until(() => { const current = chat.get(episode.id, c.id); return ofType(current, "compaction.failed").length && current.state === "idle" ? current : null; });
  assert.equal(ofType(value, "compaction.failed")[0].payload.reason, "Error: No messages to compact");
  assert.equal(value.context.tokens, 1_000);
});

test("compaction is refused while the production has an active turn", async (t) => {
  const fake = harness({ turnEvents: () => [usage(1_000)] });
  const { chat, episode, c } = setup(t, fake);
  await chat.send(episode.id, c.id, "hello");
  await settled(chat, episode.id, c.id);
  let release;
  fake.control.gate = new Promise((resolve) => { release = resolve; });
  const other = chat.create(episode.id, { name: "Other" });
  await chat.send(episode.id, other.id, "busy");
  await until(() => fake.launches.length === 2);
  await assert.rejects(chat.compact(episode.id, c.id), { statusCode: 409, message: /A turn is active/ });
  release();
  await settled(chat, episode.id, other.id);
  assert.equal(chat.get(episode.id, c.id).context.canCompact, true);
});

test("an idle chat at or above the idle size compacts once while the cache is warm", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "Date"], now: Date.parse("2026-11-18T10:00:00Z") });
  const fake = harness({ turnEvents: () => [usage(130_000)], compactEvents: () => [{ method: "context/compacted", params: { trigger: "manual", preTokens: 130_000, postTokens: 12_000 } }] });
  const { chat, episode, c } = setup(t, fake);
  await chat.send(episode.id, c.id, "hello");
  await settled(chat, episode.id, c.id);
  t.mock.timers.tick(24 * 60_000);
  await delay(10);
  assert.equal(fake.launches.length, 1, "not before the wait");
  t.mock.timers.tick(2 * 60_000);
  const value = await until(() => { const current = chat.get(episode.id, c.id); return ofType(current, "context.compacted").length && current.state === "idle" ? current : null; });
  assert.equal(ofType(value, "compaction.started")[0].payload.cause, "idle");
  t.mock.timers.tick(10 * 60_000);
  await delay(10);
  assert.equal(fake.launches.length, 2, "once per idle period");
});

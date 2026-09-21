import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store } from "../src/store.js";
import { createChatService } from "../src/chat.js";
import { createV9ConversationPersistence } from "../src/runtime/conversation-persistence.js";

const until = async (check, timeout = 2000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const value = check(); if (value) return value; await new Promise((resolve) => setTimeout(resolve, 5)); }
  throw new Error("timed out");
};

function fixture(t, { hold = false } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), "storybench-production-routing-"));
  const store = new Store(root); const episode = store.createEpisode({ title: "Routing" });
  const current = store.updateEpisode(episode.id, episode.revision, { cards: [{ id: "opening", title: "Opening", type: "Video", prompt: "Build an opener" }] });
  const calls = []; let sequence = 0;
  const factory = async (options) => {
    calls.push(options);
    const threadId = `thread_${++sequence}`;
    return { startThread: async () => threadId, resumeThread: async (id) => id, startTurn: async () => {
      const turnId = `turn_${sequence}`;
      queueMicrotask(() => options.onEvent({ method: "turn/started", params: { turnId } }));
      if (!hold) queueMicrotask(() => options.onEvent({ method: "turn/completed", params: { turn: { id: turnId, status: "completed" } } }));
      return turnId;
    }, interrupt: async (_thread, turnId) => queueMicrotask(() => options.onEvent({ method: "turn/completed", params: { turn: { id: turnId, status: "interrupted" } } })), close() {} };
  };
  const renders = {
    validateRender: () => ({ renderRevision: "r" }),
    getJob: (_episodeId, id) => store.getJob(id),
    cancelJob: (_episodeId, id) => store.saveJob({ ...store.getJob(id), state: "cancelled", error: "cancelled" }),
    listGraphicRecipes: () => [],
  };
  const chat = createChatService({ store, renders, codexFactory: factory,
    continuity: { persistence: createV9ConversationPersistence(store), catalog: async () => [] } });
  t.after(async () => { await chat.close(); store.close(); rmSync(root, { recursive: true, force: true }); });
  return { store, episode: current, calls, renders, chat };
}

test("every production shortcut creates one visible server-scoped button request and provider input", async (t) => {
  const { store, episode, calls, chat } = fixture(t);
  const conversation = chat.create(episode.id);
  const cases = [
    ["card_build", "opening", "Build the output"],
    ["still_graphic", "opening", "Make a still"],
    ["animated_graphic", null, "Make motion for the library"],
    ["draft", null, "ignored client wording"],
    ["final", null, "ignored client wording"],
  ];
  for (const [kind, targetCardId, prompt] of cases) {
    const result = await chat.sendProduction(episode.id, conversation.id, { kind, targetCardId, prompt, clientRequestId: crypto.randomUUID() });
    assert.equal(result.requestResult.created, true);
    if (kind === "final") assert.equal(result.requestResult.run.finalIntent, "active", "the Final button binds intent before dispatch");
    await until(() => !chat.busyReason(episode.id));
    const run = store.getProductionRun(result.requestResult.run.id);
    const message = store.db.prepare("SELECT * FROM conversation_messages WHERE id=?").get(run.originatingMessageId);
    assert.equal(message.origin, "button"); assert.equal(run.kind, kind); assert.equal(run.targetCardId, targetCardId);
    assert.deepEqual(calls.at(-1).request, { text: message.text, messageId: message.id, kind, cardId: targetCardId });
  }
  assert.equal(chat.get(episode.id, conversation.id).messages.filter((message) => message.role === "user").length, cases.length);
});

test("duplicate transport IDs return the existing request, busy episodes refuse, and Retry creates a successor", async (t) => {
  const { store, episode, chat } = fixture(t, { hold: true });
  const conversation = chat.create(episode.id), clientRequestId = crypto.randomUUID();
  const first = await chat.sendProduction(episode.id, conversation.id, { kind: "draft", clientRequestId });
  const duplicate = await chat.sendProduction(episode.id, conversation.id, { kind: "draft", clientRequestId });
  assert.equal(duplicate.requestResult.created, false);
  assert.equal(duplicate.requestResult.run.id, first.requestResult.run.id);
  await assert.rejects(chat.sendProduction(episode.id, conversation.id, { kind: "still_graphic", prompt: "another", clientRequestId: crypto.randomUUID() }), /not queued/);
  await until(() => chat.get(episode.id, conversation.id).state === "running");
  await chat.interrupt(episode.id, conversation.id);
  await until(() => store.getProductionRun(first.requestResult.run.id).state === "interrupted");
  const retried = await chat.retry(episode.id, conversation.id, first.requestResult.run.id, { clientRequestId: crypto.randomUUID() });
  assert.equal(retried.requestResult.run.successorOf, first.requestResult.run.id);
});

test("a refused Retry leaves no orphan visible queued message", async (t) => {
  const { store, episode, chat } = fixture(t);
  const conversation = chat.create(episode.id);
  const message = store.addConversationMessage({ conversationId: conversation.id, role: "user", text: "Create final", shortcut: true });
  const run = store.createProductionRun({ conversationId: conversation.id, kind: "final", origin: "button", originatingMessageId: message.id, harness: "codex" }).run;
  store.updateProductionRun(run.id, { state: "running" });
  const job = store.saveJob({ episodeId: episode.id, kind: "final", outputClass: "final", state: "completed", progress: 1,
    revision: episode.revision, snapshot: {}, outputPath: "outputs/final.mp4", requestId: run.id });
  store.publishFinalIntent(run.id, job.id);
  store.updateProductionRun(run.id, { state: "completed" });
  const before = chat.get(episode.id, conversation.id).messages.length;
  await assert.rejects(chat.retry(episode.id, conversation.id, run.id, { clientRequestId: crypto.randomUUID() }), /published/);
  const after = chat.get(episode.id, conversation.id).messages;
  assert.equal(after.length, before);
  assert.equal(after.filter((entry) => entry.state === "queued").length, 0);
});

test("typed messages always create chat requests even when they negate a Final", async (t) => {
  const { store, episode, calls, chat } = fixture(t, { hold: true });
  const conversation = chat.create(episode.id);
  const text = "make a draft; do NOT create the final";
  await chat.send(episode.id, conversation.id, text);
  await until(() => calls.length && chat.get(episode.id, conversation.id).state === "running");
  const run = store.listProductionRuns({ conversationId: conversation.id }).at(-1);
  assert.equal(run.kind, "chat");
  assert.deepEqual(calls[0].request, { text, messageId: run.originatingMessageId, kind: "chat", cardId: null });
  await chat.interrupt(episode.id, conversation.id);
});

test("request jobs are linked; Stop cancels only owned work and completed partial assets survive failure", async (t) => {
  const { store, episode, calls, chat } = fixture(t, { hold: true });
  const conversation = chat.create(episode.id);
  const sent = await chat.sendProduction(episode.id, conversation.id, { kind: "draft", clientRequestId: crypto.randomUUID() });
  await until(() => calls.length);
  const owned = store.saveJob({ id: "job_owned", episodeId: episode.id, kind: "draft", outputClass: "draft", state: "queued", progress: 0,
    revision: episode.revision, snapshot: {}, requestId: sent.requestResult.run.id, createdAt: new Date().toISOString() });
  const independent = store.saveJob({ id: "job_independent", episodeId: episode.id, kind: "draft", outputClass: "draft", state: "queued", progress: 0,
    revision: episode.revision, snapshot: {}, createdAt: new Date().toISOString() });
  assert.equal(store.listRequestJobs(sent.requestResult.run.id)[0].id, owned.id);
  await until(() => chat.get(episode.id, conversation.id).state === "running");
  await chat.interrupt(episode.id, conversation.id);
  await until(() => store.getJob(owned.id).state === "cancelled");
  assert.equal(store.getJob(independent.id).state, "queued");

  // A registered/completed result is ordinary durable state and is not rolled back with its request.
  store.saveJob({ ...store.getJob(independent.id), state: "completed", outputPath: "outputs/partial.mp4" });
  assert.equal(store.getJob(independent.id).state, "completed");
});

test("Stop reports creator cancellation even when request-owned work is still unfinished", async (t) => {
  const { store, episode, calls, renders, chat } = fixture(t, { hold: true });
  const conversation = chat.create(episode.id);
  const sent = await chat.sendProduction(episode.id, conversation.id, { kind: "draft", clientRequestId: crypto.randomUUID() });
  await until(() => calls.length && chat.get(episode.id, conversation.id).state === "running");
  store.saveJob({ id: "job_stopping", episodeId: episode.id, kind: "draft", outputClass: "draft", state: "queued", progress: 0,
    revision: episode.revision, snapshot: {}, requestId: sent.requestResult.run.id, createdAt: new Date().toISOString() });
  renders.cancelJob = (_episodeId, id) => store.saveJob({ ...store.getJob(id), state: "cancelling", error: "Cancellation requested" });
  await chat.interrupt(episode.id, conversation.id);
  await until(() => store.getProductionRun(sent.requestResult.run.id).state === "interrupted");
  assert.match(chat.get(episode.id, conversation.id).error, /Stopped by the creator/);
  assert.doesNotMatch(chat.get(episode.id, conversation.id).error, /assistant ended/);
});

test("await_job waits only for same-request work and move_final_to_drafts refuses ambiguity", async (t) => {
  const { store, episode, calls, chat } = fixture(t, { hold: true });
  const conversation = chat.create(episode.id);
  const sent = await chat.sendProduction(episode.id, conversation.id, { kind: "draft", clientRequestId: crypto.randomUUID() });
  await until(() => calls.length);
  const job = store.saveJob({ id: "job_wait", episodeId: episode.id, kind: "draft", outputClass: "draft", state: "queued", progress: 0,
    revision: episode.revision, snapshot: {}, requestId: sent.requestResult.run.id, createdAt: new Date().toISOString() });
  setTimeout(() => store.saveJob({ ...store.getJob(job.id), state: "completed", progress: 1, outputPath: "outputs/wait.mp4" }), 20);
  assert.equal((await calls[0].tools.await_job({ jobId: job.id, timeoutSeconds: 1 })).state, "completed");
  const final = store.saveJob({ id: "job_final", episodeId: episode.id, kind: "final", outputClass: "final", state: "completed", progress: 1,
    revision: episode.revision, snapshot: {}, outputPath: "outputs/final.mp4", createdAt: new Date().toISOString() });
  assert.equal(calls[0].tools.move_final_to_drafts({}).id, final.id);
  assert.equal(store.getJob(final.id).designation, "draft");
  const other = store.saveJob({ id: "job_other", episodeId: episode.id, kind: "draft", outputClass: "draft", state: "queued", progress: 0,
    revision: episode.revision, snapshot: {}, createdAt: new Date().toISOString() });
  await assert.rejects(calls[0].tools.await_job({ jobId: other.id, timeoutSeconds: 1 }), /not owned/);
  await chat.interrupt(episode.id, conversation.id);
});

test("a provider failure after a request-owned asset completes retains the completed result", async (t) => {
  const { store, episode, calls, chat } = fixture(t, { hold: true });
  const conversation = chat.create(episode.id);
  const sent = await chat.sendProduction(episode.id, conversation.id, { kind: "still_graphic", prompt: "Make it", clientRequestId: crypto.randomUUID() });
  await until(() => calls.length && chat.get(episode.id, conversation.id).activeTurnId);
  store.saveJob({ id: "job_partial", episodeId: episode.id, kind: "graphic-still", outputClass: "graphic", state: "completed", progress: 1,
    revision: episode.revision, snapshot: { libraryItemId: "library-result" }, outputPath: "outputs/graphics/result.png",
    requestId: sent.requestResult.run.id, createdAt: new Date().toISOString() });
  calls[0].onEvent({ method: "turn/completed", params: { turn: { id: chat.get(episode.id, conversation.id).activeTurnId, status: "failed", error: "answer failed" } } });
  await until(() => store.getProductionRun(sent.requestResult.run.id).state === "failed");
  assert.equal(store.getJob("job_partial").state, "completed");
  assert.equal(store.getJob("job_partial").snapshot.libraryItemId, "library-result");
});

test("typed Final intent binds only an explicit current message; draft, graphic, reference text and quoted history do not bind", async (t) => {
  const { store, episode, calls, chat } = fixture(t, { hold: true });
  const conversation = chat.create(episode.id);
  for (const text of [
    "Create a draft using a reference whose caption says ‘make final’.",
    "Create a still graphic titled ‘Final Thoughts’.",
    "Earlier request: ‘create final’. Summarize what it meant.",
    "Use the reference text ‘create final video’ as mood only.",
  ]) {
    await chat.send(episode.id, conversation.id, text);
    await until(() => calls.length && chat.get(episode.id, conversation.id).state === "running");
    const call = calls.at(-1), run = store.getProductionRun(call.requestId);
    assert.equal(run.finalIntent, "none");
    assert.throws(() => call.tools.declare_final_request({ messageId: call.request.messageId }), /not an explicit request|ordinary typed request/i);
    assert.equal(store.getProductionRun(run.id).finalIntent, "none");
    await chat.interrupt(episode.id, conversation.id);
    await until(() => store.getProductionRun(run.id).state === "interrupted");
  }

  await chat.send(episode.id, conversation.id, "Please finish this video.");
  await until(() => calls.length === 5 && chat.get(episode.id, conversation.id).state === "running");
  const call = calls.at(-1), run = store.getProductionRun(call.requestId);
  assert.deepEqual({ kind: run.kind, intent: run.finalIntent }, { kind: "chat", intent: "none" }, "text alone never binds intent");
  const other = chat.create(episode.id, { name: "Other" });
  const wrong = store.addConversationMessage({ conversationId: other.id, role: "user", text: "Create final" });
  assert.throws(() => call.tools.declare_final_request({ messageId: wrong.id }), /originating typed creator message/);
  const declared = call.tools.declare_final_request({ messageId: call.request.messageId });
  assert.deepEqual({ kind: declared.kind, intent: declared.finalIntent, source: declared.originatingMessageId },
    { kind: "final", intent: "active", source: call.request.messageId });
  assert.equal(call.tools.declare_final_request({ messageId: call.request.messageId }).id, run.id, "declaration reuse is idempotent");

  store.saveJob({ id: "job_final_partial", episodeId: episode.id, kind: "graphic-still", outputClass: "graphic", state: "completed", progress: 1,
    revision: episode.revision, snapshot: { libraryItemId: "useful-partial" }, outputPath: "outputs/graphics/partial.png", requestId: run.id });
  call.onEvent({ method: "turn/completed", params: { turn: { id: chat.get(episode.id, conversation.id).activeTurnId, status: "failed", error: "could not assemble video" } } });
  await until(() => store.getProductionRun(run.id).state === "failed");
  assert.deepEqual({ intent: store.getProductionRun(run.id).finalIntent, reason: store.getProductionRun(run.id).finalEndedReason }, { intent: "ended", reason: "failed" });
  assert.equal(store.getJob("job_final_partial").state, "completed", "useful partial assets survive terminal failure");
});

test("Stop ends button Final intent; a harness switch carries nothing and explicit Retry creates a successor", async (t) => {
  const { store, episode, chat } = fixture(t, { hold: true });
  const conversation = chat.create(episode.id);
  const sent = await chat.sendProduction(episode.id, conversation.id, { kind: "final", clientRequestId: crypto.randomUUID() });
  const original = sent.requestResult.run;
  assert.equal(store.getProductionRun(original.id).finalIntent, "active");
  await until(() => chat.get(episode.id, conversation.id).state === "running");
  await chat.interrupt(episode.id, conversation.id);
  await until(() => store.getProductionRun(original.id).state === "interrupted");
  assert.deepEqual({ intent: store.getProductionRun(original.id).finalIntent, reason: store.getProductionRun(original.id).finalEndedReason },
    { intent: "ended", reason: "stopped" });

  store.updateConversationSettings(conversation.id, 1, { harness: "claude", model: "sonnet" });
  assert.equal(store.getProductionRun(original.id).harness, "codex", "the old request stays on its original harness");
  const retried = await chat.retry(episode.id, conversation.id, original.id, { clientRequestId: crypto.randomUUID() });
  assert.deepEqual({ successor: retried.requestResult.run.successorOf, harness: retried.requestResult.run.harness, intent: retried.requestResult.run.finalIntent },
    { successor: original.id, harness: "claude", intent: "active" });
  await until(() => chat.get(episode.id, conversation.id).state === "running");
  await chat.interrupt(episode.id, conversation.id);
});

test("a Final turn that reports a concrete missing material ends unfulfilled and creates no output", async (t) => {
  const { store, episode, calls, chat } = fixture(t, { hold: true });
  const conversation = chat.create(episode.id);
  const sent = await chat.sendProduction(episode.id, conversation.id, { kind: "final", clientRequestId: crypto.randomUUID() });
  await until(() => calls.length && chat.get(episode.id, conversation.id).activeTurnId);
  const turnId = chat.get(episode.id, conversation.id).activeTurnId;
  calls[0].onEvent({ method: "item/agentMessage/delta", params: { turnId, delta: "I cannot complete the video because the enabled closing card has no footage." } });
  calls[0].onEvent({ method: "turn/completed", params: { turn: { id: turnId, status: "completed" } } });
  await until(() => store.getProductionRun(sent.requestResult.run.id).state === "completed");
  const run = store.getProductionRun(sent.requestResult.run.id);
  assert.deepEqual({ intent: run.finalIntent, reason: run.finalEndedReason, output: run.finalOutputJobId }, { intent: "ended", reason: "unfulfilled", output: null });
  assert.match(chat.get(episode.id, conversation.id).messages.at(-1).text, /closing card has no footage/);
  assert.equal(store.listRequestJobs(run.id).length, 0);
});

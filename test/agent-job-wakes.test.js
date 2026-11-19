// Spec #42 'Parent tools', 'Watches', 'Wake turns' and 'Lifecycle' (Feature #24 task #114):
// A4-A8 and the turn-completion half of A10, on a fake harness connection and the scripted
// agent job launcher. No model runs.
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { JSDOM } from "jsdom";
import { Store, SCHEMA_VERSION } from "../src/store.js";
import { createApp } from "../src/server.js";
import { createChatService } from "../src/chat.js";
import { createV9ConversationPersistence } from "../src/runtime/conversation-persistence.js";
import { createScopedTools, validateDirection } from "../src/runtime/tools.js";
import { createHealth } from "../src/runtime/health.js";
import { activeWork } from "../src/cli/service.js";
import { ChatWorkspace } from "../public/chat-workspace.js";
import { TOOL_DELIVERED } from "../src/tool-delivery.js";
import { CATALOG, fakeLauncher, openCodeRuntime } from "./agent-job-fixtures.js";

const until = async (check, timeout = 3000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const value = check(); if (value) return value; await new Promise((resolve) => setTimeout(resolve, 5)); }
  throw new Error("timed out");
};
// Authoring tools need the complete research delivered in the turn.
const deliverResearch = (turn) => { const research = turn.tools.read_research(); JSON.stringify(research); research[TOOL_DELIVERED](); };
const settle = () => new Promise((resolve) => setTimeout(resolve, 60));

// A harness whose parent turns run until the test completes them.
function harness() {
  const turns = [];
  const factory = async (options) => ({
    startThread: async () => `thread_${turns.length + 1}`,
    resumeThread: async (id) => id,
    startTurn: async (_threadId, prompt) => {
      const turnId = `turn_${turns.length + 1}`;
      const turn = { options, prompt, turnId, tools: options.tools, request: options.request,
        complete: (status = "completed") => options.onEvent({ method: "turn/completed", params: { turn: { id: turnId, status } } }) };
      turns.push(turn);
      queueMicrotask(() => options.onEvent({ method: "turn/started", params: { turnId } }));
      return turnId;
    },
    interrupt: async (_threadId, turnId) => queueMicrotask(() => options.onEvent({ method: "turn/completed", params: { turn: { id: turnId, status: "interrupted" } } })),
    close() {},
  });
  return { factory, turns };
}

// A job that runs until the test ends it.
function heldJobs() {
  const held = [];
  const hold = (connection) => { held.push(connection); };
  const end = (connection, text = "Report: wrote notes.md in the pad.", status = "completed") => {
    connection.emit("item/agentMessage/delta", { itemId: "r", delta: text });
    connection.emit("turn/completed", { turn: { id: "turn-1", status } });
  };
  return { held, hold, end };
}

const codexSettings = (store, ...ids) => {
  for (const id of ids) store.db.prepare("UPDATE conversations SET harness='codex',inference_source='codex-login',model='gpt-5.5',effort='medium' WHERE id=?").run(id);
};

function fixture(t, { behaviours = [], root = mkdtempSync(path.join(os.tmpdir(), "sb-agent-wakes-")), keep = false } = {}) {
  const store = new Store(root);
  const episode = store.createEpisode({ title: "Wakes" });
  const { factory, turns } = harness();
  const fake = fakeLauncher(behaviours);
  const renders = {
    validateRender: () => ({ renderRevision: "r" }),
    getJob: (_episodeId, id) => store.getJob(id),
    cancelJob: (_episodeId, id) => store.saveJob({ ...store.getJob(id), state: "cancelled", error: "cancelled" }),
    enqueueRender: ({ episodeId, outputClass, requestId }) => store.saveJob({ episodeId, kind: outputClass, outputClass, state: "queued", revision: store.getEpisode(episodeId).revision, requestId }),
    listGraphicRecipes: () => [],
  };
  const chat = createChatService({ store, renders, codexFactory: factory, agentJobLauncher: fake.launcher,
    continuity: { persistence: createV9ConversationPersistence(store), catalog: async () => CATALOG } });
  const conversation = chat.create(episode.id);
  codexSettings(store, conversation.id);
  const close = async () => { await chat.close(); store.close(); };
  t.after(async () => { if (store.db.isOpen) await close(); if (!keep) rmSync(root, { recursive: true, force: true }); });
  const view = () => chat.get(episode.id, conversation.id);
  const send = async (text = "Research the topic") => { await chat.send(episode.id, conversation.id, text); return until(() => turns.length && turns.at(-1).request.text === text && turns.at(-1)); };
  const runs = () => store.listProductionRuns({ conversationId: conversation.id });
  const idle = () => until(() => !["queued", "running", "interrupting"].includes(view().state) && !runs().some((run) => ["starting", "running"].includes(run.state)) && !chat.hasActiveWorkers({ jobs: false }));
  return { root, store, episode, chat, conversation, turns, fake, renders, view, send, runs, idle, close };
}

test("A5: two endings during a running turn start exactly one combined wake turn after it, delivered once", async (t) => {
  const jobs = heldJobs();
  const f = fixture(t, { behaviours: [jobs.hold, jobs.hold] });
  const first = await f.send();
  const one = await first.tools.start_agent_job({ brief: "Collect three facts.", label: "Facts" });
  const two = await first.tools.start_agent_job({ brief: "List two sources.", label: "Sources" });
  assert.match(one.padPath, /work\/jobs\/agent_job_/);
  await until(() => jobs.held.length === 2);
  const byLabel = (label) => jobs.held.find((connection) => connection.job.label === label);
  jobs.end(byLabel("Facts"), "Three facts in facts.md");
  // The wake line lists results in ending order; end Sources only once Facts has ended.
  await until(() => f.view().agentJobs.find((job) => job.id === one.jobId).state === "completed");
  jobs.end(byLabel("Sources"), "Two sources in sources.md");
  await until(() => f.chat.get(f.episode.id, f.conversation.id).agentJobs.every((job) => job.state === "completed"));
  await settle();
  assert.equal(f.turns.length, 1, "results that end while the production is busy are held");
  assert.equal(f.view().wake.pending, 2);
  first.complete();
  const wake = await until(() => f.turns[1]);
  assert.match(wake.prompt, /Storybench wake: this is not a creator message/);
  assert.match(wake.prompt, /"Facts"[\s\S]*Three facts in facts\.md/);
  assert.match(wake.prompt, /"Sources"[\s\S]*Two sources in sources\.md/);
  assert.doesNotMatch(wake.prompt, /User request:/);
  const run = f.runs().at(-1);
  assert.equal(run.origin, "wake");
  const line = f.view().messages.find((message) => message.id === run.originatingMessageId);
  assert.equal(line.role, "system");
  assert.equal(line.text, "Agent results: Facts (Done), Sources (Done)");
  for (const id of [one.jobId, two.jobId]) assert.equal(f.store.db.prepare("SELECT delivery FROM agent_jobs WHERE id=?").get(id).delivery, "delivered");
  wake.complete();
  await f.idle();
  await settle();
  assert.equal(f.turns.length, 2, "a delivered result never produces a second wake");
  assert.equal(f.view().wake.pending, 0);
});

test("flags #85/#86: an OpenCode job from a Codex parent runs on its provider, and get_agent_job and the wake show its real output past the OpenCode runtime", async (t) => {
  const jobs = heldJobs();
  const f = fixture(t, { behaviours: [jobs.hold] });
  const turn = await f.send();
  const started = await turn.tools.start_agent_job({ brief: "Write three facts to notes.md.", label: "Notes", harness: "opencode", model: "fixture-model" });
  assert.deepEqual([started.harness, started.source, started.model, started.effort], ["opencode", "gateway", "fixture-model", null]);
  await until(() => jobs.held.length === 1);
  const pad = jobs.held[0].job.padPath;
  await openCodeRuntime(pad);
  await writeFile(path.join(pad, "notes.md"), "three facts");
  jobs.end(jobs.held[0], "Wrote notes.md");
  await until(() => f.view().agentJobs[0]?.state === "completed");
  const read = await turn.tools.get_agent_job({ jobId: started.jobId });
  assert.deepEqual(read.files, { entries: [{ path: "notes.md", size: 11 }], total: 1, truncated: false });
  turn.complete();
  const wake = await until(() => f.turns[1]);
  assert.match(wake.prompt, /Files: notes\.md \(11 B\)\./);
  assert.doesNotMatch(wake.prompt, /node_modules|files in all/);
  wake.complete();
  await f.idle();
});

test("A5/A8: after a restart, results stay pending with no wake; the next typed turn carries them once", async (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "sb-agent-wakes-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const before = fixture(t, { behaviours: ["hang"], root, keep: true });
  const turn = await before.send();
  const job = await turn.tools.start_agent_job({ brief: "A long survey.", label: "Survey" });
  await until(() => before.view().agentJobs[0]?.state === "running");
  turn.complete();
  await before.idle();
  await before.close();
  // Same data root, new process.
  const store = new Store(root);
  const { factory, turns } = harness();
  const chat = createChatService({ store, renders: before.renders, codexFactory: factory, agentJobLauncher: fakeLauncher().launcher,
    continuity: { persistence: createV9ConversationPersistence(store), catalog: async () => CATALOG } });
  t.after(async () => { await chat.close(); store.close(); });
  const view = () => chat.get(before.episode.id, before.conversation.id);
  assert.equal(view().agentJobs[0].state, "interrupted");
  assert.equal(view().wake.pending, 1);
  await settle();
  assert.equal(turns.length, 0, "a restart starts no wake turn");
  await chat.send(before.episode.id, before.conversation.id, "What did the survey find?");
  const typed = await until(() => turns[0]);
  assert.match(typed.prompt, /User request:\nWhat did the survey find\?[\s\S]*Agent results that ended since your last turn/);
  assert.match(typed.prompt, new RegExp(`${job.jobId}[\\s\\S]*interrupted, outcome unknown and not a success`));
  assert.equal(store.db.prepare("SELECT delivery FROM agent_jobs WHERE id=?").get(job.jobId).delivery, "delivered");
  typed.complete();
  await until(() => view().state === "idle");
  await settle();
  assert.equal(turns.length, 1, "the carried result does not wake the parent again");
});

test("A6: ten wake turns run in a row, the eleventh waits with one app line, and a typed turn carries the results and resets the chain", async (t) => {
  const f = fixture(t);
  const brief = { brief: "Check one fact.", label: "Check" };
  const typed = await f.send("Start the checks");
  await typed.tools.start_agent_job(brief);
  typed.complete();
  for (let wake = 1; wake <= 10; wake++) {
    const turn = await until(() => f.turns[wake]);
    assert.equal(f.runs().at(-1).origin, "wake");
    const started = await turn.tools.start_agent_job(brief);
    await until(() => f.store.db.prepare("SELECT state FROM agent_jobs WHERE id=?").get(started.jobId).state === "completed");
    turn.complete();
  }
  await f.idle();
  await settle();
  assert.equal(f.turns.length, 11, "one typed turn and ten wake turns; the eleventh is not started");
  const view = f.view();
  assert.equal(view.wake.pending, 1);
  assert.equal(view.wake.chainLimited, true);
  const lines = view.messages.filter((message) => message.text === "Agent results are waiting. They will be included with your next message.");
  assert.equal(lines.length, 1);
  assert.equal(lines[0].role, "system");
  assert.equal(view.events.filter((event) => event.type === "agent.wake.limited").length, 1);
  const next = await f.send("Summarise them");
  assert.match(next.prompt, /Summarise them[\s\S]*Agent results that ended since your last turn/);
  next.complete();
  await f.idle();
  assert.equal(f.view().wake.pending, 0);
  assert.equal(f.view().wake.chainLimited, false, "a creator turn resets the chain");
});

test("A7: a wake message is an app line with no creator authority: no direction, no Final intent, no Retry", async (t) => {
  const f = fixture(t, { behaviours: ["fail"] });
  const typed = await f.send();
  await typed.tools.start_agent_job({ brief: "Fail.", label: "Doomed" });
  typed.complete();
  const wake = await until(() => f.turns[1]);
  const run = f.runs().at(-1), messageId = run.originatingMessageId;
  assert.match(wake.prompt, /"Doomed"[\s\S]*failed[\s\S]*Error \(harness\): model refused/);
  await assert.rejects(async () => wake.tools.declare_final_request({ messageId }), /wake turn carries no creator authority/);
  const scope = { conversationId: f.conversation.id, episodeId: f.episode.id };
  assert.throws(() => validateDirection(f.store, scope, { messageId }), { code: "DIRECTION_NOT_CREATOR" });
  wake.complete("failed");
  await f.idle();
  assert.equal(f.store.getProductionRun(run.id).state, "failed");
  await assert.rejects(f.chat.retry(f.episode.id, f.conversation.id, run.id, { clientRequestId: randomUUID() }), /wake turn is not retried/);
  // A failed wake turn returns its result to pending; the next creator turn carries it.
  assert.equal(f.view().wake.pending, 1);
  await settle();
  assert.equal(f.turns.length, 2, "a failed wake does not start another by itself");
  const next = await f.send("Try again");
  assert.match(next.prompt, /"Doomed"/);
});

test("A7: the transcript shows a wake line as an app line, never a creator bubble", async (t) => {
  const dom = new JSDOM('<main id="chat"></main>');
  globalThis.document = dom.window.document;
  t.after(() => dom.window.close());
  const at = new Date().toISOString();
  const conversation = { id: "chat", name: "Work", state: "running", draft: "", events: [], runs: [{ id: "r", state: "running", origin: "wake", originatingMessageId: 2, startedAt: at }],
    messages: [{ id: 1, role: "user", text: "Research it", state: "completed", createdAt: at }, { id: 2, role: "system", text: "Agent results: Facts (Done)", state: "running", createdAt: at }] };
  const api = async (url) => url.endsWith("/chats") ? [{ id: "chat", name: "Work", state: "running", draft: "" }] : conversation;
  const workspace = new ChatWorkspace({ root: dom.window.document.querySelector("#chat"), api, getEpisode: () => ({ id: "episode" }), renderMarkdown: (text) => text });
  await workspace.open();
  const line = dom.window.document.querySelector('[data-message-id="2"]');
  assert.ok(line.classList.contains("chat-app-line"));
  assert.equal(line.textContent, "Agent results: Facts (Done)");
  assert.equal(line.querySelector("b"), null, "no 'You' label");
  assert.equal(dom.window.document.querySelectorAll(".chat-user").length, 1);
  workspace.close();
});

test("the projection lists ended jobs by most recent ending: Stop after an earlier completion", async (t) => {
  const jobs = heldJobs();
  const f = fixture(t, { behaviours: [jobs.hold, jobs.hold] });
  const turn = await f.send();
  await turn.tools.start_agent_job({ brief: "Collect three facts.", label: "Collect facts" });
  await settle();
  await turn.tools.start_agent_job({ brief: "Find two sources.", label: "Find sources" });
  await until(() => jobs.held.length === 2);
  jobs.end(jobs.held.find((connection) => connection.job.label === "Find sources"), "Two sources.");
  await until(() => f.view().agentJobs.some((job) => job.state === "completed"));
  assert.deepEqual(f.view().agentJobs.map((job) => job.label), ["Collect facts", "Find sources"], "running first");
  await settle();
  const stopped = await f.chat.interrupt(f.episode.id, f.conversation.id);
  assert.deepEqual(stopped.agentJobs.map((job) => [job.label, job.state]), [["Collect facts", "cancelled"], ["Find sources", "completed"]],
    "the older-created job Stop ended last is listed first");
});

test("A8: Stop with no active turn ends the jobs and the watched jobs, discards their results and starts no wake", async (t) => {
  const f = fixture(t, { behaviours: ["hang", "hang"] });
  await assert.rejects(f.chat.interrupt(f.episode.id, f.conversation.id), { statusCode: 409 });
  const turn = await f.send();
  const one = await turn.tools.start_agent_job({ brief: "Survey.", label: "Survey" });
  await turn.tools.start_agent_job({ brief: "Survey more.", label: "More" });
  deliverResearch(turn);
  const draft = await turn.tools.create_draft({ expectedRenderRevision: "r" });
  assert.equal((await turn.tools.watch_job({ jobId: draft.id })).watching, true);
  turn.complete();
  await f.idle();
  assert.equal(f.view().state, "idle");
  assert.equal(f.view().waitingForAgents, 2);
  assert.equal(f.chat.hasActiveWorkers(), true, "a running job is an active worker");
  assert.equal(f.chat.hasActiveWorkers({ jobs: false }), false);
  const stopped = await f.chat.interrupt(f.episode.id, f.conversation.id);
  assert.deepEqual(stopped.agentJobs.map((job) => job.state), ["cancelled", "cancelled"]);
  assert.equal(stopped.waitingForAgents, 0);
  assert.equal(f.store.getJob(draft.id).state, "cancelled", "Stop cancels watched jobs");
  assert.deepEqual(stopped.watches, []);
  assert.equal(f.store.db.prepare("SELECT delivery FROM agent_jobs WHERE id=?").get(one.jobId).delivery, "undeliverable");
  assert.equal(stopped.wake.pending, 0);
  assert.ok(f.fake.launches.every((connection) => connection.closed > 0), "the job workers are removed");
  assert.equal(f.chat.hasActiveWorkers(), false);
  f.chat.productionJobsChanged(f.episode.id);
  await settle();
  assert.equal(f.turns.length, 1, "no wake after Stop");
  await assert.rejects(f.chat.interrupt(f.episode.id, f.conversation.id), { statusCode: 409 }, "nothing left to stop");
});

test("A10 (turn half): a watched draft does not fail its turn, and its ending wakes the parent once", async (t) => {
  const f = fixture(t);
  const unwatched = await f.send("Draft it unwatched");
  deliverResearch(unwatched);
  await unwatched.tools.create_draft({ expectedRenderRevision: "r" });
  unwatched.complete();
  await f.idle();
  assert.equal(f.runs().at(-1).state, "failed", "an unwatched unfinished job still fails the turn");
  for (const job of f.store.listJobs(f.episode.id)) f.store.saveJob({ ...job, state: "cancelled", error: "cleanup" });

  const turn = await f.send("Draft it");
  deliverResearch(turn);
  const draft = await turn.tools.create_draft({ expectedRenderRevision: "r" });
  assert.equal((await turn.tools.watch_job({ jobId: draft.id })).watching, true);
  turn.complete();
  await f.idle();
  assert.equal(f.runs().at(-1).state, "completed", "the watched draft leaves the turn completed");
  assert.equal(f.view().state, "idle");
  await settle();
  assert.equal(f.turns.length, 2, "no wake while the draft runs");
  f.store.saveJob({ ...f.store.getJob(draft.id), state: "completed", progress: 1, outputPath: "outputs/drafts/draft.mp4" });
  f.chat.productionJobsChanged(f.episode.id);
  f.chat.productionJobsChanged(f.episode.id);
  const wake = await until(() => f.turns[2]);
  assert.match(wake.prompt, new RegExp(`Watched draft job ${draft.id}: completed\\. Output: outputs/drafts/draft\\.mp4`));
  assert.equal(f.view().messages.find((message) => message.id === f.runs().at(-1).originatingMessageId).text, "Agent results: draft job (Done)");
  wake.complete();
  await f.idle();
  await settle();
  assert.equal(f.turns.length, 3, "one wake per ending");
});

test("parent tools: job ids are scoped to the conversation, writes need an active turn, and watches only take live non-Final jobs of this production", async (t) => {
  const f = fixture(t, { behaviours: ["hang"] });
  const other = f.chat.create(f.episode.id);
  codexSettings(f.store, other.id);
  const turn = await f.send();
  const job = await turn.tools.start_agent_job({ brief: "Look around.", label: "Look" });
  assert.equal(job.harness, "codex");
  assert.equal(job.model, "gpt-5.5");
  assert.equal((await turn.tools.list_agent_jobs()).jobs[0].id, job.jobId);
  await until(() => f.view().agentJobs[0]?.state === "running");
  assert.equal((await turn.tools.get_agent_job({ jobId: job.jobId })).state, "running");
  await assert.rejects(async () => turn.tools.start_agent_job({ brief: "x", label: "y", model: "no-such-model" }), /Nothing was substituted/);
  const finalJob = f.store.saveJob({ episodeId: f.episode.id, kind: "final", outputClass: "final", state: "queued", revision: f.episode.revision });
  await assert.rejects(async () => turn.tools.watch_job({ jobId: finalJob.id }), /A Final is published only inside its request/);
  const done = f.store.saveJob({ episodeId: f.episode.id, kind: "draft", outputClass: "draft", state: "completed", revision: f.episode.revision });
  await assert.rejects(async () => turn.tools.watch_job({ jobId: done.id }), /already completed/);
  const elsewhere = f.store.createEpisode({ title: "Elsewhere" });
  const foreign = f.store.saveJob({ episodeId: elsewhere.id, kind: "draft", outputClass: "draft", state: "queued", revision: elsewhere.revision });
  await assert.rejects(async () => turn.tools.watch_job({ jobId: foreign.id }), { statusCode: 404 });
  await assert.rejects(turn.tools.await_agent_job({ jobId: job.jobId, timeoutSeconds: 1 }), { statusCode: 408 });
  turn.complete();
  await f.idle();
  // The other conversation of the same production cannot reach this job.
  await f.chat.send(f.episode.id, other.id, "Peek");
  const peek = await until(() => f.turns.find((entry) => entry.request.text === "Peek"));
  for (const [name, args] of [["get_agent_job", {}], ["await_agent_job", { timeoutSeconds: 1 }], ["cancel_agent_job", {}], ["continue_agent_job", { brief: "More" }]])
    await assert.rejects(async () => peek.tools[name]({ jobId: job.jobId, ...args }), { statusCode: 404 }, name);
  assert.deepEqual((await peek.tools.list_agent_jobs()).jobs, []);
  peek.complete();
  await until(() => f.chat.get(f.episode.id, other.id).state === "idle");
  // A turn that ended cannot start, continue, cancel or watch.
  for (const name of ["start_agent_job", "continue_agent_job", "cancel_agent_job", "watch_job"])
    await assert.rejects(async () => turn.tools[name]({ jobId: job.jobId, brief: "x", label: "y" }), { statusCode: 409 }, name);
  assert.equal(f.view().agentJobs[0].state, "running");
});

test("A8: a new chat ends the production's jobs, drops watches and results, removes pads; renders continue", async (t) => {
  const workspace = mkdtempSync(path.join(os.tmpdir(), "sb-agent-wakes-app-"));
  const { factory, turns } = harness();
  const fake = fakeLauncher(["complete", "hang"]);
  const app = await createApp({ workspace, chatOptions: { codexFactory: factory, catalog: { list: async () => CATALOG }, agentJobLauncher: fake.launcher } });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { await app.close(); rmSync(workspace, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const episode = app.store.createEpisode({ title: "New chat" });
  const conversation = app.chat.create(episode.id);
  codexSettings(app.store, conversation.id);
  await app.chat.send(episode.id, conversation.id, "Go");
  const turn = await until(() => turns[0]);
  const ended = await turn.tools.start_agent_job({ brief: "Quick.", label: "Quick" });
  await until(() => app.store.db.prepare("SELECT state FROM agent_jobs WHERE id=?").get(ended.jobId).state === "completed");
  const live = await turn.tools.start_agent_job({ brief: "Slow.", label: "Slow" });
  const render = app.store.saveJob({ episodeId: episode.id, kind: "draft", outputClass: "draft", state: "queued", revision: episode.revision });
  await turn.tools.watch_job({ jobId: render.id });
  await writeFile(path.join(ended.padPath, "notes.md"), "kept until the chat closes");
  turn.complete();
  await until(() => turns[1]);
  turns[1].complete();
  await until(() => app.chat.get(episode.id, conversation.id).state === "idle");
  assert.equal(existsSync(ended.padPath), true);
  const response = await fetch(`${base}/api/episodes/${episode.id}/chats`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Fresh" }) });
  assert.equal(response.status, 201);
  const closed = app.chat.get(episode.id, conversation.id);
  assert.equal(closed.agentJobs.find((job) => job.id === live.jobId).state, "cancelled");
  assert.equal(existsSync(ended.padPath), false, "pads of the closed conversation are removed");
  assert.equal(existsSync(live.padPath), false);
  assert.deepEqual(closed.watches, []);
  assert.equal(closed.wake.pending, 0);
  assert.equal(app.store.getJob(render.id).state, "queued", "the watched render keeps running");
  assert.ok(app.store.db.prepare("SELECT pad_removed_at FROM agent_jobs WHERE id=?").get(ended.jobId).pad_removed_at);
  assert.equal(turns.length, 2, "no wake for the cancelled job");
});

test("A8: channel deletion ends the deleted channel's jobs and waits for their workers; other channels' jobs do not block it", async (t) => {
  const workspace = mkdtempSync(path.join(os.tmpdir(), "sb-agent-wakes-delete-"));
  const { factory, turns } = harness();
  const fake = fakeLauncher(["hang", "hang"]);
  const app = await createApp({ workspace, chatOptions: { codexFactory: factory, catalog: { list: async () => CATALOG }, agentJobLauncher: fake.launcher } });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { await app.close(); rmSync(workspace, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const post = async (url, body) => { const response = await fetch(base + url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); return { status: response.status, body: await response.json() }; };
  const doomed = app.store.getDefaultChannel(), kept = app.store.createChannel("Kept");
  const jobs = [];
  for (const channel of [doomed, kept]) {
    const episode = app.store.createEpisode({ title: channel.name, channelId: channel.id });
    const conversation = app.chat.create(episode.id);
    codexSettings(app.store, conversation.id);
    await app.chat.send(episode.id, conversation.id, `Work in ${channel.name}`);
    const turn = await until(() => turns.find((entry) => entry.request.text === `Work in ${channel.name}`));
    jobs.push({ episode, conversation, job: await turn.tools.start_agent_job({ brief: "Read.", label: channel.name }) });
    turn.complete();
    await until(() => app.chat.get(episode.id, conversation.id).state === "idle");
  }
  await until(() => fake.launches.length === 2);
  const preview = (await post("/api/channel-deletions/preview", { channelIds: [doomed.id] })).body;
  const deleted = await post("/api/channel-deletions", { channelIds: [doomed.id], token: preview.token, operationId: `delete_${randomUUID()}` });
  assert.equal(deleted.status, 200, deleted.body.error);
  assert.equal(deleted.body.state, "completed");
  const deletedWorker = fake.launches.find(worker => worker.job.id === jobs[0].job.jobId);
  const retainedWorker = fake.launches.find(worker => worker.job.id === jobs[1].job.jobId);
  assert.ok(deletedWorker.closed > 0, "the deleted channel's job worker was removed first");
  assert.equal(app.store.db.prepare("SELECT COUNT(*) n FROM agent_jobs WHERE id=?").get(jobs[0].job.jobId).n, 0, "its rows went with the channel");
  assert.equal(app.chat.get(jobs[1].episode.id, jobs[1].conversation.id).agentJobs[0].state, "running", "the other channel's job keeps running");
  assert.equal(retainedWorker.closed, 0);
});

test("A8: a job in a retained channel that ends during a pending deletion starts its wake once the deletion completes", async (t) => {
  const workspace = mkdtempSync(path.join(os.tmpdir(), "sb-agent-wakes-delete-"));
  const { factory, turns } = harness();
  const jobs = heldJobs();
  const fake = fakeLauncher([jobs.hold]);
  const app = await createApp({ workspace, chatOptions: { codexFactory: factory, catalog: { list: async () => CATALOG }, agentJobLauncher: fake.launcher } });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { await app.close(); rmSync(workspace, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const post = async (url, body) => { const response = await fetch(base + url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); return { status: response.status, body: await response.json() }; };
  const doomed = app.store.getDefaultChannel(), kept = app.store.createChannel("Kept");
  await writeFile(path.join(app.store.channelMediaDirectory(doomed.id), "owned.txt"), "doomed");
  const episode = app.store.createEpisode({ title: "Kept", channelId: kept.id });
  const conversation = app.chat.create(episode.id);
  codexSettings(app.store, conversation.id);
  const view = () => app.chat.get(episode.id, conversation.id);
  await app.chat.send(episode.id, conversation.id, "Work in Kept");
  const turn = await until(() => turns[0]);
  await turn.tools.start_agent_job({ brief: "Read.", label: "Kept" });
  turn.complete();
  await until(() => view().state === "idle" && jobs.held.length === 1);
  // The first deletion attempt stops part-way and stays pending.
  let injected = false;
  app.store.afterChannelDeleteFile = () => { if (!injected) { injected = true; throw new Error("injected file interruption"); } };
  const preview = (await post("/api/channel-deletions/preview", { channelIds: [doomed.id] })).body;
  const operationId = `delete_${randomUUID()}`;
  const pending = await post("/api/channel-deletions", { channelIds: [doomed.id], token: preview.token, operationId });
  assert.equal(pending.body.state, "pending", pending.body.error);
  jobs.end(jobs.held[0], "Notes in notes.md");
  await until(() => view().wake.pending === 1);
  await settle();
  assert.equal(turns.length, 1, "a pending deletion holds the wake");
  assert.equal(view().wake.held, true);
  const retried = await post(`/api/channel-deletions/${operationId}/retry`, {});
  assert.equal(retried.body.state, "completed", retried.body.error);
  const wake = await until(() => turns[1]);
  assert.match(wake.prompt, /Storybench wake:[\s\S]*"Kept"[\s\S]*Notes in notes\.md/);
  wake.complete();
  await until(() => view().state === "idle");
  assert.equal(view().wake.pending, 0);
});

test("A8: health counts running agent jobs, so update, stop and backup refuse while they run", async (t) => {
  const f = fixture(t, { behaviours: ["hang"] });
  const health = createHealth({ store: f.store, release: null });
  assert.equal(health.snapshot().activity.agents.jobs, 0);
  const turn = await f.send();
  await turn.tools.start_agent_job({ brief: "Long.", label: "Long" });
  turn.complete();
  await f.idle();
  const snapshot = health.snapshot();
  assert.equal(snapshot.activity.agents.active, 0);
  assert.equal(snapshot.activity.agents.jobs, 1);
  assert.deepEqual(activeWork(snapshot), { renders: 0, agents: 0, jobs: 1, deletions: 0, busy: true });
});

test("A4: register_work_file refuses a pad path or a pad sourcePath with the copy-out message", async (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "sb-agent-wakes-pad-"));
  const store = new Store(root);
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
  const episode = store.createEpisode({ title: "Pads" });
  store.ensureEpisodeDirectories(episode.id);
  const workDir = store.episodeWorkDirectory(episode.id), pad = path.join(workDir, "jobs", "agent_job_1");
  await mkdir(pad, { recursive: true });
  await writeFile(path.join(pad, "chart.svg"), "<svg/>");
  await writeFile(path.join(workDir, "chart.svg"), "<svg/>");
  const tools = createScopedTools({ requestId: "r1", conversationId: "c1", harness: "codex", channelId: episode.channelId, episodeId: episode.id,
    dataRoot: root, episodeDir: store.episodeDirectory(episode.id), workDir }, { store });
  const copyOut = { code: "PATH_IN_JOB_PAD", message: /agent job pad \(work\/jobs\/\)[\s\S]*Copy it into your own work area first/ };
  await assert.rejects(tools.call("register_work_file", { path: "work/jobs/agent_job_1/chart.svg" }), copyOut);
  await assert.rejects(tools.call("register_work_file", { path: "work/chart.svg", sourcePath: "work/jobs/agent_job_1/chart.svg" }), copyOut);
  await assert.rejects(tools.call("register_work_file", { path: "work/jobs/../jobs/agent_job_1/chart.svg" }), copyOut);
});

test("schema 20 widens a populated v19 production_runs to the wake origin and keeps rows, references and triggers", (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "sb-agent-wakes-v20-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  let store = new Store(root);
  const episode = store.createEpisode({ title: "Migrated" });
  const chat = createChatService({ store, renders: {}, codexFactory: async () => { throw new Error("unused"); } });
  const { id: conversationId } = chat.create(episode.id);
  const message = store.addConversationMessage({ conversationId, role: "user", text: "Draft it", state: "completed" });
  const run = store.createProductionRun({ conversationId, harness: "codex", originatingMessageId: message.id }).run;
  const job = store.saveJob({ episodeId: episode.id, kind: "draft", outputClass: "draft", state: "completed", revision: episode.revision, requestId: run.id });
  // Back to the v19 shape (the narrow origin CHECK, no watches table), rebuilt the same way.
  const db = store.db;
  db.exec("PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE; DROP TABLE job_watches");
  const triggers = db.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger'").all();
  for (const trigger of triggers) db.exec(`DROP TRIGGER "${trigger.name}"`);
  const indexes = db.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name='production_runs' AND sql IS NOT NULL").all();
  const schema = db.prepare("SELECT sql FROM sqlite_master WHERE name='production_runs'").get().sql;
  db.exec(schema.replace("origin IN ('typed','button','wake')", "origin IN ('typed','button')").replace(/^CREATE TABLE\s+(?:"[^"]+"|\w+)/i, "CREATE TABLE old_runs"));
  db.exec("INSERT INTO old_runs SELECT * FROM production_runs; DROP TABLE production_runs; ALTER TABLE old_runs RENAME TO production_runs");
  for (const statement of [...indexes, ...triggers]) db.exec(statement.sql);
  db.exec("PRAGMA user_version=19; COMMIT; PRAGMA foreign_keys=ON");
  assert.doesNotMatch(db.prepare("SELECT sql FROM sqlite_master WHERE name='production_runs'").get().sql, /'wake'/);
  store.close();
  store = new Store(root);
  t.after(() => store.close());
  assert.equal(Number(store.db.prepare("PRAGMA user_version").get().user_version), SCHEMA_VERSION);
  assert.equal(store.getProductionRun(run.id).originatingMessageId, message.id, "rows survive the rebuild");
  assert.equal(store.getJob(job.id).requestId, run.id, "job references survive");
  const line = store.addConversationMessage({ conversationId, role: "system", text: "Agent results: Facts (Done)", state: "queued" });
  assert.equal(store.createProductionRun({ conversationId, harness: "codex", origin: "wake", originatingMessageId: line.id }).run.origin, "wake");
  assert.throws(() => store.createProductionRun({ conversationId, harness: "codex", origin: "wake", originatingMessageId: message.id }), /wake request originates from an app wake line/);
  assert.throws(() => store.saveJob({ episodeId: episode.id, kind: "draft", outputClass: "draft", state: "queued", revision: episode.revision, requestId: "request_missing" }), /./, "the jobs request trigger still runs");
  assert.ok(store.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='job_watches'").get());
  assert.deepEqual(store.db.prepare("PRAGMA foreign_key_check").all(), []);
});

// Spec #42 'Agents panel and chat' (task #115): a job worker's tokens and tool activity reach the
// panel as agent_job.updated events, the tool cleared when its result returns, as for native
// delegations. The polled projection carries no brief or result text.
test("A11: job worker tokens and activity become panel events; the projection leaves out brief and result", async (t) => {
  const jobs = heldJobs();
  const f = fixture(t, { behaviours: [jobs.hold] });
  const turn = await f.send();
  const { jobId } = await turn.tools.start_agent_job({ brief: "Collect three facts.", label: "Facts" });
  const [connection] = await until(() => jobs.held.length === 1 && jobs.held);
  connection.emit("context/usage", { tokens: 4_200 });
  connection.emit("item/started", { item: { type: "dynamicToolCall", tool: "read_research", status: "inProgress" } });
  connection.emit("item/completed", { item: { type: "dynamicToolCall", tool: "read_research", status: "completed" } });
  connection.emit("context/usage", { tokens: 4_200 });
  const updates = () => f.view().events.filter((event) => event.type === "agent_job.updated" && event.payload.id === jobId && !("state" in event.payload)).map((event) => event.payload);
  await until(() => updates().length === 3);
  assert.deepEqual(updates(), [{ id: jobId, tokens: 4_200 }, { id: jobId, activity: "read_research" }, { id: jobId, activity: "" }], "unchanged values are not emitted again");
  jobs.end(connection, "Three facts.");
  await until(() => f.view().agentJobs[0]?.state === "completed");
  const [row] = f.view().agentJobs;
  assert.equal(row.label, "Facts");
  assert.ok(!("brief" in row) && !("result" in row), "the panel row has no brief or result");
  assert.equal(f.chat.get(f.episode.id, f.conversation.id).waitingForAgents, 0);
  turn.complete();
});

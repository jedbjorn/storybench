// Agent job ledger and runner (spec #42 'Agent jobs', 'Scratch pads'; A1, plus continue,
// restart, result capture and pad removal). The launcher is injected; no worker starts.
import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { AGENT_JOB_CAP, FILE_LIST_LIMIT, RESULT_LIMIT_BYTES, capResult, createAgentJobService } from "../src/agent-jobs.js";
import { CATALOG, jobFixture, openCodeRuntime } from "./agent-job-fixtures.js";

const ended = async (service, job) => { await service.settled(job.id); return service.get(job.conversationId, job.id); };

test("A1: a job runs in its own pad with the conversation's settings and ends with its final message and files", async (t) => {
  const { app, episode, conversation, fake, service, start, changes } = await jobFixture(t, { behaviours: [async (connection) => {
    await writeFile(path.join(connection.job.padPath, "notes.md"), "three facts");
    await mkdir(path.join(connection.job.padPath, "drafts"));
    await writeFile(path.join(connection.job.padPath, "drafts", "b.txt"), "xy");
    // The rendered boot is not the job's output.
    await writeFile(path.join(connection.job.padPath, "AGENTS.md"), "boot");
    connection.emit("item/agentMessage/delta", { itemId: "a", delta: "Working." });
    connection.emit("item/agentMessage/delta", { itemId: "b", delta: "Done: notes.md" });
    connection.emit("turn/completed", { turn: { id: "turn-1", status: "completed" } });
  }] });
  const job = await start();
  assert.equal(job.state, "queued");
  assert.deepEqual([job.harness, job.source, job.model, job.effort, job.timeLimitMinutes], ["codex", "codex-login", "gpt-5.5", "medium", 30]);
  assert.equal(job.padPath, path.join(app.store.episodeWorkDirectory(episode.id), "jobs", job.id));
  assert.equal(job.segmentId, job.id, "the job has its own session folder");
  const done = await ended(service, job);
  assert.equal(done.state, "completed");
  assert.deepEqual(done.result, { text: "Done: notes.md", truncated: false });
  assert.deepEqual(done.files, { entries: [{ path: "drafts/b.txt", size: 2 }, { path: "notes.md", size: 11 }], total: 2, truncated: false });
  assert.equal(done.delivery, "pending", "one ending, one pending result");
  assert.ok(done.startedAt && done.endedAt && done.sessionId);
  assert.equal(fake.launches[0].prompts[0], "Collect three facts about the topic.");
  assert.equal(fake.launches[0].closed > 0, true, "the worker is removed when the job ends");
  assert.deepEqual(changes, ["queued", "running", "completed"]);
  assert.equal(service.list(conversation.id)[0].id, job.id);
  assert.equal(service.list(conversation.id)[0].brief, undefined, "list is a summary");
});

test("A1: the fifth live job of a conversation is refused naming the four that hold the slots", async (t) => {
  const { conversation, other, service, start } = await jobFixture(t, { behaviours: Array(6).fill("hang") });
  const holding = [];
  for (let index = 0; index < AGENT_JOB_CAP; index++) holding.push((await start({ label: `Job ${index}` })).id);
  const refused = await start({ label: "Fifth" }).then(() => null, (error) => error);
  assert.equal(refused.statusCode, 409);
  assert.equal(refused.code, "AGENT_JOB_CAP");
  assert.deepEqual(refused.holding, holding);
  for (const id of holding) assert.match(refused.message, new RegExp(id));
  assert.equal(service.list(conversation.id).length, 4, "nothing was recorded for the refused start");
  // Another conversation has its own four slots; a cancelled job frees one.
  assert.equal((await start({}, other.id)).state, "queued");
  assert.equal((await service.cancel(conversation.id, holding[0])).state, "cancelled");
  assert.equal((await start({ label: "Now fits" })).state, "queued");
});

test("A1: the time limit defaults to 30 minutes, accepts 1-60, and ends a job timed_out", async (t) => {
  const { service, start, fake } = await jobFixture(t, { behaviours: ["hang"] });
  for (const timeoutMinutes of [0, 61, 1.5, "5", -1])
    await assert.rejects(start({ timeoutMinutes }), (error) => error.statusCode === 400 && /1 to 60/.test(error.message), String(timeoutMinutes));
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const job = await start({ timeoutMinutes: 1 });
  assert.equal(job.timeLimitMinutes, 1);
  while (!fake.launches[0]?.prompts.length) await new Promise((resolve) => setImmediate(resolve));
  t.mock.timers.tick(59_999);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(service.get(job.conversationId, job.id).state, "running");
  t.mock.timers.tick(1);
  const done = await ended(service, job);
  t.mock.timers.reset();
  assert.equal(done.state, "timed_out");
  assert.deepEqual(done.error, { stage: "time-limit", message: "The job reached its 1-minute time limit and was stopped." });
  assert.ok(fake.launches[0].closed > 0);
});

test("A1: an unusable harness, model or effort is refused and never substituted", async (t) => {
  const unavailable = CATALOG.map((entry) => entry.harness === "claude" ? { ...entry, available: false, reason: "not logged in" } : entry);
  const { conversation, service, start, fake } = await jobFixture(t, { catalog: unavailable });
  for (const [input, pattern] of [
    [{ model: "gpt-unknown" }, /gpt-unknown is not an available Codex model/],
    [{ effort: "turbo" }, /turbo is not a supported effort/],
    [{ model: "gpt-text", effort: "high" }, /high is not a supported effort/],
    [{ harness: "claude" }, /Claude Code is unavailable: not logged in/],
    [{ harness: "opencode", model: "not-offered" }, /not-offered is not offered by any ready OpenCode provider \(gateway\)/],
    [{ harness: "bash" }, /Unsupported harness/],
  ]) await assert.rejects(start(input), (error) => pattern.test(error.message) && /Nothing was substituted/.test(error.message), JSON.stringify(input));
  for (const input of [{ brief: "" }, { brief: "x".repeat(64 * 1024 + 1) }, { label: " " }, { label: "x".repeat(201) }])
    await assert.rejects(start(input), (error) => error.statusCode >= 400);
  assert.equal(fake.launches.length, 0);
  assert.equal(service.list(conversation.id).length, 0);
  // An explicit other harness starts from its own defaults, not the conversation's model or effort.
  const { start: startOther } = await jobFixture(t);
  const claude = await startOther({ harness: "claude", model: "sonnet" });
  assert.deepEqual([claude.harness, claude.source, claude.model, claude.effort], ["claude", "claude-login", "sonnet", null]);
});

// Flag #85: OpenCode has no login source. A job from a Claude or Codex parent runs on the one
// ready provider source that offers its model, with the parent's model and effort as given.
const PROVIDERS = [
  ...CATALOG.filter((entry) => entry.harness !== "opencode"),
  { id: "gateway", source: "gateway", harness: "opencode", available: true, models: [{ id: "fixture-model", efforts: [] }, { id: "shared-model", efforts: [] }] },
  { source: "ollama-cloud", harness: "opencode", available: true, models: [{ id: "deepseek-v4.1-flash:1017", efforts: ["high"] }, { id: "shared-model", efforts: [] }] },
  { id: "moonshotai", harness: "opencode", available: false, reason: "No key; open Providers", models: [] },
];
const PARENTS = {
  codex: "harness='codex',inference_source='codex-login',model='gpt-5.5',effort='medium'",
  claude: "harness='claude',inference_source='claude-login',model='sonnet',effort='high'",
};
const parentFixture = async (t, parent, options = {}) => {
  const fixture = await jobFixture(t, { catalog: PROVIDERS, ...options });
  fixture.app.store.db.prepare(`UPDATE conversations SET ${PARENTS[parent]} WHERE id=?`).run(fixture.conversation.id);
  return fixture;
};
const route = (job) => [job.harness, job.source, job.model, job.effort];

for (const parent of Object.keys(PARENTS)) {
  test(`flag #85: an OpenCode job from a ${parent} parent runs on the provider that offers its model, never substituted`, async (t) => {
    const { conversation, service, start, fake } = await parentFixture(t, parent);
    const deepseek = await ended(service, await start({ harness: "opencode", model: "deepseek-v4.1-flash:1017" }));
    assert.deepEqual(route(deepseek), ["opencode", "ollama-cloud", "deepseek-v4.1-flash:1017", null]);
    assert.equal(deepseek.state, "completed");
    assert.deepEqual(route(fake.launches[0].job), route(deepseek), "the worker runs the resolved route");
    assert.deepEqual(route(await start({ harness: "opencode", model: "deepseek-v4.1-flash:1017", effort: "high" })), ["opencode", "ollama-cloud", "deepseek-v4.1-flash:1017", "high"]);
    assert.deepEqual(route(await start({ harness: "opencode", model: "fixture-model" })), ["opencode", "gateway", "fixture-model", null]);
    const count = service.list(conversation.id).length;
    for (const [input, pattern, code] of [
      [{ harness: "opencode" }, /Choose an explicit model for OpenCode/, "INVALID_MODEL"],
      [{ harness: "opencode", model: "no-such-model" }, /no-such-model is not offered by any ready OpenCode provider \(gateway, ollama-cloud\)/, "UNKNOWN_MODEL"],
      [{ harness: "opencode", model: "shared-model" }, /shared-model is offered by more than one OpenCode provider \(gateway, ollama-cloud\)/, "AMBIGUOUS_ROUTE"],
      [{ harness: "opencode", model: "deepseek-v4.1-flash:1017", effort: "low" }, /low is not a supported effort/, "UNSUPPORTED_EFFORT"],
    ]) await assert.rejects(start(input), (error) => pattern.test(error.message) && /Nothing was substituted/.test(error.message) && error.code === code, JSON.stringify(input));
    assert.equal(service.list(conversation.id).length, count, "nothing was recorded for a refused start");
  });

  test(`flag #85: from a ${parent} parent, OpenCode with no configured or ready provider is refused naming the cause`, async (t) => {
    const none = await parentFixture(t, parent, { catalog: PROVIDERS.filter((entry) => entry.harness !== "opencode") });
    await assert.rejects(none.start({ harness: "opencode", model: "fixture-model" }), (error) => error.statusCode === 409 && /OpenCode is unavailable: no OpenCode provider is configured/.test(error.message));
    const down = await parentFixture(t, parent, { catalog: PROVIDERS.map((entry) => entry.harness === "opencode" && entry.available ? { ...entry, available: false, reason: "Key rejected", models: [] } : entry) });
    await assert.rejects(down.start({ harness: "opencode", model: "fixture-model" }),
      (error) => error.statusCode === 409 && /no provider is ready \(gateway: Key rejected; ollama-cloud: Key rejected; moonshotai: No key; open Providers\)/.test(error.message));
    // A provider whose model list is not exhaustive takes an unlisted exact id, with a note.
    const open = await parentFixture(t, parent, { catalog: PROVIDERS.map((entry) => entry.source === "ollama-cloud" ? { ...entry, exactModelIds: true } : entry) });
    const unlisted = await open.start({ harness: "opencode", model: "qwen-next:cloud" });
    assert.deepEqual(route(unlisted), ["opencode", "ollama-cloud", "qwen-next:cloud", null]);
    assert.match(unlisted.notes.join(), /qwen-next:cloud is not in the OpenCode list/);
    for (const fixture of [none, down]) assert.equal(fixture.fake.launches.length, 0);
  });
}

test("flag #85: an OpenCode parent keeps its own provider source for its jobs", async (t) => {
  const { app, conversation, start } = await jobFixture(t, { catalog: PROVIDERS });
  app.store.db.prepare("UPDATE conversations SET harness='opencode',inference_source='gateway',model='shared-model',effort=NULL WHERE id=?").run(conversation.id);
  assert.deepEqual(route(await start()), ["opencode", "gateway", "shared-model", null]);
  assert.deepEqual(route(await start({ harness: "opencode", model: "shared-model" })), ["opencode", "gateway", "shared-model", null], "same harness: no provider choice is made");
  await assert.rejects(start({ harness: "opencode", model: "deepseek-v4.1-flash:1017" }), /deepseek-v4.1-flash:1017 is not an available OpenCode model/);
});

test("A1: interrupted, failed and cut results are never reported as success", async (t) => {
  const big = "é".repeat(150 * 1024);
  const { app, conversation, service, start } = await jobFixture(t, { behaviours: ["fail", "launch-fails", (connection) => {
    connection.emit("item/agentMessage/delta", { itemId: "x", delta: big });
    connection.emit("turn/completed", { turn: { id: "turn-1", status: "completed" } });
  }, "hang", "hang"] });
  const failed = await ended(service, await start());
  assert.equal(failed.state, "failed");
  assert.deepEqual(failed.error, { stage: "harness", message: "model refused" });
  const launch = await ended(service, await start());
  assert.deepEqual([launch.state, launch.error.stage, launch.error.message], ["failed", "launch", "worker.start refused"]);
  const cut = await ended(service, await start());
  assert.equal(cut.state, "completed");
  assert.equal(cut.result.truncated, true);
  assert.ok(Buffer.byteLength(cut.result.text, "utf8") <= RESULT_LIMIT_BYTES);
  assert.match(cut.result.text, /\[Result cut at 262144 bytes; \d+ more bytes were not stored\.\]$/);
  assert.ok(!cut.result.text.includes("�"), "cut on a character boundary");

  // Restart: queued and running jobs end interrupted with an unknown outcome.
  const running = await start(), queued = await start();
  app.store.db.prepare("UPDATE agent_jobs SET state='queued',started_at=NULL WHERE id=?").run(queued.id);
  const restarted = createAgentJobService({ store: app.store, launcher: async () => { throw new Error("no replay"); }, catalog: async () => CATALOG });
  for (const id of [running.id, queued.id]) {
    const job = restarted.get(conversation.id, id);
    assert.equal(job.state, "interrupted");
    assert.equal(job.result, null);
    assert.equal(job.error.stage, "restart");
    assert.match(job.error.message, /outcome is unknown and it was not replayed/);
    assert.equal(job.delivery, "pending");
  }
  // The first ending wins: the old runner's later cancel does not rewrite the interrupted row.
  await service.cancel(conversation.id, running.id);
  assert.equal(restarted.get(conversation.id, running.id).state, "interrupted");
});

test("result capture cuts by bytes and marks what it cut", () => {
  assert.deepEqual(capResult("short", 100), { text: "short", truncated: false });
  const cut = capResult("a".repeat(500), 200);
  assert.equal(cut.truncated, true);
  assert.ok(Buffer.byteLength(cut.text) <= 200);
  assert.match(cut.text, /more bytes were not stored/);
});

test("the file list stops at 200 entries with sizes and says how many there were", async (t) => {
  const { service, start } = await jobFixture(t, { behaviours: [async (connection) => {
    for (let index = 0; index < FILE_LIST_LIMIT + 5; index++) await writeFile(path.join(connection.job.padPath, `f${String(index).padStart(3, "0")}.txt`), "x".repeat(index % 7));
    connection.emit("turn/completed", { turn: { id: "turn-1", status: "completed" } });
  }] });
  const done = await ended(service, await start());
  assert.equal(done.files.entries.length, FILE_LIST_LIMIT);
  assert.deepEqual([done.files.total, done.files.truncated], [FILE_LIST_LIMIT + 5, true]);
  assert.deepEqual(done.files.entries[3], { path: "f003.txt", size: 3 });
  assert.equal(done.result, null);
});

test("flag #86: OpenCode runtime files and rendered boot files never displace the job's output in the file list", async (t) => {
  const { service, start } = await jobFixture(t, { behaviours: [async (connection) => {
    await openCodeRuntime(connection.job.padPath);
    await writeFile(path.join(connection.job.padPath, "notes.md"), "three facts");
    connection.emit("turn/completed", { turn: { id: "turn-1", status: "completed" } });
  }] });
  const done = await ended(service, await start());
  assert.deepEqual(done.files, { entries: [{ path: "notes.md", size: 11 }], total: 1, truncated: false });
});

test("continue runs on the same harness, session and pad, and refuses a live run, a lost session or a removed pad", async (t) => {
  const { conversation, other, service, start, fake } = await jobFixture(t, { behaviours: ["complete", "hang", "complete", "no-session", "complete", "resume-lost"] });
  const first = await ended(service, await start({ harness: "claude", model: "sonnet", effort: "high" }));
  const second = await service.continue({ conversationId: conversation.id, requestId: "request_two", jobId: first.id, brief: "Now check the second source." });
  assert.equal(second.continuedFrom, first.id);
  for (const key of ["padPath", "segmentId", "sessionId", "harness", "source", "model", "effort", "label"]) assert.equal(second[key], first[key], key);
  assert.equal(second.parentRequestId, "request_two");
  while (!fake.launches[1]?.resumed) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(fake.launches[1].resumed, first.sessionId);
  await assert.rejects(service.continue({ conversationId: conversation.id, requestId: "r", jobId: second.id, brief: "x" }), { code: "AGENT_JOB_LIVE" });
  await assert.rejects(service.continue({ conversationId: conversation.id, requestId: "r", jobId: first.id, brief: "x" }), { code: "AGENT_JOB_LIVE" }, "the pad is in use by its continuation");
  await assert.rejects(service.continue({ conversationId: other.id, requestId: "r", jobId: first.id, brief: "x" }), { statusCode: 404 });
  await service.cancel(conversation.id, second.id);
  const third = await ended(service, await service.continue({ conversationId: conversation.id, requestId: "r", jobId: second.id, brief: "Finish.", timeoutMinutes: 5 }));
  assert.deepEqual([third.state, third.timeLimitMinutes, third.sessionId], ["completed", 5, first.sessionId]);

  const lost = await ended(service, await start());
  assert.equal(lost.sessionId, null);
  await assert.rejects(service.continue({ conversationId: conversation.id, requestId: "r", jobId: lost.id, brief: "x" }), { code: "AGENT_JOB_NO_SESSION" });

  // A saved session that cannot be resumed fails the run; a new session is never substituted.
  const fresh = await ended(service, await start());
  const resumed = await ended(service, await service.continue({ conversationId: conversation.id, requestId: "r", jobId: fresh.id, brief: "x" }));
  assert.deepEqual([resumed.state, resumed.error.stage], ["failed", "session"]);
  assert.match(resumed.error.message, /no new session was substituted/);

  await service.removePads(first.episodeId);
  await assert.rejects(service.continue({ conversationId: conversation.id, requestId: "r", jobId: third.id, brief: "x" }), { code: "AGENT_JOB_PAD_REMOVED" });
});

test("cancel ends one job cancelled once its worker is gone; jobs are scoped to their conversation", async (t) => {
  const { conversation, other, service, start, fake } = await jobFixture(t, { behaviours: ["hang", "hang", "hang"] });
  const job = await start();
  await assert.rejects(Promise.resolve().then(() => service.get(other.id, job.id)), { statusCode: 404 });
  await assert.rejects(service.cancel(other.id, job.id), { statusCode: 404 });
  while (!fake.launches[0]?.prompts.length) await new Promise((resolve) => setImmediate(resolve));
  const cancelled = await service.cancel(conversation.id, job.id);
  assert.deepEqual([cancelled.state, cancelled.delivery], ["cancelled", "pending"]);
  assert.ok(fake.launches[0].closed > 0);
  assert.equal((await service.cancel(conversation.id, job.id)).state, "cancelled", "an ended job is returned as it is");
  // Cancelled while still queued: no worker is launched at all.
  const [a, b] = [await start(), await start()];
  await service.cancelConversation(conversation.id);
  for (const id of [a.id, b.id]) assert.equal(service.get(conversation.id, id).state, "cancelled");
  assert.equal(fake.launches.length, 1);
  assert.equal(service.hasRunning(), false);
});

test("pads of closed conversations are removed, live pads kept, and a failed removal is retried by the next call", async (t) => {
  const { episode, conversation, other, service, start, app } = await jobFixture(t, { behaviours: ["complete", "hang", "complete"] });
  const closed = await ended(service, await start());
  const live = await start({}, other.id);
  const kept = await ended(service, await start({}, other.id));
  const fresh = app.chat.create(episode.id, { name: "New chat" });
  const jobsDir = path.dirname(closed.padPath);
  const root = process.getuid?.() === 0;
  if (!root) await chmod(jobsDir, 0o500);
  const first = await service.removePads(episode.id, { keepConversationId: fresh.id });
  await chmod(jobsDir, 0o700);
  if (!root) {
    assert.equal(first.removed.length, 0);
    assert.deepEqual(first.failed.map(({ padPath }) => padPath).sort(), [closed.padPath, kept.padPath].sort());
    assert.equal(service.get(conversation.id, closed.id).padRemoved, false);
  }
  const second = await service.removePads(episode.id, { keepConversationId: fresh.id });
  assert.equal(second.failed.length, 0);
  assert.deepEqual((await readdir(jobsDir)).sort(), [path.basename(live.padPath)], "only the live job's pad remains");
  assert.equal(service.get(conversation.id, closed.id).padRemoved, true);
  assert.equal(service.get(other.id, kept.id).state, "completed", "rows outlive their pad");
  await assert.rejects(stat(closed.padPath), { code: "ENOENT" });
});

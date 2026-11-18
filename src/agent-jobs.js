// Agent jobs (spec #42 'Agent jobs' and 'Scratch pads'; decisions #108, #109): an app-owned
// ledger of headless harness runs, each scoped to one conversation with its own worker and
// scratch pad. These are service-level primitives: the parent tools, wake turns and lifecycle
// wiring build on them. Where the spec is silent on a lifecycle detail this follows
// Subfloor's `sc job` (one terminal state per run, a lost run is never a success).
import { randomUUID } from "node:crypto";
import { lstat, mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { SelectionError, validateSelection } from "./runtime/conversation-runtime.js";

export const AGENT_JOB_CAP = 4;
export const LIVE_STATES = Object.freeze(["queued", "running"]);
export const TERMINAL_STATES = Object.freeze(["completed", "failed", "timed_out", "cancelled", "interrupted"]);
export const TIME_LIMIT_MINUTES = Object.freeze({ default: 30, min: 1, max: 60 });
export const BRIEF_LIMIT_BYTES = 64 * 1024;
export const LABEL_LIMIT = 200;
export const RESULT_LIMIT_BYTES = 256 * 1024;
export const FILE_LIST_LIMIT = 200;
// Files the app renders into every pad; they are not the job's output.
const RENDERED_FILES = new Set(["AGENTS.md", "CLAUDE.md"]);
// Pad-root directories that hold runtime state, not output: OpenCode's project directory (its
// installed node_modules, package files and the rendered .gitignore) and the render manifest.
// They are not walked, so they cannot use up the list or the walk budget.
const RUNTIME_DIRS = new Set([".opencode", ".storybench"]);
const MAX_PAD_WALK = 20_000;

const now = () => new Date().toISOString();
const refusal = (message, statusCode = 400, extra = {}) => Object.assign(new Error(message), { statusCode, ...extra });

// Keep at most `limit` bytes, cut on a character boundary, with a marker saying how much was cut.
export function capResult(text, limit = RESULT_LIMIT_BYTES, { omittedBeyond = 0 } = {}) {
  const bytes = Buffer.from(text, "utf8");
  if (bytes.length <= limit && !omittedBeyond) return { text, truncated: false };
  const marker = (omitted) => `\n\n[Result cut at ${limit} bytes; ${omitted} more bytes were not stored.]`;
  let end = limit - Buffer.byteLength(marker(bytes.length + omittedBeyond));
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--;
  return { text: bytes.subarray(0, end).toString("utf8") + marker(bytes.length - end + omittedBeyond), truncated: true };
}

// The job's final message: the last assistant message of the run. Codex streams one message
// per item id; Claude and OpenCode emit each text block whole, without an item id.
function resultCapture(limit = RESULT_LIMIT_BYTES) {
  let current = null, last = null;
  return {
    append(delta, itemId = null) {
      if (!delta) return;
      if (!current || !itemId || current.itemId !== itemId) current = { itemId, text: "", omitted: 0 };
      // Bound memory: anything past the stored limit is only counted.
      const room = limit * 2 - current.text.length;
      if (room > 0) current.text += delta.slice(0, room);
      current.omitted += Buffer.byteLength(delta.slice(Math.max(room, 0)), "utf8");
      if (current.text.trim()) last = current;
    },
    value: () => (last ? capResult(last.text, limit, { omittedBeyond: last.omitted }) : null),
  };
}

// Regular files in a pad, sorted by path, up to `limit` entries with sizes. Symlinks are
// neither followed nor listed.
export async function listPadFiles(padDir, { limit = FILE_LIST_LIMIT } = {}) {
  const files = [];
  let visited = 0;
  const walk = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (++visited > MAX_PAD_WALK) return;
      const absolute = path.join(directory, entry.name), relative = path.relative(padDir, absolute);
      if (entry.isDirectory()) { if (!(directory === padDir && RUNTIME_DIRS.has(entry.name))) await walk(absolute); }
      else if (entry.isFile() && !RENDERED_FILES.has(relative)) files.push({ path: relative, size: (await lstat(absolute)).size });
    }
  };
  await walk(padDir);
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { entries: files.slice(0, limit), total: files.length, truncated: files.length > limit || visited > MAX_PAD_WALK };
}

const checkBrief = (brief) => {
  if (typeof brief !== "string" || !brief.trim()) throw refusal("An agent job needs a brief: the goal, the paths and the rules that apply");
  if (Buffer.byteLength(brief, "utf8") > BRIEF_LIMIT_BYTES) throw refusal(`The brief is ${Buffer.byteLength(brief, "utf8")} bytes; the limit is ${BRIEF_LIMIT_BYTES} bytes (64 KiB)`, 413);
  return brief;
};
const checkLabel = (label) => {
  const value = typeof label === "string" ? label.trim() : "";
  if (!value) throw refusal("An agent job needs a short label");
  if (value.length > LABEL_LIMIT) throw refusal(`The label is ${value.length} characters; the limit is ${LABEL_LIMIT}`);
  return value;
};
const checkLimit = (minutes) => {
  if (minutes === undefined || minutes === null) return TIME_LIMIT_MINUTES.default;
  if (!Number.isInteger(minutes) || minutes < TIME_LIMIT_MINUTES.min || minutes > TIME_LIMIT_MINUTES.max)
    throw refusal(`timeoutMinutes must be a whole number from ${TIME_LIMIT_MINUTES.min} to ${TIME_LIMIT_MINUTES.max}; the default is ${TIME_LIMIT_MINUTES.default}`);
  return minutes;
};

// store: the app Store. launcher(job, { onEvent, onError, supportsImages }) opens the job's
// worker and returns a harness connection (startThread/resumeThread/startTurn/close) whose
// close() removes the worker. catalog() lists the installed harness catalogue entries.
// onChange(job) follows every state change; onEvent(job, event) passes harness events on.
export function createAgentJobService({ store, launcher, catalog, onChange = () => {}, onEvent = () => {}, log = () => {} }) {
  const db = store.db;
  // Restart: a job that was queued or running in a previous process has an unknown outcome.
  // It is never replayed, and its pad stays until its conversation closes.
  const restarted = db.prepare(`UPDATE agent_jobs SET state='interrupted',ended_at=?,error_stage='restart',
    error='Storybench restarted while this job ran; its outcome is unknown and it was not replayed.',delivery='pending'
    WHERE state IN ('queued','running')`).run(now());
  if (restarted.changes) log({ event: "agent_jobs.interrupted", count: Number(restarted.changes) });

  const runs = new Map();
  let closing = false;
  const absolutePad = (relative) => path.join(store.workspace, relative);
  const project = (row) => row && ({
    id: row.id, conversationId: row.conversation_id, episodeId: row.episode_id, parentRequestId: row.parent_request_id,
    label: row.label, brief: row.brief, harness: row.harness, source: row.inference_source, model: row.model ?? null, effort: row.effort ?? null,
    state: row.state, timeLimitMinutes: row.time_limit_minutes, createdAt: row.created_at, startedAt: row.started_at ?? null, endedAt: row.ended_at ?? null,
    result: row.result_text == null ? null : { text: row.result_text, truncated: Boolean(row.result_truncated) },
    error: row.error == null ? null : { stage: row.error_stage ?? null, message: row.error },
    files: row.files == null ? null : JSON.parse(row.files),
    padPath: absolutePad(row.pad_path), padRemoved: Boolean(row.pad_removed_at), segmentId: row.segment_id, sessionId: row.session_id ?? null,
    continuedFrom: row.continued_from ?? null, delivery: row.delivery ?? null,
  });
  const read = (id) => db.prepare("SELECT * FROM agent_jobs WHERE id=?").get(id);
  // Every lookup is scoped to the calling conversation.
  const owned = (conversationId, jobId) => {
    const row = typeof jobId === "string" ? db.prepare("SELECT * FROM agent_jobs WHERE id=? AND conversation_id=?").get(jobId, String(conversationId ?? "")) : null;
    if (!row) throw refusal(`Agent job ${String(jobId)} was not found in this conversation`, 404);
    return row;
  };
  const changed = (id) => { const job = project(read(id)); if (job) onChange(job); return job; };

  // Harness, model and effort are the parent's choice; what it omits comes from the
  // conversation. Each is validated against the installed catalogue and never substituted.
  async function resolveRoute(conversation, { harness, model, effort }) {
    const same = harness == null || harness === conversation.harness;
    const selection = {
      harness: harness ?? conversation.harness,
      model: model !== undefined ? model : same ? conversation.model : null,
      effort: effort !== undefined ? effort : same ? conversation.effort : null,
    };
    const entries = await catalog();
    let checked;
    try { checked = validateSelection(entries, { ...selection, source: same ? conversation.inferenceSource : crossSource(entries, selection) }); }
    catch (cause) { throw refusal(`This agent job cannot run: ${cause.message}. Nothing was substituted.`, cause.statusCode ?? 409, { code: cause.code }); }
    const entry = entries.find((candidate) => candidate.harness === checked.harness && (candidate.source ?? candidate.id ?? `${checked.harness}-login`) === checked.source);
    const listed = entry?.models?.find((candidate) => candidate.id === checked.model);
    return { ...checked, supportsImages: !listed?.inputModalities || listed.inputModalities.includes("image") };
  }

  // Another harness runs on its login source (decision #110). OpenCode has no login: it runs on
  // the one ready provider source that offers the model. None, or more than one, is refused.
  function crossSource(entries, { harness, model }) {
    if (harness !== "opencode") return `${harness}-login`;
    const providers = entries.filter((entry) => entry.harness === "opencode"), name = (entry) => entry.source ?? entry.id;
    if (!providers.length) throw new SelectionError("HARNESS_UNAVAILABLE", "OpenCode is unavailable: no OpenCode provider is configured; open Providers", 409);
    const ready = providers.filter((entry) => entry.available);
    if (!ready.length) throw new SelectionError("HARNESS_UNAVAILABLE", `OpenCode is unavailable: no provider is ready (${providers.map((entry) => `${name(entry)}: ${entry.reason}`).join("; ")})`, 409);
    if (model == null) throw new SelectionError("INVALID_MODEL", "Choose an explicit model for OpenCode");
    const offering = ready.filter((entry) => entry.models.some((candidate) => candidate.id === model));
    // A provider whose model list is not exhaustive accepts an unlisted exact id.
    const routes = offering.length ? offering : ready.filter((entry) => entry.exactModelIds);
    if (!routes.length) throw new SelectionError("UNKNOWN_MODEL", `${model} is not offered by any ready OpenCode provider (${ready.map(name).join(", ")})`);
    if (routes.length > 1) throw new SelectionError("AMBIGUOUS_ROUTE", `${model} is offered by more than one OpenCode provider (${routes.map(name).join(", ")}), and a job names no provider; start it from a conversation set to the provider you want`, 409);
    return name(routes[0]);
  }

  // The cap and the pad's liveness are checked and the row inserted in one synchronous step.
  function insert(job) {
    if (closing) throw refusal("Storybench is shutting down; no agent job starts", 409);
    const holding = db.prepare("SELECT id FROM agent_jobs WHERE conversation_id=? AND state IN ('queued','running') ORDER BY created_at,rowid").all(job.conversationId).map(({ id }) => id);
    if (holding.length >= AGENT_JOB_CAP)
      throw refusal(`This conversation already has ${AGENT_JOB_CAP} agent jobs running or queued: ${holding.join(", ")}. Wait for one to end or cancel one first.`, 409, { code: "AGENT_JOB_CAP", holding });
    const live = db.prepare("SELECT id FROM agent_jobs WHERE pad_path=? AND state IN ('queued','running')").get(job.padPath);
    if (live) throw refusal(`Agent job ${live.id} is still running on this pad; wait for it to end or cancel it before continuing`, 409, { code: "AGENT_JOB_LIVE" });
    db.prepare(`INSERT INTO agent_jobs(id,conversation_id,episode_id,parent_request_id,label,brief,harness,inference_source,model,effort,state,time_limit_minutes,created_at,pad_path,segment_id,session_id,continued_from)
      VALUES(?,?,?,?,?,?,?,?,?,?,'queued',?,?,?,?,?,?)`).run(job.id, job.conversationId, job.episodeId, String(job.parentRequestId), job.label, job.brief,
      job.harness, job.source, job.model ?? null, job.effort ?? null, job.timeLimitMinutes, now(), job.padPath, job.segmentId, job.sessionId ?? null, job.continuedFrom ?? null);
    return job.id;
  }

  // Exactly one terminal write per run: the first ending wins.
  function finish(id, { state, stage = null, error = null }, { result = null, files = null } = {}) {
    if (!db.isOpen) return;
    db.prepare(`UPDATE agent_jobs SET state=?,ended_at=?,error_stage=?,error=?,result_text=?,result_truncated=?,files=?,delivery='pending'
      WHERE id=? AND state IN ('queued','running')`).run(state, now(), stage, error, result?.text ?? null, result?.truncated ? 1 : 0, files ? JSON.stringify(files) : null, id);
    changed(id);
  }

  function launch(id, route) {
    let settle;
    const entry = { outcome: null, connection: null, settled: new Promise((resolve) => { settle = resolve; }) };
    entry.end = (outcome) => {
      if (entry.outcome) return;
      entry.outcome = outcome;
      entry.wake?.();
      Promise.resolve().then(() => entry.connection?.close?.()).catch(() => {});
    };
    runs.set(id, entry);
    run(project(read(id)), entry, route).catch((cause) => log({ event: "agent_job.runner_failed", jobId: id, error: cause?.message }))
      .finally(() => { runs.delete(id); settle(); });
  }

  async function run(job, entry, route) {
    const result = resultCapture();
    const turnEnded = new Promise((resolve) => { entry.wake = resolve; });
    const timer = setTimeout(() => entry.end({ state: "timed_out", stage: "time-limit", error: `The job reached its ${job.timeLimitMinutes}-minute time limit and was stopped.` }), job.timeLimitMinutes * 60_000);
    timer.unref?.();
    let stage = "pad", started = false, turnId = null;
    // A cancel or the time limit ends the run even while the harness has not answered.
    const step = (promise) => Promise.race([promise, turnEnded]);
    const consume = (event) => {
      const params = event.params ?? {}, eventTurn = params.turnId ?? params.turn?.id ?? null;
      try { onEvent(job, event); } catch { /* observers never end a run */ }
      // A resumed Codex session may replay the previous turn; only this run's turn counts.
      if (event.method === "turn/started") { started = true; turnId ??= eventTurn; return; }
      if (!started || (turnId && eventTurn && eventTurn !== turnId)) return;
      if (event.method === "item/agentMessage/delta" && typeof params.delta === "string") result.append(params.delta, params.itemId ?? null);
      else if (event.method === "turn/completed") {
        const status = params.turn?.status;
        entry.end(status === "completed" ? { state: "completed" }
          : { state: "failed", stage: "harness", error: status === "interrupted" ? "The harness ended the run as interrupted" : String(params.turn?.error ?? "The harness run failed").slice(0, 2000) });
      }
    };
    try {
      await mkdir(job.padPath, { recursive: true });
      if (entry.outcome) return;
      stage = "launch";
      entry.connection = await launcher(job, { supportsImages: route.supportsImages, onEvent: consume,
        onError: (cause) => entry.end({ state: "failed", stage: "harness", error: cause?.message || "The job worker failed" }) });
      if (entry.outcome) return;
      stage = "session";
      const threadId = await step(job.sessionId ? entry.connection.resumeThread(job.sessionId) : entry.connection.startThread());
      if (entry.outcome) return;
      // A continued job runs on its saved session or not at all.
      if (job.sessionId && (entry.connection.segmentTransition || threadId !== job.sessionId)) throw new Error("The job's saved session could not be resumed; no new session was substituted");
      if (!job.sessionId) db.prepare("UPDATE agent_jobs SET session_id=? WHERE id=?").run(threadId, job.id);
      db.prepare("UPDATE agent_jobs SET state='running',started_at=? WHERE id=? AND state='queued'").run(now(), job.id);
      changed(job.id);
      stage = "turn";
      await step(entry.connection.startTurn(threadId, job.brief));
      await turnEnded;
    } catch (cause) {
      entry.end({ state: "failed", stage, error: String(cause?.message || cause || "The job failed").slice(0, 2000) });
    } finally {
      clearTimeout(timer);
      // The worker is gone before the job ends, so its file list is final.
      try { await entry.connection?.close?.(); }
      catch (cause) { log({ event: "agent_job.stop_failed", jobId: job.id, error: cause?.message }); }
      const files = await listPadFiles(job.padPath).catch(() => null);
      finish(job.id, entry.outcome ?? { state: "failed", stage, error: "The run ended without an outcome" }, { result: result.value(), files });
    }
  }

  async function start({ conversationId, requestId, brief, label, harness, model, effort, timeoutMinutes }) {
    const conversation = store.requireConversation(conversationId);
    const job = { conversationId: conversation.id, episodeId: conversation.episodeId, parentRequestId: requestId, brief: checkBrief(brief), label: checkLabel(label), timeLimitMinutes: checkLimit(timeoutMinutes) };
    const route = await resolveRoute(conversation, { harness, model, effort });
    job.id = `agent_job_${randomUUID()}`;
    job.segmentId = job.id;
    job.padPath = path.relative(store.workspace, path.join(store.episodeWorkDirectory(conversation.episodeId), "jobs", job.id));
    insert({ ...job, harness: route.harness, source: route.source, model: route.model, effort: route.effort });
    changed(job.id);
    launch(job.id, route);
    return { ...project(read(job.id)), notes: route.notes };
  }

  // A new run on the same harness, model, effort, session and pad. It takes a slot and has its
  // own time limit.
  async function continueJob({ conversationId, requestId, jobId, brief, timeoutMinutes }) {
    const earlier = owned(conversationId, jobId);
    const job = { brief: checkBrief(brief), timeLimitMinutes: checkLimit(timeoutMinutes) };
    if (LIVE_STATES.includes(earlier.state)) throw refusal(`Agent job ${earlier.id} is still ${earlier.state}; wait for it to end or cancel it before continuing it`, 409, { code: "AGENT_JOB_LIVE" });
    if (!earlier.session_id) throw refusal(`Agent job ${earlier.id} cannot be continued: no harness session was captured before it ended`, 409, { code: "AGENT_JOB_NO_SESSION" });
    const padMissing = earlier.pad_removed_at || !(await lstat(absolutePad(earlier.pad_path)).then((info) => info.isDirectory(), () => false));
    if (padMissing) throw refusal(`Agent job ${earlier.id} cannot be continued: its pad was removed`, 409, { code: "AGENT_JOB_PAD_REMOVED" });
    const conversation = store.requireConversation(earlier.conversation_id);
    const route = await resolveRoute({ ...conversation, harness: earlier.harness, inferenceSource: earlier.inference_source },
      { harness: earlier.harness, model: earlier.model, effort: earlier.effort });
    Object.assign(job, { id: `agent_job_${randomUUID()}`, conversationId: earlier.conversation_id, episodeId: earlier.episode_id, parentRequestId: requestId,
      label: earlier.label, harness: earlier.harness, source: earlier.inference_source, model: earlier.model, effort: earlier.effort,
      padPath: earlier.pad_path, segmentId: earlier.segment_id, sessionId: earlier.session_id, continuedFrom: earlier.id });
    insert(job);
    changed(job.id);
    launch(job.id, route);
    return project(read(job.id));
  }

  // Ends one job `cancelled` and resolves once its worker is gone. An ended job is returned as it is.
  async function cancel(conversationId, jobId) {
    const row = owned(conversationId, jobId);
    const entry = runs.get(row.id);
    if (entry) { entry.end({ state: "cancelled", stage: null, error: "Cancelled before it finished." }); await entry.settled; }
    else if (LIVE_STATES.includes(row.state)) finish(row.id, { state: "cancelled", error: "Cancelled before it finished." });
    return project(read(row.id));
  }

  async function cancelConversation(conversationId) {
    const ids = db.prepare("SELECT id FROM agent_jobs WHERE conversation_id=? AND state IN ('queued','running')").all(String(conversationId)).map(({ id }) => id);
    return Promise.all(ids.map((id) => cancel(conversationId, id)));
  }

  // Remove the pads of a production's closed conversations (all but keepConversationId). A
  // live job's pad is never removed. A failure is logged and left for the next call, which
  // the next new chat makes, as redline removal does.
  async function removePads(episodeId, { keepConversationId = null } = {}) {
    const pads = db.prepare(`SELECT DISTINCT pad_path padPath FROM agent_jobs WHERE episode_id=? AND pad_removed_at IS NULL AND conversation_id IS NOT ?
      AND pad_path NOT IN (SELECT pad_path FROM agent_jobs WHERE state IN ('queued','running'))`).all(episodeId, keepConversationId).map(({ padPath }) => padPath);
    const removed = [], failed = [];
    for (const padPath of pads) {
      try {
        if (path.basename(path.dirname(padPath)) !== "jobs" || padPath.startsWith("..") || path.isAbsolute(padPath)) throw new Error("not an agent job pad");
        await rm(absolutePad(padPath), { recursive: true, force: true });
        db.prepare("UPDATE agent_jobs SET pad_removed_at=? WHERE pad_path=? AND pad_removed_at IS NULL").run(now(), padPath);
        removed.push(absolutePad(padPath));
      } catch (cause) {
        failed.push({ padPath: absolutePad(padPath), error: cause.message });
        log({ event: "agent_job.pad_removal_failed", padPath, error: cause.message });
      }
    }
    return { removed, failed };
  }

  return {
    start, continue: continueJob, cancel, cancelConversation, removePads,
    get: (conversationId, jobId) => project(owned(conversationId, jobId)),
    // Newest first; summaries without brief or result text (get() reads one in full).
    list: (conversationId) => db.prepare("SELECT * FROM agent_jobs WHERE conversation_id=? ORDER BY created_at DESC,rowid DESC").all(String(conversationId))
      .map((row) => { const { brief, result, ...summary } = project(row); return { ...summary, resultTruncated: result?.truncated ?? false, hasResult: Boolean(result) }; }),
    // Live (queued or running) jobs of a conversation, oldest first.
    live: (conversationId) => db.prepare("SELECT * FROM agent_jobs WHERE conversation_id=? AND state IN ('queued','running') ORDER BY created_at,rowid").all(String(conversationId)).map(project),
    // Ended jobs whose one result has not reached a parent turn yet, in ending order.
    pending: (conversationId) => db.prepare("SELECT * FROM agent_jobs WHERE conversation_id=? AND delivery='pending' ORDER BY ended_at,rowid").all(String(conversationId)).map(project),
    // Move results between delivery states; only rows still in `from` change.
    setDelivery(ids, to, { from = "pending" } = {}) {
      const update = db.prepare("UPDATE agent_jobs SET delivery=? WHERE id=? AND delivery=?");
      for (const id of ids) update.run(to, id, from);
    },
    // Resolves when the job's current run has ended (immediately when it is not running).
    settled: (jobId) => runs.get(jobId)?.settled ?? Promise.resolve(),
    hasRunning: () => runs.size > 0,
    async close() {
      closing = true;
      const ending = [...runs.values()];
      for (const entry of ending) entry.end({ state: "interrupted", stage: "shutdown", error: "Storybench shut down while this job ran; its outcome is unknown and it was not replayed." });
      await Promise.allSettled(ending.map((entry) => entry.settled));
    },
  };
}

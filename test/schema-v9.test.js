import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SCHEMA_VERSION, Store } from "../src/store.js";
import { createChatService } from "../src/chat.js";

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "test-support", "fixtures");

// A data root holding a copy of a committed fixture database (built by the historical application code).
function fixtureRoot(t, name) {
  const root = mkdtempSync(path.join(os.tmpdir(), "storybench-v9-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  copyFileSync(path.join(FIXTURES, name), path.join(root, "storybench.sqlite"));
  return root;
}
const rows = (store, sql, ...values) => store.db.prepare(sql).all(...values).map((row) => ({ ...row }));
function snapshot(store) {
  return {
    conversations: rows(store, "SELECT id,episode_id,name,thread_id,harness,model,effort,settings_source,settings_revision,settings_updated_at,active_segment_id FROM conversations ORDER BY id"),
    messages: rows(store, "SELECT id,conversation_id,role,text,state,turn_id,origin FROM conversation_messages ORDER BY id"),
    events: rows(store, "SELECT conversation_id,sequence,type,payload FROM conversation_events ORDER BY conversation_id,sequence"),
    segments: rows(store, "SELECT * FROM conversation_segments ORDER BY id"),
    runs: rows(store, "SELECT * FROM production_runs"),
    jobColumns: rows(store, "PRAGMA table_info('jobs')").map((column) => column.name),
  };
}

test("a v8 database (conversations created by the v8 chat code) migrates through v9 to the current schema with the specified backfill, twice", (t) => {
  const root = fixtureRoot(t, "v8-conversations.sqlite");
  const before = new DatabaseSync(path.join(root, "storybench.sqlite"), { readOnly: true });
  assert.equal(Number(before.prepare("PRAGMA user_version").get().user_version), 8);
  const original = {
    conversations: before.prepare("SELECT id,episode_id,name,thread_id,created_at FROM conversations ORDER BY id").all().map((row) => ({ ...row })),
    messages: before.prepare("SELECT id,conversation_id,role,text,state,turn_id FROM conversation_messages ORDER BY id").all().map((row) => ({ ...row })),
    events: before.prepare("SELECT conversation_id,sequence,type,payload FROM conversation_events ORDER BY conversation_id,sequence").all().map((row) => ({ ...row })),
  };
  before.close();
  assert.equal(original.conversations.filter((row) => row.thread_id).length, 1);
  let store = new Store(root, { legacyWorkspace: false, startup: false });
  assert.equal(Number(store.db.prepare("PRAGMA user_version").get().user_version), SCHEMA_VERSION);
  assert.ok(SCHEMA_VERSION >= 9);
  const backup = new DatabaseSync(path.join(root, "storybench.pre-v9.sqlite"), { readOnly: true });
  assert.equal(Number(backup.prepare("PRAGMA user_version").get().user_version), 8);
  backup.close();
  const first = snapshot(store);
  // Existing conversations: codex, migrated, model and effort unknown; nothing else about them changes.
  for (const conversation of first.conversations) {
    const old = original.conversations.find((row) => row.id === conversation.id);
    assert.deepEqual({ episode: conversation.episode_id, name: conversation.name, thread: conversation.thread_id }, { episode: old.episode_id, name: old.name, thread: old.thread_id });
    assert.deepEqual({ harness: conversation.harness, model: conversation.model, effort: conversation.effort, source: conversation.settings_source, revision: conversation.settings_revision, updated: conversation.settings_updated_at },
      { harness: "codex", model: null, effort: null, source: "migrated", revision: 1, updated: null });
  }
  // The conversation with a thread gets a migrated segment whose id is the conversation id (session folders stay valid).
  const threaded = original.conversations.find((row) => row.thread_id);
  assert.deepEqual(first.segments.map(({ id, conversation_id, harness, native_session_id, reason, previous_segment_id, created_at, ended_at }) => ({ id, conversation_id, harness, native_session_id, reason, previous_segment_id, created_at, ended_at })),
    [{ id: threaded.id, conversation_id: threaded.id, harness: "codex", native_session_id: threaded.thread_id, reason: "migrated", previous_segment_id: null, created_at: threaded.created_at, ended_at: null }]);
  assert.equal(first.conversations.find((row) => row.id === threaded.id).active_segment_id, threaded.id);
  assert.equal(first.conversations.find((row) => row.id !== threaded.id).active_segment_id, null, "no thread, no segment until first send");
  // Messages and events are preserved; messages gain their origin.
  assert.deepEqual(first.messages.map(({ origin, ...rest }) => rest), original.messages);
  assert.deepEqual(first.messages.map((row) => [row.role, row.origin]), original.messages.map((row) => [row.role, row.role === "user" ? "typed" : "agent"]));
  assert.deepEqual(first.events, original.events);
  assert.deepEqual(first.runs, [], "no production_runs backfill");
  assert.ok(first.jobColumns.includes("request_id"));
  assert.deepEqual(store.db.prepare("PRAGMA foreign_key_check").all(), []);
  store.close();
  // Reopen (no-op) and force the v9 step again: identical.
  store = new Store(root, { legacyWorkspace: false, startup: false });
  assert.deepEqual(snapshot(store), first);
  store.db.exec("PRAGMA user_version=8");
  store.close();
  store = new Store(root, { legacyWorkspace: false, startup: false });
  t.after(() => store.close());
  assert.deepEqual(snapshot(store), first);
});

test("a v5 database (pre-channel conversations) migrates through v9 to the current schema", (t) => {
  const root = fixtureRoot(t, "v5-conversations.sqlite");
  const before = new DatabaseSync(path.join(root, "storybench.sqlite"), { readOnly: true });
  assert.equal(Number(before.prepare("PRAGMA user_version").get().user_version), 5);
  const threads = before.prepare("SELECT id,thread_id FROM conversations WHERE thread_id IS NOT NULL").all().map((row) => ({ ...row }));
  const messageCount = before.prepare("SELECT COUNT(*) n FROM conversation_messages").get().n;
  before.close();
  const store = new Store(root, { startup: false });
  t.after(() => store.close());
  assert.equal(Number(store.db.prepare("PRAGMA user_version").get().user_version), SCHEMA_VERSION);
  assert.deepEqual(rows(store, "SELECT version FROM migration_log ORDER BY version").map((row) => row.version), Array.from({ length: SCHEMA_VERSION - 4 }, (_, i) => i + 5));
  assert.ok(existsSync(path.join(root, "storybench.pre-v6.sqlite")));
  assert.equal(store.listChannels().length, 1);
  assert.deepEqual(rows(store, "SELECT id,native_session_id FROM conversation_segments").map((row) => ({ id: row.id, thread_id: row.native_session_id })), threads);
  assert.equal(store.db.prepare("SELECT COUNT(*) n FROM conversation_messages WHERE origin IS NOT NULL").get().n, messageCount);
  assert.deepEqual(store.db.prepare("PRAGMA foreign_key_check").all(), []);
});

test("a fresh database gets the tables before any chat service runs, and the chat code still works on v9", async (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "storybench-v9-fresh-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const store = new Store(root);
  t.after(() => store.close());
  for (const table of ["conversations", "conversation_messages", "conversation_events", "conversation_segments", "production_runs"]) assert.ok(store.tableExists(table), table);
  const episode = store.createEpisode({ title: "Fresh" });
  const chat = createChatService({ store, renders: {} });
  t.after(() => chat.close());
  const conversation = chat.create(episode.id, { name: "New" });
  assert.deepEqual((({ harness, settingsSource, model }) => ({ harness, settingsSource, model }))(store.getConversation(conversation.id)), { harness: "codex", settingsSource: "default", model: null });
});

// A v9 store with one episode, two conversations and a user message in the first.
function world(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), "storybench-v9-api-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const store = new Store(root);
  t.after(() => store.close());
  const episode = store.createEpisode({ title: "Episode" });
  const other = store.createEpisode({ title: "Other" });
  store.updateEpisode(episode.id, episode.revision, { cards: [{ id: "card-1", title: "Opening", type: "Video" }] });
  const chat = createChatService({ store, renders: {} });
  t.after(() => chat.close());
  const conversation = chat.create(episode.id, { name: "Main" });
  const second = chat.create(episode.id, { name: "Second" });
  const foreign = chat.create(other.id, { name: "Elsewhere" });
  const stamp = new Date().toISOString();
  const message = (conversationId, role, origin) => Number(store.db.prepare("INSERT INTO conversation_messages(conversation_id,role,text,state,created_at,updated_at,origin) VALUES(?,?,?,?,?,?,?)")
    .run(conversationId, role, "text", "completed", stamp, stamp, origin).lastInsertRowid);
  return { root, store, episode, other, conversation, second, foreign, message, userMessage: message(conversation.id, "user", "button") };
}

test("client_request_id makes a repeated submission return the existing request; it is scoped to one conversation", (t) => {
  const w = world(t);
  const first = w.store.createProductionRun({ conversationId: w.conversation.id, kind: "draft", origin: "button", clientRequestId: "click-1", originatingMessageId: w.userMessage, harness: "codex", modelSelected: "gpt-6-astra" });
  assert.equal(first.created, true);
  assert.match(first.run.id, /^request_/);
  assert.deepEqual({ kind: first.run.kind, origin: first.run.origin, episodeId: first.run.episodeId, state: first.run.state, finalIntent: first.run.finalIntent }, { kind: "draft", origin: "button", episodeId: w.episode.id, state: "starting", finalIntent: "none" });
  const again = w.store.createProductionRun({ conversationId: w.conversation.id, kind: "final", clientRequestId: "click-1", harness: "claude" });
  assert.deepEqual({ created: again.created, id: again.run.id, kind: again.run.kind }, { created: false, id: first.run.id, kind: "draft" }, "the first submission wins; nothing new starts");
  assert.equal(w.store.getRunByClientRequestId(w.conversation.id, "click-1").id, first.run.id);
  assert.equal(w.store.createProductionRun({ conversationId: w.second.id, clientRequestId: "click-1", harness: "codex" }).created, true, "another conversation may reuse the value");
  assert.equal(w.store.createProductionRun({ conversationId: w.conversation.id, harness: "codex" }).created, true, "without a client id every call is a new request");
  assert.throws(() => w.store.db.prepare("INSERT INTO production_runs(id,conversation_id,episode_id,kind,origin,client_request_id,harness,state,started_at,updated_at) VALUES('dup',?,?,'chat','typed','click-1','codex','starting','t','t')")
    .run(w.conversation.id, w.episode.id), /UNIQUE/, "the database enforces it too");
  // Validation of related identities.
  assert.throws(() => w.store.createProductionRun({ conversationId: w.conversation.id, harness: "codex", targetCardId: "missing" }), (error) => error.statusCode === 404);
  assert.equal(w.store.createProductionRun({ conversationId: w.conversation.id, harness: "codex", kind: "card_build", targetCardId: "card-1" }).run.targetCardId, "card-1");
  assert.throws(() => w.store.createProductionRun({ conversationId: w.second.id, harness: "codex", originatingMessageId: w.userMessage }), /not in this conversation/);
  const reply = w.message(w.conversation.id, "assistant", "agent");
  assert.throws(() => w.store.createProductionRun({ conversationId: w.conversation.id, harness: "codex", originatingMessageId: reply }), /creator \(user\) message/);
  for (const bad of [{ kind: "render" }, { origin: "api" }, { harness: "gemini" }]) assert.throws(() => w.store.createProductionRun({ conversationId: w.conversation.id, harness: "codex", ...bad }));
  assert.throws(() => w.store.db.prepare("INSERT INTO conversation_messages(conversation_id,role,text,state,created_at,updated_at,origin) VALUES(?,?,?,?,?,?,?)").run(w.conversation.id, "user", "x", "completed", "t", "t", "shortcut"), /CHECK/);
});

test("final intent is bound to its request: active, then published once or ended with a reason; retry makes a successor", (t) => {
  const w = world(t);
  const { run } = w.store.createProductionRun({ conversationId: w.conversation.id, kind: "final", origin: "button", clientRequestId: "final-1", originatingMessageId: w.userMessage, harness: "codex" });
  assert.equal(run.finalIntent, "active");
  const job = w.store.saveJob({ episodeId: w.episode.id, kind: "final", outputClass: "final", state: "completed", progress: 1, revision: 1,
    outputPath: "x.mp4", snapshot: { episode: { revision: w.store.getEpisode(w.episode.id).revision }, story: { storyRevision: w.store.getStory(w.episode.id).storyRevision } }, requestId: run.id });
  assert.equal(job.requestId, run.id);
  const stray = w.store.saveJob({ episodeId: w.episode.id, kind: "final", outputClass: "final", state: "completed", progress: 1, revision: 1, outputPath: "y.mp4", snapshot: {} });
  assert.throws(() => w.store.publishFinalIntent(run.id, stray.id), /not produced by this request/);
  const published = w.store.publishFinalIntent(run.id, job.id);
  assert.deepEqual({ intent: published.finalIntent, reason: published.finalEndedReason, output: published.finalOutputJobId }, { intent: "published", reason: "published", output: job.id });
  assert.throws(() => w.store.publishFinalIntent(run.id, job.id), (error) => error.statusCode === 409, "published exactly once");
  assert.throws(() => w.store.endFinalIntent(run.id, "stopped"), (error) => error.statusCode === 409);
  w.store.updateProductionRun(run.id, { state: "completed" });
  assert.throws(() => w.store.retryProductionRun(run.id, { harness: "codex" }), /request a new Final/);
  // A stopped final ends its intent; an explicit Retry starts a successor with Final intent again.
  const stopped = w.store.createProductionRun({ conversationId: w.conversation.id, kind: "final", harness: "codex", modelSelected: "gpt-6-astra" }).run;
  assert.throws(() => w.store.retryProductionRun(stopped.id, {}), /Only a finished request/);
  const interrupted = w.store.updateProductionRun(stopped.id, { state: "interrupted" });
  assert.deepEqual({ intent: interrupted.finalIntent, reason: interrupted.finalEndedReason }, { intent: "ended", reason: "stopped" }, "Stop ends the intent in the same update");
  assert.throws(() => w.store.endFinalIntent(stopped.id, "restart"), (error) => error.statusCode === 409, "an ended intent cannot be re-ended or reopened");
  const retry = w.store.retryProductionRun(stopped.id, { clientRequestId: "retry-1" }).run;
  assert.deepEqual({ successorOf: retry.successorOf, kind: retry.kind, intent: retry.finalIntent, model: retry.modelSelected, origin: retry.origin }, { successorOf: stopped.id, kind: "final", intent: "active", model: null, origin: "button" }, "the retry uses the conversation's current selection, not the old run's model");
  assert.throws(() => w.store.endFinalIntent(retry.id, "published"), /reason must be/);
  // Ordinary requests never carry Final intent; the database refuses inconsistent states.
  const draft = w.store.createProductionRun({ conversationId: w.conversation.id, kind: "draft", harness: "codex" }).run;
  assert.equal(draft.finalIntent, "none");
  assert.throws(() => w.store.endFinalIntent(draft.id, "stopped"), (error) => error.statusCode === 409);
  assert.throws(() => w.store.db.prepare("UPDATE production_runs SET final_intent='published' WHERE id=?").run(draft.id), /CHECK/);
  assert.throws(() => w.store.db.prepare("UPDATE production_runs SET final_intent='ended',final_ended_reason='published' WHERE id=?").run(draft.id), /CHECK/);
  // State transitions and attribution.
  w.store.updateProductionRun(draft.id, { state: "running", nativeTurnId: "turn_1", modelResolved: "gpt-6-astra-2026", usage: { input: 10 } });
  const done = w.store.updateProductionRun(draft.id, { state: "completed" });
  assert.deepEqual({ state: done.state, turn: done.nativeTurnId, resolved: done.modelResolved, usage: done.usage, finished: Boolean(done.finishedAt) }, { state: "completed", turn: "turn_1", resolved: "gpt-6-astra-2026", usage: { input: 10 }, finished: true });
  assert.throws(() => w.store.updateProductionRun(draft.id, { state: "running" }), (error) => error.statusCode === 409, "terminal states are final");
});

test("typed Final declaration is idempotent and bound to the request's exact typed creator message", (t) => {
  const w = world(t);
  const typedMessage = w.message(w.conversation.id, "user", "typed");
  const request = w.store.createProductionRun({ conversationId: w.conversation.id, kind: "chat", origin: "typed",
    originatingMessageId: typedMessage, harness: "codex" }).run;
  assert.equal(request.finalIntent, "none");
  const declared = w.store.declareFinalRequest(request.id, typedMessage);
  assert.deepEqual({ kind: declared.kind, intent: declared.finalIntent, source: declared.originatingMessageId },
    { kind: "final", intent: "active", source: typedMessage });
  assert.equal(w.store.declareFinalRequest(request.id, typedMessage).finalIntent, "active", "same-request reuse returns the existing intent");
  assert.throws(() => w.store.declareFinalRequest(request.id, w.userMessage), /originating message/);
  const foreignMessage = w.message(w.foreign.id, "user", "typed");
  assert.throws(() => w.store.declareFinalRequest(request.id, foreignMessage), /originating message/);
  const draftMessage = w.message(w.second.id, "user", "typed");
  const draft = w.store.createProductionRun({ conversationId: w.second.id, kind: "draft", origin: "typed",
    originatingMessageId: draftMessage, harness: "codex" }).run;
  assert.throws(() => w.store.declareFinalRequest(draft.id, draftMessage), /ordinary typed request/);

  const buttonMessage = w.message(w.second.id, "user", "button");
  const buttonFinal = w.store.createProductionRun({ conversationId: w.second.id, kind: "final", origin: "button",
    originatingMessageId: buttonMessage, harness: "codex" }).run;
  assert.equal(w.store.declareFinalRequest(buttonFinal.id, buttonMessage).id, buttonFinal.id, "a button Final is already bound");

  const rootMessage = w.message(w.second.id, "user", "typed");
  const root = w.store.createProductionRun({ conversationId: w.second.id, kind: "chat", origin: "typed",
    originatingMessageId: rootMessage, harness: "codex" }).run;
  w.store.updateProductionRun(root.id, { state: "failed" });
  const retryMessage = w.message(w.second.id, "user", "button");
  const successor = w.store.retryProductionRun(root.id, { originatingMessageId: retryMessage, origin: "button" }).run;
  assert.throws(() => w.store.declareFinalRequest(successor.id, retryMessage), /root typed request's originating message/);
  assert.deepEqual((({ kind, finalIntent }) => ({ kind, finalIntent }))(w.store.declareFinalRequest(successor.id, rootMessage)),
    { kind: "final", finalIntent: "active" }, "an explicit Retry can cite the root typed message");
});

test("jobs link to their request within the same episode; Stop can list a request's active jobs", (t) => {
  const w = world(t);
  const { run } = w.store.createProductionRun({ conversationId: w.conversation.id, kind: "draft", harness: "codex" });
  const job = (extra = {}) => w.store.saveJob({ episodeId: w.episode.id, kind: "draft", outputClass: "draft", state: "queued", progress: 0, revision: 1, snapshot: {}, ...extra });
  const owned = job({ requestId: run.id });
  const later = job();
  assert.equal(w.store.linkJobToRequest(later.id, run.id).requestId, run.id);
  assert.deepEqual(w.store.listRequestJobs(run.id, { activeOnly: true }).map((value) => value.id).sort(), [owned.id, later.id].sort());
  w.store.saveJob({ ...w.store.getJob(owned.id), state: "running" });
  assert.equal(w.store.getJob(owned.id).requestId, run.id, "a later saveJob does not drop the link");
  const otherRun = w.store.createProductionRun({ conversationId: w.second.id, harness: "codex" }).run;
  assert.throws(() => w.store.linkJobToRequest(later.id, otherRun.id), /another request/);
  const foreignRun = w.store.createProductionRun({ conversationId: w.foreign.id, harness: "codex" }).run;
  const fresh = job();
  assert.throws(() => w.store.linkJobToRequest(fresh.id, foreignRun.id), /another episode/);
  assert.throws(() => w.store.db.prepare("UPDATE jobs SET request_id=? WHERE id=?").run(foreignRun.id, fresh.id), /within its episode/);
  assert.throws(() => w.store.saveJob({ episodeId: w.episode.id, kind: "draft", outputClass: "draft", state: "queued", revision: 1, snapshot: {}, requestId: foreignRun.id }), /another episode/);
});

test("FK and cascade choices: deleting a conversation removes its segments, requests and messages; jobs keep history", (t) => {
  const w = world(t);
  const segment = w.store.createSegment({ conversationId: w.conversation.id, harness: "codex", reason: "initial" });
  const otherSegment = w.store.createSegment({ conversationId: w.second.id, harness: "claude", reason: "initial" });
  assert.throws(() => w.store.createSegment({ conversationId: w.conversation.id, harness: "codex", reason: "harness-return", previousSegmentId: otherSegment.id }), /another conversation/);
  const { run } = w.store.createProductionRun({ conversationId: w.conversation.id, kind: "draft", harness: "codex", segmentId: segment.id, originatingMessageId: w.userMessage });
  const job = w.store.saveJob({ episodeId: w.episode.id, kind: "draft", outputClass: "draft", state: "completed", progress: 1, revision: 1, outputPath: "d.mp4", snapshot: {}, requestId: run.id });
  // Scope triggers: a run cannot point at another conversation's segment, message or episode.
  assert.throws(() => w.store.db.prepare("INSERT INTO production_runs(id,conversation_id,episode_id,segment_id,harness,started_at,updated_at) VALUES('x',?,?,?,'codex','t','t')").run(w.conversation.id, w.episode.id, otherSegment.id), /another conversation/);
  assert.throws(() => w.store.db.prepare("INSERT INTO production_runs(id,conversation_id,episode_id,harness,started_at,updated_at) VALUES('y',?,?,'codex','t','t')").run(w.conversation.id, w.other.id), /another conversation or episode/);
  assert.throws(() => w.store.db.prepare("UPDATE conversations SET active_segment_id=? WHERE id=?").run(otherSegment.id, w.conversation.id), /another conversation/);
  w.store.db.prepare("DELETE FROM conversations WHERE id=?").run(w.conversation.id);
  assert.equal(w.store.getSegment(segment.id), null);
  assert.equal(w.store.getProductionRun(run.id), null);
  assert.equal(w.store.db.prepare("SELECT COUNT(*) n FROM conversation_messages WHERE conversation_id=?").get(w.conversation.id).n, 0);
  assert.deepEqual({ exists: Boolean(w.store.getJob(job.id)), requestId: w.store.getJob(job.id).requestId }, { exists: true, requestId: null }, "job history survives; its request link is cleared");
  assert.deepEqual(w.store.db.prepare("PRAGMA foreign_key_check").all(), []);
});

test("segments: a new segment ends the previous one and becomes active; native sessions are unique and set once", (t) => {
  const w = world(t);
  const first = w.store.createSegment({ conversationId: w.conversation.id, harness: "codex", reason: "initial" });
  assert.equal(w.store.getActiveSegment(w.conversation.id).id, first.id);
  w.store.setSegmentNativeSession(first.id, "thread_abc");
  assert.equal(w.store.setSegmentNativeSession(first.id, "thread_abc").nativeSessionId, "thread_abc", "setting the same value again is a no-op");
  assert.throws(() => w.store.setSegmentNativeSession(first.id, "thread_other"), (error) => error.statusCode === 409);
  const switched = w.store.createSegment({ conversationId: w.conversation.id, harness: "claude", reason: "harness-switch", firstMessageId: w.userMessage, seedIncludedMessages: 12, seedOmittedMessages: 3 });
  assert.deepEqual({ previous: switched.previousSegmentId, native: switched.nativeSessionId, seed: [switched.seedIncludedMessages, switched.seedOmittedMessages] }, { previous: first.id, native: null, seed: [12, 3] });
  assert.ok(w.store.getSegment(first.id).endedAt);
  assert.equal(w.store.getConversation(w.conversation.id).activeSegmentId, switched.id);
  const elsewhere = w.store.createSegment({ conversationId: w.second.id, harness: "codex", reason: "initial" });
  assert.throws(() => w.store.setSegmentNativeSession(elsewhere.id, "thread_abc"), /another segment/, "a native session belongs to exactly one segment");
  assert.throws(() => w.store.createSegment({ conversationId: w.conversation.id, harness: "codex", reason: "because" }), /reason must be/);
  assert.equal(w.store.updateSegmentSeed(switched.id, { seedOmittedMessages: 4 }).seedOmittedMessages, 4);
  assert.deepEqual(w.store.listSegments(w.conversation.id).map((segment) => segment.id), [first.id, switched.id]);
});

test("conversation settings: explicit choices are revisioned; the latest explicit choice seeds new conversations", (t) => {
  const w = world(t);
  assert.equal(w.store.lastExplicitSettings(), null);
  const updated = w.store.updateConversationSettings(w.conversation.id, 1, { harness: "claude", model: "opus", effort: "high" });
  assert.deepEqual({ harness: updated.harness, model: updated.model, effort: updated.effort, source: updated.settingsSource, revision: updated.settingsRevision }, { harness: "claude", model: "opus", effort: "high", source: "explicit", revision: 2 });
  assert.throws(() => w.store.updateConversationSettings(w.conversation.id, 1, { harness: "codex" }), (error) => error.statusCode === 409);
  assert.throws(() => w.store.updateConversationSettings(w.conversation.id, 2, { harness: "gemini" }), /harness must be/);
  assert.throws(() => w.store.updateConversationSettings(w.conversation.id, 2, { harness: "codex", model: "x\ny" }), /single-line/);
  assert.deepEqual(w.store.lastExplicitSettings(), { harness: "claude", model: "opus", effort: "high" });
  assert.equal(w.store.getConversation(w.second.id).settingsSource, "default", "other conversations are untouched");
});

test("an application restart interrupts unfinished requests and ends their Final intent with reason restart", (t) => {
  const w = world(t);
  const running = w.store.createProductionRun({ conversationId: w.conversation.id, kind: "final", harness: "codex" }).run;
  w.store.updateProductionRun(running.id, { state: "running" });
  const finished = w.store.createProductionRun({ conversationId: w.conversation.id, kind: "draft", harness: "codex" }).run;
  w.store.updateProductionRun(finished.id, { state: "completed" });
  w.store.close();
  const reopened = new Store(w.root);
  t.after(() => reopened.close());
  const after = reopened.getProductionRun(running.id);
  assert.deepEqual({ state: after.state, intent: after.finalIntent, reason: after.finalEndedReason }, { state: "interrupted", intent: "ended", reason: "restart" });
  assert.equal(reopened.getProductionRun(finished.id).state, "completed");
  const offline = new Store(w.root, { startup: false });
  offline.close();
});

const liveJob = (w, runId, extra = {}) => w.store.saveJob({ episodeId: w.episode.id, kind: "final", outputClass: "final", state: "completed", progress: 1,
  revision: 1, outputPath: `${Math.random()}.mp4`, snapshot: { episode: { revision: w.store.getEpisode(w.episode.id).revision }, story: { storyRevision: w.store.getStory(w.episode.id).storyRevision } }, requestId: runId, ...extra });

test("review 1A: a failed Final request ends its intent at once and can never be published or given new work", (t) => {
  const w = world(t);
  const { run } = w.store.createProductionRun({ conversationId: w.conversation.id, kind: "final", harness: "codex" });
  const output = liveJob(w, run.id);
  const failed = w.store.updateProductionRun(run.id, { state: "failed", error: "render failed" });
  assert.deepEqual({ state: failed.state, intent: failed.finalIntent, reason: failed.finalEndedReason }, { state: "failed", intent: "ended", reason: "failed" });
  assert.throws(() => w.store.publishFinalIntent(run.id, output.id), /failed request cannot publish/);
  const late = w.store.saveJob({ episodeId: w.episode.id, kind: "final", outputClass: "final", state: "completed", progress: 1, revision: 1, outputPath: "late.mp4", snapshot: {} });
  assert.throws(() => w.store.linkJobToRequest(late.id, run.id), /failed request cannot take on new work/);
  assert.throws(() => liveJob(w, run.id), /failed request cannot take on new work/);
  assert.equal(w.store.getProductionRun(run.id).finalIntent, "ended");
  // The database refuses a finished request with live Final authority.
  const { run: other } = w.store.createProductionRun({ conversationId: w.second.id, kind: "final", harness: "codex" });
  assert.throws(() => w.store.db.prepare("UPDATE production_runs SET state='failed' WHERE id=?").run(other.id), /CHECK/);
  // An interruption may name its reason; anything else is refused.
  assert.equal(w.store.updateProductionRun(other.id, { state: "interrupted", finalEndReason: "cancelled" }).finalEndedReason, "cancelled");
  const { run: third } = w.store.createProductionRun({ conversationId: w.second.id, kind: "final", harness: "codex" });
  assert.throws(() => w.store.updateProductionRun(third.id, { state: "interrupted", finalEndReason: "published" }), /finalEndReason must be/);
});

test("review 1B: a Final request that completes without publishing ends as unfulfilled and can be retried", (t) => {
  const w = world(t);
  const { run } = w.store.createProductionRun({ conversationId: w.conversation.id, kind: "final", harness: "codex" });
  w.store.updateProductionRun(run.id, { state: "running" });
  const done = w.store.updateProductionRun(run.id, { state: "completed", error: "No footage for the closing shot" });
  assert.deepEqual({ intent: done.finalIntent, reason: done.finalEndedReason }, { intent: "ended", reason: "unfulfilled" });
  const retry = w.store.retryProductionRun(run.id, {}).run;
  assert.deepEqual({ successorOf: retry.successorOf, intent: retry.finalIntent }, { successorOf: run.id, intent: "active" });
  // A published request completes normally and keeps its publication.
  w.store.updateProductionRun(retry.id, { state: "running" });
  const output = liveJob(w, retry.id);
  w.store.publishFinalIntent(retry.id, output.id);
  const finished = w.store.updateProductionRun(retry.id, { state: "completed" });
  assert.deepEqual({ intent: finished.finalIntent, reason: finished.finalEndedReason }, { intent: "published", reason: "published" });
});

test("review 2: a retry dispatches on the conversation's current harness/model/effort by default", (t) => {
  const w = world(t);
  const { run } = w.store.createProductionRun({ conversationId: w.conversation.id, kind: "draft", harness: "codex", modelSelected: "gpt-6-astra", effortSelected: "medium" });
  w.store.updateProductionRun(run.id, { state: "failed" });
  w.store.updateConversationSettings(w.conversation.id, 1, { harness: "claude", model: "opus", effort: "high" });
  const retry = w.store.retryProductionRun(run.id, {}).run;
  assert.deepEqual({ harness: retry.harness, model: retry.modelSelected, effort: retry.effortSelected }, { harness: "claude", model: "opus", effort: "high" });
  w.store.updateProductionRun(retry.id, { state: "failed" });
  const explicit = w.store.retryProductionRun(retry.id, { harness: "codex", modelSelected: null }).run;
  assert.deepEqual({ harness: explicit.harness, model: explicit.modelSelected, effort: explicit.effortSelected }, { harness: "codex", model: null, effort: "high" });
});

test("review 3: settings and segments change only while the conversation and its request-owned work are idle", (t) => {
  const w = world(t);
  const { run } = w.store.createProductionRun({ conversationId: w.conversation.id, kind: "draft", harness: "codex" });
  assert.throws(() => w.store.updateConversationSettings(w.conversation.id, 1, { harness: "claude" }), (error) => error.statusCode === 409 && error.requestId === run.id);
  assert.throws(() => w.store.createSegment({ conversationId: w.conversation.id, harness: "claude", reason: "harness-switch" }), (error) => error.statusCode === 409);
  // The request being dispatched may still start its own segment (e.g. a resume fallback).
  assert.equal(w.store.createSegment({ conversationId: w.conversation.id, harness: "codex", reason: "resume-unavailable", exceptRunId: run.id }).reason, "resume-unavailable");
  const render = w.store.saveJob({ episodeId: w.episode.id, kind: "draft", outputClass: "draft", state: "running", progress: 0.5, revision: 1, snapshot: {}, requestId: run.id });
  w.store.updateProductionRun(run.id, { state: "completed" });
  // The turn ended but its render still runs on the episode: a switch waits for it, in any conversation of the episode.
  assert.throws(() => w.store.updateConversationSettings(w.second.id, 1, { harness: "claude" }), (error) => error.statusCode === 409 && error.jobId === render.id);
  w.store.saveJob({ ...w.store.getJob(render.id), state: "completed", progress: 1, outputPath: "r.mp4" });
  assert.equal(w.store.updateConversationSettings(w.conversation.id, 1, { harness: "claude" }).harness, "claude");
  assert.equal(w.store.createSegment({ conversationId: w.conversation.id, harness: "claude", reason: "harness-switch" }).harness, "claude");
  // Another episode's work does not block this conversation.
  const { run: foreignRun } = w.store.createProductionRun({ conversationId: w.foreign.id, kind: "draft", harness: "codex" });
  assert.equal(w.store.updateConversationSettings(w.second.id, 1, { harness: "claude" }).harness, "claude");
  assert.equal(foreignRun.state, "starting");
});

test("review 4: invalid references fail as StoreErrors with meaningful statuses, not raw SQLite errors", (t) => {
  const w = world(t);
  const { run } = w.store.createProductionRun({ id: "request_fixed", conversationId: w.conversation.id, harness: "codex" });
  assert.throws(() => w.store.createProductionRun({ id: "request_fixed", conversationId: w.conversation.id, harness: "codex" }), (error) => error.statusCode === 409 && /already exists/.test(error.message));
  const foreignReply = w.message(w.second.id, "assistant", "agent");
  assert.throws(() => w.store.updateProductionRun(run.id, { assistantMessageId: foreignReply }), (error) => error.statusCode === 404);
  assert.throws(() => w.store.updateProductionRun(run.id, { assistantMessageId: 999999 }), (error) => error.statusCode === 404);
  assert.throws(() => w.store.updateProductionRun(run.id, { assistantMessageId: w.userMessage }), (error) => error.statusCode === 400 && /assistant message/.test(error.message));
  const reply = w.message(w.conversation.id, "assistant", "agent");
  assert.equal(w.store.updateProductionRun(run.id, { assistantMessageId: reply }).assistantMessageId, reply);
  assert.throws(() => w.store.updateProductionRun(run.id, { segmentId: "segment_missing" }), (error) => error.statusCode === 404);
  assert.throws(() => w.store.saveJob({ episodeId: w.episode.id, kind: "draft", outputClass: "draft", state: "queued", revision: 1, snapshot: {}, requestId: "request_missing" }),
    (error) => error.statusCode === 404 && /Production request not found/.test(error.message));
  const { run: foreignRun } = w.store.createProductionRun({ conversationId: w.foreign.id, harness: "codex" });
  assert.throws(() => w.store.saveJob({ episodeId: w.episode.id, kind: "draft", outputClass: "draft", state: "queued", revision: 1, snapshot: {}, requestId: foreignRun.id }),
    (error) => error.statusCode === 409 && /another episode/.test(error.message));
});

test("review 5: addConversationMessage derives origin from the role; a shortcut is only a user message", (t) => {
  const w = world(t);
  assert.equal(w.store.addConversationMessage({ conversationId: w.conversation.id, role: "user", text: "Make it faster" }).origin, "typed");
  const shortcut = w.store.addConversationMessage({ conversationId: w.conversation.id, role: "user", text: "Create a draft from the current story, cards and available material.", shortcut: true });
  assert.equal(shortcut.origin, "button");
  assert.equal(w.store.addConversationMessage({ conversationId: w.conversation.id, role: "assistant", text: "Done", state: "streaming", turnId: "turn_1" }).origin, "agent");
  assert.throws(() => w.store.addConversationMessage({ conversationId: w.conversation.id, role: "assistant", text: "x", shortcut: true }), /Only a user message/);
  assert.throws(() => w.store.addConversationMessage({ conversationId: w.conversation.id, role: "tool", text: "x" }), /role must be/);
  assert.throws(() => w.store.addConversationMessage({ conversationId: "conversation_missing", role: "user", text: "x" }), (error) => error.statusCode === 404);
  // The stored row carries it, and a request can originate from it.
  assert.equal(w.store.db.prepare("SELECT origin FROM conversation_messages WHERE id=?").get(shortcut.id).origin, "button");
  assert.equal(w.store.createProductionRun({ conversationId: w.conversation.id, kind: "draft", origin: "button", originatingMessageId: shortcut.id, harness: "codex" }).run.originatingMessageId, shortcut.id);
});

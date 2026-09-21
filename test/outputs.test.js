import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { JSDOM } from "jsdom";
import { Store, SCHEMA_VERSION } from "../src/store.js";
import { createApp } from "../src/server.js";
import { initDataRoot, openDataRoot } from "../src/services/data-root.js";
import { deleteDraftOutputs, isDeletableOutputPath, listDraftCleanup, moveFinalToDrafts } from "../src/services/outputs.js";
import { cleanupRowsHTML, selectedTotal, toggleSelection } from "../public/draft-cleanup.js";
import { jobsForOutputView, renderJobList } from "../public/job-status.js";

const sha = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
const seconds = (value) => new Date(Date.UTC(2026, 8, 20, 12, 0, value)).toISOString();

function workspace(t, { startup = false } = {}) {
  const base = mkdtempSync(path.join(os.tmpdir(), "storybench-outputs-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = path.join(base, "data");
  initDataRoot(root);
  let store = openDataRoot(root, { startup });
  const channel = store.createChannel("Outputs");
  const episode = store.createEpisode({ title: "Cuts", channelId: channel.id });
  const directory = store.episodeDirectory(episode.id);
  const write = (relative, bytes) => { const file = path.join(root, relative); mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, bytes); return relative; };
  const rel = (...parts) => path.relative(root, path.join(directory, ...parts));
  let clock = 0;
  const output = (id, outputClass, relative, bytes, extra = {}) => {
    if (relative && bytes != null) write(relative, bytes);
    return store.saveJob({ id, episodeId: episode.id, kind: outputClass === "legacy_draft" ? "export" : outputClass, outputClass, state: "completed", progress: 1,
      revision: 1, outputPath: relative, snapshot: { renderRevision: `render-${id}`, episode: { id: episode.id } }, createdAt: seconds(clock++), ...extra });
  };
  const sentinel = write(`channels/${channel.id}/media/source-sentinel.mp4`, "original footage bytes");
  const fixture = {
    base, root, channel, episode, write, rel,
    get store() { return store; },
    reopen(options = {}) { store.close(); store = openDataRoot(root, { startup: true, ...options }); return store; },
    sentinel, sentinelHash: sha(path.join(root, sentinel)),
    draft: output("job_draft", "draft", rel("outputs", "drafts", "draft.mp4"), "d".repeat(100)),
    legacy: output("job_legacy", "legacy_draft", write("exports/legacy-preview.mp4", "l".repeat(200)), null),
    demoted: output("job_demoted", "final", rel("outputs", "final", "demoted.mp4"), "f".repeat(300)),
    retained: output("job_final", "final", rel("outputs", "final", "kept.mp4"), "k".repeat(400)),
    registered: output("job_registered", "draft", rel("outputs", "drafts", "registered.mp4"), "r".repeat(50)),
    sharedA: output("job_shared_a", "draft", rel("outputs", "drafts", "shared.mp4"), "s".repeat(70)),
    sharedB: output("job_shared_b", "draft", rel("outputs", "drafts", "shared.mp4"), null, { createdAt: seconds(20) }),
    stuck: output("job_stuck", "draft", rel("outputs", "drafts", "stuck.mp4"), "x".repeat(60)),
    graphic: output("job_graphic", "graphic", rel("outputs", "graphics", "title.png"), "g".repeat(10)),
    active: store.saveJob({ id: "job_active", episodeId: episode.id, kind: "draft", outputClass: "draft", state: "running", progress: 0.3, revision: 1, snapshot: {} }),
    output,
  };
  // The registered output's file is also a library asset (for example reused as footage or branding).
  store.saveAsset({ channelId: channel.id, name: "registered.mp4", hash: "registered-hash", kind: "video", path: fixture.registered.outputPath, duration: 1, metadata: {} });
  fixture.demoted = store.moveFinalToDrafts({ episodeId: episode.id, outputId: "job_demoted", expectedRevision: 1, actor: "fixture" });
  t.after(() => store.close());
  return fixture;
}
const revisionOf = (store, id) => store.getJob(id).recordRevision;

test("Move to Drafts keeps the same output, bytes and provenance and only changes the designation", async (t) => {
  const f = workspace(t);
  const store = f.store;
  const episodeBefore = store.getEpisode(f.episode.id);
  const second = f.output("job_final_2", "final", f.rel("outputs", "final", "second.mp4"), "2".repeat(40));
  const file = path.join(f.root, f.retained.outputPath);
  const before = { hash: sha(file), job: store.getJob("job_final") };
  assert.throws(() => moveFinalToDrafts(store, { episodeId: f.episode.id }), (error) => error.statusCode === 409 && error.candidates.length === 2, "ambiguous target refused");
  assert.throws(() => moveFinalToDrafts(store, { episodeId: f.episode.id, outputId: "job_final", expectedRevision: 7 }), /Stale output revision/);
  assert.throws(() => moveFinalToDrafts(store, { episodeId: f.episode.id, outputId: "job_draft", expectedRevision: 1 }), /not currently a Final/);
  assert.throws(() => moveFinalToDrafts(store, { episodeId: f.episode.id, outputId: "job_graphic", expectedRevision: 1 }), (error) => error.statusCode === 404);
  const moved = moveFinalToDrafts(store, { episodeId: f.episode.id, outputId: "job_final", expectedRevision: 1, actor: "agent", requestId: "req-7" });
  for (const key of ["id", "outputPath", "outputClass", "createdAt", "revision", "kind", "state"]) assert.deepEqual(moved[key], before.job[key], key);
  assert.deepEqual(moved.snapshot, before.job.snapshot);
  assert.equal(sha(file), before.hash, "no re-encode or copy");
  assert.equal(moved.designation, "draft");
  assert.equal(moved.recordRevision, 2);
  assert.deepEqual(moved.designationHistory.map(({ revision, designation, previous, actor, requestId }) => ({ revision, designation, previous, actor, requestId })),
    [{ revision: 1, designation: "final", previous: null, actor: "render", requestId: null }, { revision: 2, designation: "draft", previous: "final", actor: "agent", requestId: "req-7" }]);
  const episodeAfter = store.getEpisode(f.episode.id);
  assert.deepEqual({ revision: episodeAfter.revision, state: episodeAfter.state, cards: episodeAfter.cards }, { revision: episodeBefore.revision, state: episodeBefore.state, cards: episodeBefore.cards }, "project state and the manual label are untouched");
  // With one final left, an agent may omit the ID; the operation targets exactly that output.
  assert.equal(moveFinalToDrafts(store, { episodeId: f.episode.id, actor: "agent" }).id, second.id);
  assert.throws(() => moveFinalToDrafts(store, { episodeId: f.episode.id }), /No completed final/);
  // An older in-memory job object cannot overwrite the designation (completed records are immutable).
  assert.throws(() => store.saveJob({ ...before.job }), (error) => error.statusCode === 409);
  assert.equal(store.getJob("job_final").designation, "draft");
  const views = jobsForOutputView(store.listJobs(f.episode.id), "final");
  assert.deepEqual(views, []);
  const dom = new JSDOM('<div id="drafts"></div>');
  renderJobList(dom.window.document.querySelector("#drafts"), jobsForOutputView(store.listJobs(f.episode.id), "draft"));
  assert.match(dom.window.document.querySelector('[data-job-id="job_final"]').textContent, /Draft \(rendered as Final\)/);
  assert.ok(dom.window.document.querySelector('[data-job-id="job_final"] video[src="/api/jobs/job_final/file"]'), "same stable file endpoint");
  assert.ok(dom.window.document.querySelector('[data-delete-output="job_final"]'));
});

test("cleanup lists only present assembled drafts, with size, designation and blocking dependencies", async (t) => {
  const f = workspace(t);
  const rows = await listDraftCleanup(f.store, f.episode.id);
  assert.deepEqual(rows.map((row) => row.id).sort(), ["job_demoted", "job_draft", "job_legacy", "job_registered", "job_shared_a", "job_shared_b", "job_stuck"].sort());
  const byId = Object.fromEntries(rows.map((row) => [row.id, row]));
  assert.equal(byId.job_draft.size, 100);
  assert.equal(byId.job_demoted.outputClass, "final");
  assert.equal(byId.job_demoted.designation, "draft");
  assert.equal(byId.job_registered.eligible, false);
  assert.match(byId.job_registered.blockers[0], /registered as library or branding media/);
  // F1: drafts sharing one file only with each other are selectable together, with a note.
  assert.deepEqual({ eligible: byId.job_shared_a.eligible, sharedWith: byId.job_shared_a.sharedWith }, { eligible: true, sharedWith: ["job_shared_b"] });
  assert.match(byId.job_shared_a.note, /Also removes the file of job_shared_b; the shared file is counted once/);
  assert.deepEqual(byId.job_shared_b.sharedWith, ["job_shared_a"]);
  const grouped = toggleSelection(rows, new Set(), "job_shared_a", true);
  assert.deepEqual([...grouped].sort(), ["job_shared_a", "job_shared_b"], "selecting one selects the drafts that share its file");
  assert.deepEqual([...toggleSelection(rows, grouped, "job_shared_b", false)], []);
  assert.match(new JSDOM(cleanupRowsHTML(rows)).window.document.querySelector('[data-cleanup-row="job_shared_a"]').textContent, /counted once/);
  const document = new JSDOM(cleanupRowsHTML(rows)).window.document;
  assert.equal(document.querySelectorAll("[data-cleanup-select]:checked").length, 0, "nothing starts selected");
  assert.equal(document.querySelector('[data-cleanup-select="job_registered"]').disabled, true);
  assert.equal(selectedTotal(rows, new Set(["job_draft", "job_shared_a", "job_shared_b"])), 170, "a shared file is counted once");
  // A queued/running job that still needs a file blocks its deletion.
  f.store.db.prepare("UPDATE jobs SET output_path=? WHERE id='job_active'").run(f.draft.outputPath);
  const blocked = (await listDraftCleanup(f.store, f.episode.id)).find((row) => row.id === "job_draft");
  assert.match(blocked.blockers.join(), /needed by an active job \(job_active\)/);
  const refused = await deleteDraftOutputs(f.store, { episodeId: f.episode.id, outputs: [{ id: "job_draft", expectedRevision: 1 }] });
  assert.equal(refused.results[0].status, "refused");
  assert.ok(existsSync(path.join(f.root, f.draft.outputPath)));
});

test("individual and bulk deletion remove only eligible files, count shared bytes once and report per output", async (t) => {
  const f = workspace(t);
  const store = f.store;
  const exists = (job) => existsSync(path.join(f.root, job.outputPath));
  const single = await deleteDraftOutputs(store, { episodeId: f.episode.id, outputs: [{ id: "job_draft", expectedRevision: 1 }] });
  assert.deepEqual(single.results, [{ id: "job_draft", status: "deleted", bytesReclaimed: 100, sharedWith: undefined }]);
  assert.equal(single.bytesReclaimed, 100);
  assert.equal(exists(f.draft), false);
  const deleted = store.getJob("job_draft");
  assert.deepEqual({ state: deleted.deletionState, bytes: deleted.deletedBytes, path: deleted.outputPath, snapshot: deleted.snapshot.renderRevision },
    { state: "deleted", bytes: 100, path: f.draft.outputPath, snapshot: "render-job_draft" }, "history is retained without the file");
  const replay = await deleteDraftOutputs(store, { episodeId: f.episode.id, outputs: [{ id: "job_draft", expectedRevision: 1 }] });
  assert.deepEqual(replay.results[0], { id: "job_draft", status: "alreadyDeleted", reason: "Already deleted", bytesReclaimed: 0 });
  assert.equal(replay.bytesReclaimed, 0);

  const failing = path.join(f.root, f.stuck.outputPath);
  const fs = { unlink: async (file) => { if (file === failing) throw Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" }); return import("node:fs/promises").then(({ unlink }) => unlink(file)); } };
  const selection = ["job_legacy", "job_demoted", "job_shared_a", "job_shared_b", "job_stuck", "job_registered", "job_final", "job_graphic", "job_active"]
    .map((id) => ({ id, expectedRevision: revisionOf(store, id) }));
  const bulk = await deleteDraftOutputs(store, { episodeId: f.episode.id, outputs: selection }, { fs });
  const status = Object.fromEntries(bulk.results.map((result) => [result.id, result.status]));
  assert.deepEqual(status, { job_legacy: "deleted", job_demoted: "deleted", job_shared_a: "deleted", job_shared_b: "deleted", job_stuck: "failed",
    job_registered: "refused", job_final: "refused", job_graphic: "refused", job_active: "refused" });
  assert.equal(bulk.bytesReclaimed, 200 + 300 + 70, "the shared file is counted once and the failed file not at all");
  assert.deepEqual(bulk.results.find((result) => result.id === "job_shared_b").sharedWith, ["job_shared_a", "job_shared_b"]);
  assert.match(bulk.results.find((result) => result.id === "job_final").reason, /designated Final/);
  assert.match(bulk.results.find((result) => result.id === "job_registered").reason, /registered/);
  assert.equal(store.getJob("job_stuck").deletionState, "present", "a failed item is retained for retry");
  assert.match(store.getJob("job_stuck").deletionNote, /EACCES/);
  for (const job of [f.retained, f.registered, f.stuck, f.graphic]) assert.equal(exists(job), true, `${job.id} file kept`);
  assert.equal(sha(path.join(f.root, f.sentinel)), f.sentinelHash, "source media untouched");
  const retry = await deleteDraftOutputs(store, { episodeId: f.episode.id, outputs: [{ id: "job_stuck", expectedRevision: revisionOf(store, "job_stuck") }] });
  assert.deepEqual({ status: retry.results[0].status, bytes: retry.bytesReclaimed }, { status: "deleted", bytes: 60 });

  // A later record that reuses a deleted output's path is never touched by a replayed request.
  const replacement = f.output("job_replacement", "draft", f.legacy.outputPath, "new bytes");
  const replayBulk = await deleteDraftOutputs(store, { episodeId: f.episode.id, outputs: selection });
  assert.ok(replayBulk.results.filter((result) => result.id !== "job_stuck").every((result) => ["alreadyDeleted", "refused"].includes(result.status)));
  assert.equal(replayBulk.bytesReclaimed, 0);
  assert.equal(readFileSync(path.join(f.root, replacement.outputPath), "utf8"), "new bytes");
  // The reused legacy path was deleted once; the new owner's file is its own.
  assert.equal(store.getJob("job_legacy").deletionState, "deleted");
});

test("a stale selection or a concurrent reclassification is refused; nothing deletes a final", async (t) => {
  const f = workspace(t);
  const store = f.store;
  const selectedAt = revisionOf(store, "job_final");
  const early = await deleteDraftOutputs(store, { episodeId: f.episode.id, outputs: [{ id: "job_final", expectedRevision: selectedAt }] });
  assert.match(early.results[0].reason, /designated Final/);
  moveFinalToDrafts(store, { episodeId: f.episode.id, outputId: "job_final", expectedRevision: selectedAt });
  const stale = await deleteDraftOutputs(store, { episodeId: f.episode.id, outputs: [{ id: "job_final", expectedRevision: selectedAt }] });
  assert.deepEqual({ status: stale.results[0].status, current: stale.results[0].currentRevision }, { status: "refused", current: selectedAt + 1 });
  assert.ok(existsSync(path.join(f.root, f.retained.outputPath)));
  // A move requested while a deletion is in flight is refused rather than racing it.
  const draftRevision = revisionOf(store, "job_draft");
  assert.equal(store.markOutputDeleting("job_draft", draftRevision), true);
  assert.equal(store.markOutputDeleting("job_draft", draftRevision), false, "a second concurrent submit cannot claim it");
  const concurrent = await deleteDraftOutputs(store, { episodeId: f.episode.id, outputs: [{ id: "job_draft", expectedRevision: draftRevision + 1 }] });
  assert.match(concurrent.results[0].reason, /already in progress/);
  const current = await deleteDraftOutputs(store, { episodeId: f.episode.id, outputs: [{ id: "job_final", expectedRevision: selectedAt + 1 }] });
  assert.equal(current.results[0].status, "deleted");
});

test("an interrupted deletion reconciles on reopen: absent files become deleted, present files return for retry", async (t) => {
  const f = workspace(t);
  // Stop abruptly after the file is removed but before the record is finalized.
  await assert.rejects(deleteDraftOutputs(f.store, { episodeId: f.episode.id, outputs: [{ id: "job_legacy", expectedRevision: 1 }] },
    { afterUnlink: () => { throw new Error("simulated crash after unlink"); } }), /simulated crash/);
  assert.equal(f.store.getJob("job_legacy").deletionState, "deleting");
  assert.equal(existsSync(path.join(f.root, f.legacy.outputPath)), false);
  assert.equal(f.store.markOutputDeleting("job_stuck", 1), true, "interrupted before the file was removed");
  const store = f.reopen();
  const legacy = store.getJob("job_legacy");
  assert.deepEqual({ state: legacy.deletionState, bytes: legacy.deletedBytes }, { state: "deleted", bytes: null }, "no reclaimed bytes are claimed");
  assert.match(legacy.deletionNote, /already absent/);
  const stuck = store.getJob("job_stuck");
  assert.equal(stuck.deletionState, "present");
  assert.match(stuck.deletionNote, /interrupted/);
  const retry = await deleteDraftOutputs(store, { episodeId: f.episode.id, outputs: [{ id: "job_stuck", expectedRevision: stuck.recordRevision }] });
  assert.equal(retry.results[0].status, "deleted");
  const missing = f.output("job_missing", "draft", f.rel("outputs", "drafts", "never-written.mp4"), null);
  const absent = await deleteDraftOutputs(store, { episodeId: f.episode.id, outputs: [{ id: missing.id, expectedRevision: 1 }] });
  assert.deepEqual({ status: absent.results[0].status, bytes: absent.bytesReclaimed }, { status: "absent", bytes: 0 });
});

test("a read-only directory is an undeletable fixture: the output is retained and the report is truthful", { skip: process.getuid?.() === 0 }, async (t) => {
  const f = workspace(t);
  const directory = path.dirname(path.join(f.root, f.draft.outputPath));
  const { chmodSync } = await import("node:fs");
  chmodSync(directory, 0o555);
  let report;
  try { report = await deleteDraftOutputs(f.store, { episodeId: f.episode.id, outputs: [{ id: "job_draft", expectedRevision: 1 }] }); }
  finally { chmodSync(directory, 0o755); }
  assert.equal(report.results[0].status, "failed");
  assert.equal(report.bytesReclaimed, 0);
  assert.equal(f.store.getJob("job_draft").deletionState, "present");
  assert.ok(existsSync(path.join(f.root, f.draft.outputPath)));
});

test("HTTP routes move, list and delete, and a deleted output has no playback link", async (t) => {
  const f = workspace(t);
  f.store.close();
  const app = await createApp({ dataRoot: f.root });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}/api/episodes/${f.episode.id}`;
  const post = (url, body) => fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const moved = await post(`${base}/outputs/job_final/move-to-drafts`, { expectedRevision: 1 });
  assert.equal((await moved.json()).designation, "draft");
  assert.equal((await post(`${base}/outputs/job_final/move-to-drafts`, { expectedRevision: 1 })).status, 409);
  assert.equal((await fetch(`http://127.0.0.1:${app.server.address().port}/api/jobs/job_final/file`)).status, 200, "moved final keeps its file endpoint");
  const rows = await (await fetch(`${base}/outputs/cleanup`)).json();
  assert.ok(rows.some((row) => row.id === "job_final"));
  const report = await (await post(`${base}/outputs/delete`, { outputs: [{ id: "job_final", expectedRevision: 2 }] })).json();
  assert.equal(report.results[0].status, "deleted");
  assert.equal((await fetch(`http://127.0.0.1:${app.server.address().port}/api/jobs/job_final/file`)).status, 410);
  assert.equal((await post(`${base}/outputs/delete`, { outputs: [] })).status, 400);
  const state = await (await fetch(`http://127.0.0.1:${app.server.address().port}/api/state?channel=${f.channel.id}`)).json();
  assert.equal(state.jobs.find((job) => job.id === "job_final").deletionState, "deleted");
});

test("schema 8 migrates outputs from schema 7 repeatably with designation defaulted from the output class", (t) => {
  const f = workspace(t);
  const root = f.root;
  // Rebuild a schema-7 database: drop every schema-8 addition.
  const db = f.store.db;
  db.exec(`DROP TRIGGER jobs_initial_designation; DROP TABLE output_designations; DELETE FROM migration_log WHERE version=8;`);
  for (const column of ["designation", "record_revision", "deletion_state", "deletion_started_at", "deleted_at", "deleted_bytes", "deletion_note", "sidecar_paths"])
    db.exec(`ALTER TABLE jobs DROP COLUMN ${column}`);
  db.exec("PRAGMA user_version=7");
  const before = db.prepare("SELECT id,episode_id,kind,state,output_path,output_class,snapshot,created_at FROM jobs ORDER BY id").all().map((row) => ({ ...row }));
  const hashes = Object.fromEntries(before.filter((row) => row.output_path && existsSync(path.join(root, row.output_path))).map((row) => [row.id, sha(path.join(root, row.output_path))]));
  const snapshot = (store) => ({
    jobs: store.db.prepare("SELECT id,episode_id,kind,state,output_path,output_class,snapshot,created_at FROM jobs ORDER BY id").all().map((row) => ({ ...row })),
    designations: store.db.prepare("SELECT id,designation,record_revision,deletion_state FROM jobs ORDER BY id").all().map((row) => ({ ...row })),
    history: store.db.prepare("SELECT job_id,revision,designation,actor FROM output_designations ORDER BY job_id").all().map((row) => ({ ...row })),
  });
  let store = f.reopen({ startup: false });
  assert.equal(Number(store.db.prepare("PRAGMA user_version").get().user_version), SCHEMA_VERSION);
  assert.equal(SCHEMA_VERSION, 8);
  assert.ok(existsSync(path.join(root, "storybench.pre-v8.sqlite")));
  const backup = new DatabaseSync(path.join(root, "storybench.pre-v8.sqlite"), { readOnly: true });
  assert.equal(Number(backup.prepare("PRAGMA user_version").get().user_version), 7);
  backup.close();
  const first = snapshot(store);
  assert.deepEqual(first.jobs, before, "IDs, class, snapshot, paths and times preserved");
  const designation = Object.fromEntries(first.designations.map((row) => [row.id, row.designation]));
  assert.deepEqual(designation, { job_active: "draft", job_demoted: "final", job_draft: "draft", job_final: "final", job_graphic: null, job_legacy: "draft",
    job_registered: "draft", job_shared_a: "draft", job_shared_b: "draft", job_stuck: "draft" });
  assert.ok(first.designations.every((row) => row.record_revision === 1 && row.deletion_state === "present"));
  assert.ok(first.history.every((row) => row.actor === "migration" && row.revision === 1));
  for (const [id, hash] of Object.entries(hashes)) assert.equal(sha(path.join(root, before.find((row) => row.id === id).output_path)), hash);
  store.db.exec("PRAGMA user_version=7");
  store = f.reopen({ startup: false });
  assert.deepEqual(snapshot(store), first, "a second run changes nothing");
  // Later designation changes survive a forced re-run of the step.
  store.moveFinalToDrafts({ episodeId: f.episode.id, outputId: "job_demoted", expectedRevision: 1 });
  store.db.exec("PRAGMA user_version=7");
  store = f.reopen({ startup: false });
  assert.equal(store.getJob("job_demoted").designation, "draft");
  assert.equal(store.getJob("job_demoted").recordRevision, 2);
});

test("F1: a file shared with a retained non-draft owner stays blocked even when shared with a listed draft", async (t) => {
  const f = workspace(t);
  // job_shared_b's file is now also the file of a final: the drafts may not remove it.
  f.output("job_final_shared", "final", f.sharedA.outputPath, null);
  const rows = Object.fromEntries((await listDraftCleanup(f.store, f.episode.id)).map((row) => [row.id, row]));
  assert.equal(rows.job_shared_a.eligible, false);
  assert.match(rows.job_shared_a.blockers.join(), /job_final_shared/);
  assert.deepEqual(rows.job_shared_a.sharedWith, ["job_shared_b"]);
});

test("F2: if a sibling sharing the file changes before marking, the whole group is kept and released for retry", async (t) => {
  const f = workspace(t);
  const store = f.store;
  const file = path.join(f.root, f.sharedA.outputPath);
  const report = await deleteDraftOutputs(store, { episodeId: f.episode.id, outputs: [{ id: "job_shared_a", expectedRevision: 1 }, { id: "job_shared_b", expectedRevision: 1 }] },
    { beforeMark: () => { store.db.prepare("UPDATE jobs SET record_revision=record_revision+1 WHERE id='job_shared_b'").run(); } });
  const status = Object.fromEntries(report.results.map((result) => [result.id, result]));
  assert.equal(status.job_shared_b.status, "refused");
  assert.equal(status.job_shared_a.status, "refused");
  assert.match(status.job_shared_a.reason, /shared with a retained output \(job_shared_b\)/);
  assert.equal(report.bytesReclaimed, 0);
  assert.ok(existsSync(file), "the shared file is preserved");
  assert.deepEqual([store.getJob("job_shared_a").deletionState, store.getJob("job_shared_b").deletionState], ["present", "present"]);
  const retry = await deleteDraftOutputs(store, { episodeId: f.episode.id, outputs: [{ id: "job_shared_a", expectedRevision: revisionOf(store, "job_shared_a") }, { id: "job_shared_b", expectedRevision: revisionOf(store, "job_shared_b") }] });
  assert.deepEqual(retry.results.map((result) => result.status), ["deleted", "deleted"]);
  assert.equal(retry.bytesReclaimed, 70);
});

test("F3: only files in managed output locations of the record's own episode can be deleted", async (t) => {
  const f = workspace(t);
  const store = f.store;
  const other = store.createEpisode({ title: "Other", channelId: f.channel.id });
  const otherDraft = f.write(path.relative(f.root, path.join(store.episodeOutputDirectory(other.id, "drafts"), "theirs.mp4")), "theirs");
  const legacyEpisode = `episodes/${f.episode.id}/final/old-final.mp4`;
  f.write(legacyEpisode, "legacy final dir, now a draft");
  f.output("job_media", "draft", f.sentinel, null);
  f.output("job_foreign", "draft", otherDraft, null);
  f.output("job_graphics_dir", "draft", f.write(f.rel("outputs", "graphics", "g.mp4"), "g"), null);
  f.output("job_legacy_final_dir", "draft", legacyEpisode, null);
  const job = store.getJob("job_draft");
  assert.equal(isDeletableOutputPath(f.draft.outputPath, job), true);
  assert.equal(isDeletableOutputPath(f.retained.outputPath, job), true, "final/ is a managed root; designation decides");
  assert.equal(isDeletableOutputPath("exports/legacy-preview.mp4", job), true);
  assert.equal(isDeletableOutputPath(legacyEpisode, job), true);
  for (const outside of [f.sentinel, otherDraft, f.rel("outputs", "graphics", "g.mp4"), f.rel("work", "x.mp4"), "media/abc", "storybench.sqlite", `episodes/${f.episode.id}/reference/r.mp4`])
    assert.equal(isDeletableOutputPath(outside, job), false, outside);
  const rows = Object.fromEntries((await listDraftCleanup(store, f.episode.id)).map((row) => [row.id, row]));
  for (const id of ["job_media", "job_foreign", "job_graphics_dir"]) {
    assert.equal(rows[id].eligible, false, id);
    assert.match(rows[id].blockers.join(), /not in a managed output location/);
  }
  const report = await deleteDraftOutputs(store, { episodeId: f.episode.id, outputs: ["job_media", "job_foreign", "job_graphics_dir", "job_legacy_final_dir"].map((id) => ({ id, expectedRevision: 1 })) });
  assert.deepEqual(Object.fromEntries(report.results.map((result) => [result.id, result.status])),
    { job_media: "refused", job_foreign: "refused", job_graphics_dir: "refused", job_legacy_final_dir: "deleted" });
  assert.equal(sha(path.join(f.root, f.sentinel)), f.sentinelHash, "source media untouched");
  assert.ok(existsSync(path.join(f.root, otherDraft)));
  assert.equal(existsSync(path.join(f.root, legacyEpisode)), false);
});

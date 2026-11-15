import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store, SCHEMA_VERSION, RESEARCH_LIMITS, validateResearch } from "../src/store.js";
import { deleteDraftOutputs } from "../src/services/outputs.js";

function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), "storybench-research-"));
  let store = new Store(root, { legacyWorkspace: false, startup: false });
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
  const a = store.createChannel("A"), b = store.createChannel("B");
  return {
    root, a, b, get store() { return store; },
    reopen(options = {}) { store.close(); store = new Store(root, { legacyWorkspace: false, startup: false, ...options }); return store; },
  };
}
const content = (summary = "# Findings\n\nFull **Markdown**: é 🦉", links = [{ url: "https://example.com/source?x=1#finding", title: "Source", note: "Supports the claim" }]) => ({ summary, links });
const count = (store) => store.db.prepare("SELECT count(*) n FROM production_research").get().n;
const row = (store, episodeId) => ({ ...store.db.prepare("SELECT * FROM production_research WHERE episode_id=?").get(episodeId) });
function legacyV16(f) {
  // Remove this additive slice to recreate the pre-research schema, retaining deck/video data.
  f.store.db.exec("DROP TABLE production_research; DELETE FROM migration_log WHERE version=17; PRAGMA user_version=16");
}

test("schema 16 deck/video records migrate atomically, back up, reopen and repeat without replacing research", (t) => {
  const f = fixture(t), s = f.store;
  const video = s.createEpisode({ channelId: f.a.id }), deck = s.createEpisode({ channelId: f.b.id, kind: "deck" });
  const before = [video, deck].map((p) => ({ episode: s.getEpisode(p.id), story: s.getStory(p.id), history: s.listEpisodeHistory(p.id) }));
  legacyV16(f);
  let migrated = f.reopen();
  assert.equal(migrated.dataRootIdentity().schemaVersion, SCHEMA_VERSION);
  assert.equal(count(migrated), 2);
  for (const [i, p] of [video, deck].entries()) {
    assert.deepEqual(migrated.getResearch(p.id), { episodeId: p.id, researchRevision: 1, summary: "", links: [], updatedAt: p.updatedAt, actor: null });
    assert.deepEqual({ episode: migrated.getEpisode(p.id), story: migrated.getStory(p.id), history: migrated.listEpisodeHistory(p.id) }, before[i]);
  }
  const backupPath = path.join(f.root, "storybench.pre-v17.sqlite"), backupBytes = readFileSync(backupPath);
  const backup = new DatabaseSync(backupPath, { readOnly: true });
  try {
    assert.equal(backup.prepare("PRAGMA user_version").get().user_version, 16);
    assert.equal(backup.prepare("SELECT count(*) n FROM episodes").get().n, 2);
    assert.equal(backup.prepare("SELECT 1 FROM sqlite_master WHERE name='production_research'").get(), undefined);
    assert.equal(backup.prepare("PRAGMA quick_check").get().quick_check, "ok");
  } finally { backup.close(); }
  const saved = migrated.saveResearch(deck.id, 1, content(), "agent");
  migrated.db.exec("PRAGMA user_version=16");
  migrated = f.reopen();
  assert.deepEqual(migrated.getResearch(deck.id), saved);
  assert.equal(count(migrated), 2);
  assert.deepEqual(readFileSync(backupPath), backupBytes, "repeat migration keeps original backup");
  assert.deepEqual(f.reopen().getResearch(deck.id), saved);
  assert.deepEqual(f.store.db.prepare("PRAGMA foreign_key_check").all(), []);
  const savedBackup = path.join(f.root, "saved.sqlite");
  f.store.backupDatabase(savedBackup);
  const copy = new DatabaseSync(savedBackup, { readOnly: true });
  try { assert.deepEqual({ ...copy.prepare("SELECT * FROM production_research WHERE episode_id=?").get(deck.id) }, row(f.store, deck.id)); }
  finally { copy.close(); }
});

test("a failed migration rolls back table/backfill/version and retries using the preserved backup", (t) => {
  const f = fixture(t);
  const p = f.store.createEpisode({ channelId: f.a.id, kind: "deck" });
  legacyV16(f);
  f.store.db.exec(`CREATE TRIGGER fail_research_migration BEFORE INSERT ON migration_log WHEN NEW.version=17
    BEGIN SELECT RAISE(ABORT,'injected migration failure'); END`);
  assert.throws(() => f.reopen(), /injected migration failure/);
  const raw = new DatabaseSync(path.join(f.root, "storybench.sqlite"));
  try {
    assert.equal(raw.prepare("PRAGMA user_version").get().user_version, 16);
    assert.equal(raw.prepare("SELECT 1 FROM sqlite_master WHERE name='production_research'").get(), undefined);
    assert.equal(raw.prepare("SELECT 1 FROM migration_log WHERE version=17").get(), undefined);
    raw.exec("DROP TRIGGER fail_research_migration");
  } finally { raw.close(); }
  assert.ok(existsSync(path.join(f.root, "storybench.pre-v17.sqlite")));
  assert.equal(f.reopen().getResearch(p.id).summary, "");
});

test("complete saves persist independent revisions, actor/time and stable ordered link IDs for both kinds", (t) => {
  const f = fixture(t);
  for (const kind of ["video", "deck"]) {
    const s = f.store, p = s.createEpisode({ channelId: f.a.id, kind });
    const episodeBefore = s.getEpisode(p.id), storyBefore = s.getStory(p.id), historyBefore = s.listEpisodeHistory(p.id);
    s.db.prepare("UPDATE production_research SET updated_at=? WHERE episode_id=?").run("2000-01-01T00:00:00.000Z", p.id);
    const start = new Date().toISOString();
    const first = s.saveResearch(p.id, 1, content(undefined, [...content().links, { id: "stable_two", url: "http://example.org/", title: "", note: "" }]));
    assert.equal(first.researchRevision, 2); assert.equal(first.actor, "human");
    assert.ok(first.updatedAt >= start && first.updatedAt <= new Date().toISOString());
    assert.match(first.links[0].id, /^research_link_/);
    assert.deepEqual(first.links[1], { id: "stable_two", url: "http://example.org/", title: "", note: "" });
    const editedLinks = [first.links[1], { ...first.links[0], title: "Edited source", note: "Revised relevance" }];
    const second = s.saveResearch(p.id, 2, content("New summary", editedLinks), "agent");
    assert.equal(second.actor, "agent"); assert.equal(second.researchRevision, 3);
    assert.deepEqual(second.links, editedLinks);
    assert.deepEqual(s.getEpisode(p.id), episodeBefore);
    assert.deepEqual(s.getStory(p.id), storyBefore);
    assert.deepEqual(s.listEpisodeHistory(p.id), historyBefore);
    assert.deepEqual(f.reopen().getResearch(p.id), second);
    const removed = f.store.saveResearch(p.id, 3, content("", [second.links[1]]));
    assert.equal(removed.links[0].id, first.links[0].id);
    const empty = f.store.saveResearch(p.id, 4, content("", []));
    assert.deepEqual({ summary: empty.summary, links: empty.links }, { summary: "", links: [] });
    assert.deepEqual(f.reopen().getResearch(p.id), empty);
    const summaryOnly = f.store.saveResearch(p.id, 5, content("Only summary", []));
    assert.equal(summaryOnly.summary, "Only summary");
  }
});

test("shared validation rejects malformed records, URLs, duplicate IDs and actors without changing any saved bytes", (t) => {
  const f = fixture(t), s = f.store, p = s.createEpisode({ channelId: f.a.id });
  const saved = s.saveResearch(p.id, 1, content()), before = row(s, p.id);
  const invalid = [null, [], {}, { summary: null, links: [] }, { summary: 1, links: [] }, { summary: "", links: {} },
    ...[null, [], "x", {}, { url: 3 }, { id: null, url: "https://example.com" }, { id: "", url: "https://example.com" },
      { id: "../escape", url: "https://example.com" }, { url: "https://example.com", title: null }, { url: "https://example.com", note: {} }].map((link) => content("", [link])),
    ...["javascript:alert(1)", "data:text/html,x", "file:///tmp/x", "ftp://example.com", "/relative", "//example.com", "https:", "https:example.com", "https://", "https://a b.com", "https://example.com/\npath"].map((url) => content("", [{ url }])),
    content("", [{ id: "same", url: "https://a.com" }, { id: "same", url: "https://b.com" }]), content("", new Array(1)),
  ];
  for (const value of invalid) {
    assert.throws(() => validateResearch(value), (e) => e.statusCode === 400);
    assert.throws(() => s.saveResearch(p.id, saved.researchRevision, value), (e) => e.statusCode === 400);
    assert.deepEqual(row(s, p.id), before);
    assert.equal(s.db.isTransaction, false);
  }
  for (const actor of [null, "model", 5, {}]) {
    assert.throws(() => s.saveResearch(p.id, 2, content(), actor), /actor/);
    assert.deepEqual(row(s, p.id), before);
  }
});

test("UTF-8 field, count and total JSON limits reject atomically and exact field boundaries round-trip", (t) => {
  const f = fixture(t), s = f.store, p = s.createEpisode({ channelId: f.a.id }), before = row(s, p.id), limits = RESEARCH_LIMITS;
  const urlPrefix = "https://example.com/";
  const tooLarge = [
    content("é".repeat(limits.summaryBytes / 2 + 1), []),
    content("", Array.from({ length: limits.maxLinks + 1 }, () => ({ url: "https://example.com" }))),
    ...[["id", "a".repeat(limits.linkIdBytes + 1)], ["url", urlPrefix + "x".repeat(limits.urlBytes)],
      ["title", "é".repeat(limits.titleBytes / 2 + 1)], ["note", "é".repeat(limits.noteBytes / 2 + 1)]].map(([key, value]) => content("", [{ url: urlPrefix, [key]: value }])),
    content("\u0000".repeat(limits.summaryBytes), []), // JSON escaping also counts toward the complete record limit.
  ];
  for (const value of tooLarge) {
    assert.throws(() => validateResearch(value), (e) => e.statusCode === 413 && /limit|at most/.test(e.message));
    assert.throws(() => s.saveResearch(p.id, 1, value), (e) => e.statusCode === 413);
    assert.deepEqual(row(s, p.id), before);
  }
  const boundary = content("é".repeat(limits.summaryBytes / 2), [{ id: "a".repeat(limits.linkIdBytes), url: urlPrefix + "x".repeat(limits.urlBytes - urlPrefix.length), title: "é".repeat(limits.titleBytes / 2), note: "é".repeat(limits.noteBytes / 2) }]);
  const saved = s.saveResearch(p.id, 1, boundary);
  assert.deepEqual({ summary: saved.summary, links: saved.links }, boundary);
  assert.deepEqual(f.reopen().getResearch(p.id), saved);
  assert.equal(validateResearch(content("", Array.from({ length: limits.maxLinks }, (_, i) => ({ id: `link_${i}`, url: urlPrefix })))).links.length, limits.maxLinks);
});

test("a second connection cannot overwrite a newer research revision; wrong/missing revisions are atomic conflicts", (t) => {
  const f = fixture(t), s = f.store, p = s.createEpisode({ channelId: f.a.id });
  const second = new Store(f.root, { legacyWorkspace: false, startup: false });
  t.after(() => second.close());
  const read = second.getResearch(p.id), winner = s.saveResearch(p.id, read.researchRevision, content("Winner"), "agent"), before = row(s, p.id);
  for (const revision of [read.researchRevision, undefined, "2", 2.5, null, NaN]) {
    assert.throws(() => second.saveResearch(p.id, revision, content("Loser")), (e) => e.statusCode === 409 && assert.deepEqual(e.current, winner) === undefined);
    assert.deepEqual(row(s, p.id), before);
  }
  assert.equal(second.saveResearch(p.id, winner.researchRevision, content("Reconciled")).researchRevision, 3);
});

test("archive, navigation and draft cleanup preserve research; deleting one production cascades only its research", async (t) => {
  const f = fixture(t), s = f.store;
  const a = s.createEpisode({ channelId: f.a.id }), b = s.createEpisode({ channelId: f.a.id, kind: "deck" }), c = s.createEpisode({ channelId: f.b.id });
  const saved = [a, b, c].map((p) => s.saveResearch(p.id, 1, content(p.id)));
  const outputPath = path.relative(f.root, path.join(s.episodeOutputDirectory(a.id, "drafts"), "preview.mp4"));
  writeFileSync(path.join(f.root, outputPath), "disposable draft");
  const job = s.saveJob({ episodeId: a.id, kind: "draft", outputClass: "draft", state: "completed", revision: 1, outputPath });
  assert.equal((await deleteDraftOutputs(s, { episodeId: a.id, outputs: [{ id: job.id, expectedRevision: job.recordRevision }] })).deleted, 1);
  const archived = s.updateEpisode(a.id, a.revision, { archived: true });
  s.openChannel(f.b.id); s.openChannel(f.a.id); s.listEpisodes({ channelId: f.a.id }); s.getDeck(b.id);
  assert.deepEqual(s.getResearch(archived.id), saved[0]);
  s.updateEpisode(a.id, archived.revision, { archived: false });
  assert.deepEqual(f.reopen().getResearch(a.id), saved[0]);
  // There is no single-production deletion API yet. Exercise the owning-row FK directly.
  const reopened = f.store;
  reopened.db.prepare("DELETE FROM episodes WHERE id=?").run(b.id);
  assert.equal(reopened.db.prepare("SELECT 1 FROM production_research WHERE episode_id=?").get(b.id), undefined);
  assert.throws(() => reopened.getResearch(b.id), (e) => e.statusCode === 404);
  for (const i of [0, 2]) assert.deepEqual(reopened.getResearch(saved[i].episodeId), saved[i]);
  for (const operation of [() => reopened.getResearch("missing"), () => reopened.saveResearch("missing", 1, content())])
    assert.throws(operation, (e) => e.statusCode === 404);
  assert.equal(count(reopened), 2);
});

test("channel deletion inventories research changes, blocks pending owners, resumes and purges only selected records", (t) => {
  const f = fixture(t), s = f.store;
  const a = s.createEpisode({ channelId: f.a.id }), deck = s.createEpisode({ channelId: f.a.id, kind: "deck" }), b = s.createEpisode({ channelId: f.b.id });
  const saved = [a, deck, b].map((p) => s.saveResearch(p.id, 1, content(p.id)));
  const preview = s.channelDeletion.preview([f.a.id]);
  const request = { channelIds: [f.a.id], token: preview.token, operationId: `delete_${randomUUID()}` };
  const changed = s.saveResearch(a.id, 2, content("Changed since review"));
  assert.throws(() => s.channelDeletion.accept(request), /Review them again/);
  assert.deepEqual(s.getResearch(a.id), changed);
  const reviewed = s.channelDeletion.preview([f.a.id]);
  s.saveResearch(b.id, 2, content("Unrelated change"));
  assert.equal(s.channelDeletion.preview([f.a.id]).token, reviewed.token, "retained research is outside selected inventory");
  const survivor = s.getResearch(b.id);
  s.afterChannelDeleteAccepted = () => { throw new Error("injected stop after acceptance"); };
  assert.throws(() => s.channelDeletion.accept({ ...request, token: reviewed.token }), /injected stop/);
  const pendingRow = row(s, a.id);
  for (const p of [a, deck]) {
    assert.throws(() => s.getResearch(p.id), (e) => e.statusCode === 410);
    assert.throws(() => s.saveResearch(p.id, 2, content("Forbidden")), (e) => e.statusCode === 410);
  }
  assert.deepEqual(row(s, a.id), pendingRow);
  assert.equal(count(s), saved.length);
  assert.deepEqual(s.getResearch(b.id), survivor);
  const recovered = f.reopen({ startup: true });
  assert.equal(recovered.channelDeletion.status(request.operationId).state, "completed");
  assert.equal(count(recovered), 1);
  assert.deepEqual(recovered.getResearch(b.id), survivor);
  assert.throws(() => recovered.saveResearch(a.id, changed.researchRevision, content()), (e) => e.statusCode === 404);
  assert.equal(recovered.channelDeletion.accept({ ...request, token: reviewed.token }).state, "completed");
  assert.deepEqual(recovered.db.prepare("PRAGMA foreign_key_check").all(), []);
});

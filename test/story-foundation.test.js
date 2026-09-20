import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store } from "../src/store.js";
import { createApp } from "../src/server.js";

function workspace(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), "storybench-foundation-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function legacy(root, { episodes = true } = {}) {
  const db = new DatabaseSync(path.join(root, "storybench.sqlite"));
  db.exec(`
    CREATE TABLE episodes (id TEXT PRIMARY KEY,title TEXT NOT NULL,notes TEXT NOT NULL DEFAULT '',revision INTEGER NOT NULL,cards TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE episode_history (episode_id TEXT NOT NULL,revision INTEGER NOT NULL,title TEXT NOT NULL,notes TEXT NOT NULL,cards TEXT NOT NULL,actor TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(episode_id,revision));
    CREATE TABLE assets (id TEXT PRIMARY KEY,name TEXT NOT NULL,hash TEXT NOT NULL UNIQUE,kind TEXT NOT NULL,path TEXT NOT NULL,duration REAL,width INTEGER,height INTEGER,metadata TEXT NOT NULL,thumbnail_path TEXT,created_at TEXT NOT NULL);
    CREATE TABLE jobs (id TEXT PRIMARY KEY,episode_id TEXT NOT NULL,kind TEXT NOT NULL,state TEXT NOT NULL,progress REAL NOT NULL DEFAULT 0,revision INTEGER NOT NULL,output_path TEXT,error TEXT,snapshot TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE chats (episode_id TEXT PRIMARY KEY,state TEXT NOT NULL DEFAULT 'idle',thread_id TEXT,active_turn_id TEXT,error TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE chat_messages (id INTEGER PRIMARY KEY AUTOINCREMENT,episode_id TEXT NOT NULL,role TEXT NOT NULL,text TEXT NOT NULL,state TEXT NOT NULL,turn_id TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE chat_events (episode_id TEXT NOT NULL,sequence INTEGER NOT NULL,type TEXT NOT NULL,payload TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(episode_id,sequence));
  `);
  const stamp = "2026-01-01T00:00:00.000Z";
  const cards = JSON.stringify([{ id: "legacy-card", title: "Keep", purpose: "", notes: "", missing: "", visual: null, narration: null, duration: null }]);
  if (episodes) {
    for (const id of ["episode-a", "episode-b"]) {
      db.prepare("INSERT INTO episodes VALUES(?,?,?,?,?,?,?)").run(id, `Title ${id}`, "notes", 1, cards, stamp, stamp);
      db.prepare("INSERT INTO episode_history VALUES(?,?,?,?,?,?,?)").run(id, 1, `Title ${id}`, "notes", cards, "human", stamp);
      db.prepare("INSERT INTO chats VALUES(?,?,?,?,?,?,?)").run(id, "idle", `thread-${id}`, null, null, stamp, stamp);
      db.prepare("INSERT INTO chat_events VALUES(?,?,?,?,?)").run(id, 1, "status", '{"state":"idle"}', stamp);
    }
  }
  for (const [id, kind] of [["v", "video"], ["a", "audio"], ["i", "image"]])
    db.prepare("INSERT INTO assets VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(id, id, `hash-${id}`, kind, `media/${id}`, 1, null, null, "{}", null, stamp);
  if (episodes)
    db.prepare("INSERT INTO jobs VALUES(?,?,?,?,?,?,?,?,?,?,?)").run("job-old", "episode-a", "export", "completed", 1, 1, "exports/old.mp4", null, "{}", stamp, stamp);
  db.close();
}

test("v0 migration backs up, preserves legacy state, converges after interruption, and is idempotent", (t) => {
  const root = workspace(t);
  legacy(root);
  assert.throws(() => new Store(root, { afterMigrationCommit: () => { throw new Error("stop after commit"); } }), /stop after commit/);
  const backupPath = path.join(root, "storybench.pre-v2.sqlite");
  assert.equal(existsSync(backupPath), true);
  const backup = new DatabaseSync(backupPath, { readOnly: true });
  assert.equal(backup.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
  assert.equal(backup.prepare("PRAGMA table_info(episodes)").all().some((column) => column.name === "state"), false);
  backup.close();
  const backupBytes = readFileSync(backupPath);
  let store = new Store(root);
  assert.deepEqual(store.listEpisodes().map((episode) => episode.state), ["Scaffold", "Scaffold"]);
  assert.equal(store.getEpisode("episode-a").cards[0].id, "legacy-card");
  assert.equal(store.db.prepare("SELECT thread_id FROM chats WHERE episode_id='episode-a'").get().thread_id, "thread-episode-a");
  assert.equal(store.db.prepare("SELECT name FROM chats WHERE episode_id='episode-a'").get().name, "Conversation 1");
  assert.equal(store.getJob("job-old").outputClass, "legacy_draft");
  assert.deepEqual(store.listEpisodeLibrary("episode-a").map((item) => item.category).sort(), ["B-roll", "Graphics", "Narration"]);
  assert.equal(readFileSync(path.join(root, "episodes/episode-a/story.md"), "utf8"), "");
  const counts = ["episodes", "episode_history", "episode_library", "story_history"].map((table) => store.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n);
  store.close();
  store = new Store(root);
  assert.deepEqual(["episodes", "episode_history", "episode_library", "story_history"].map((table) => store.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n), counts);
  assert.deepEqual(readFileSync(backupPath), backupBytes);
  store.close();
});

test("asset-only migration creates one discoverable Imported library episode", (t) => {
  const root = workspace(t);
  legacy(root, { episodes: false });
  const store = new Store(root);
  t.after(() => store.close());
  assert.equal(store.listEpisodes().length, 1);
  assert.equal(store.listEpisodes()[0].title, "Imported library");
  assert.equal(store.listEpisodeLibrary(store.listEpisodes()[0].id).length, 3);
});

test("story sections keep stable identities, ignore fences, and retire mappings atomically", (t) => {
  const store = new Store(workspace(t));
  t.after(() => store.close());
  let episode = store.createEpisode({ title: "Story" });
  let saved = store.saveStory(episode.id, 1, "# Overview\r\nUnicode café\r\n# Hook\r\nBeat\r\n# Sections\r\n## Same\r\nA\r\n## Same\r\nB\r\n```md\r\n## Fake\r\n```\r\n~~~\r\n## Also fake\r\n~~~");
  assert.equal(saved.sections.length, 2);
  assert.equal(saved.source.replaceAll("\r\n", "").includes("\r"), false);
  const [first, second] = saved.sections;
  episode = store.updateEpisode(episode.id, episode.revision, { cards: [
    { id: "one", title: "One", sectionId: first.id },
    { id: "two", title: "Two", sectionId: first.id },
    { id: "three", title: "Three", sectionId: second.id },
  ] });
  const reordered = `# Sections\n<!-- storybench:section ${second.id} -->\n## Renamed second\n<!-- storybench:section ${first.id} -->\n## Renamed first`;
  saved = store.saveStory(episode.id, saved.storyRevision, reordered);
  assert.deepEqual(saved.sections.map((section) => section.id), [second.id, first.id]);
  assert.deepEqual(store.getEpisode(episode.id).cards.map((card) => card.sectionId), [first.id, first.id, second.id]);
  const removed = `# Sections\n<!-- storybench:section ${second.id} -->\n## Only`;
  saved = store.saveStory(episode.id, saved.storyRevision, removed);
  assert.deepEqual(saved.mappingChanges.unassignedCardIds, ["one", "two"]);
  assert.deepEqual(store.getEpisode(episode.id).cards.map((card) => card.sectionId), [null, null, second.id]);
});

test("invalid section identities and stale writes leave story and board unchanged", (t) => {
  const store = new Store(workspace(t));
  t.after(() => store.close());
  const one = store.createEpisode();
  const two = store.createEpisode();
  const a = store.saveStory(one.id, 1, "# Sections\n## A");
  const b = store.saveStory(two.id, 1, "# Sections\n## B");
  const before = store.getStory(two.id);
  const boardBefore = store.getEpisode(two.id);
  assert.throws(() => store.saveStory(two.id, b.storyRevision, `# Sections\n<!-- storybench:section ${a.sections[0].id} -->\n## Foreign`), /another episode/);
  assert.throws(() => store.saveStory(two.id, b.storyRevision, `# Sections\n<!-- storybench:section ${b.sections[0].id} -->\n## A\n<!-- storybench:section ${b.sections[0].id} -->\n## B`), /Duplicate/);
  assert.throws(() => store.saveStory(two.id, 1, "stale"), (error) => error.statusCode === 409 && error.current.source === before.source);
  assert.deepEqual(store.getStory(two.id), before);
  assert.deepEqual(store.getEpisode(two.id), boardBefore);
});

test("publication failure exposes committed pending state and startup recovery publishes once", (t) => {
  const root = workspace(t);
  let store = new Store(root);
  const episode = store.createEpisode();
  store.beforeStoryPublish = () => { throw new Error("disk unavailable"); };
  let pending;
  assert.throws(() => store.saveStory(episode.id, 1, "# Sections\n## Intro"), (error) => {
    pending = error.committed;
    return error.statusCode === 503 && pending.publicationPending && pending.storyRevision === 2;
  });
  assert.equal(store.getStory(episode.id).publicationStatus, "pending");
  assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM story_history WHERE episode_id=?").get(episode.id).n, 2);
  store.close();
  store = new Store(root);
  assert.equal(store.getStory(episode.id).publicationStatus, "published");
  assert.equal(readFileSync(path.join(root, "episodes", episode.id, "story.md"), "utf8"), pending.source);
  assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM story_history WHERE episode_id=?").get(episode.id).n, 2);
  assert.throws(() => store.saveStory(episode.id, 1, "retry"), /Stale/);
  store.close();
});

test("external story changes are preserved and never overwritten", (t) => {
  const root = workspace(t);
  const store = new Store(root);
  t.after(() => store.close());
  const episode = store.createEpisode();
  const saved = store.saveStory(episode.id, 1, "known");
  const file = path.join(root, "episodes", episode.id, "story.md");
  writeFileSync(file, "unexpected");
  assert.throws(() => store.saveStory(episode.id, saved.storyRevision, "new committed"), (error) => Boolean(error.statusCode === 409 && error.conflictPath));
  assert.equal(readFileSync(file, "utf8"), "unexpected");
  const story = store.getStory(episode.id);
  assert.equal(story.source, "new committed");
  assert.equal(story.publicationPending, true);
  assert.equal(story.publicationStatus, "external-conflict");
});

test("story HTTP contract returns conflicts, bounds source, and keeps unknown routes alive", async (t) => {
  const root = workspace(t);
  const app = await createApp({ workspace: root });
  t.after(() => app.close());
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const episode = app.store.createEpisode();
  const request = (source, revision = 1) => fetch(`${base}/api/episodes/${episode.id}/story`, {
    method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ source, expectedStoryRevision: revision }),
  });
  let response = await request("# Sections\n## Intro");
  assert.equal(response.status, 200);
  const accepted = await response.json();
  response = await request("stale");
  assert.equal(response.status, 409);
  assert.equal((await response.json()).current.storyRevision, accepted.storyRevision);
  assert.equal((await request("x".repeat(1024 * 1024 + 1), accepted.storyRevision)).status, 413);
  assert.equal((await fetch(`${base}/api/episodes/missing/story`)).status, 404);
  assert.equal((await fetch(`${base}/api/health`)).status, 404);
  assert.equal((await fetch(`${base}/favicon.ico`)).status, 404);
  assert.equal((await fetch(`${base}/api/state`)).status, 200);
});

test("registered story paths reject legacy traversal and symlink escape", (t) => {
  const root = workspace(t);
  const outside = workspace(t);
  const store = new Store(root);
  assert.throws(() => store.ensureEpisodeDirectories("../escape"), /Invalid registered/);
  const episode = store.createEpisode();
  store.close();
  rmSync(path.join(root, "episodes", episode.id), { recursive: true, force: true });
  symlinkSync(outside, path.join(root, "episodes", episode.id));
  assert.throws(() => new Store(root), /escapes the workspace/);
});

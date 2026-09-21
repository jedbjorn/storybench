import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { Readable } from "node:stream";
import os from "node:os";
import path from "node:path";
import { Store, SCHEMA_VERSION } from "../src/store.js";
import { createApp } from "../src/server.js";
import { createLibraryService } from "../src/library.js";
import { adoptWorkspace, initDataRoot, inspectDataRoot, openDataRoot } from "../src/services/data-root.js";
import { createChannel, getDefaultChannel, listChannels, renameChannel, useChannel } from "../src/services/channels.js";

const sha = (value) => createHash("sha256").update(value).digest("hex");
function tempDir(t, prefix = "storybench-channels-") {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function png(dir, color) {
  const file = path.join(dir, `${color}-${Date.now()}-${Math.random()}.png`);
  execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", `color=c=${color}:s=16x16`, "-frames:v", "1", "-y", file]);
  return readFileSync(file);
}
function twoChannelRoot(t) {
  const root = path.join(tempDir(t), "data");
  initDataRoot(root);
  const store = openDataRoot(root);
  t.after(() => store.close());
  const a = store.createChannel("Alpha");
  const b = store.createChannel("Beta");
  return { root, store, a, b, library: createLibraryService({ workspace: root, store }) };
}

test("channel records: first is default, names are unique case-insensitively, rename never moves files", (t) => {
  const root = path.join(tempDir(t), "root");
  const created = initDataRoot(root);
  assert.equal(created.created, true);
  assert.deepEqual(created.channels, []);
  assert.equal(getDefaultChannel(root), null);
  const cooking = createChannel(root, "Cooking");
  assert.match(cooking.id, /^channel_[0-9a-f-]{36}$/);
  assert.equal(cooking.isDefault, true);
  assert.ok(existsSync(path.join(root, "channels", cooking.id, "media")));
  assert.ok(existsSync(path.join(root, "channels", cooking.id, "branding")));
  const travel = createChannel(root, "Travel");
  assert.equal(travel.isDefault, false);
  assert.throws(() => createChannel(root, "  cOOKING "), (error) => error.statusCode === 409);
  assert.throws(() => createChannel(root, ""), /required/);
  assert.equal(useChannel(root, "travel").id, travel.id);
  const listed = listChannels(root);
  assert.equal(listed.defaultChannelId, travel.id);
  assert.deepEqual(listed.channels.map((channel) => channel.name), ["Cooking", "Travel"]);
  const renamed = renameChannel(root, cooking.id, "Kitchen");
  assert.equal(renamed.id, cooking.id);
  assert.ok(existsSync(path.join(root, "channels", cooking.id, "media")), "rename keeps the ID-named directory");
  assert.throws(() => useChannel(root, "Cooking"), (error) => error.statusCode === 404);
  assert.throws(() => renameChannel(root, travel.id, "kitchen"), (error) => error.statusCode === 409);
});

test("two channels keep separate libraries for same-named, same-byte media and dedup only within a channel", async (t) => {
  const { root, store, a, b, library } = twoChannelRoot(t);
  const scratch = tempDir(t);
  const bytes = png(scratch, "red");
  const episodeA = store.createEpisode({ title: "A", channelId: a.id });
  const episodeB = store.createEpisode({ title: "B", channelId: b.id });
  const register = (episodeId) => library.registerFile({ episodeId, readable: Readable.from([bytes]), fileName: "clip.png",
    contentType: "image/png", selectedCategory: "Graphics" });
  const itemA = await register(episodeA.id);
  const itemB = await register(episodeB.id);
  assert.notEqual(itemA.assetId, itemB.assetId, "equal bytes in two channels are two assets");
  assert.equal(itemA.asset.hash, itemB.asset.hash);
  assert.equal(itemA.asset.channelId, a.id);
  assert.equal(itemB.asset.channelId, b.id);
  assert.equal(path.dirname(itemA.asset.path), path.join("channels", a.id, "media"));
  assert.equal(path.dirname(itemB.asset.path), path.join("channels", b.id, "media"));
  assert.equal(sha(readFileSync(path.join(root, itemA.asset.path))), sha(bytes));
  assert.equal(sha(readFileSync(path.join(root, itemB.asset.path))), sha(bytes));
  const secondA = store.createEpisode({ title: "A2", channelId: a.id });
  const againA = await register(secondA.id);
  assert.equal(againA.assetId, itemA.assetId, "same bytes in one channel reuse the asset");
  assert.deepEqual(readdirSync(store.channelMediaDirectory(a.id)).filter((name) => !name.startsWith(".")), [path.basename(itemA.asset.path)]);
  assert.deepEqual(store.listAssets({ channelId: a.id }).map((asset) => asset.id), [itemA.assetId]);
  assert.deepEqual(store.listAssets({ channelId: b.id }).map((asset) => asset.id), [itemB.assetId]);
  assert.deepEqual(store.listEpisodes({ channelId: a.id }).map((episode) => episode.id).sort(), [episodeA.id, secondA.id].sort());
  assert.deepEqual(store.listEpisodes({ channelId: b.id }).map((episode) => episode.id), [episodeB.id]);
  const textA = await library.registerText({ episodeId: episodeA.id, title: "notes", text: "same words" });
  const textB = await library.registerText({ episodeId: episodeB.id, title: "notes", text: "same words" });
  assert.notEqual(textA.assetId, textB.assetId);
  assert.equal(path.dirname(textB.asset.path), path.join("channels", b.id, "media"));
  const directory = store.episodeDirectory(episodeB.id);
  assert.equal(path.relative(root, directory), path.join("channels", b.id, "episodes", episodeB.id));
  for (const sub of ["work", "outputs"]) assert.ok(existsSync(path.join(directory, sub)));
  assert.ok(existsSync(path.join(directory, "story.md")));
});

test("branding is channel-owned: standards apply only inside their channel", (t) => {
  const { store, a, b } = twoChannelRoot(t);
  const source = store.createEpisode({ title: "Source", channelId: a.id });
  store.updateEpisode(source.id, source.revision, { cards: [{ id: "intro", title: "Intro", type: "Video", prompt: "", sectionId: null, itemId: null, referenceItemIds: [], order: 0, enabled: true }] });
  const template = store.promoteCard(source.id, "intro", { name: "Alpha intro", role: "intro" });
  assert.equal(template.channelId, a.id);
  assert.equal(store.createEpisode({ title: "Alpha later", channelId: a.id }).cards[0].brandingTemplateId, template.id);
  const betaEpisode = store.createEpisode({ title: "Beta later", channelId: b.id });
  assert.equal(betaEpisode.cards.length, 0);
  assert.deepEqual(store.listBrandingTemplates({ channelId: b.id }), []);
  assert.throws(() => store.applyBrandingTemplate(betaEpisode.id, template.id), (error) => error.statusCode === 409);
  const betaSource = store.createEpisode({ title: "Beta source", channelId: b.id });
  store.updateEpisode(betaSource.id, betaSource.revision, { cards: [{ id: "b-intro", title: "B", type: "Video", prompt: "", sectionId: null, itemId: null, referenceItemIds: [], order: 0, enabled: true }] });
  store.promoteCard(betaSource.id, "b-intro", { role: "intro" });
  assert.equal(store.getBrandingTemplate(template.id).role, "intro", "a role change in Beta leaves Alpha's standard intact");
});

test("wrong-channel and mismatched IDs fail at shared operations and in the database", async (t) => {
  const { store, a, b } = twoChannelRoot(t);
  const episodeA = store.createEpisode({ title: "A", channelId: a.id });
  const episodeB = store.createEpisode({ title: "B", channelId: b.id });
  const assetA = store.saveAsset({ channelId: a.id, name: "a.mp4", hash: "hash-a", kind: "video", path: "channels/a.mp4", duration: 2, metadata: { hasAudio: true } });
  const itemA = store.attachLibraryItem(episodeA.id, assetA.id, { category: "B-roll" });
  assert.throws(() => store.attachLibraryItem(episodeB.id, assetA.id, { category: "B-roll" }), (error) => error.statusCode === 409);
  assert.throws(() => store.updateEpisode(episodeB.id, episodeB.revision, { cards: [{ id: "c", type: "Video", itemId: itemA.id }] }), /not found for this episode/);
  assert.throws(() => store.updateEpisode(episodeB.id, episodeB.revision, { cards: [{ id: "c", visual: { assetId: assetA.id, in: 0, out: 1, offset: 0, gain: 1 } }] }), (error) => error.statusCode === 409);
  assert.throws(() => store.createEpisode({ title: "Ambiguous" }), (error) => error.statusCode === 400, "no silent default destination");
  assert.throws(() => store.createEpisode({ title: "Unknown", channelId: "channel_missing" }), (error) => error.statusCode === 404);
  assert.throws(() => store.saveAsset({ name: "x", hash: "x", kind: "video", path: "x", metadata: {} }), (error) => error.statusCode === 400);
  assert.throws(() => store.assertEpisodeChannel(episodeA.id, b.id), (error) => error.statusCode === 409);
  // Database-level invariants hold even for writes that bypass the service layer.
  assert.equal(Number(store.db.prepare("PRAGMA foreign_keys").get().foreign_keys), 1);
  assert.throws(() => store.db.prepare("INSERT INTO library_items(id,episode_id,asset_id,category,label,created_at,updated_at) VALUES('x',?,?,'B-roll','x','t','t')").run(episodeB.id, assetA.id), /another channel/);
  assert.throws(() => store.db.prepare("UPDATE episodes SET channel_id=? WHERE id=?").run(b.id, episodeA.id), /immutable/);
  assert.throws(() => store.db.prepare("INSERT INTO episodes(id,channel_id,directory,title,revision,cards,created_at,updated_at) VALUES('e','channel_missing','episodes/e','t',1,'[]','t','t')").run(), /FOREIGN KEY/);
  store.saveAsset({ channelId: b.id, name: "b.mp4", hash: "hash-a", kind: "video", path: "channels/b.mp4", duration: 2, metadata: {} });
  assert.throws(() => store.db.prepare("INSERT INTO assets(id,channel_id,name,hash,kind,path,metadata,created_at) VALUES('dup',?,'n','hash-a','video','p','{}','t')").run(a.id), /UNIQUE/);

  const app = await createApp({ dataRoot: store.workspace });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  assert.equal((await fetch(`${base}/api/episodes/${episodeA.id}?channel=${b.id}`)).status, 409);
  assert.equal((await fetch(`${base}/api/episodes/${episodeA.id}`, { headers: { "x-storybench-channel": a.id } })).status, 200);
  assert.equal((await fetch(`${base}/api/episodes/${episodeA.id}/library`, { headers: { "x-storybench-channel": b.id } })).status, 409);
  const render = await fetch(`${base}/api/episodes/${episodeA.id}/render`, { method: "POST", headers: { "content-type": "application/json", "x-storybench-channel": b.id }, body: JSON.stringify({ kind: "preview" }) });
  assert.equal(render.status, 409);
  const scoped = await (await fetch(`${base}/api/state?channel=${b.id}`)).json();
  assert.deepEqual(scoped.episodes.map((episode) => episode.id), [episodeB.id]);
  assert.equal(scoped.channel.id, b.id);
  assert.equal((await fetch(`${base}/api/state?channel=channel_missing`)).status, 404);
  const created = await fetch(`${base}/api/channels/${b.id}/episodes`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "Via route" }) });
  assert.equal((await created.json()).channelId, b.id);
  const ambiguous = await fetch(`${base}/api/episodes`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  assert.equal(ambiguous.status, 400);
});

test("a queued job finishes in its originating channel while the default and views change", async (t) => {
  const root = path.join(tempDir(t), "data");
  initDataRoot(root);
  let release, started;
  const running = new Promise((resolve) => { started = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  const app = await createApp({ dataRoot: root, renderOptions: { renderCompositionImpl: async ({ outputPath }) => {
    started(); await gate; writeFileSync(outputPath, "rendered"); return { path: outputPath };
  } } });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const json = (url, method = "GET", body, channel) => fetch(`${base}${url}`, { method, headers: { "content-type": "application/json", ...(channel ? { "x-storybench-channel": channel } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}) }).then(async (response) => ({ status: response.status, body: await response.json() }));
  const a = (await json("/api/channels", "POST", { name: "Alpha" })).body;
  const b = (await json("/api/channels", "POST", { name: "Beta" })).body;
  const store = app.store;
  let episode = (await json(`/api/channels/${a.id}/episodes`, "POST", { title: "Alpha episode" })).body;
  const story = store.saveStory(episode.id, 1, "# Sections\n\n## Main");
  mkdirSync(store.channelMediaDirectory(a.id), { recursive: true });
  writeFileSync(path.join(store.channelMediaDirectory(a.id), "clip.mp4"), "fixture");
  const asset = store.saveAsset({ channelId: a.id, name: "clip.mp4", hash: "clip", kind: "video", path: `channels/${a.id}/media/clip.mp4`, duration: 1, metadata: {} });
  const item = store.attachLibraryItem(episode.id, asset.id, { category: "B-roll" });
  episode = store.updateEpisode(episode.id, episode.revision, { cards: [{ id: "v", title: "V", type: "Video", sectionId: story.sections[0].id, itemId: item.id, in: 0, out: 1 }] });
  const before = (await json("/api/data-root")).body;
  const queued = await json(`/api/episodes/${episode.id}/render`, "POST", { kind: "preview" }, a.id);
  assert.equal(queued.status, 202);
  assert.deepEqual({ channelId: queued.body.snapshot.destination.channelId, episodeId: queued.body.snapshot.destination.episodeId }, { channelId: a.id, episodeId: episode.id });
  await running;
  assert.equal((await json("/api/channels/default", "PUT", { channel: b.id })).body.id, b.id);
  const betaView = (await json("/api/state")).body;
  assert.equal(betaView.channel.id, b.id, "a view without explicit scope opens the new default");
  assert.deepEqual(betaView.jobs, []);
  const alphaView = (await json(`/api/state?channel=${a.id}`)).body;
  assert.deepEqual(alphaView.jobs.map((job) => [job.id, job.state]), [[queued.body.id, "running"]], "the open Alpha view is not retargeted");
  const after = (await json("/api/data-root")).body;
  assert.deepEqual({ pid: after.pid, id: after.id }, { pid: before.pid, id: before.id }, "navigation keeps the process and database target");
  release();
  let job;
  for (let attempt = 0; attempt < 100; attempt++) {
    job = store.getJob(queued.body.id);
    if (job.state === "completed" || job.state === "failed") break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(job.state, "completed", job.error);
  assert.equal(job.channelId, a.id);
  assert.equal(path.dirname(job.outputPath), path.join("channels", a.id, "episodes", episode.id, "outputs", "drafts"));
  assert.equal(readFileSync(path.join(root, job.outputPath), "utf8"), "rendered");
  assert.equal(store.getDefaultChannel().id, b.id);
});

function legacyWorkspace(root) {
  mkdirSync(path.join(root, "media"), { recursive: true });
  mkdirSync(path.join(root, "exports"), { recursive: true });
  const db = new DatabaseSync(path.join(root, "storybench.sqlite"));
  db.exec(`
    CREATE TABLE episodes (id TEXT PRIMARY KEY,title TEXT NOT NULL,notes TEXT NOT NULL DEFAULT '',revision INTEGER NOT NULL,cards TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE episode_history (episode_id TEXT NOT NULL,revision INTEGER NOT NULL,title TEXT NOT NULL,notes TEXT NOT NULL,cards TEXT NOT NULL,actor TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(episode_id,revision));
    CREATE TABLE assets (id TEXT PRIMARY KEY,name TEXT NOT NULL,hash TEXT NOT NULL UNIQUE,kind TEXT NOT NULL,path TEXT NOT NULL,duration REAL,width INTEGER,height INTEGER,metadata TEXT NOT NULL,thumbnail_path TEXT,created_at TEXT NOT NULL);
    CREATE TABLE jobs (id TEXT PRIMARY KEY,episode_id TEXT NOT NULL,kind TEXT NOT NULL,state TEXT NOT NULL,progress REAL NOT NULL DEFAULT 0,revision INTEGER NOT NULL,output_path TEXT,error TEXT,snapshot TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
  `);
  const stamp = "2026-01-01T00:00:00.000Z";
  for (const id of ["episode-a", "episode-b"]) {
    db.prepare("INSERT INTO episodes VALUES(?,?,?,?,?,?,?)").run(id, `Title ${id}`, "", 1, JSON.stringify([{ id: `card-${id}`, title: "Keep", purpose: "", visual: null, narration: null }]), stamp, stamp);
    db.prepare("INSERT INTO episode_history VALUES(?,?,?,?,?,?,?)").run(id, 1, `Title ${id}`, "", "[]", "human", stamp);
  }
  for (const [id, kind] of [["v", "video"], ["i", "image"]]) {
    const bytes = Buffer.from(`bytes-${id}`);
    writeFileSync(path.join(root, "media", sha(bytes)), bytes);
    db.prepare("INSERT INTO assets VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(id, id, sha(bytes), kind, `media/${sha(bytes)}`, 1, null, null, "{}", null, stamp);
  }
  writeFileSync(path.join(root, "exports", "old.mp4"), "old export");
  db.prepare("INSERT INTO jobs VALUES(?,?,?,?,?,?,?,?,?,?,?)").run("job-old", "episode-a", "export", "completed", 1, 1, "exports/old.mp4", null, "{}", stamp, stamp);
  db.close();
}
function fingerprint(store, root) {
  const rows = (sql) => store.db.prepare(sql).all().map((row) => ({ ...row }));
  const files = {};
  for (const asset of store.listAssets()) files[asset.path] = sha(readFileSync(path.join(root, asset.path)));
  return {
    episodes: rows("SELECT id,channel_id,directory,title,revision,cards FROM episodes ORDER BY id"),
    assets: rows("SELECT id,channel_id,hash,path,kind FROM assets ORDER BY id"),
    library: rows("SELECT id,episode_id,asset_id,category FROM library_items ORDER BY id"),
    jobs: rows("SELECT id,episode_id,output_path,output_class FROM jobs ORDER BY id"),
    stories: rows("SELECT episode_id,revision,committed_hash FROM stories ORDER BY episode_id"),
    channels: rows("SELECT id,name FROM channels"),
    files,
    exportHash: sha(readFileSync(path.join(root, "exports", "old.mp4"))),
  };
}

test("legacy migration into the first channel is repeatable and preserves IDs, paths and bytes", (t) => {
  const root = tempDir(t);
  legacyWorkspace(root);
  const legacyHashes = Object.fromEntries(readdirSync(path.join(root, "media")).map((name) => [name, sha(readFileSync(path.join(root, "media", name)))]));
  let store = new Store(root);
  assert.equal(Number(store.db.prepare("PRAGMA user_version").get().user_version), SCHEMA_VERSION);
  const first = fingerprint(store, root);
  assert.equal(first.channels.length, 1);
  const [channel] = first.channels;
  assert.deepEqual(first.episodes.map((row) => [row.id, row.channel_id, row.directory]), [["episode-a", channel.id, "episodes/episode-a"], ["episode-b", channel.id, "episodes/episode-b"]]);
  assert.deepEqual(first.assets.map((row) => [row.id, row.path]), [["i", `media/${sha("bytes-i")}`], ["v", `media/${sha("bytes-v")}`]]);
  assert.ok(first.assets.every((row) => row.channel_id === channel.id));
  assert.deepEqual(Object.values(first.files).sort(), Object.values(legacyHashes).sort());
  assert.deepEqual(first.jobs, [{ id: "job-old", episode_id: "episode-a", output_path: "exports/old.mp4", output_class: "legacy_draft" }]);
  assert.equal(store.getJob("job-old").channelId, channel.id);
  assert.equal(store.episodeDirectory("episode-a"), path.join(root, "episodes", "episode-a"));
  assert.equal(store.getDefaultChannel().id, channel.id);
  assert.ok(existsSync(path.join(root, "storybench.pre-v6.sqlite")));
  const backup = new DatabaseSync(path.join(root, "storybench.pre-v6.sqlite"), { readOnly: true });
  assert.equal(backup.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
  assert.equal(Number(backup.prepare("PRAGMA user_version").get().user_version), 5);
  backup.close();
  const assetIndexes = store.db.prepare("PRAGMA index_list('assets')").all().filter((index) => index.unique);
  assert.deepEqual(assetIndexes.map((index) => store.db.prepare(`PRAGMA index_info('${index.name}')`).all().map((column) => column.name)).filter((columns) => columns.includes("hash")), [["channel_id", "hash"]]);
  store.close();
  // Reopen (no-op) and then force the v6 step to run again over already-migrated data.
  store = new Store(root);
  assert.deepEqual(fingerprint(store, root), first);
  store.db.exec("PRAGMA user_version=5");
  store.close();
  store = new Store(root);
  t.after(() => store.close());
  assert.deepEqual(fingerprint(store, root), first);
  assert.equal(store.listChannels().length, 1);
});

test("init and adopt are explicit, refuse conflicting state and never duplicate", (t) => {
  const base = tempDir(t);
  assert.throws(() => initDataRoot("relative/root"), /absolute/);
  const legacyRoot = path.join(base, "legacy");
  mkdirSync(legacyRoot);
  legacyWorkspace(legacyRoot);
  assert.equal(inspectDataRoot(legacyRoot).state, "legacy");
  assert.throws(() => initDataRoot(legacyRoot), (error) => error.statusCode === 409 && /adopt/.test(error.message));
  assert.throws(() => openDataRoot(legacyRoot), (error) => error.statusCode === 409 && /adopt/.test(error.message));
  const adopted = adoptWorkspace(legacyRoot, { channelName: "Prototype" });
  assert.equal(adopted.adopted, true);
  assert.deepEqual(adopted.channels.map((channel) => channel.name), ["Prototype"]);
  assert.ok(existsSync(adopted.backupPath));
  const again = adoptWorkspace(legacyRoot, { channelName: "Other" });
  assert.equal(again.alreadyAdopted, true);
  assert.equal(again.identity.id, adopted.identity.id);
  assert.deepEqual(again.channels.map((channel) => channel.id), adopted.channels.map((channel) => channel.id));
  const store = openDataRoot(legacyRoot);
  assert.equal(store.listEpisodes().length, 2);
  assert.equal(store.listAssets().length, 2);
  store.close();

  const conflicting = path.join(base, "half");
  mkdirSync(path.join(conflicting, "media"), { recursive: true });
  assert.throws(() => initDataRoot(conflicting), (error) => error.statusCode === 409 && /media/.test(error.message));
  assert.throws(() => adoptWorkspace(conflicting), (error) => error.statusCode === 409);
  const foreign = path.join(base, "foreign");
  mkdirSync(foreign);
  writeFileSync(path.join(foreign, "storybench.sqlite"), "not sqlite at all, just text that is long enough to not be a header........");
  assert.equal(inspectDataRoot(foreign).state, "conflict");
  assert.throws(() => initDataRoot(foreign), (error) => error.statusCode === 409);

  const unrelated = path.join(base, "unrelated");
  mkdirSync(unrelated);
  writeFileSync(path.join(unrelated, "notes.txt"), "keep me");
  const init = initDataRoot(unrelated);
  assert.equal(init.created, true);
  assert.equal(readFileSync(path.join(unrelated, "notes.txt"), "utf8"), "keep me");
  assert.equal(existsSync(path.join(unrelated, "media")), false, "an initialized root has no prototype folders");
  const repeat = initDataRoot(unrelated);
  assert.deepEqual({ created: repeat.created, id: repeat.identity.id }, { created: false, id: init.identity.id });
  const opened = openDataRoot(unrelated);
  assert.deepEqual(opened.listAssets(), []);
  opened.close();
  assert.throws(() => adoptWorkspace(path.join(base, "missing")), (error) => error.statusCode === 409);
  assert.throws(() => openDataRoot(path.join(base, "missing")), (error) => error.statusCode === 409);

  const future = path.join(base, "future");
  initDataRoot(future);
  const db = new DatabaseSync(path.join(future, "storybench.sqlite"));
  db.exec("PRAGMA user_version=99");
  db.close();
  assert.equal(inspectDataRoot(future).state, "newer");
  assert.throws(() => openDataRoot(future), (error) => error.statusCode === 409);
});

test("cross-channel reuse registers in the destination with provenance and keeps the source intact", async (t) => {
  const { root, store, a, b, library } = twoChannelRoot(t);
  const scratch = tempDir(t);
  const bytes = png(scratch, "blue");
  const source = store.createEpisode({ title: "Source", channelId: a.id });
  const sourceItem = await library.registerFile({ episodeId: source.id, readable: Readable.from([bytes]), fileName: "logo.png", contentType: "image/png", selectedCategory: "Graphics" });
  const reference = await library.registerText({ episodeId: source.id, title: "Mood", text: "slow and warm" });
  const sourceSnapshot = JSON.stringify([store.getLibraryItem(source.id, sourceItem.id), store.getAsset(sourceItem.assetId), store.getLibraryItem(source.id, reference.id)]);
  const sourceHash = sha(readFileSync(path.join(root, sourceItem.asset.path)));
  let destination = store.createEpisode({ title: "Destination", channelId: b.id });
  destination = store.updateEpisode(destination.id, destination.revision, { cards: [{ id: "still", title: "Still", type: "Static Graphic", prompt: "", sectionId: null, itemId: null, referenceItemIds: [], order: 0, enabled: true, duration: 2 }] });
  const staleRevision = destination.revision;
  destination = store.updateEpisode(destination.id, destination.revision, { title: "Destination edited" });

  const conflict = await library.reuseItem({ source: { episodeId: source.id, itemId: sourceItem.id },
    destination: { episodeId: destination.id, channelId: b.id, cardId: "still", expectedRevision: staleRevision }, requestId: "req-1" });
  assert.equal(conflict.appliedToCard, false);
  assert.match(conflict.applyNote, /library/);
  assert.equal(conflict.copied, true);
  assert.equal(conflict.item.episodeId, destination.id);
  assert.equal(conflict.item.asset.channelId, b.id);
  assert.equal(conflict.item.asset.hash, sourceItem.asset.hash);
  assert.equal(path.dirname(conflict.item.asset.path), path.join("channels", b.id, "media"));
  assert.equal(sha(readFileSync(path.join(root, conflict.item.asset.path))), sourceHash);
  assert.deepEqual(conflict.item.provenance.reusedFrom, { channelId: a.id, channelName: "Alpha", episodeId: source.id, episodeTitle: "Source",
    itemId: sourceItem.id, assetId: sourceItem.assetId, hash: sourceItem.asset.hash, category: "Graphics", label: sourceItem.label });
  assert.equal(conflict.item.provenance.requestId, "req-1");
  assert.equal(store.getEpisode(destination.id).cards[0].itemId, null, "the stale card choice is not overwritten");

  const repeated = await library.reuseItem({ source: { episodeId: source.id, itemId: sourceItem.id }, destination: { episodeId: destination.id } });
  assert.equal(repeated.alreadyPresent, true);
  assert.equal(repeated.item.id, conflict.item.id);
  assert.equal(store.listEpisodeLibrary(destination.id).length, 1);

  const current = store.getEpisode(destination.id);
  const applied = await library.reuseItem({ source: { episodeId: source.id, itemId: sourceItem.id },
    destination: { episodeId: destination.id, cardId: "still", expectedRevision: current.revision } });
  assert.equal(applied.appliedToCard, true);
  assert.equal(store.getEpisode(destination.id).cards[0].itemId, conflict.item.id);

  const removedCard = await library.reuseItem({ source: { episodeId: source.id, itemId: reference.id },
    destination: { episodeId: destination.id, cardId: "gone", expectedRevision: store.getEpisode(destination.id).revision, assign: "reference" } });
  assert.equal(removedCard.appliedToCard, false);
  assert.match(removedCard.applyNote, /no longer exists/);
  assert.equal(removedCard.item.category, "Reference", "a reused reference stays reference material");
  assert.equal(removedCard.item.extractedText, "slow and warm");

  const second = store.createEpisode({ title: "Second destination", channelId: b.id });
  const deduplicated = await library.reuseItem({ source: { episodeId: source.id, itemId: sourceItem.id }, destination: { episodeId: second.id } });
  assert.equal(deduplicated.copied, false);
  assert.equal(deduplicated.deduplicated, true);
  assert.equal(deduplicated.item.assetId, conflict.item.assetId, "the destination channel deduplicates by content");

  const sameChannel = store.createEpisode({ title: "Alpha sibling", channelId: a.id });
  const sibling = await library.reuseItem({ source: { episodeId: source.id, itemId: sourceItem.id }, destination: { episodeId: sameChannel.id } });
  assert.equal(sibling.item.assetId, sourceItem.assetId, "same-channel reuse adds membership without copying");

  await assert.rejects(library.reuseItem({ source: { episodeId: source.id, itemId: sourceItem.id }, destination: { episodeId: destination.id, channelId: a.id } }), (error) => error.statusCode === 409);
  await assert.rejects(library.reuseItem({ source: { episodeId: destination.id, itemId: sourceItem.id }, destination: { episodeId: second.id } }), (error) => error.statusCode === 404);
  assert.equal(JSON.stringify([store.getLibraryItem(source.id, sourceItem.id), store.getAsset(sourceItem.assetId), store.getLibraryItem(source.id, reference.id)]), sourceSnapshot);
  assert.equal(sha(readFileSync(path.join(root, sourceItem.asset.path))), sourceHash);
});

test("--workspace refuses an initialized or adopted data root instead of silently adding a channel", async (t) => {
  const base = tempDir(t);
  const initialized = path.join(base, "initialized");
  initDataRoot(initialized);
  assert.throws(() => new Store(initialized), (error) => error.statusCode === 409 && /--data-root/.test(error.message));
  await assert.rejects(createApp({ workspace: initialized }), /--data-root/);
  assert.equal(existsSync(path.join(initialized, "media")), false, "no prototype folders were added");
  assert.deepEqual(listChannels(initialized).channels, []);
  assert.equal(inspectDataRoot(initialized).identity.origin, "init");
  const adopted = path.join(base, "adopted");
  mkdirSync(adopted);
  legacyWorkspace(adopted);
  adoptWorkspace(adopted);
  assert.equal(inspectDataRoot(adopted).identity.origin, "adopt");
  assert.throws(() => new Store(adopted), /--data-root/);
  assert.equal(listChannels(adopted).channels.length, 1);
  // A genuine prototype workspace still opens and gets its first channel.
  const prototype = path.join(base, "prototype");
  const store = new Store(prototype);
  assert.deepEqual(store.listChannels().map((channel) => channel.name), ["Main"]);
  assert.equal(store.dataRootIdentity().origin, "workspace");
  store.close();
  const reopened = new Store(prototype);
  assert.equal(reopened.listChannels().length, 1);
  reopened.close();
});

test("reuse rejects missing identities with 400 before any lookup", async (t) => {
  const { store, a, library } = twoChannelRoot(t);
  const episode = store.createEpisode({ title: "A", channelId: a.id });
  await assert.rejects(library.reuseItem({}), (error) => error.statusCode === 400 && /source.episodeId/.test(error.message));
  await assert.rejects(library.reuseItem({ source: { episodeId: episode.id }, destination: { episodeId: episode.id } }), (error) => error.statusCode === 400 && /source.itemId/.test(error.message));
  await assert.rejects(library.reuseItem({ source: { episodeId: episode.id, itemId: "x" }, destination: { episodeId: "" } }), (error) => error.statusCode === 400 && /destination.episodeId/.test(error.message));
  const app = await createApp({ dataRoot: store.workspace });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  t.after(() => app.close());
  const response = await fetch(`http://127.0.0.1:${app.server.address().port}/api/episodes/${episode.id}/library/reuse`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /source.episodeId is required/);
});

test("an unknown channel on an episode operation is 404, a different one is 409", async (t) => {
  const { store, a, b } = twoChannelRoot(t);
  const episode = store.createEpisode({ title: "A", channelId: a.id });
  assert.throws(() => store.assertEpisodeChannel(episode.id, "channel_missing"), (error) => error.statusCode === 404);
  assert.throws(() => store.assertEpisodeChannel(episode.id, b.id), (error) => error.statusCode === 409);
  const app = await createApp({ dataRoot: store.workspace });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  assert.equal((await fetch(`${base}/api/episodes/${episode.id}?channel=channel_missing`)).status, 404);
  assert.equal((await fetch(`${base}/api/episodes/${episode.id}?channel=${b.id}`)).status, 409);
});

test("saveAsset returns the winning row when a concurrent insert takes the channel hash first", (t) => {
  const { store, a } = twoChannelRoot(t);
  const winner = store.saveAsset({ channelId: a.id, name: "first", hash: "race", kind: "video", path: "p1", metadata: {} });
  const original = store.getAssetByHash.bind(store);
  let calls = 0;
  // The first dedup check misses, as if the competing insert landed between the check and this insert.
  store.getAssetByHash = (...args) => (calls++ === 0 ? null : original(...args));
  const result = store.saveAsset({ channelId: a.id, name: "second", hash: "race", kind: "video", path: "p2", metadata: {} });
  store.getAssetByHash = original;
  assert.equal(result.id, winner.id);
  assert.equal(store.listAssets({ channelId: a.id }).length, 1);
});

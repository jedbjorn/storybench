import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { Store } from "../src/store.js";
import { createLibraryService } from "../src/library.js";
import { createApp } from "../src/server.js";
import { buildRenderPlan } from "../src/composition-plan.js";

function ffmpeg(args) {
  const result = spawnSync("ffmpeg", ["-v", "error", "-threads", "1", ...args], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
}
const hashFile = async (file) => createHash("sha256").update(await readFile(file)).digest("hex");

async function fixture() {
  const workspace = await mkdtemp(path.join(tmpdir(), "storybench-library-"));
  const store = new Store(workspace);
  const episode = store.createEpisode({ title: "Library test" });
  return { workspace, store, episode, async close() { store.close(); await rm(workspace, { recursive: true, force: true }); } };
}

test("library items preserve membership identity, scoped metadata, and optimistic revisions", async (t) => {
  const f = await fixture();
  t.after(() => f.close());
  const other = f.store.createEpisode({ title: "Other" });
  const first = await createLibraryService({ workspace: f.workspace, store: f.store }).registerText({
    episodeId: f.episode.id, title: "Interview notes", text: "A useful excerpt",
  });
  const second = f.store.attachLibraryItem(other.id, first.assetId, { category: "Reference", label: "Other copy" });
  assert.notEqual(first.id, first.assetId);
  assert.notEqual(first.id, second.id);
  assert.equal(f.store.listEpisodeLibrary(f.episode.id).length, 1);
  assert.equal(f.store.getLibraryItem(f.episode.id, second.id), null);
  assert.deepEqual(f.store.getEpisode(f.episode.id).cards, [], "library import does not insert cards");

  const story = f.store.saveStory(f.episode.id, 1, "# Sections\n\n## Interview");
  const sectionId = story.sections[0].id;
  const edited = f.store.updateLibraryItem(f.episode.id, first.id, 1, {
    category: "B-roll", label: "Interview selects", tags: ["person", "quote"], notes: "Use near opening", sectionId,
  });
  assert.equal(edited.category, "B-roll");
  assert.equal(edited.sectionId, sectionId);
  assert.deepEqual(edited.tags, ["person", "quote"]);
  assert.throws(() => f.store.updateLibraryItem(f.episode.id, first.id, 1, { notes: "stale" }), /Stale library revision/);
  assert.throws(() => f.store.updateLibraryItem(f.episode.id, first.id, 2, { sectionId: "elsewhere" }), /Story section not found/);
  const removed = f.store.saveStory(f.episode.id, story.storyRevision, "# Sections\n\n## Replacement");
  assert.deepEqual(removed.mappingChanges.unassignedLibraryItemIds, [first.id]);
  assert.equal(f.store.getLibraryItem(f.episode.id, first.id).sectionId, null);
});

test("reference file imports are atomic, serialized, bounded, and report extraction", async (t) => {
  const f = await fixture();
  t.after(() => f.close());
  const service = createLibraryService({ workspace: f.workspace, store: f.store });
  const order = [];
  async function *content(value, delay) {
    order.push(`start-${value}`);
    await new Promise((resolve) => setTimeout(resolve, delay));
    yield Buffer.from(value);
    order.push(`end-${value}`);
  }
  const [one, two] = await Promise.all([
    service.registerFile({ episodeId: f.episode.id, readable: Readable.from(content("one", 20)), fileName: "one.txt", contentType: "text/plain", selectedCategory: "Reference" }),
    service.registerFile({ episodeId: f.episode.id, readable: Readable.from(content("two", 0)), fileName: "two.txt", contentType: "text/plain", selectedCategory: "Reference" }),
  ]);
  assert.deepEqual(order, ["start-one", "end-one", "start-two", "end-two"]);
  assert.equal(one.extractedText, "one");
  assert.equal(two.extractionStatus, "complete");
  await assert.rejects(service.registerFile({ episodeId: f.episode.id, readable: Readable.from("bad"), fileName: "bad.txt", selectedCategory: "Elsewhere" }), /Unknown library category/);
  assert.equal(f.store.listEpisodeLibrary(f.episode.id).length, 2);
  assert.deepEqual(await readFile(path.join(f.workspace, one.asset.path), "utf8"), "one");

  async function *oversized() {
    const chunk = Buffer.alloc(1024 * 1024);
    for (let index = 0; index < 21; index++) yield chunk;
  }
  await assert.rejects(service.registerFile({ episodeId: f.episode.id, readable: Readable.from(oversized()), fileName: "too-large.txt", contentType: "text/plain", selectedCategory: "Reference" }), /20 MiB limit/);
  assert.equal(f.store.listEpisodeLibrary(f.episode.id).length, 2, "failed import publishes no membership");
});

test("Reference imports preserve detected image, video, and audio formats across category moves", async (t) => {
  const f = await fixture();
  t.after(() => f.close());
  const sourceDir = path.join(f.workspace, "fixtures");
  await mkdir(sourceDir);
  const image = path.join(sourceDir, "still.png"), video = path.join(sourceDir, "clip.webm"), audio = path.join(sourceDir, "tone.wav");
  ffmpeg(["-f", "lavfi", "-i", "color=c=red:s=32x32:d=0.1", "-frames:v", "1", image]);
  ffmpeg(["-f", "lavfi", "-i", "color=c=blue:s=64x64:r=30:d=1", "-c:v", "libvpx-vp9", "-pix_fmt", "yuv420p", video]);
  ffmpeg(["-f", "lavfi", "-i", "sine=frequency=660:sample_rate=48000:duration=1", audio]);
  const before = await Promise.all([image, video, audio].map(hashFile));
  const service = createLibraryService({ workspace: f.workspace, store: f.store });
  const imported = [];
  for (const file of [image, video, audio]) imported.push(await service.registerFile({ episodeId: f.episode.id,
    readable: createReadStream(file), fileName: path.basename(file), contentType: "application/octet-stream", selectedCategory: "Reference" }));
  assert.deepEqual(imported.map((item) => item.asset.kind), ["image", "video", "audio"]);
  assert.deepEqual(imported.map((item) => item.extractionStatus), ["not-applicable", "not-applicable", "not-applicable"]);
  const moved = imported.map((item, index) => f.store.updateLibraryItem(f.episode.id, item.id, 1,
    { category: ["Graphics", "B-roll", "Narration"][index] }));
  assert.deepEqual(moved.map((item) => item.asset.kind), ["image", "video", "audio"]);
  assert.deepEqual(await Promise.all([image, video, audio].map(hashFile)), before, "registered import never mutates sources");
  for (const item of moved) await readFile(path.join(f.workspace, item.asset.path));

  const story = f.store.saveStory(f.episode.id, 1, "# Sections\n\n## Main");
  const cards = [
    { id: "video", title: "Video", type: "Video", sectionId: story.sections[0].id, itemId: moved[1].id, order: 0, in: 0, out: .5 },
    { id: "image", title: "Image", type: "Static Graphic", sectionId: story.sections[0].id, itemId: moved[0].id, order: 1, duration: .5 },
    { id: "audio", title: "Audio", type: "Audio", sectionId: story.sections[0].id, itemId: moved[2].id, order: 2,
      role: "music", anchorVisualCardId: "video", offset: 0, in: 0, out: .5 },
  ];
  const episode = f.store.updateEpisode(f.episode.id, f.store.getEpisode(f.episode.id).revision, { cards });
  const plan = buildRenderPlan({ sections: story.sections, cards: episode.cards, libraryItems: f.store.listEpisodeLibrary(f.episode.id) });
  assert.deepEqual(plan.visualSpine.map((entry) => entry.cardId), ["video", "image"]);
  assert.equal(plan.audioPlacements[0].cardId, "audio");
});

test("media deduplication never downgrades format and repairs a matching legacy reference asset", async (t) => {
  const f = await fixture();
  t.after(() => f.close());
  const source = path.join(f.workspace, "clip.mp4");
  ffmpeg(["-f", "lavfi", "-i", "color=c=green:s=64x64:r=30:d=0.3", "-c:v", "libx264", "-pix_fmt", "yuv420p", source]);
  const bytesHash = await hashFile(source);
  const legacy = f.store.saveAsset({ name: "misclassified.mp4", hash: bytesHash, kind: "reference", path: "clip.mp4", metadata: {} });
  const service = createLibraryService({ workspace: f.workspace, store: f.store });
  const repaired = await service.registerFile({ episodeId: f.episode.id, readable: createReadStream(source), fileName: "clip.mp4",
    contentType: "video/mp4", selectedCategory: "Reference" });
  assert.equal(repaired.assetId, legacy.id, "existing stable asset identity is retained");
  assert.equal(repaired.asset.kind, "video");
  assert.notEqual(repaired.asset.path, "clip.mp4", "repaired asset uses the managed media path");
  const other = f.store.createEpisode({ title: "Other" });
  const duplicate = await service.registerFile({ episodeId: other.id, readable: createReadStream(source), fileName: "clip.mp4",
    contentType: "video/mp4", selectedCategory: "Reference" });
  assert.equal(duplicate.assetId, legacy.id);
  assert.equal(duplicate.asset.kind, "video");
});

test("pasted references preserve source while bounding excerpts", async (t) => {
  const f = await fixture();
  t.after(() => f.close());
  const source = "x".repeat(200_001);
  const item = await createLibraryService({ workspace: f.workspace, store: f.store }).registerText({
    episodeId: f.episode.id, title: "Long notes", text: source,
  });
  assert.equal(item.extractedText.length, 200_000);
  assert.equal(item.extractionStatus, "truncated");
  assert.equal((await readFile(path.join(f.workspace, item.asset.path), "utf8")).length, source.length);
});

test("content deduplication reuses a registered asset without orphan episode copies", async (t) => {
  const f = await fixture();
  t.after(() => f.close());
  const other = f.store.createEpisode({ title: "Other" });
  const service = createLibraryService({ workspace: f.workspace, store: f.store });
  const first = await service.registerText({ episodeId: f.episode.id, title: "One", text: "same bytes" });
  const second = await service.registerText({ episodeId: other.id, title: "Two", text: "same bytes" });
  assert.equal(first.assetId, second.assetId);
  assert.equal(first.asset.path, second.asset.path);
  // New-layout episodes store library files in their channel's media folder: one copy for both memberships.
  const channelMedia = f.store.channelMediaDirectory(other.channelId);
  assert.equal(path.dirname(path.join(f.workspace, second.asset.path)), channelMedia);
  assert.deepEqual(await import("node:fs/promises").then(({ readdir }) => readdir(channelMedia)), [path.basename(second.asset.path)]);
});

test("URL references reject private destinations and revalidate redirects", async (t) => {
  const f = await fixture();
  t.after(() => f.close());
  const publicLookup = async (hostname) => hostname === "blocked.example"
    ? [{ address: "127.0.0.1", family: 4 }]
    : [{ address: "93.184.216.34", family: 4 }];
  let calls = 0;
  const service = createLibraryService({
    workspace: f.workspace,
    store: f.store,
    dnsLookup: publicLookup,
    fetchImpl: async () => {
      calls += 1;
      return new Response(null, { status: 302, headers: { location: "http://blocked.example/private" } });
    },
  });
  await assert.rejects(service.registerUrl({ episodeId: f.episode.id, url: "https://public.example/start" }), /forbidden destination/);
  assert.equal(calls, 1);
  assert.equal(f.store.listEpisodeLibrary(f.episode.id).length, 0);
});

test("URL references reject private IPv4-mapped IPv6 before connecting", async (t) => {
  const f = await fixture();
  t.after(() => f.close());
  let connected = false;
  const service = createLibraryService({
    workspace: f.workspace, store: f.store,
    dnsLookup: async () => [{ address: "::ffff:a00:1", family: 6 }],
    fetchImpl: async () => { connected = true; return new Response("never"); },
  });
  await assert.rejects(service.registerUrl({ episodeId: f.episode.id, url: "https://mapped.example" }), /forbidden destination/);
  assert.equal(connected, false);
});

test("URL redirects and rejected responses destroy their bodies", async (t) => {
  const f = await fixture();
  t.after(() => f.close());
  let destroyed = 0;
  const response = (status, location) => {
    const body = Readable.from([Buffer.alloc(1024)]);
    const original = body.destroy.bind(body);
    body.destroy = (...args) => { destroyed += 1; return original(...args); };
    return { status, ok: false, headers: { get: (name) => name === "location" ? location : null }, body };
  };
  let call = 0;
  const service = createLibraryService({ workspace: f.workspace, store: f.store,
    dnsLookup: async () => [{ address: "93.184.216.34", family: 4 }],
    fetchImpl: async () => ++call === 1 ? response(302, "https://public.example/end") : response(500),
  });
  await assert.rejects(service.registerUrl({ episodeId: f.episode.id, url: "https://public.example/start" }), /HTTP 500/);
  assert.equal(destroyed, 2);
});

test("unreadable PDF and invalid UTF-8 preserve originals with unavailable extraction", async (t) => {
  const f = await fixture();
  t.after(() => f.close());
  const service = createLibraryService({ workspace: f.workspace, store: f.store });
  const pdfSource = Buffer.from("%PDF-1.7\nnot a complete PDF\n");
  const pdf = await service.registerFile({ episodeId: f.episode.id, readable: Readable.from(pdfSource), fileName: "scan.pdf", contentType: "application/pdf", selectedCategory: "Reference" });
  assert.equal(pdf.extractionStatus, "unavailable");
  assert.match(pdf.provenance.extractionError, /PDF metadata unavailable/);
  assert.deepEqual(await readFile(path.join(f.workspace, pdf.asset.path)), pdfSource);

  const invalid = Buffer.from([0x66, 0x80, 0x67]);
  const text = await service.registerFile({ episodeId: f.episode.id, readable: Readable.from(invalid), fileName: "invalid.txt", contentType: "text/plain", selectedCategory: "Reference" });
  assert.equal(text.extractionStatus, "unavailable");
  assert.equal(text.extractedText, "");
  assert.match(text.provenance.extractionError, /valid UTF-8/);
  assert.deepEqual(await readFile(path.join(f.workspace, text.asset.path)), invalid);
});

test("HTTP library routes scope previews to episode membership", async (t) => {
  const workspace = await mkdtemp(path.join(tmpdir(), "storybench-library-http-"));
  const app = await createApp({ workspace });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { await app.close(); await rm(workspace, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const headers = { origin: base, "content-type": "application/json" };
  const episode = await (await fetch(`${base}/api/episodes`, { method: "POST", headers, body: JSON.stringify({ title: "One" }) })).json();
  const other = await (await fetch(`${base}/api/episodes`, { method: "POST", headers, body: JSON.stringify({ title: "Two" }) })).json();
  const itemResponse = await fetch(`${base}/api/episodes/${episode.id}/library/text`, { method: "POST", headers, body: JSON.stringify({ title: "notes", text: "scoped" }) });
  assert.equal(itemResponse.status, 201);
  const item = await itemResponse.json();
  const preview = await fetch(`${base}/api/episodes/${episode.id}/library/${item.id}/file`);
  assert.equal(await preview.text(), "scoped");
  assert.equal((await fetch(`${base}/api/episodes/${other.id}/library/${item.id}/file`)).status, 404);
  const items = await (await fetch(`${base}/api/episodes/${episode.id}/library`)).json();
  assert.equal(items[0].assetId, item.assetId);
});

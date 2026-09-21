import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import crypto from "node:crypto";
import { Store } from "../src/store.js";
import { buildRenderPlan } from "../src/composition-plan.js";

test("promotion preserves source and standards create editable fresh copies once", async (t) => {
  const workspace = await mkdtemp(path.join(tmpdir(), "storybench-branding-"));
  const store = new Store(workspace);
  t.after(async () => { store.close(); await rm(workspace, { recursive: true, force: true }); });
  const sourceEpisode = store.createEpisode({ title: "Source" });
  const bytes = Buffer.from("registered-image");
  const sourcePath = path.join(store.episodeOutputDirectory(sourceEpisode.id, "graphics"), "intro.png");
  await mkdir(path.dirname(sourcePath), { recursive: true });
  await writeFile(sourcePath, bytes);
  const hash = crypto.createHash("sha256").update(bytes).digest("hex");
  const asset = store.saveAsset({ name: "Intro", hash, kind: "image", path: path.relative(workspace, sourcePath), metadata: {} });
  const item = store.attachLibraryItem(sourceEpisode.id, asset.id, { category: "Graphics", label: "Intro art" });
  const sourceCard = { id: "intro-card", title: "Intro", type: "Static Graphic", prompt: "Open with channel identity", sectionId: null,
    itemId: item.id, referenceItemIds: [], duration: 2, order: 0, enabled: true };
  const updated = store.updateEpisode(sourceEpisode.id, sourceEpisode.revision, { cards: [sourceCard] });
  const template = store.promoteCard(sourceEpisode.id, sourceCard.id, { name: "Standard intro", role: "intro" });
  assert.equal(store.getEpisode(sourceEpisode.id).cards[0].id, sourceCard.id, "promotion preserves source card");
  assert.deepEqual(await readFile(path.join(workspace, store.getAsset(asset.id).path)), bytes);
  assert.equal(path.dirname(store.getAsset(asset.id).path), path.join("channels", sourceEpisode.channelId, "branding"));

  const target = store.createEpisode({ title: "Target" });
  assert.equal(target.cards.length, 1);
  assert.notEqual(target.cards[0].id, sourceCard.id);
  assert.equal(target.cards[0].brandingTemplateId, template.id);
  assert.equal(target.cards[0].anchorVisualCardId, null);
  const targetItems = store.listEpisodeLibrary(target.id);
  assert.equal(targetItems.length, 1);
  assert.notEqual(targetItems[0].id, item.id);
  assert.equal(targetItems[0].assetId, item.assetId);
  assert.equal(store.getStory(target.id).sections.find((section) => section.id === target.cards[0].sectionId).title, "Intro");
  assert.equal(store.applyBrandingTemplate(target.id, template.id, { automatic: true }).cards.length, 1, "reopen does not duplicate standard");
  assert.equal(updated.cards[0].title, "Intro");
});

test("v3 migration splits legacy visual and narration into a valid anchored plan", async (t) => {
  const workspace = await mkdtemp(path.join(tmpdir(), "storybench-card-migration-"));
  let store = new Store(workspace);
  t.after(async () => { store.close(); await rm(workspace, { recursive: true, force: true }); });
  const episode = store.createEpisode({ title: "Legacy" });
  const story = store.saveStory(episode.id, 1, "# Sections\n\n## Body");
  const video = store.saveAsset({ name: "video", hash: "video-hash", kind: "video", path: "media/video", duration: 5, metadata: { hasAudio: true } });
  const audio = store.saveAsset({ name: "audio", hash: "audio-hash", kind: "audio", path: "media/audio", duration: 4, metadata: { hasAudio: true } });
  const videoItem = store.attachLibraryItem(episode.id, video.id, { category: "B-roll" });
  const audioItem = store.attachLibraryItem(episode.id, audio.id, { category: "Narration" });
  const legacy = [{ id: "legacy-card", title: "Legacy scene", purpose: "Keep timing", notes: "", missing: "", sectionId: story.sections[0].id, duration: null,
    visual: { assetId: video.id, in: 0, out: 5, offset: 0, gain: 0.7 }, narration: { assetId: audio.id, in: 1, out: 3, offset: 1, gain: 0.4 } },
  { id: "planning-card", title: "Unfinished", purpose: "Preserve me", notes: "note", missing: "camera", sectionId: story.sections[0].id, visual: null, narration: null }];
  store.db.prepare("UPDATE episodes SET cards=? WHERE id=?").run(JSON.stringify(legacy), episode.id);
  store.db.exec("PRAGMA user_version=3");
  store.close();
  store = new Store(workspace);
  const migrated = store.getEpisode(episode.id).cards;
  assert.equal(migrated.length, 3);
  assert.equal(migrated[0].id, "legacy-card");
  assert.equal(migrated[0].itemId, videoItem.id);
  assert.equal(migrated[1].id, "legacy-card__audio");
  assert.equal(migrated[1].itemId, audioItem.id);
  assert.equal(migrated[1].anchorVisualCardId, "legacy-card");
  assert.equal(migrated[1].offset, 1);
  assert.equal(migrated[1].gain, 0.4);
  assert.deepEqual({ id: migrated[2].id, type: migrated[2].type, prompt: migrated[2].prompt, itemId: migrated[2].itemId, missing: migrated[2].missing },
    { id: "planning-card", type: "Video", prompt: "Preserve me", itemId: null, missing: "camera" });
  const plan = buildRenderPlan({ sections: store.getStory(episode.id).sections, cards: migrated.slice(0, 2), libraryItems: store.listEpisodeLibrary(episode.id) });
  assert.equal(plan.audioPlacements[0].startFrame, 30);
  assert.equal(plan.audioPlacements[0].sourceInFrame, 30);
});

test("changing standards affects later episodes without rewriting existing copies", async (t) => {
  const workspace = await mkdtemp(path.join(tmpdir(), "storybench-branding-role-"));
  const store = new Store(workspace);
  t.after(async () => { store.close(); await rm(workspace, { recursive: true, force: true }); });
  const source = store.createEpisode({ title: "Source" });
  const make = (id, title) => ({ id, title, type: "Video", prompt: "", sectionId: null, itemId: null, referenceItemIds: [], order: 0, enabled: true });
  const saved = store.updateEpisode(source.id, source.revision, { cards: [make("one", "One"), make("two", "Two")] });
  const one = store.promoteCard(source.id, "one", { role: "intro" });
  const first = store.createEpisode({ title: "First" });
  const two = store.promoteCard(source.id, "two", { role: "intro" });
  const second = store.createEpisode({ title: "Second" });
  assert.equal(first.cards[0].brandingTemplateId, one.id);
  assert.equal(second.cards[0].brandingTemplateId, two.id);
  assert.equal(store.getEpisode(first.id).cards[0].brandingTemplateId, one.id);
  assert.equal(store.getBrandingTemplate(one.id).role, null);
  assert.equal(saved.cards.length, 2);
});

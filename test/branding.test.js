import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import crypto from "node:crypto";
import { Store } from "../src/store.js";

test("promotion preserves source and standards create editable fresh copies once", async (t) => {
  const workspace = await mkdtemp(path.join(tmpdir(), "storybench-branding-"));
  const store = new Store(workspace);
  t.after(async () => { store.close(); await rm(workspace, { recursive: true, force: true }); });
  const sourceEpisode = store.createEpisode({ title: "Source" });
  const bytes = Buffer.from("registered-image");
  const sourcePath = path.join(workspace, "episodes", sourceEpisode.id, "graphics", "intro.png");
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
  assert.match(store.getAsset(asset.id).path, /^branding\/assets\//);

  const target = store.createEpisode({ title: "Target" });
  assert.equal(target.cards.length, 1);
  assert.notEqual(target.cards[0].id, sourceCard.id);
  assert.equal(target.cards[0].brandingTemplateId, template.id);
  assert.equal(target.cards[0].anchorVisualCardId, null);
  const targetItems = store.listEpisodeLibrary(target.id);
  assert.equal(targetItems.length, 1);
  assert.notEqual(targetItems[0].id, item.id);
  assert.equal(targetItems[0].assetId, item.assetId);
  assert.equal(store.applyBrandingTemplate(target.id, template.id, { automatic: true }).cards.length, 1, "reopen does not duplicate standard");

  const story = store.getStory(target.id);
  store.saveStory(target.id, story.storyRevision, "# Sections\n\n## Intro\n\n## Outro");
  assert.equal(store.getEpisode(target.id).cards[0].sectionId, store.getStory(target.id).sections[0].id);
  assert.equal(updated.cards[0].title, "Intro");
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

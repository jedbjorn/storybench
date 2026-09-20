import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Store } from "../src/store.js";
import { createRenderService } from "../src/render-service.js";

const digest = async (file) => createHash("sha256").update(await readFile(file)).digest("hex");
const waitFor = async (store, id) => {
  for (let attempt = 0; attempt < 100; attempt++) {
    const job = store.getJob(id);
    if (["completed", "failed", "cancelled"].includes(job.state)) return job;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("job did not finish");
};

async function fixture(overrides = {}) {
  const workspace = await mkdtemp(path.join(tmpdir(), "storybench-render-service-"));
  const store = new Store(workspace);
  let episode = store.createEpisode({ title: "Render service" });
  const story = store.saveStory(episode.id, 1, "# Sections\n\n## Main");
  const source = path.join(workspace, "media", "source.mp4");
  await writeFile(source, "source remains unchanged");
  const asset = store.saveAsset({ name: "source.mp4", hash: await digest(source), kind: "video", path: "media/source.mp4", duration: 1, metadata: { hasAudio: false } });
  const item = store.attachLibraryItem(episode.id, asset.id, { category: "B-roll", label: "Source" });
  episode = store.updateEpisode(episode.id, episode.revision, { cards: [{ id: "visual", title: "Visual", type: "Video", sectionId: story.sections[0].id, itemId: item.id, in: 0, out: 1 }] });
  const fakeRender = overrides.fakeRender || (async ({ outputPath, onProgress }) => {
    onProgress?.(.5); await writeFile(outputPath, "immutable output"); onProgress?.(1);
    return { path: outputPath, width: 1280, height: 720, duration: 1 };
  });
  const renders = createRenderService({ workspace, store, renderCompositionImpl: fakeRender,
    validateGraphicRecipe: (recipe) => structuredClone(recipe), renderGraphic: overrides.renderGraphic });
  return { workspace, store, renders, episode: () => store.getEpisode(episode.id), episodeId: episode.id, source };
}

test("final intent is exact, one-use and stale-safe while drafts need no grant", async (t) => {
  const value = await fixture();
  t.after(async () => { await value.renders.close(); value.store.close(); await rm(value.workspace, { recursive: true, force: true }); });
  const snapshot = value.renders.getRenderSnapshot(value.episodeId);
  const draft = value.renders.enqueueRender({ episodeId: value.episodeId, outputClass: "draft", expectedRenderRevision: snapshot.renderRevision });
  assert.equal((await waitFor(value.store, draft.id)).state, "completed");

  assert.throws(() => value.renders.enqueueRender({ episodeId: value.episodeId, outputClass: "final", expectedRenderRevision: snapshot.renderRevision }), /authorization/i);
  const grant = value.renders.mintFinalGrant({ episodeId: value.episodeId, expectedRenderRevision: snapshot.renderRevision, requestId: "gui-request" });
  assert.throws(() => value.renders.enqueueRender({ episodeId: value.episodeId, outputClass: "final", expectedRenderRevision: snapshot.renderRevision,
    finalGrantId: grant.id, requestId: "another-request" }), /does not match/i);
  const final = value.renders.enqueueRender({ episodeId: value.episodeId, outputClass: "final", expectedRenderRevision: snapshot.renderRevision,
    finalGrantId: grant.id, requestId: "gui-request" });
  assert.throws(() => value.renders.enqueueRender({ episodeId: value.episodeId, outputClass: "final", expectedRenderRevision: snapshot.renderRevision,
    finalGrantId: grant.id, requestId: "gui-request" }), /already used/i);
  const completed = await waitFor(value.store, final.id);
  const output = path.join(value.workspace, completed.outputPath), before = await digest(output);
  const episode = value.episode();
  let changed = value.store.updateEpisode(value.episodeId, episode.revision, { notes: "changed after final" });
  assert.equal(value.renders.getJob(value.episodeId, final.id).stale, true);
  changed = value.store.updateEpisode(value.episodeId, changed.revision, { cards: changed.cards.map((card) => ({ ...card, excluded: true })) });
  assert.equal(value.renders.getJob(value.episodeId, final.id).stale, true, "an invalid current plan cannot make an old output look current");
  assert.equal(await digest(output), before);
  assert.equal(await digest(value.source), createHash("sha256").update("source remains unchanged").digest("hex"));
});

test("changed render inputs invalidate an unconsumed final grant", async (t) => {
  const value = await fixture();
  t.after(async () => { await value.renders.close(); value.store.close(); await rm(value.workspace, { recursive: true, force: true }); });
  const snapshot = value.renders.getRenderSnapshot(value.episodeId);
  const grant = value.renders.mintFinalGrant({ episodeId: value.episodeId, expectedRenderRevision: snapshot.renderRevision, requestId: "intent" });
  const episode = value.episode();
  value.store.updateEpisode(value.episodeId, episode.revision, { notes: "new revision" });
  assert.throws(() => value.renders.enqueueRender({ episodeId: value.episodeId, outputClass: "final",
    expectedRenderRevision: snapshot.renderRevision, finalGrantId: grant.id, requestId: "intent" }), /inputs changed/i);
});

test("graphic output registers once and never overwrites a card changed during rendering", async (t) => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const value = await fixture({ renderGraphic: async ({ outputPath, signal }) => {
    await gate; if (signal.aborted) throw signal.reason; await writeFile(outputPath, "png bytes");
    return { path: outputPath, kind: "image", width: 1280, height: 720, metadata: { frames: 1 } };
  }});
  t.after(async () => { await value.renders.close(); value.store.close(); await rm(value.workspace, { recursive: true, force: true }); });
  const recipe = value.renders.createGraphicRecipe(value.episodeId, { name: "Title", cardId: "visual",
    recipe: { kind: "still", width: 1280, height: 720, layers: [{ kind: "text", text: "Title" }] } });
  value.renders.updateGraphicRecipe(value.episodeId, recipe.id, 1, { recipe: { ...recipe.recipe, background: "#123456" } });
  assert.equal(value.store.getGraphicRecipe(value.episodeId, recipe.id, 1).revision, 1);
  assert.equal(value.store.getGraphicRecipe(value.episodeId, recipe.id).revision, 2);
  const job = value.renders.enqueueGraphic({ episodeId: value.episodeId, recipeId: recipe.id, expectedRecipeRevision: 2 });
  const episode = value.episode();
  value.store.updateEpisode(value.episodeId, episode.revision, { cards: episode.cards.map((card) => ({ ...card, title: "User changed card" })) });
  release();
  const completed = await waitFor(value.store, job.id);
  assert.equal(completed.state, "completed", completed.error);
  assert.equal(completed.snapshot.appliedToCard, false);
  assert.match(completed.snapshot.applyNote, /not overwritten/);
  assert.equal(value.episode().cards[0].title, "User changed card");
  const graphics = value.store.listEpisodeLibrary(value.episodeId).filter((item) => item.provenance?.recipeId === recipe.id);
  assert.equal(graphics.length, 1);
  await access(path.join(value.workspace, completed.outputPath));
});

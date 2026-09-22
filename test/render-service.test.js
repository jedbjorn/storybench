import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
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

function finalRequest(value, { id = `request_${randomUUID()}`, conversationId = `conversation_${randomUUID()}` } = {}) {
  const stamp = new Date().toISOString();
  value.store.db.prepare("INSERT INTO conversations(id,episode_id,name,created_at,updated_at) VALUES(?,?,?,?,?)")
    .run(conversationId, value.episodeId, "Final", stamp, stamp);
  const message = value.store.addConversationMessage({ conversationId, role: "user", text: "Create final", shortcut: true });
  const run = value.store.createProductionRun({ id, conversationId, kind: "final", origin: "button", originatingMessageId: message.id, harness: "codex" }).run;
  return { run, conversationId, message };
}

test("Final publication uses request-bound intent once, pins output bytes, and drafts need no intent", async (t) => {
  const value = await fixture();
  t.after(async () => { await value.renders.close(); value.store.close(); await rm(value.workspace, { recursive: true, force: true }); });
  const snapshot = value.renders.getRenderSnapshot(value.episodeId);
  const draft = value.renders.enqueueRender({ episodeId: value.episodeId, outputClass: "draft", expectedRenderRevision: snapshot.renderRevision });
  assert.equal((await waitFor(value.store, draft.id)).state, "completed");

  assert.throws(() => value.renders.enqueueRender({ episodeId: value.episodeId, outputClass: "final", expectedRenderRevision: snapshot.renderRevision }), /request-bound Final intent/i);
  const authority = finalRequest(value);
  const publish = value.store.publishFinalIntent.bind(value.store);
  let publicationCalls = 0;
  value.store.publishFinalIntent = (...args) => { publicationCalls++; return publish(...args); };
  assert.throws(() => value.renders.enqueueRender({ episodeId: value.episodeId, outputClass: "final", expectedRenderRevision: snapshot.renderRevision,
    conversationId: "another-conversation", requestId: authority.run.id }), /does not match/i);
  const final = value.renders.enqueueRender({ episodeId: value.episodeId, outputClass: "final", expectedRenderRevision: snapshot.renderRevision,
    conversationId: authority.conversationId, requestId: authority.run.id });
  const repeated = value.renders.enqueueRender({ episodeId: value.episodeId, outputClass: "final", expectedRenderRevision: snapshot.renderRevision,
    conversationId: authority.conversationId, requestId: authority.run.id });
  assert.equal(repeated.id, final.id, "a repeated create_final call returns the same operation");
  const completed = await waitFor(value.store, final.id);
  assert.equal(value.store.getProductionRun(authority.run.id).finalIntent, "published");
  assert.equal(publicationCalls, 1, "the successful publication calls publishFinalIntent exactly once");
  assert.equal(value.store.getProductionRun(authority.run.id).finalOutputJobId, final.id);
  assert.equal(completed.snapshot.output.sha256, await digest(path.join(value.workspace, completed.outputPath)));
  assert.equal(completed.snapshot.output.bytes, Buffer.byteLength("immutable output"));
  assert.throws(() => value.store.publishFinalIntent(authority.run.id, final.id), /no active Final intent/i);
  const output = path.join(value.workspace, completed.outputPath), before = await digest(output);
  const episode = value.episode();
  let changed = value.store.updateEpisode(value.episodeId, episode.revision, { notes: "changed after final" });
  assert.equal(value.renders.getJob(value.episodeId, final.id).stale, true);
  value.store.updateEpisode(value.episodeId, changed.revision, { cards: changed.cards.map((card) => ({ ...card, excluded: true })) });
  assert.equal(value.renders.getJob(value.episodeId, final.id).stale, true, "an invalid current plan cannot make an old output look current");
  assert.equal(await digest(output), before);
  assert.equal(await digest(value.source), createHash("sha256").update("source remains unchanged").digest("hex"));
});

test("changed render inputs at publication fail instead of publishing stale Final inputs", async (t) => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const value = await fixture({ fakeRender: async ({ outputPath }) => { await gate; await writeFile(outputPath, "stale output"); return { path: outputPath, width: 1280, height: 720, duration: 1 }; } });
  t.after(async () => { await value.renders.close(); value.store.close(); await rm(value.workspace, { recursive: true, force: true }); });
  const snapshot = value.renders.getRenderSnapshot(value.episodeId);
  const authority = finalRequest(value);
  const final = value.renders.enqueueRender({ episodeId: value.episodeId, outputClass: "final", expectedRenderRevision: snapshot.renderRevision,
    conversationId: authority.conversationId, requestId: authority.run.id });
  const episode = value.episode();
  value.store.updateEpisode(value.episodeId, episode.revision, { notes: "new revision" });
  release();
  const failed = await waitFor(value.store, final.id);
  assert.equal(failed.state, "failed");
  assert.match(failed.error, /inputs changed before Final publication/i);
  assert.equal(failed.outputPath, null);
  assert.equal(value.store.getProductionRun(authority.run.id).finalIntent, "active", "the agent may validate current inputs and retry in this request");
  const current = value.renders.getRenderSnapshot(value.episodeId);
  const retried = value.renders.enqueueRender({ episodeId: value.episodeId, outputClass: "final", expectedRenderRevision: current.renderRevision,
    conversationId: authority.conversationId, requestId: authority.run.id });
  assert.notEqual(retried.id, final.id);
  assert.equal((await waitFor(value.store, retried.id)).state, "completed");
  assert.equal(value.store.getProductionRun(authority.run.id).finalOutputJobId, retried.id, "the retry publishes within the same active request");
});

test("the database revision guard closes a creator-save race immediately before Final publication", async (t) => {
  const value = await fixture();
  t.after(async () => { await value.renders.close(); value.store.close(); await rm(value.workspace, { recursive: true, force: true }); });
  const snapshot = value.renders.getRenderSnapshot(value.episodeId);
  const authority = finalRequest(value);
  const publish = value.store.publishFinalIntent.bind(value.store);
  let raced = false;
  value.store.publishFinalIntent = (...args) => {
    if (!raced) {
      raced = true;
      const current = value.episode();
      value.store.updateEpisode(value.episodeId, current.revision, { notes: "creator save between preflight and publication" });
    }
    return publish(...args);
  };
  const final = value.renders.enqueueRender({ episodeId: value.episodeId, outputClass: "final", expectedRenderRevision: snapshot.renderRevision,
    conversationId: authority.conversationId, requestId: authority.run.id });
  const failed = await waitFor(value.store, final.id);
  assert.equal(failed.state, "failed");
  assert.match(failed.error, /inputs changed before Final publication/i);
  assert.equal(failed.outputPath, null);
  assert.equal(value.store.getProductionRun(authority.run.id).finalIntent, "active");
});

test("the database revision guard closes a story-only save race immediately before Final publication", async (t) => {
  const value = await fixture();
  t.after(async () => { await value.renders.close(); value.store.close(); await rm(value.workspace, { recursive: true, force: true }); });
  const snapshot = value.renders.getRenderSnapshot(value.episodeId);
  const authority = finalRequest(value);
  const publish = value.store.publishFinalIntent.bind(value.store);
  let raced = false;
  value.store.publishFinalIntent = (...args) => {
    if (!raced) {
      raced = true;
      const story = value.store.getStory(value.episodeId);
      value.store.saveStory(value.episodeId, story.storyRevision, `${story.source}\n\nStory-only edit in the publication gap.`);
    }
    return publish(...args);
  };
  const final = value.renders.enqueueRender({ episodeId: value.episodeId, outputClass: "final", expectedRenderRevision: snapshot.renderRevision,
    conversationId: authority.conversationId, requestId: authority.run.id });
  const failed = await waitFor(value.store, final.id);
  assert.equal(failed.state, "failed");
  assert.match(failed.error, /inputs changed before Final publication/i);
  assert.equal(failed.outputPath, null);
  assert.equal(value.store.getProductionRun(authority.run.id).finalIntent, "active");
});

test("closed worker rejects Final enqueue before using request intent or creating a job", async (t) => {
  const value = await fixture();
  t.after(async () => { value.store.close(); await rm(value.workspace, { recursive: true, force: true }); });
  const snapshot = value.renders.getRenderSnapshot(value.episodeId);
  const authority = finalRequest(value);
  await value.renders.close();
  assert.throws(() => value.renders.enqueueRender({ episodeId: value.episodeId, outputClass: "final",
    expectedRenderRevision: snapshot.renderRevision, conversationId: authority.conversationId, requestId: authority.run.id }), /worker is closed/i);
  assert.equal(value.store.listJobs(value.episodeId).length, 0);
  assert.equal(value.store.getProductionRun(authority.run.id).finalIntent, "active");
  assert.equal(value.store.tableExists("final_authorizations"), true, "historical grant rows remain readable");
  for (const method of ["createFinalAuthorization", "consumeFinalAuthorization", "saveAuthorizedFinalJob"])
    assert.equal(value.store[method], undefined, `${method} is retired`);
  value.store.db.prepare("INSERT INTO final_authorizations VALUES(?,?,?,?,?,?,?,?)")
    .run("historical-grant", value.episodeId, "a".repeat(64), null, null, "2025-01-01T00:05:00.000Z", "2025-01-01T00:01:00.000Z", "2025-01-01T00:00:00.000Z");
  assert.deepEqual({ ...value.store.db.prepare("SELECT id,render_revision,consumed_at FROM final_authorizations WHERE id=?").get("historical-grant") },
    { id: "historical-grant", render_revision: "a".repeat(64), consumed_at: "2025-01-01T00:01:00.000Z" });
});

test("request-bound Final intent outlives the retired five-minute grant window", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-09-21T10:00:00.000Z") });
  const value = await fixture();
  t.after(async () => { await value.renders.close(); value.store.close(); await rm(value.workspace, { recursive: true, force: true }); });
  const authority = finalRequest(value);
  t.mock.timers.tick(10 * 60_000);
  const edited = value.episode();
  value.store.updateEpisode(value.episodeId, edited.revision, { notes: "prepared by the agent after Final intent was bound" }, "agent");
  const snapshot = value.renders.getRenderSnapshot(value.episodeId);
  const final = value.renders.enqueueRender({ episodeId: value.episodeId, outputClass: "final", expectedRenderRevision: snapshot.renderRevision,
    conversationId: authority.conversationId, requestId: authority.run.id });
  assert.equal((await waitFor(value.store, final.id)).state, "completed");
  assert.equal(value.store.getProductionRun(authority.run.id).finalIntent, "published");
});

test("cancelling a request-owned Final job ends its intent as cancelled without publishing", async (t) => {
  let started, release;
  const running = new Promise((resolve) => { started = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  const value = await fixture({ fakeRender: async ({ outputPath, signal }) => {
    started(); await gate; if (signal.aborted) throw signal.reason; await writeFile(outputPath, "must not publish"); return { path: outputPath };
  } });
  t.after(async () => { release(); await value.renders.close(); value.store.close(); await rm(value.workspace, { recursive: true, force: true }); });
  const authority = finalRequest(value), snapshot = value.renders.getRenderSnapshot(value.episodeId);
  const final = value.renders.enqueueRender({ episodeId: value.episodeId, outputClass: "final", expectedRenderRevision: snapshot.renderRevision,
    conversationId: authority.conversationId, requestId: authority.run.id });
  await running;
  value.renders.cancelJob(value.episodeId, final.id);
  assert.deepEqual((({ finalIntent, finalEndedReason }) => ({ finalIntent, finalEndedReason }))(value.store.getProductionRun(authority.run.id)),
    { finalIntent: "ended", finalEndedReason: "cancelled" });
  release();
  assert.equal((await waitFor(value.store, final.id)).state, "cancelled");
  assert.equal(value.store.getProductionRun(authority.run.id).finalOutputJobId, null);
});

test("moving a published Final to Drafts and requesting Final again creates a new version", async (t) => {
  const value = await fixture();
  t.after(async () => { await value.renders.close(); value.store.close(); await rm(value.workspace, { recursive: true, force: true }); });
  const firstRequest = finalRequest(value), snapshot = value.renders.getRenderSnapshot(value.episodeId);
  const first = value.renders.enqueueRender({ episodeId: value.episodeId, outputClass: "final", expectedRenderRevision: snapshot.renderRevision,
    conversationId: firstRequest.conversationId, requestId: firstRequest.run.id });
  await waitFor(value.store, first.id);
  value.store.updateProductionRun(firstRequest.run.id, { state: "completed" });
  const moved = value.store.moveFinalToDrafts({ episodeId: value.episodeId, outputId: first.id, expectedRevision: 1, actor: "human" });
  assert.equal(moved.designation, "draft");

  const message = value.store.addConversationMessage({ conversationId: firstRequest.conversationId, role: "user", text: "Create another final", shortcut: true });
  const secondRequest = value.store.createProductionRun({ conversationId: firstRequest.conversationId, kind: "final", origin: "button",
    originatingMessageId: message.id, harness: "codex" }).run;
  const second = value.renders.enqueueRender({ episodeId: value.episodeId, outputClass: "final", expectedRenderRevision: snapshot.renderRevision,
    conversationId: firstRequest.conversationId, requestId: secondRequest.id });
  await waitFor(value.store, second.id);
  assert.notEqual(second.id, first.id);
  assert.equal(value.store.getJob(first.id).designation, "draft");
  assert.equal(value.store.getJob(second.id).designation, "final");
  assert.equal(value.store.getProductionRun(secondRequest.id).finalOutputJobId, second.id);
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

test("graphic database publication rolls back before deleting a failed output", async (t) => {
  const workspace = await mkdtemp(path.join(tmpdir(), "storybench-graphic-rollback-"));
  const store = new Store(workspace, { beforeGraphicMembership: () => { throw new Error("injected membership failure"); } });
  const episode = store.createEpisode({ title: "Rollback" });
  const renders = createRenderService({ workspace, store, validateGraphicRecipe: (recipe) => structuredClone(recipe),
    renderGraphic: async ({ outputPath }) => { await writeFile(outputPath, "staged graphic"); return { path: outputPath, kind: "image", width: 10, height: 10, metadata: { frames: 1 } }; } });
  t.after(async () => { await renders.close(); store.close(); await rm(workspace, { recursive: true, force: true }); });
  const recipe = renders.createGraphicRecipe(episode.id, { name: "Rollback",
    recipe: { kind: "still", width: 10, height: 10, layers: [] } });
  const job = renders.enqueueGraphic({ episodeId: episode.id, recipeId: recipe.id, expectedRecipeRevision: 1 });
  const failed = await waitFor(store, job.id);
  assert.equal(failed.state, "failed");
  assert.match(failed.error, /injected membership failure/);
  assert.deepEqual(store.listAssets(), []);
  assert.deepEqual(store.listEpisodeLibrary(episode.id), []);
  const graphicsDir = store.episodeOutputDirectory(episode.id, "graphics");
  assert.deepEqual(await import("node:fs/promises").then(({ readdir }) => readdir(graphicsDir)), []);
});

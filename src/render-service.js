import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, rm } from "node:fs/promises";
import path from "node:path";
import { buildRenderPlan } from "./composition-plan.js";
import { renderComposition } from "./composition-renderer.js";
import { HeavyJobQueue, renderFingerprint } from "./job-runner.js";
import { StoreError } from "./store.js";

const jobId = () => `job_${randomUUID()}`;
const now = () => new Date().toISOString();

function inside(root, candidate) {
  const base = path.resolve(root);
  const value = path.resolve(candidate);
  if (value !== base && !value.startsWith(`${base}${path.sep}`)) throw new StoreError("Path must remain inside the workspace");
  return value;
}

function pinnedItem(item) {
  return {
    id: item.id, revision: item.revision, category: item.category, sectionId: item.sectionId,
    provenance: item.provenance, assetId: item.assetId,
    asset: item.asset && { id: item.asset.id, hash: item.asset.hash, kind: item.asset.kind, path: item.asset.path,
      duration: item.asset.duration, width: item.asset.width, height: item.asset.height, metadata: item.asset.metadata },
  };
}

export function createRenderService({ workspace, store, renderGraphic, validateGraphicRecipe, renderCompositionImpl = renderComposition }) {
  const root = path.resolve(workspace);
  const worker = new HeavyJobQueue();

  function getRenderSnapshot(episodeId) {
    const episode = store.getEpisode(episodeId);
    if (!episode) throw new StoreError("Episode not found", 404);
    const story = store.getStory(episodeId);
    const libraryItems = store.listEpisodeLibrary(episodeId);
    const composition = buildRenderPlan({ sections: story.sections, cards: episode.cards, libraryItems });
    const referenced = new Set(composition.referencedLibraryItemIds);
    const pinnedLibrary = libraryItems.filter((item) => referenced.has(item.id)).map(pinnedItem);
    const graphicRecipes = [];
    for (const item of pinnedLibrary) {
      const recipeId = item.provenance?.recipeId;
      const recipeRevision = item.provenance?.recipeRevision;
      if (!recipeId || !Number.isInteger(recipeRevision)) continue;
      const recipe = store.getGraphicRecipe(episodeId, recipeId, recipeRevision);
      if (!recipe) throw new StoreError(`Pinned graphic recipe is unavailable: ${recipeId} r${recipeRevision}`, 409);
      graphicRecipes.push({ id: recipe.id, revision: recipe.revision, recipe: recipe.recipe });
    }
    const snapshot = {
      episode: { id: episode.id, revision: episode.revision, title: episode.title, cards: episode.cards },
      story: { storyRevision: story.storyRevision, source: story.source, sections: story.sections },
      libraryItems: pinnedLibrary,
      graphicRecipes,
      composition,
    };
    return { ...snapshot, renderRevision: renderFingerprint(snapshot) };
  }

  function validateRender(episodeId) { return getRenderSnapshot(episodeId); }

  function mintFinalGrant({ episodeId, expectedRenderRevision, conversationId = null, requestId = null }) {
    const snapshot = getRenderSnapshot(episodeId);
    if (snapshot.renderRevision !== expectedRenderRevision)
      throw new StoreError("Render inputs changed; review the current cut before authorizing final", 409, { currentRenderRevision: snapshot.renderRevision });
    if (!conversationId && !requestId) throw new StoreError("A conversation or GUI request id is required");
    return store.createFinalAuthorization({ episodeId, renderRevision: snapshot.renderRevision, conversationId, requestId });
  }

  function queueRender(job) {
    worker.enqueue(job.id, async (signal) => {
      let current = store.saveJob({ ...job, state: "running" });
      try {
        const folderName = job.outputClass === "final" ? "final" : "drafts";
        const folder = inside(root, path.join(root, "episodes", job.episodeId, folderName));
        await mkdir(folder, { recursive: true });
        const outputPath = inside(folder, path.join(folder, `${job.id}.mp4`));
        const result = await renderCompositionImpl({
          workspace: root, outputPath, preview: job.outputClass === "draft", signal,
          plan: job.snapshot.composition, libraryItems: job.snapshot.libraryItems,
          onProgress: (progress) => { current = store.saveJob({ ...current, state: "running", progress }); },
        });
        const relative = path.relative(root, inside(root, result.path || outputPath));
        store.saveJob({ ...current, state: "completed", progress: 1, outputPath: relative, error: null });
      } catch (error) {
        const cancelled = signal.aborted || error?.name === "AbortError";
        store.saveJob({ ...current, state: cancelled ? "cancelled" : "failed", error: cancelled ? signal.reason?.message || "Job cancelled" : error.message, outputPath: null });
      }
    }, (reason) => store.saveJob({ ...job, state: "cancelled", error: reason, outputPath: null }),
    (error) => store.saveJob({ ...job, state: "failed", error: error.message || String(error), outputPath: null }));
  }

  function enqueueRender({ episodeId, outputClass, expectedRenderRevision, finalGrantId = null, conversationId = null, requestId = null }) {
    if (!["draft", "final"].includes(outputClass)) throw new StoreError("outputClass must be draft or final");
    const snapshot = getRenderSnapshot(episodeId);
    if (snapshot.renderRevision !== expectedRenderRevision)
      throw new StoreError("Render inputs changed; validate the current cut and try again", 409, { currentRenderRevision: snapshot.renderRevision });
    const createdAt = now();
    const value = { id: jobId(), episodeId, kind: outputClass, outputClass, state: "queued", progress: 0,
      revision: snapshot.episode.revision, snapshot, createdAt };
    const job = outputClass === "final"
      ? store.saveAuthorizedFinalJob(finalGrantId, { episodeId, renderRevision: snapshot.renderRevision, conversationId, requestId }, value)
      : store.saveJob(value);
    queueRender(job);
    return job;
  }

  function getJob(episodeId, id) {
    const job = store.getJob(id);
    if (!job || job.episodeId !== episodeId) throw new StoreError("Job not found", 404);
    if (!["draft", "final"].includes(job.outputClass)) return { ...job, stale: null };
    let current;
    try { current = getRenderSnapshot(episodeId).renderRevision; } catch { current = null; }
    return { ...job, stale: Boolean(job.snapshot?.renderRevision && (!current || job.snapshot.renderRevision !== current)) };
  }

  function listJobs(episodeId) { return store.listJobs(episodeId).map((job) => getJob(episodeId, job.id)); }

  function cancelJob(episodeId, id) {
    const job = getJob(episodeId, id);
    if (!['queued', 'running'].includes(job.state)) throw new StoreError("Only queued or running jobs can be cancelled", 409);
    if (!worker.cancel(id)) throw new StoreError("Job is no longer active", 409);
    return getJob(episodeId, id);
  }

  function createGraphicRecipe(episodeId, input, actor = "user") {
    if (!validateGraphicRecipe) throw new StoreError("Graphics capability is unavailable", 503);
    const normalized = validateGraphicRecipe(input.recipe);
    return store.createGraphicRecipe(episodeId, { ...input, kind: normalized.kind, recipe: normalized }, actor);
  }

  function updateGraphicRecipe(episodeId, recipeId, expectedRevision, input, actor = "user") {
    if (!validateGraphicRecipe) throw new StoreError("Graphics capability is unavailable", 503);
    const normalized = validateGraphicRecipe(input.recipe);
    const current = store.getGraphicRecipe(episodeId, recipeId);
    if (current && current.kind !== normalized.kind) throw new StoreError("Graphic kind cannot change after creation");
    return store.updateGraphicRecipe(episodeId, recipeId, expectedRevision, { ...input, recipe: normalized }, actor);
  }

  function enqueueGraphic({ episodeId, recipeId, expectedRecipeRevision }) {
    if (!renderGraphic) throw new StoreError("Graphics capability is unavailable", 503);
    const recipe = store.getGraphicRecipe(episodeId, recipeId);
    if (!recipe) throw new StoreError("Graphic recipe not found", 404);
    if (recipe.revision !== expectedRecipeRevision) throw new StoreError(`Stale graphic revision: expected ${recipe.revision}`, 409, { current: recipe });
    const episode = store.getEpisode(episodeId);
    const targetCard = recipe.cardId ? episode.cards.find((card) => card.id === recipe.cardId) : null;
    const snapshot = { recipe: { id: recipe.id, revision: recipe.revision, recipe: recipe.recipe },
      episodeRevision: episode.revision, targetCard: targetCard && { id: targetCard.id, type: targetCard.type, itemId: targetCard.itemId } };
    const value = store.saveJob({ id: jobId(), episodeId, kind: `graphic-${recipe.kind}`, outputClass: "graphic",
      state: "queued", progress: 0, revision: episode.revision, snapshot: { ...snapshot, renderRevision: renderFingerprint(snapshot) } });
    worker.enqueue(value.id, async (signal) => {
      let current = store.saveJob({ ...value, state: "running" });
      const extension = recipe.kind === "still" ? "png" : "mp4";
      const folder = inside(root, path.join(root, "episodes", episodeId, "graphics"));
      const outputPath = inside(folder, path.join(folder, `${recipe.id}-r${recipe.revision}-${value.id}.${extension}`));
      let published = false;
      try {
        await mkdir(folder, { recursive: true });
        const items = new Map(store.listEpisodeLibrary(episodeId).map((item) => [item.id, item]));
        const resolveImage = async (itemId) => {
          const item = items.get(itemId);
          if (!item || item.asset?.kind !== "image") throw new StoreError(`Registered image item not found: ${itemId}`);
          const actual = await realpath(inside(root, path.join(root, item.asset.path)));
          return inside(root, actual);
        };
        const result = await renderGraphic({ workspace: root, recipe: recipe.recipe, outputPath, resolveImage, signal,
          onProgress: (progress) => { current = store.saveJob({ ...current, state: "running", progress }); } });
        if (signal.aborted) throw signal.reason || new DOMException("Job cancelled", "AbortError");
        const bytes = await readFile(inside(root, result.path || outputPath));
        const hash = createHash("sha256").update(bytes).digest("hex");
        const asset = store.saveAsset({ name: `${recipe.name}.${extension}`, hash, kind: result.kind,
          path: path.relative(root, result.path || outputPath), width: result.width, height: result.height,
          duration: result.duration ?? null, metadata: { ...result.metadata, graphicRecipeId: recipe.id, graphicRecipeRevision: recipe.revision } });
        let item = store.listEpisodeLibrary(episodeId).find((candidate) => candidate.provenance?.recipeId === recipe.id && candidate.provenance?.recipeRevision === recipe.revision);
        if (!item) item = store.attachLibraryItem(episodeId, asset.id, { category: "Graphics", label: recipe.name,
          sourceKind: "graphic", provenance: { recipeId: recipe.id, recipeRevision: recipe.revision, jobId: value.id } });
        published = true;
        let appliedToCard = false, applyNote = null;
        if (recipe.cardId && snapshot.targetCard) {
          const latest = store.getEpisode(episodeId);
          const currentCard = latest.cards.find((card) => card.id === recipe.cardId);
          const unchanged = latest.revision === snapshot.episodeRevision && currentCard &&
            currentCard.type === snapshot.targetCard.type && currentCard.itemId === snapshot.targetCard.itemId;
          if (unchanged) {
            const cards = latest.cards.map((card) => card.id === recipe.cardId ? { ...card, itemId: item.id,
              type: recipe.kind === "still" ? "Static Graphic" : "Video Graphic" } : card);
            store.updateEpisode(episodeId, latest.revision, { cards }, "graphic");
            appliedToCard = true;
          } else applyNote = "Graphic registered in the library; the target card changed while rendering and was not overwritten";
        }
        store.saveJob({ ...current, state: "completed", progress: 1, outputPath: asset.path, error: null,
          snapshot: { ...current.snapshot, libraryItemId: item.id, assetId: asset.id, appliedToCard, applyNote } });
      } catch (error) {
        const cancelled = signal.aborted || error?.name === "AbortError";
        if (!published) await rm(outputPath, { force: true }).catch(() => {});
        store.saveJob({ ...current, state: cancelled ? "cancelled" : "failed", error: cancelled ? signal.reason?.message || "Job cancelled" : error.message, outputPath: null });
      }
    }, (reason) => store.saveJob({ ...value, state: "cancelled", error: reason, outputPath: null }),
    (error) => store.saveJob({ ...value, state: "failed", error: error.message || String(error), outputPath: null }));
    return value;
  }

  return { getRenderSnapshot, validateRender, mintFinalGrant, enqueueRender, getJob, listJobs, cancelJob,
    createGraphicRecipe, updateGraphicRecipe, enqueueGraphic, listGraphicRecipes: (episodeId) => store.listGraphicRecipes(episodeId),
    getGraphicRecipe: (episodeId, recipeId) => store.getGraphicRecipe(episodeId, recipeId), close: (reason) => worker.close(reason) };
}

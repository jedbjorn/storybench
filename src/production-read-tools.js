// Read-only production tools shared by a production turn and an agent job (spec #42 'Tools').
// None of them writes; a turn adds its research gate and its write tools around them.
import { getDeckReadiness } from "./runtime/deck-readiness.js";
import { releaseFromEnv } from "./runtime/health.js";
import { fontCatalog } from "./fonts.js";
import { getOperationGuide, OPERATION_GUIDE_NAMES } from "./agent-guides.js";

const notFound = (message) => Object.assign(new Error(message), { statusCode: 404 });

export function createProductionReadTools({ store, renders, decks, episodeId, brandStandards }) {
  const episode = () => { const value = store.getEpisode(episodeId); if (!value) throw notFound("Episode not found"); return value; };
  const librarySummary = () => store.listEpisodeLibrary(episodeId).map((item) => ({ id: item.id, revision: item.revision, label: item.label,
    category: item.category, sourceKind: item.sourceKind, extractionStatus: item.extractionStatus,
    asset: item.asset && { id: item.asset.id, name: item.asset.name, kind: item.asset.kind, duration: item.asset.duration, width: item.asset.width, height: item.asset.height } }));
  const excerpt = (itemId, offset = 0, limit = 4000) => {
    const item = store.listEpisodeLibrary(episodeId).find((candidate) => candidate.id === itemId);
    const current = episode();
    // Scope comes from explicit episode/card links; the Reference category remains readable as before.
    const linked = current.referenceItemIds.includes(itemId) || current.cards.some((card) => (card.referenceItemIds || []).includes(itemId));
    if (!item || (item.category !== "Reference" && !linked)) throw notFound("Reference item not found");
    const text = item.extractedText ?? item.provenance?.extractedText ?? "", start = Math.max(0, Number(offset) || 0), size = Math.min(20_000, Math.max(1, Number(limit) || 4000));
    return { itemId, offset: start, text: text.slice(start, start + size), truncated: start + size < text.length };
  };
  return {
    read_deck: () => store.getDeck(episodeId),
    get_context: () => ({ episode: episode(), story: store.getStory(episodeId), library: librarySummary(), research: store.getResearchMetadata(episodeId),
      ...(episode().kind === "deck" ? { deckCapabilities: { runtime: getDeckReadiness(releaseFromEnv()), installation: releaseFromEnv()?.deckReadiness ?? { state: "unverified", reason: "No release receipt" }, request: "Use get_capabilities for the selected model and served image tools." } } : {}),
      brandStandards, fonts: fontCatalog(), references: store.getReferenceContext(episodeId), branding: store.listBrandingTemplates({ channelId: episode().channelId }), operationGuides: OPERATION_GUIDE_NAMES }),
    get_operation_guide: ({ name }) => getOperationGuide(name),
    read_reference_excerpt: ({ itemId, offset, limit }) => excerpt(itemId, offset, limit),
    get_job: ({ jobId }) => (episode().kind === "deck" ? decks : renders).getJob(episodeId, jobId),
  };
}

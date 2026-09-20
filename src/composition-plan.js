const CARD_TYPES = new Set([
  "Video/Audio",
  "Video",
  "Audio",
  "Static Graphic",
  "Video Graphic",
]);
const VISUAL_TYPES = new Set(["Video/Audio", "Video", "Static Graphic", "Video Graphic"]);
const AUDIO_ROLES = new Set(["voiceover", "music", "sound effect", "other"]);

export class CompositionError extends Error {
  constructor(issues) {
    super(issues.map((issue) => `${issue.cardTitle || issue.cardId || "Composition"}: ${issue.message}`).join("; "));
    this.name = "CompositionError";
    this.issues = issues;
  }
}

const issue = (code, card, message) => ({
  code,
  ...(card ? { cardId: card.id, cardTitle: card.title || card.id } : {}),
  message,
});
const enabled = (card) => card.enabled !== false && card.excluded !== true;
const secondsToFrame = (value, fps) => Math.round(value * fps);

function libraryIndex(items, issues) {
  const index = new Map();
  for (const item of items || []) {
    if (!item?.id || index.has(item.id)) {
      issues.push({ code: "duplicate-library-item", message: `Library item id ${item?.id || "(missing)"} is not unique` });
      continue;
    }
    index.set(item.id, item);
  }
  return index;
}

function orderedCards(sections, cards) {
  const sectionOrder = new Map((sections || []).map((section, index) => [section.id, index]));
  return cards
    .map((card, inputOrder) => ({ card, inputOrder }))
    .sort((left, right) => {
      const leftSection = sectionOrder.get(left.card.sectionId) ?? Number.MAX_SAFE_INTEGER;
      const rightSection = sectionOrder.get(right.card.sectionId) ?? Number.MAX_SAFE_INTEGER;
      return leftSection - rightSection ||
        (Number.isFinite(left.card.order) ? left.card.order : 0) - (Number.isFinite(right.card.order) ? right.card.order : 0) ||
        left.inputOrder - right.inputOrder;
    })
    .map(({ card }) => card);
}

function checkedGain(card, issues) {
  const gain = card.gain ?? 1;
  if (!Number.isFinite(gain) || gain < 0 || gain > 8)
    issues.push(issue("invalid-gain", card, "gain must be between 0 and 8"));
  return gain;
}

function checkedTrim(card, item, fps, issues, { still = false } = {}) {
  if (still) {
    if (!Number.isFinite(card.duration) || card.duration <= 0) {
      issues.push(issue("invalid-duration", card, "static graphics require a positive duration"));
      return null;
    }
    return { sourceInFrame: 0, sourceOutFrame: null, durationFrames: secondsToFrame(card.duration, fps) };
  }
  const start = card.in ?? 0;
  const end = card.out ?? item?.asset?.duration;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) {
    issues.push(issue("invalid-trim", card, "source in/out must define a positive range"));
    return null;
  }
  if (Number.isFinite(item?.asset?.duration) && end > item.asset.duration + 1e-9) {
    issues.push(issue("trim-out-of-range", card, "source out exceeds the registered asset duration"));
    return null;
  }
  const sourceInFrame = secondsToFrame(start, fps);
  const sourceOutFrame = secondsToFrame(end, fps);
  if (sourceOutFrame <= sourceInFrame) {
    issues.push(issue("trim-below-frame", card, `source range is shorter than one ${fps} fps frame`));
    return null;
  }
  return { sourceInFrame, sourceOutFrame, durationFrames: sourceOutFrame - sourceInFrame };
}

export function buildRenderPlan({ sections = [], cards = [], libraryItems = [], fps = 30 }) {
  const issues = [];
  if (!Number.isInteger(fps) || fps <= 0) issues.push({ code: "invalid-fps", message: "fps must be a positive integer" });
  const safeFps = Number.isInteger(fps) && fps > 0 ? fps : 30;
  const ids = new Set();
  for (const card of cards) {
    if (!card?.id || ids.has(card.id)) issues.push(issue("duplicate-card-id", card, "card id must be present and unique"));
    else ids.add(card.id);
    if (!CARD_TYPES.has(card?.type)) issues.push(issue("unknown-card-type", card, `unknown card type ${card?.type || "(missing)"}`));
  }
  const sectionIds = new Set(sections.map((section) => section.id));
  const items = libraryIndex(libraryItems, issues);
  const active = orderedCards(sections, cards.filter(enabled));
  for (const card of active)
    if (!card.sectionId || !sectionIds.has(card.sectionId))
      issues.push(issue("unassigned-card", card, "enabled card must be assigned to a current story section"));

  const visualSpine = [];
  let cursor = 0;
  for (const card of active.filter((candidate) => VISUAL_TYPES.has(candidate.type))) {
    const item = items.get(card.itemId);
    if (!item) {
      issues.push(issue("missing-visual", card, "enabled visual has no registered episode library item"));
      continue;
    }
    const allowedKinds = card.type === "Static Graphic" ? ["image"] : ["video"];
    if (!allowedKinds.includes(item.asset?.kind)) {
      issues.push(issue("wrong-visual-kind", card, `${card.type} requires ${allowedKinds.join(" or ")} media`));
      continue;
    }
    const trim = checkedTrim(card, item, safeFps, issues, { still: card.type === "Static Graphic" });
    if (!trim) continue;
    const gain = card.type === "Video/Audio" ? checkedGain(card, issues) : 0;
    visualSpine.push({
      cardId: card.id,
      sectionId: card.sectionId,
      itemId: item.id,
      assetId: item.assetId,
      startFrame: cursor,
      durationFrames: trim.durationFrames,
      sourceInFrame: trim.sourceInFrame,
      sourceOutFrame: trim.sourceOutFrame,
      includeSourceAudio: card.type === "Video/Audio",
      gain,
    });
    cursor += trim.durationFrames;
  }
  if (!visualSpine.length) issues.push({ code: "missing-visual-spine", message: "render requires at least one enabled visual card; no filler is added" });

  const visualById = new Map(visualSpine.map((visual) => [visual.cardId, visual]));
  const activeById = new Map(active.map((card) => [card.id, card]));
  const audioPlacements = [];
  for (const card of active.filter((candidate) => candidate.type === "Audio")) {
    const item = items.get(card.itemId);
    if (!item) {
      issues.push(issue("missing-audio", card, "enabled audio has no registered episode library item"));
      continue;
    }
    if (!(item.asset?.kind === "audio" || (item.asset?.kind === "video" && item.asset?.metadata?.hasAudio))) {
      issues.push(issue("wrong-audio-kind", card, "audio card requires registered audio-bearing media"));
      continue;
    }
    const anchorCard = activeById.get(card.anchorVisualCardId);
    const anchor = visualById.get(card.anchorVisualCardId);
    if (!anchor || !anchorCard || !VISUAL_TYPES.has(anchorCard.type)) {
      issues.push(issue("missing-audio-anchor", card, "enabled audio must anchor to an enabled visual card"));
      continue;
    }
    if (!Number.isFinite(card.offset ?? 0) || (card.offset ?? 0) < 0) {
      issues.push(issue("invalid-audio-offset", card, "audio offset must be zero or greater"));
      continue;
    }
    if (!AUDIO_ROLES.has(card.role)) issues.push(issue("invalid-audio-role", card, "audio role must be voiceover, music, sound effect or other"));
    const trim = checkedTrim(card, item, safeFps, issues);
    if (!trim) continue;
    const startFrame = anchor.startFrame + secondsToFrame(card.offset ?? 0, safeFps);
    const endFrame = startFrame + trim.durationFrames;
    if (endFrame > cursor) {
      issues.push(issue("audio-beyond-cut", card, "audio extends beyond the visual cut; it is not silently trimmed"));
      continue;
    }
    const fadeInFrames = secondsToFrame(card.fadeIn ?? 0, safeFps);
    const fadeOutFrames = secondsToFrame(card.fadeOut ?? 0, safeFps);
    if (fadeInFrames < 0 || fadeOutFrames < 0 || fadeInFrames + fadeOutFrames > trim.durationFrames)
      issues.push(issue("invalid-audio-fade", card, "audio fades must be non-negative and fit within the placement"));
    audioPlacements.push({
      cardId: card.id,
      sectionId: card.sectionId,
      itemId: item.id,
      assetId: item.assetId,
      role: card.role,
      anchorVisualCardId: card.anchorVisualCardId,
      startFrame,
      endFrame,
      sourceInFrame: trim.sourceInFrame,
      sourceOutFrame: trim.sourceOutFrame,
      gain: checkedGain(card, issues),
      fadeInFrames,
      fadeOutFrames,
    });
  }

  if (issues.length) throw new CompositionError(issues);
  return {
    fps: safeFps,
    durationFrames: cursor,
    visualSpine,
    audioPlacements,
    referencedLibraryItemIds: [...new Set([...visualSpine, ...audioPlacements].map((placement) => placement.itemId))],
    referencedAssetIds: [...new Set([...visualSpine, ...audioPlacements].map((placement) => placement.assetId))],
  };
}

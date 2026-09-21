// Cross-project catalogue for the scoped tools. Project visibility across the
// installation's channels/episodes is ordinary context (decision #39); every result carries
// its origin (channel, episode, item) so the agent can tell what it found. All lookups go
// through the store; files resolve through the project-root containment check.
import path from "node:path";
import { PROJECT_ROOTS } from "./layout.js";
import { RuntimeError, resolveProjectFile } from "./validate.js";

const lower = (value) => String(value ?? "").toLowerCase();

export function originOf(store, episodeId, item = null) {
  const episode = store.getEpisode(episodeId);
  if (!episode) throw new RuntimeError("EPISODE_NOT_FOUND", "Episode not found", { status: 404 });
  const channel = store.getChannel?.(episode.channelId) ?? null;
  return {
    channel: { id: episode.channelId, name: channel?.name ?? null },
    episode: { id: episode.id, title: episode.title },
    ...(item ? { item: { id: item.id, label: item.label, category: item.category, kind: item.asset?.kind ?? null } } : {}),
  };
}

// Is this library item reference material in its episode (by category or by an explicit
// episode/card reference link)?
export function isReferenceItem(store, episodeId, item) {
  if (item.category === "Reference") return true;
  const episode = store.getEpisode(episodeId);
  return Boolean(episode && (episode.referenceItemIds?.includes(item.id) || episode.cards?.some((card) => card.referenceItemIds?.includes(item.id))));
}

export function getItem(store, episodeId, itemId) {
  if (typeof episodeId !== "string" || typeof itemId !== "string") throw new RuntimeError("INVALID_ITEM", "episodeId and itemId are required");
  const item = store.getLibraryItem(episodeId, itemId);
  if (!item) throw new RuntimeError("ITEM_NOT_FOUND", "Library item not found in that episode", { status: 404 });
  return item;
}

// Resolve a tool target { itemId, episodeId? } or { path } to a readable project file and
// its origin. Paths are relative to the current episode directory or absolute project paths.
export async function resolveTarget(store, scope, args = {}) {
  if (args.itemId != null) {
    const episodeId = args.episodeId ?? scope.episodeId;
    const item = getItem(store, episodeId, args.itemId);
    if (!item.asset?.path) throw new RuntimeError("ITEM_HAS_NO_FILE", "This library item has no stored file");
    const file = await resolveProjectFile(scope.dataRoot, path.resolve(scope.dataRoot, item.asset.path), { projectRoots: PROJECT_ROOTS });
    return { file, item, origin: originOf(store, episodeId, item), reference: isReferenceItem(store, episodeId, item) };
  }
  if (typeof args.path !== "string" || !args.path) throw new RuntimeError("INVALID_TARGET", "Give either itemId (with optional episodeId) or path");
  const file = await resolveProjectFile(scope.dataRoot, path.resolve(scope.episodeDir, args.path), { projectRoots: PROJECT_ROOTS });
  const parts = path.relative(scope.dataRoot, file).split(path.sep);
  const origin = { path: file, ...(parts[0] === "channels" ? { channel: { id: parts[1] } } : {}), ...(parts[2] === "episodes" || parts[0] === "episodes" ? { episode: { id: parts[0] === "episodes" ? parts[1] : parts[3] } } : {}) };
  return { file, item: null, origin, reference: null };
}

// Browse/search the installation. Empty query lists episodes (with channel) and their items.
export function searchProject(store, scope, { query = "", channelId = null, episodeId = null, kind = null, category = null, limit = 40 } = {}) {
  const needle = lower(query).trim();
  const max = Math.min(Math.max(Number.isInteger(limit) ? limit : 40, 1), 200);
  const channels = store.listChannels().filter((channel) => !channelId || channel.id === channelId);
  const episodes = [], items = [];
  for (const channel of channels) {
    for (const episode of store.listEpisodes({ channelId: channel.id })) {
      if (episodeId && episode.id !== episodeId) continue;
      const channelLabel = { id: channel.id, name: channel.name };
      const episodeMatches = !needle || lower(episode.title).includes(needle) || lower(channel.name).includes(needle);
      if (episodeMatches) episodes.push({ channel: channelLabel, episode: { id: episode.id, title: episode.title, state: episode.state }, current: episode.id === scope.episodeId });
      for (const item of store.listEpisodeLibrary(episode.id)) {
        if (kind && item.asset?.kind !== kind) continue;
        if (category && item.category !== category) continue;
        const haystack = [item.label, item.asset?.name, item.category, item.notes, ...(item.tags ?? [])].map(lower).join(" ");
        if (needle && !haystack.includes(needle) && !episodeMatches) continue;
        if (items.length >= max) break;
        items.push({
          channel: channelLabel, episode: { id: episode.id, title: episode.title }, current: episode.id === scope.episodeId,
          item: { id: item.id, label: item.label, category: item.category, kind: item.asset?.kind ?? null, duration: item.asset?.duration ?? null,
            width: item.asset?.width ?? null, height: item.asset?.height ?? null, hasText: Boolean(item.extractedText), reference: isReferenceItem(store, episode.id, item) },
          path: item.asset?.path ? path.join(scope.dataRoot, item.asset.path) : null,
        });
      }
    }
  }
  return { query: needle, episodes: episodes.slice(0, max), items, truncated: items.length >= max };
}

// Bounded reference/text excerpt from any project item (same extracted-text source as the
// chat's excerpt service), labelled with its origin.
export function readExcerpt(store, scope, { itemId, episodeId = scope.episodeId, offset = 0, limit = 4000 } = {}) {
  const item = getItem(store, episodeId, itemId);
  const text = item.extractedText ?? item.provenance?.extractedText ?? "";
  const start = Math.max(0, Number(offset) || 0), size = Math.min(20_000, Math.max(1, Number(limit) || 4000));
  return { origin: originOf(store, episodeId, item), reference: isReferenceItem(store, episodeId, item), offset: start, text: text.slice(start, start + size),
    truncated: start + size < text.length, available: Boolean(text), extractionStatus: item.extractionStatus };
}

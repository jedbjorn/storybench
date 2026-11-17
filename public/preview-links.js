export function withChannel(url, channelId) {
  return channelId ? `${url}${url.includes('?') ? '&' : '?'}channel=${encodeURIComponent(channelId)}` : url;
}

export function previewUrl(kind, id, channelId, itemId) {
  return withChannel(`/preview/${kind}/${encodeURIComponent(id)}${itemId ? `/${encodeURIComponent(itemId)}` : ''}`, channelId);
}

export function libraryOpenUrl(item, channelId) {
  const asset = item.asset || {};
  const previewable = asset.kind === 'video' || /\.(png|jpe?g|webp|gif|svg)$/i.test(asset.name || '')
    || /^image\/(png|jpeg|webp|gif|svg\+xml)(;|$)/i.test(asset.metadata?.contentType || '');
  return previewable ? previewUrl('library', item.episodeId, channelId, item.id)
    : withChannel(`/api/episodes/${encodeURIComponent(item.episodeId)}/library/${encodeURIComponent(item.id)}/file`, channelId);
}

// Each open workspace tab records its selected conversation per production under its own key, refreshed while
// open and removed when it closes. Preview's redline popup defaults to the most recent selection among live
// records; a record whose tab stopped refreshing (a crash) expires. Background tabs can be throttled to one
// timer per minute, so the expiry is generous; ordinary closing removes the record at once.
const SELECTION_PREFIX = 'storybench.chat.selected.';
const SELECTION_TTL = 150_000;

export function selectionKey(episodeId, tabId) {
  return `${SELECTION_PREFIX}${episodeId}.${tabId}`;
}

// The conversation selected in a workspace tab that has this production open, or null when none has.
export function workspaceSelection(episodeId, now = Date.now()) {
  let best = null;
  try {
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (!key?.startsWith(`${SELECTION_PREFIX}${episodeId}.`)) continue;
      const value = JSON.parse(localStorage.getItem(key) || 'null');
      if (value?.id && now - value.seenAt < SELECTION_TTL && (!best || value.selectedAt > best.selectedAt)) best = value;
    }
  } catch { return null; }
  return best?.id ?? null;
}

// Drops records left by tabs that ended without removing theirs.
export function pruneSelections(now = Date.now()) {
  try {
    const keys = [];
    for (let index = 0; index < localStorage.length; index++) keys.push(localStorage.key(index));
    for (const key of keys.filter(key => key?.startsWith(SELECTION_PREFIX))) {
      let value = null;
      try { value = JSON.parse(localStorage.getItem(key) || 'null'); } catch { /* unreadable: drop it */ }
      if (!(now - value?.seenAt < SELECTION_TTL)) localStorage.removeItem(key);
    }
  } catch { /* storage unavailable */ }
}

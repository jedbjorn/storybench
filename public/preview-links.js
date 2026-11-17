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

// The workspace records its selected conversation per production; Preview's redline popup defaults to it.
export function selectedConversationKey(episodeId) {
  return `storybench.chat.selected.${episodeId}`;
}

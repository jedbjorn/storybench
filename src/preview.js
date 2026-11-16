import path from 'node:path';
import { realpath, stat } from 'node:fs/promises';
import { StoreError } from './store.js';
import { projectContentType } from './project-files.js';

// Metadata never exposes disk paths. Every lookup is pinned to the URL's channel.
export async function previewMetadata(store, workspace, parts, channelId) {
  const [source, id, itemId] = parts;
  const unavailable = () => { throw new StoreError('This item is no longer available.', 404); };
  if (!channelId || !['library', 'output', 'deck'].includes(source)) unavailable();
  let episode, asset, job, label, relative, media;
  if (source === 'library') {
    if (parts.length !== 3) unavailable();
    episode = store.getEpisode(id);
    if (!episode || episode.channelId !== channelId) unavailable();
    const item = store.getLibraryItem(id, itemId);
    if (!item) unavailable();
    asset = item.asset; label = item.label; relative = asset.path;
    media = `/api/episodes/${encodeURIComponent(id)}/library/${encodeURIComponent(itemId)}/file`;
  } else {
    if (parts.length !== 2) unavailable();
    job = store.getJob(id);
    episode = job && store.getEpisode(job.episodeId);
    if (!episode || episode.channelId !== channelId) unavailable();
    if (job.deletionState !== 'present') throw new StoreError('This item is no longer available.', 410);
    if (job.state !== 'completed' || !job.outputPath || (job.kind === 'deck') !== (source === 'deck')) unavailable();
    relative = job.outputPath;
    asset = { name: path.basename(relative), ...job.snapshot?.output };
    label = `${source === 'deck' ? 'Deck' : job.outputClass === 'final' ? 'Final' : 'Draft'} — ${job.createdAt}`;
    media = `/api/jobs/${encodeURIComponent(id)}/${source === 'deck' ? 'deck/index.html' : 'file'}`;
  }
  const root = await realpath(workspace);
  const file = path.resolve(workspace, relative);
  if (!file.startsWith(path.resolve(workspace) + path.sep)) unavailable();
  const actual = await realpath(file).catch(error => { if (error.code === 'ENOENT') unavailable(); throw error; });
  if (!actual.startsWith(root + path.sep)) unavailable();
  const info = await stat(actual);
  if (!info.isFile()) unavailable();
  const contentType = projectContentType(asset, relative);
  const kind = source === 'deck' ? 'deck' : /^image\/(png|jpeg|webp|gif|svg\+xml)$/.test(contentType) ? 'image'
    : contentType.startsWith('video/') ? 'video' : null;
  if (!kind) unavailable();
  const scope = `?channel=${encodeURIComponent(channelId)}`;
  return { source, episodeId: episode.id, channelId, production: episode.title, label, kind, contentType,
    bytes: info.size, width: asset?.width ?? null, height: asset?.height ?? null, duration: asset?.duration ?? null,
    mediaUrl: media + scope,
    downloadUrl: (source === 'deck' ? `/api/jobs/${encodeURIComponent(id)}/deck/bundle.zip` : media) + scope + '&download=1' };
}

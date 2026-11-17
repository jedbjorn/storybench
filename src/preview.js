import path from 'node:path';
import { realpath, stat } from 'node:fs/promises';
import { StoreError } from './store.js';
import { projectContentType } from './project-files.js';
import { reportsState, CAPTURE_REBUILD } from './deck-capture.js';
import { getDeckReadiness } from './runtime/deck-readiness.js';
import { releaseFromEnv } from './runtime/health.js';

// Metadata never exposes disk paths. Every lookup is pinned to the URL's channel.
export async function previewMetadata(store, workspace, parts, channelId) {
  return (await previewTarget(store, workspace, parts, channelId)).metadata;
}

// The pinned asset with its resolved file, for server-side work on exactly what Preview shows.
export async function previewTarget(store, workspace, parts, channelId) {
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
    asset = (job.snapshot?.assetId && store.getAsset(job.snapshot.assetId)) || { name: path.basename(relative), ...job.snapshot?.output };
    label = job.outputClass === 'graphic' ? asset.name : `${source === 'deck' ? 'Deck' : job.outputClass === 'final' ? 'Final' : 'Draft'} — ${job.createdAt}`;
    media = `/api/jobs/${encodeURIComponent(id)}/${source === 'deck' ? 'deck/index.html' : 'file'}`;
  }
  const root = await realpath(workspace);
  const file = path.resolve(workspace, relative);
  if (!file.startsWith(path.resolve(workspace) + path.sep)) unavailable();
  const actual = await realpath(file).catch(error => { if (error.code === 'ENOENT') unavailable(); throw error; });
  if (!actual.startsWith(root + path.sep)) unavailable();
  const info = await stat(actual);
  if (!info.isFile()) unavailable();
  if (source === 'deck') {
    const entry = path.join(path.dirname(file), 'index.html');
    if (await realpath(entry).catch(() => null) !== entry || !(await stat(entry)).isFile()) unavailable();
  }
  const contentType = projectContentType(asset, relative);
  const kind = source === 'deck' ? 'deck' : /^image\/(png|jpeg|webp|gif|svg\+xml)$/.test(contentType) ? 'image'
    : contentType.startsWith('video/') ? 'video' : null;
  if (!kind) unavailable();
  const scope = `?channel=${encodeURIComponent(channelId)}`;
  const assembled = ['draft', 'legacy_draft', 'final'];
  const latest = job && (source === 'deck' || assembled.includes(job.outputClass))
    ? store.listJobs(episode.id).find(candidate => candidate.state === 'completed' && candidate.deletionState === 'present'
      && candidate.outputPath && candidate.createdAt > job.createdAt
      && (source === 'deck' ? candidate.kind === 'deck' : assembled.includes(candidate.outputClass))) : null;
  // Deck Markup needs the pinned build's slides (to trust frame state messages and to write the
  // context line from labels the creator already sees; never notes or body text) and whether
  // server capture can serve it: an older runtime or an unready browser cannot.
  const browser = source === 'deck' && getDeckReadiness(releaseFromEnv()).browser;
  const deck = source === 'deck' ? { revision: job.revision,
    slides: job.snapshot.slides.map(slide => ({ id: slide.id, title: slide.title,
      stages: (slide.stages ?? []).map(stage => stage.title), views: (slide.subnav ?? []).map(view => view.label) })),
    capture: !reportsState(job) ? { available: false, reason: CAPTURE_REBUILD }
      : browser.state !== 'ready' ? { available: false, reason: browser.reason } : { available: true, reason: null } } : undefined;
  const metadata = { source, episodeId: episode.id, channelId, production: episode.title, label, kind, contentType, deck,
    ...(source === 'library' ? { itemId } : { jobId: id, outputClass: job.outputClass }),
    bytes: info.size, width: asset?.width ?? null, height: asset?.height ?? null, duration: asset?.duration ?? null,
    latestUrl: latest ? `/preview/${source}/${encodeURIComponent(latest.id)}${scope}` : null,
    mediaUrl: media + scope,
    downloadUrl: (source === 'deck' ? `/api/jobs/${encodeURIComponent(id)}/deck/bundle.zip` : media) + scope + '&download=1' };
  return { metadata, file: actual };
}

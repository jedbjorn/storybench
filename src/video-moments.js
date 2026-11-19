// A bookmark points to one registered item or one completed output, never to its group's
// latest revision. The episode owns mutations and callers supply discovery's channel scope.
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { StoreError } from './store.js';
import { projectContentType } from './project-files.js';
import { PROJECT_ROOTS } from './runtime/layout.js';
import { openProjectFile } from './runtime/validate.js';
import { mediaSummary } from './runtime/media-inspect.js';

// Prototype renders predate per-episode output directories and live under exports/.
const videoRoots = [...PROJECT_ROOTS, 'exports'];
const unavailable = () => new StoreError('The pinned video is unavailable', 410);
const stampOf = info => [info.dev, info.ino, info.size, info.ctimeNs, info.mtimeNs].join(':');

function fields(input) {
  const { startSeconds, endSeconds, note = '' } = input ?? {};
  if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds) || startSeconds < 0 || startSeconds >= endSeconds)
    throw new StoreError('Give a finite range in seconds with 0 <= start < end');
  if (typeof note !== 'string') throw new StoreError('note must be text');
  return { startSeconds, endSeconds, note };
}

function checkDuration(end, duration) {
  if (!Number.isFinite(duration) || end > duration) throw new StoreError('Range exceeds the pinned video duration');
}

async function digest(handle) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(null, { fd: handle.fd, autoClose: false, start: 0 })) hash.update(chunk);
  return hash.digest('hex');
}

export function createVideoMoments(store) {
  const { db } = store;
  function owner({ episodeId, channelId }) {
    if (!channelId) throw new StoreError('An explicit origin channel is required');
    return store.assertEpisodeChannel(episodeId, channelId);
  }

  function sourceAt(episodeId, type, id) {
    if (type === 'library') {
      const item = store.getLibraryItem(episodeId, id);
      if (!item?.asset) throw unavailable();
      const contentType = projectContentType(item.asset, item.asset.path);
      if (!contentType.startsWith('video/')) throw unavailable();
      return { assetId: item.assetId, label: item.label, path: item.asset.path, hash: item.asset.hash, contentType };
    }
    const job = store.getJob(id);
    if (job?.episodeId !== episodeId || job.state !== 'completed' || job.deletionState !== 'present' ||
        !['draft', 'final', 'legacy_draft'].includes(job.outputClass) || job.kind === 'deck' || !job.outputPath) throw unavailable();
    return { assetId: null, label: `${job.outputClass === 'final' ? 'Final' : 'Draft'} — ${job.createdAt}`,
      path: job.outputPath, hash: job.snapshot?.output?.sha256, contentType: projectContentType({ kind: 'video' }, job.outputPath) };
  }

  async function openSource(source) {
    try {
      const { handle } = await openProjectFile(store.workspace, path.resolve(store.workspace, source.path), { projectRoots: videoRoots });
      return handle;
    } catch (error) {
      if (error.code?.startsWith('PATH_') || ['ENOENT', 'ENOTDIR', 'EACCES'].includes(error.code)) throw unavailable();
      throw error;
    }
  }

  function record(origin, id) {
    const episode = owner(origin);
    const row = db.prepare('SELECT * FROM video_moments WHERE id=? AND episode_id=?').get(id, episode.id);
    if (!row) throw new StoreError('Moment not found in this episode', 404);
    return row;
  }

  // Agent inspection and HTTP byte ranges both consume this checked, open descriptor.
  // A replaced path cannot retarget an outstanding playback or frame request.
  async function openPinned(row) {
    const source = sourceAt(row.episode_id, row.source_type, row.source_id);
    if (source.assetId !== row.asset_id || (source.hash && source.hash !== row.sha256)) throw unavailable();
    const handle = await openSource(source);
    try {
      const stamp = stampOf(await handle.stat({ bigint: true }));
      if (stamp !== row.file_stamp) {
        const sha256 = await digest(handle);
        if (sha256 !== row.sha256 || stamp !== stampOf(await handle.stat({ bigint: true }))) throw unavailable();
      }
      return { handle, contentType: source.contentType.startsWith('video/') ? source.contentType : 'application/octet-stream' };
    } catch (error) { await handle.close(); throw error; }
  }

  async function get(origin, id) {
    const row = record(origin, id);
    let available = true;
    try { const { handle } = await openPinned(row); await handle.close(); }
    catch (error) { if (error.statusCode !== 410) throw error; available = false; }
    const { channelId, episodeId } = origin;
    return { id, channelId, episodeId, source: { type: row.source_type, id: row.source_id, assetId: row.asset_id },
      sourceLabel: row.source_label, duration: row.duration, startSeconds: row.start_seconds, endSeconds: row.end_seconds,
      note: row.note, revision: row.revision, available,
      mediaUrl: available ? `/api/episodes/${encodeURIComponent(episodeId)}/moments/${id}/file?channel=${encodeURIComponent(channelId)}` : null };
  }

  // Both discovery consumers supply the channels to consult. Summaries never open
  // media or load full notes into the result; get() resolves one selected moment.
  function list({ channelIds, query = '', offset = 0, limit = 30 }) {
    if (!Array.isArray(channelIds) || !channelIds.length || channelIds.some(id => typeof id !== 'string' || !id))
      throw new StoreError('Specify the origin channels to search');
    if (typeof query !== 'string' || !Number.isSafeInteger(offset) || offset < 0 ||
        !Number.isInteger(limit) || limit < 1 || limit > 100) throw new StoreError('Invalid moment query or page');
    const rows = db.prepare(`SELECT m.id, m.episode_id AS episodeId, e.title AS episodeTitle,
      c.id AS channelId, c.name AS channelName, m.source_type, m.source_id, m.asset_id, m.source_label AS sourceLabel,
      m.start_seconds AS startSeconds, m.end_seconds AS endSeconds, substr(m.note,1,200) AS noteExcerpt
      FROM video_moments m JOIN episodes e ON e.id=m.episode_id JOIN channels c ON c.id=e.channel_id
      WHERE c.pending_delete_id IS NULL AND c.id IN (SELECT value FROM json_each(?))
        AND (instr(lower(m.source_label),lower(?)) OR instr(lower(m.note),lower(?)))
      ORDER BY m.rowid DESC LIMIT ? OFFSET ?`).all(JSON.stringify(channelIds), query, query, limit + 1, offset);
    const moments = rows.slice(0, limit).map(({ source_type, source_id, asset_id, ...row }) => ({
      ...row, source: { type: source_type, id: source_id, assetId: asset_id },
    }));
    return { moments, nextOffset: rows.length > limit ? offset + limit : null };
  }

  function replay(episodeId, requestId, fingerprint) {
    const saved = db.prepare('SELECT fingerprint,moment_id FROM video_moment_saves WHERE episode_id=? AND request_id=?').get(episodeId, requestId);
    if (!saved) return null;
    if (saved.fingerprint !== fingerprint) throw new StoreError('requestId was already used with different values', 409);
    if (!saved.moment_id) throw new StoreError('This saved moment has been removed', 410);
    return saved.moment_id;
  }

  async function create(origin, input) {
    const { id: episodeId } = owner(origin);
    const { requestId, source } = input ?? {};
    if (typeof requestId !== 'string' || !requestId.trim() || requestId.length > 200) throw new StoreError('A requestId of 1–200 characters is required');
    if (!['library', 'output'].includes(source?.type) || typeof source.id !== 'string' || !source.id)
      throw new StoreError('Identify a library item or a draft/final output');
    const { startSeconds, endSeconds, note } = fields(input);
    const fingerprint = createHash('sha256').update(JSON.stringify([source.type, source.id, startSeconds, endSeconds, note])).digest('hex');
    let id = replay(episodeId, requestId, fingerprint);
    if (id) return get(origin, id);

    const target = sourceAt(episodeId, source.type, source.id);
    const handle = await openSource(target);
    let stamp, sha256, duration;
    try {
      stamp = stampOf(await handle.stat({ bigint: true }));
      const media = await mediaSummary(handle).catch(error => {
        if (error.code === 'FRAME_FAILED') throw new StoreError('Cannot read the registered video duration', 422);
        throw error;
      });
      if (media.kind !== 'video') throw new StoreError('Only video sources can be bookmarked');
      duration = media.duration;
      checkDuration(endSeconds, duration);
      sha256 = await digest(handle);
      if ((target.hash && sha256 !== target.hash) || stamp !== stampOf(await handle.stat({ bigint: true }))) throw unavailable();
    } finally { await handle.close(); }

    db.exec('BEGIN IMMEDIATE');
    try {
      id = replay(episodeId, requestId, fingerprint);
      if (!id) {
        owner(origin);
        const current = sourceAt(episodeId, source.type, source.id);
        if (current.assetId !== target.assetId || current.path !== target.path || current.hash !== target.hash) throw unavailable();
        id = `moment_${randomUUID()}`;
        db.prepare(`INSERT INTO video_moments(id,episode_id,source_type,source_id,asset_id,source_label,sha256,file_stamp,
          duration,start_seconds,end_seconds,note) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(
          id, episodeId, source.type, source.id, target.assetId, target.label, sha256, stamp, duration, startSeconds, endSeconds, note);
        db.prepare('INSERT INTO video_moment_saves(episode_id,request_id,fingerprint,moment_id) VALUES(?,?,?,?)')
          .run(episodeId, requestId, fingerprint, id);
      }
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    return get(origin, id);
  }

  async function update(origin, id, input) {
    const row = record(origin, id);
    const { startSeconds, endSeconds, note } = fields(input);
    checkDuration(endSeconds, row.duration);
    const revision = input.expectedRevision;
    if (!Number.isInteger(revision) || revision < 1) throw new StoreError('A positive expectedRevision is required');
    if (row.revision === revision + 1 && row.start_seconds === startSeconds && row.end_seconds === endSeconds && row.note === note)
      return get(origin, id);
    const changed = db.prepare(`UPDATE video_moments SET start_seconds=?,end_seconds=?,note=?,revision=revision+1
      WHERE id=? AND episode_id=? AND revision=?`).run(startSeconds, endSeconds, note, id, origin.episodeId, revision);
    if (!changed.changes) throw new StoreError('Moment changed before saving', 409, { current: await get(origin, id) });
    return get(origin, id);
  }

  async function remove(origin, id, revision) {
    record(origin, id);
    if (!Number.isInteger(revision) || revision < 1) throw new StoreError('A positive expectedRevision is required');
    const changed = db.prepare('DELETE FROM video_moments WHERE id=? AND episode_id=? AND revision=?').run(id, origin.episodeId, revision);
    if (!changed.changes) throw new StoreError('Moment changed before removal', 409, { current: await get(origin, id) });
    return { id, removed: true };
  }
  return { create, get, list, update, remove, openMedia: (origin, id) => openPinned(record(origin, id)) };
}

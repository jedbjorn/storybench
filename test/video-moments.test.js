import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/server.js';
import { Store } from '../src/store.js';
import { createVideoMoments } from '../src/video-moments.js';
import { deleteDraftOutputs } from '../src/services/outputs.js';

async function fixture(t) {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'sb-moments-'));
  const app = await createApp({ workspace });
  t.after(async () => { await app.close(); await rm(workspace, { recursive: true, force: true }); });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const { store } = app;
  const episode = store.createEpisode({ title: 'Opening' });
  const { channelId, id: episodeId } = episode;
  const origin = { channelId, episodeId };
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const collection = `/api/episodes/${episodeId}/moments`;
  async function call(method, suffix, body, status = 200) {
    const response = await fetch(base + collection + suffix + '?channel=' + channelId, {
      method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    const value = await response.json();
    assert.equal(response.status, status, JSON.stringify(value));
    return value;
  }
  const source = path.join(workspace, 'fixture.mp4');
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=48x32:r=10',
    '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '2', '-c:v', 'mpeg4', '-c:a', 'aac', source]);
  return { app, workspace, store, episode, origin, base, collection, call, bytes: await readFile(source) };
}

test('two bookmarked ranges of imported video keep their sound, origin and identity after library changes', async t => {
  const { store, episode, origin, base, collection, call, bytes } = await fixture(t);
  const imported = await fetch(`${base}/api/episodes/${episode.id}/library/files?channel=${episode.channelId}`, {
    method: 'POST', headers: { 'content-type': 'video/mp4', 'x-file-name': 'opening.mp4', 'x-library-label': 'Opening' }, body: bytes,
  });
  assert.equal(imported.status, 201);
  const item = await imported.json();
  const source = { type: 'library', id: item.id };
  const save = { requestId: 'first', source, startSeconds: 0, endSeconds: 0.8, note: 'Picture rises with sound' };
  const [a, repeat] = await Promise.all([call('POST', '', save), call('POST', '', save)]);
  assert.deepEqual(a, repeat);
  await call('POST', '', { ...save, note: 'different' }, 409);
  const b = await call('POST', '', { requestId: 'second', source, startSeconds: 1.2, endSeconds: 2 });
  assert.notEqual(a.id, b.id);
  assert.equal(b.note, '');
  assert.equal(b.duration, 2);
  assert.deepEqual(a.source, { ...source, assetId: item.assetId });
  assert.equal(a.channelId, episode.channelId);
  assert.equal(a.episodeId, episode.id);
  assert.equal(store.listEpisodeLibrary(episode.id).length, 1);
  assert.deepEqual(store.getEpisode(episode.id), episode);

  const api = createVideoMoments(store);
  assert.deepEqual(await api.get(origin, b.id), b);
  for (const range of [{ startSeconds: NaN }, { startSeconds: Infinity }, { startSeconds: -1 }, { endSeconds: '1' },
    { endSeconds: 0 }, { endSeconds: 3, duration: 99 }, { startSeconds: 1.4, endSeconds: 1.2 }]) {
    await assert.rejects(api.create(origin, { ...save, requestId: 'invalid', ...range }), { statusCode: 400 });
  }
  const other = store.createChannel('Elsewhere');
  assert.equal((await fetch(base + collection + '/' + a.id)).status, 400);
  assert.equal((await fetch(base + collection + '/' + a.id + '?channel=' + other.id)).status, 409);
  const wrongOrigin = { ...origin, episodeId: store.createEpisode({ title: 'Other', channelId: origin.channelId }).id };
  await assert.rejects(api.get(wrongOrigin, a.id), { statusCode: 404 });
  await assert.rejects(api.remove(wrongOrigin, a.id, 1), { statusCode: 404 });

  const later = store.attachLibraryItem(episode.id, item.assetId, { iterationOf: item.id });
  assert.equal(later.iteration, 2);
  const lookup = async params => (await fetch(base + '/api/moments?' + params)).json();
  assert.equal((await fetch(base + '/api/moments')).status, 400);
  assert.deepEqual((await lookup('channel=' + other.id)).moments, []);
  const firstPage = await lookup('channel=' + other.id + '&channel=' + episode.channelId + '&q=Opening&limit=1');
  assert.deepEqual(firstPage.moments.map(m => m.id), [b.id]);
  assert.equal(firstPage.nextOffset, 1);
  const secondPage = await lookup('channel=' + episode.channelId + '&q=Opening&limit=1&offset=1');
  assert.equal(secondPage.nextOffset, null);
  const byNote = (await lookup('channel=' + episode.channelId + '&q=RISES')).moments;
  assert.deepEqual(byNote, secondPage.moments);
  assert.deepEqual(byNote[0], { id: a.id, channelId: origin.channelId, channelName: store.getChannel(origin.channelId).name,
    episodeId: episode.id, episodeTitle: episode.title, source: a.source, sourceLabel: a.sourceLabel,
    startSeconds: a.startSeconds, endSeconds: a.endSeconds, noteExcerpt: a.note });
  store.updateLibraryItem(episode.id, item.id, item.revision, { label: 'Renamed' });
  assert.deepEqual(await call('GET', '/' + a.id), a);
  const playback = await fetch(base + a.mediaUrl);
  assert.equal(playback.headers.get('content-type'), 'video/mp4');
  assert.equal(playback.headers.get('cache-control'), 'no-store');
  assert.deepEqual(Buffer.from(await playback.arrayBuffer()), bytes);
  await call('DELETE', '/' + b.id, { expectedRevision: 1 });
  assert.ok(store.getLibraryItem(episode.id, item.id));
  store.deleteLibraryItem(episode.id, item.id, store.getLibraryItem(episode.id, item.id).revision, episode.revision);
  assert.deepEqual(await call('POST', '', save), { ...a, available: false, mediaUrl: null });
  assert.equal((await fetch(base + a.mediaUrl)).status, 410);
  assert.ok(store.getLibraryItem(episode.id, later.id));
});

test('an output bookmark pins a particular render, supports stale edit recovery and survives draft cleanup', async t => {
  const { workspace, store, episode, base, call, bytes } = await fixture(t);
  async function output(id, outputClass) {
    const file = path.join(store.episodeOutputDirectory(episode.id, outputClass === 'draft' ? 'drafts' : 'final'), id + '.mp4');
    await writeFile(file, bytes);
    return store.saveJob({ id, episodeId: episode.id, state: 'completed', progress: 1, kind: outputClass, outputClass,
      outputPath: path.relative(workspace, file), revision: episode.revision, snapshot: {}, createdAt: new Date().toISOString() });
  }
  const draft = await output('draft1', 'draft');
  const save = { requestId: 'opening', source: { type: 'output', id: draft.id }, startSeconds: 0.2, endSeconds: 1.1, note: 'Original' };
  const a = await call('POST', '', save);
  const url = '/' + a.id;
  const final = await output('final2', 'final');
  const other = await call('POST', '', { ...save, source: { type: 'output', id: final.id }, requestId: 'final' });
  assert.deepEqual(await call('GET', url), a);
  assert.notEqual(a.mediaUrl, other.mediaUrl);
  const played = await fetch(base + a.mediaUrl, { headers: { range: 'bytes=3-18' } });
  assert.equal(played.status, 206);
  assert.deepEqual(Buffer.from(await played.arrayBuffer()), bytes.subarray(3, 19));
  assert.equal((await fetch(base + a.mediaUrl, { method: 'HEAD' })).headers.get('content-length'), String(bytes.length));
  const stale = { expectedRevision: 1, startSeconds: 0.7, endSeconds: 1.4, note: 'My revised note' };
  const winner = await call('PUT', url, { ...stale, note: 'Other view' });
  assert.equal(winner.revision, 2);
  const conflict = await call('PUT', url, stale, 409);
  assert.deepEqual(conflict.current, winner);
  await call('DELETE', url, { expectedRevision: 1 }, 409);
  const retry = { ...stale, expectedRevision: conflict.current.revision };
  const edited = await call('PUT', url, retry);
  assert.deepEqual(await call('PUT', url, retry), edited);
  assert.deepEqual(await call('POST', '', save), edited);
  assert.equal(edited.note, stale.note);
  assert.equal(edited.revision, 3);

  const file = path.join(workspace, draft.outputPath);
  const replaced = Buffer.from(bytes);
  replaced[replaced.length - 1] ^= 1;
  await writeFile(file, replaced);
  assert.deepEqual(await call('GET', url), { ...edited, available: false, mediaUrl: null });
  assert.equal((await fetch(base + a.mediaUrl)).status, 410);
  await writeFile(file, bytes);
  assert.deepEqual(await call('GET', url), edited);
  await deleteDraftOutputs(store, { episodeId: episode.id, outputs: [{ id: draft.id, expectedRevision: draft.recordRevision }] });
  assert.equal(store.getJob(draft.id).deletionState, 'deleted');
  assert.deepEqual(await call('GET', url), { ...edited, available: false, mediaUrl: null });
  const missingEdit = await call('PUT', url, { ...retry, expectedRevision: edited.revision, note: 'Keep the idea' });
  assert.equal(missingEdit.available, false);
  await call('DELETE', url, { expectedRevision: missingEdit.revision });
  await call('GET', url, undefined, 404);
  await call('POST', '', save, 410);
  assert.deepEqual(await call('GET', '/' + other.id), other);
  await call('DELETE', '/' + other.id, { expectedRevision: other.revision });
  assert.deepEqual(store.getJob(final.id), final);
  assert.deepEqual(await readFile(path.join(workspace, final.outputPath)), bytes);
});

test('a migrated workspace can bookmark a legacy export and replay the save after restart', async t => {
  const { app, workspace, store, episode, origin, bytes } = await fixture(t);
  const outputPath = 'exports/old.mp4';
  await writeFile(path.join(workspace, outputPath), bytes);
  const job = store.saveJob({ id: 'old', episodeId: episode.id, kind: 'export', outputClass: 'legacy_draft',
    outputPath, revision: 1, state: 'completed', progress: 1, snapshot: {} });
  store.db.exec(`DROP TABLE video_moment_saves; DROP TABLE video_moments;
    DELETE FROM migration_log WHERE version=23; PRAGMA user_version=22`);
  await app.close();
  const migrated = new Store(workspace);
  const save = { requestId: 'legacy', source: { type: 'output', id: job.id }, startSeconds: 0, endSeconds: 1 };
  let moment;
  try {
    moment = await createVideoMoments(migrated).create(origin, save);
    assert.equal(moment.available, true);
  } finally { migrated.close(); }
  const reopened = new Store(workspace);
  try {
    const api = createVideoMoments(reopened);
    assert.deepEqual(await api.create(origin, save), moment);
    await rm(path.join(workspace, outputPath));
    assert.deepEqual(await api.get(origin, moment.id), { ...moment, available: false, mediaUrl: null });
    assert.deepEqual(reopened.db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { reopened.close(); }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../src/server.js';

test('project files resolve media types, download safe names and sandbox active content', async t => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'sb-preview-serving-'));
  const app = await createApp({ workspace });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await app.close(); await rm(workspace, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const episode = app.store.createEpisode({ title: 'Media' });
  const other = app.store.createChannel('Other');
  const types = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
    svg: 'image/svg+xml', mov: 'video/quicktime', m4v: 'video/x-m4v', mp4: 'video/mp4', webm: 'video/webm',
    html: 'text/html', xhtml: 'application/xhtml+xml',
  };
  for (const [extension, type] of Object.entries(types)) {
    const file = `managed-${extension}`;
    await writeFile(path.join(workspace, file), 'project content');
    const asset = app.store.saveAsset({ channelId: episode.channelId, name: `original.${extension}`, hash: extension,
      kind: type.startsWith('video/') ? 'video' : 'image', path: file, metadata: { contentType: 'application/octet-stream' } });
    const item = app.store.attachLibraryItem(episode.id, asset.id, { category: 'Reference', label: 'Résumé "one"/two' });
    const library = `/api/episodes/${episode.id}/library/${item.id}/file`;
    for (const route of [library, `/api/assets/${asset.id}/file`]) {
      const response = await fetch(`${base}${route}?channel=${episode.channelId}`);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('content-type'), type, extension);
      assert.match(response.headers.get('content-disposition'), /^inline;/);
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(response.headers.get('content-security-policy'), ['svg', 'html', 'xhtml'].includes(extension) ? 'sandbox' : null);
      assert.equal(await response.text(), 'project content');
      const download = await fetch(`${base}${route}?channel=${episode.channelId}&download=1`);
      const disposition = download.headers.get('content-disposition');
      assert.match(disposition, /^attachment;/);
      assert.ok(disposition.endsWith(`.${extension}`));
      if (route === library) assert.match(disposition, /filename\*=UTF-8''R%C3%A9sum%C3%A9%20_one__two/);
      await download.arrayBuffer();
    }
    const denied = await fetch(`${base}/api/assets/${asset.id}/file?channel=${other.id}`);
    assert.equal(denied.status, 404);
    await denied.arrayBuffer();
  }
  const file = path.join(workspace, 'draft.mp4');
  await writeFile(file, '0123456789');
  app.store.saveJob({ id: 'preview_draft', episodeId: episode.id, kind: 'draft', outputClass: 'draft', state: 'completed',
    progress: 1, revision: 1, outputPath: 'draft.mp4', snapshot: {}, createdAt: new Date().toISOString() });
  const route = `${base}/api/jobs/preview_draft/file?channel=${episode.channelId}`;
  const response = await fetch(route, { headers: { range: 'bytes=2-5' } });
  assert.equal(response.status, 206);
  assert.equal(response.headers.get('content-type'), 'video/mp4');
  assert.equal(response.headers.get('content-range'), 'bytes 2-5/10');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.match(response.headers.get('content-disposition'), /^inline;/);
  assert.equal(await response.text(), '2345');
  const download = await fetch(`${route}&download=1`, { method: 'HEAD' });
  assert.match(download.headers.get('content-disposition'), /^attachment; filename="draft.mp4"/);
  assert.equal((await fetch(`${base}/api/jobs/preview_draft/file?channel=${other.id}`)).status, 404);
  const invalidRange = await fetch(route, { headers: { range: 'bytes=100-200' } });
  assert.equal(invalidRange.status, 416);
  assert.equal(invalidRange.headers.get('x-content-type-options'), 'nosniff');

  const asset = app.store.saveAsset({ channelId: episode.channelId, name: 'no-extension', hash: 'probed', kind: 'image', path: 'draft.mp4',
    metadata: { streams: [{ codec_type: 'video', codec_name: 'webp' }] } });
  const probed = await fetch(`${base}/api/assets/${asset.id}/file`);
  assert.equal(probed.headers.get('content-type'), 'image/webp');
  await probed.arrayBuffer();
});

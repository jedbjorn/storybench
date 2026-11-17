import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../src/server.js';
import { previewPNG } from '../test-support/preview-fixtures.js';

const root = path.resolve(import.meta.dirname, '..');

test('the redline upload is pinned to the previewed asset, marks its record once, and never duplicates identical bytes', async t => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'sb-redline-'));
  const app = await createApp({ workspace });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await app.close(); await rm(workspace, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const episode = app.store.createEpisode({ title: 'Redlines' });
  const scope = `?channel=${episode.channelId}`;
  const upload = await fetch(`${base}/api/episodes/${episode.id}/library/files${scope}`, {
    method: 'POST', headers: { 'x-file-name': 'still.png', 'content-type': 'image/png' }, body: previewPNG });
  assert.equal(upload.status, 201);
  const source = await upload.json();
  assert.equal(source.sourceKind, 'file', 'The ordinary library upload never sets the redline mark');
  const pinned = `/api/preview/library/${episode.id}/${source.id}`;
  const metadata = await (await fetch(`${base}${pinned}${scope}`)).json();
  assert.equal(metadata.itemId, source.id);
  assert.equal(metadata.source, 'library');

  assert.equal((await fetch(`${base}${pinned}/raster${scope}`)).status, 404, 'Only SVG previews have a server raster');
  const post = (body, headers = {}) => fetch(`${base}${pinned}/redline${scope}`, { method: 'POST', headers: { 'content-type': 'image/png', ...headers }, body });
  const svgFile = path.join(workspace, 'mark.svg');
  await writeFile(svgFile, '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30"><rect width="40" height="30" fill="#00f"/></svg>');
  const svgAsset = app.store.saveAsset({ channelId: episode.channelId, name: 'mark.svg', hash: 'mark-svg', kind: 'image', path: 'mark.svg', metadata: { contentType: 'image/svg+xml' } });
  const svgItem = app.store.attachLibraryItem(episode.id, svgAsset.id, { category: 'Graphics', label: 'Mark' });
  const raster = await fetch(`${base}/api/preview/library/${episode.id}/${svgItem.id}/raster${scope}`);
  assert.equal(raster.status, 200);
  assert.equal(raster.headers.get('content-type'), 'image/png');
  const png = Buffer.from(await raster.arrayBuffer());
  assert.equal(png.readUInt32BE(16), 40);
  assert.equal(png.readUInt32BE(20), 30);

  // A distinct PNG from the server raster stands in for a flattened markup.
  const first = await post(png, { 'x-redline-position': 'at 0:02.5' });
  assert.equal(first.status, 201, await first.clone().text());
  const item = await first.json();
  assert.equal(item.sourceKind, 'redline');
  assert.equal(item.category, 'Reference');
  assert.equal(item.label, 'Redline — still.png at 0:02.5');
  assert.equal(item.asset.kind, 'image');
  const retry = await post(png, { 'x-redline-position': 'at 0:02.5' });
  assert.equal(retry.status, 200);
  assert.equal((await retry.json()).id, item.id, 'A retried Send reuses the record for identical bytes');
  const redlines = app.store.listEpisodeLibrary(episode.id).filter(entry => entry.sourceKind === 'redline');
  assert.deepEqual(redlines.map(entry => entry.id), [item.id]);
  assert.deepEqual(await readFile(path.join(workspace, redlines[0].asset.path)), png);

  for (const [body, headers, status] of [
    [Buffer.from('not an image'), {}, 422],
    [png, { 'content-type': 'image/jpeg' }, 415],
    [png, { 'x-redline-position': 'anything goes' }, 400],
  ]) assert.equal((await post(body, headers)).status, status);
  const wrong = app.store.createChannel('Wrong');
  assert.equal((await fetch(`${base}${pinned}/redline?channel=${wrong.id}`, { method: 'POST', headers: { 'content-type': 'image/png' }, body: png })).status, 404);
  const missing = await fetch(`${base}/api/preview/library/${episode.id}/library_missing/redline${scope}`, { method: 'POST', headers: { 'content-type': 'image/png' }, body: png });
  assert.equal(missing.status, 404);
  assert.match((await missing.json()).error, /no longer available/);
  assert.equal(app.store.listEpisodeLibrary(episode.id).filter(entry => entry.sourceKind === 'redline').length, 1);
});

test('Painterro is exact-pinned, bundled locally with its licence, and loaded only by Markup', async () => {
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const lock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'));
  assert.equal(pkg.devDependencies.painterro, '1.2.92');
  assert.equal(pkg.dependencies.painterro, undefined, 'The bundle is committed, so the app image does not install Painterro');
  assert.equal(lock.packages['node_modules/painterro'].version, '1.2.92');
  assert.match(pkg.scripts.build, /esbuild src\/painterro-entry\.js --bundle .*--outfile=public\/painterro\.js/);
  const licence = await readFile(path.join(root, 'public/painterro.LICENSE.txt'), 'utf8');
  assert.ok(licence.startsWith(await readFile(path.join(root, 'node_modules/painterro/LICENSE'), 'utf8')));
  assert.match(licence, /Lodash/);
  const bundle = await readFile(path.join(root, 'public/painterro.js'), 'utf8');
  assert.match(bundle.slice(0, 200), /Painterro 1\.2\.92 .*painterro\.LICENSE\.txt/);
  assert.doesNotMatch(bundle, /\bimport\s*\(|from\s*["']https?:|fetch\(/, 'The bundle loads nothing at run time');
  const preview = await readFile(path.join(root, 'public/preview.js'), 'utf8');
  const html = await readFile(path.join(root, 'public/preview.html'), 'utf8');
  assert.doesNotMatch(html + preview, /painterro\.js/i, 'Ordinary previews never load the markup bundle');
  assert.equal(preview.split('redline.js').length, 2, 'Only the Markup press imports the popup');
  assert.ok(preview.includes("await import('./redline.js')"));
  assert.doesNotMatch(html, /redline/);
  const redline = await readFile(path.join(root, 'public/redline.js'), 'utf8');
  assert.match(redline, /^import Painterro from '\.\/painterro\.js';/);
});

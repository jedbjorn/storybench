// Spec #44 task #123: the Slides canvas route. One saved slide built exactly as the bundle builds it,
// served under the bundle's sandbox, read-only and pinned to the saved revision and the production's channel.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from '../src/server.js';
import { listenInRange } from '../test-support/loopback-port.js';

async function setup(t) {
  const workspace = await mkdtemp(path.join(tmpdir(), 'sb-canvas-route-'));
  const app = await createApp({ workspace });
  t.after(async () => { await app.close(); await rm(workspace, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${await listenInRange(app.server)}`;
  const episode = app.store.createEpisode({ kind: 'deck', title: 'Route deck' });
  const saved = app.store.saveDeck(episode.id, 1, [
    { id: 'first', title: 'First slide', layout: 'statement', body: 'Hello', stages: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }] },
    { id: 'second', title: 'Second slide', layout: 'statement', design: { copy: { align: 'center' } } },
    { id: 'lonely', title: 'One column', layout: 'columns', columns: [{ title: 'Only' }] },
  ], 'human', { theme: { colors: { accent: '#C03060' } }, stageText: { style: 'list' } });
  const canvas = (file = 'index.html', revision = saved.revision, slide = 'first', init = {}) => fetch(`${base}/api/episodes/${episode.id}/deck-canvas/${revision}/${slide}/${file}`, init);
  return { app, base, episode, saved, canvas };
}

test('the canvas serves one saved slide as the build renders it, with the bridge, under the bundle sandbox', async t => {
  const { app, episode, canvas } = await setup(t);
  app.store.saveBrandStandards(episode.channelId, 1, { colors: ['#101820'], fonts: [], stylePrompt: '' });
  const page = await canvas();
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy'), /^sandbox allow-scripts; default-src 'none'; script-src 'self'/);
  assert.equal(page.headers.get('cache-control'), 'no-store');
  const html = await page.text();
  assert.match(html, /<script src="audience.js" defer><\/script><script src="canvas-frame.js" data-standards-revision="2" defer><\/script>/);
  assert.equal(html.match(/<article class="slide/g).length, 1, 'only the open slide');
  assert.match(html, /<ol class="stages stage-list"|<ul class="stages stage-list"/, 'deck default stage text style reaches the slide');
  const css = await (await canvas('styles.css')).text();
  assert.match(css, /--ink:#101820/, 'the channel base colour, live');
  assert.match(css, /--accent:#C03060/, 'the deck theme accent');
  assert.match(await (await canvas('canvas-frame.js')).text(), /storybench-canvas/);
  assert.equal((await canvas('index.html', undefined, 'first', { method: 'HEAD' })).status, 200);
  assert.match(await (await canvas('index.html', undefined, 'second')).text(), /data-copy-align="center"/, 'slide override');
});

test('the canvas refuses a stale revision, an unknown slide or file, another channel, and names a slide the build cannot show', async t => {
  const { app, base, episode, saved, canvas } = await setup(t);
  assert.equal((await canvas('index.html', saved.revision - 1)).status, 409);
  assert.equal((await canvas('index.html', saved.revision, 'missing')).status, 404);
  assert.equal((await canvas('manifest.json')).status, 404);
  assert.equal((await canvas('../../../../package.json')).status, 404);
  const other = app.store.createChannel('Other');
  assert.equal((await fetch(`${base}/api/episodes/${episode.id}/deck-canvas/${saved.revision}/first/index.html?channel=${other.id}`)).status, 409, 'pinned to its channel');
  const refused = await canvas('index.html', saved.revision, 'lonely');
  assert.equal(refused.status, 422);
  assert.match((await refused.json()).error, /^This slide cannot be shown yet: columns requires two or three items/);
  assert.equal((await canvas('index.html', saved.revision, 'first', { method: 'POST' })).status, 404, 'read-only');
});

test('Brand Standards carry the deck template roles shown where a role is unset', async t => {
  const { base, episode } = await setup(t);
  const standards = await (await fetch(`${base}/api/brand-standards?channel=${episode.channelId}`)).json();
  assert.deepEqual(standards.deckTemplate, { colorRoles: { base: '#252C30', accent: '#26686B', background: '#F7F4ED' }, font: 'Manrope' });
});

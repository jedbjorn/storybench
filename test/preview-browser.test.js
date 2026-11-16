import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { chromium, firefox } from 'playwright-core';
import { createApp } from '../src/server.js';
import { listenInRange } from '../test-support/loopback-port.js';
import { previewFixtures } from '../test-support/preview-fixtures.js';

for (const engine of [chromium, firefox]) test(`${engine.name()}: Preview routes render media, sandbox SVG and handle unavailable artifacts`, { timeout: 90_000 }, async t => {
  // Required seats: launch failure is a test failure, never a skip.
  const browser = await engine.launch(engine === chromium ? { channel: 'chromium' } : {});
  t.after(() => browser.close());
  const workspace = await mkdtemp(path.join(tmpdir(), 'sb-preview-browser-'));
  const app = await createApp({ workspace });
  t.after(async () => { await app.close(); await rm(workspace, { recursive: true, force: true }); });
  const port = await listenInRange(app.server);
  const base = `http://127.0.0.1:${port}`;
  const folder = path.join(workspace, 'fixtures');
  const cases = previewFixtures(folder);
  const context = await browser.newContext();
  const page = await context.newPage();
  const downloads = [];
  page.on('download', download => downloads.push(download.url()));
  let last;
  for (const [name, type] of cases) {
    const channel = app.store.createChannel(`${name} ${type || 'empty type'}`);
    const episode = app.store.createEpisode({ title: 'Preview fixture', channelId: channel.id });
    const upload = await fetch(`${base}/api/episodes/${episode.id}/library/files?channel=${channel.id}`, {
      method: 'POST', headers: { 'x-file-name': name, 'content-type': type || 'application/octet-stream' }, body: await readFile(path.join(folder, name)),
    });
    assert.equal(upload.status, 201, await upload.clone().text());
    const item = await upload.json();
    const url = `${base}/preview/library/${episode.id}/${item.id}?channel=${channel.id}`;
    assert.equal((await page.goto(url)).status(), 200);
    await page.waitForFunction(() => document.title.startsWith('Storybench Preview — '));
    assert.equal(await page.locator('#production').textContent(), episode.title);
    assert.equal(await page.locator('#download').isVisible(), true);
    const isImage = name.startsWith('image');
    if (isImage) {
      await page.waitForFunction(() => document.querySelector('#viewer img')?.naturalWidth > 0);
      await page.click('#actual-size');
      assert.equal(await page.locator('#actual-size').getAttribute('aria-pressed'), 'true');
      assert.match(await page.locator('#viewer').getAttribute('class'), /actual/);
    } else {
      assert.equal(await page.locator('#viewer video[controls]').count(), 1);
      // MOV container decoding varies by browser; the Preview page must still open.
      if (name.endsWith('.mp4')) await page.waitForFunction(() => document.querySelector('video')?.duration > 0);
    }
    last = { episode, item, url };
  }
  assert.deepEqual(downloads, []);
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#viewer video')?.duration > 0);

  // A legacy/agent-written SVG can exist even though today's upload parser rejects scripts.
  const scriptFile = path.join(workspace, 'scripted.svg');
  await writeFile(scriptFile, '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="red"/><script>document.documentElement.setAttribute("data-script-ran","yes");localStorage.setItem("svg-ran","yes")</script></svg>');
  const asset = app.store.saveAsset({ channelId: last.episode.channelId, name: 'scripted.svg', hash: 'scripted-svg', kind: 'image', path: 'scripted.svg', metadata: { contentType: 'image/svg+xml' } });
  const item = app.store.attachLibraryItem(last.episode.id, asset.id, { category: 'Reference', label: 'Scripted SVG' });
  const scope = `?channel=${last.episode.channelId}`;
  await page.goto(`${base}/api/episodes/${last.episode.id}/library/${item.id}/file${scope}`);
  assert.equal(await page.locator('svg').getAttribute('data-script-ran'), null);
  await page.goto(`${base}/preview/library/${last.episode.id}/${item.id}${scope}`);
  await page.waitForFunction(() => document.querySelector('#viewer img')?.naturalWidth === 80);
  assert.equal(await page.evaluate(() => localStorage.getItem('svg-ran')), null);

  const file = path.join(workspace, 'draft.mp4');
  await writeFile(file, await readFile(path.join(folder, 'video.mp4')));
  for (const kind of ['draft', 'final']) {
    const job = app.store.saveJob({ id: `preview_${kind}`, episodeId: last.episode.id, kind, outputClass: kind,
      state: 'completed', progress: 1, revision: 1, outputPath: 'draft.mp4', snapshot: {}, createdAt: new Date().toISOString() });
    await page.goto(`${base}/preview/output/${job.id}${scope}`);
    await page.waitForFunction(() => document.querySelector('#viewer video')?.duration > 0);
  }
  const deck = app.store.createEpisode({ title: 'Preview deck', kind: 'deck', channelId: last.episode.channelId });
  app.store.saveDeck(deck.id, 1, [
    { id: 'one', title: 'First slide', body: 'First', layout: 'statement' },
    { id: 'two', title: 'Second slide', body: 'Second', layout: 'statement' },
  ]);
  const build = app.decks.enqueue({ episodeId: deck.id, expectedRevision: 2 });
  await page.waitForFunction(async ({ base, id, channel }) => (await (await fetch(`${base}/api/state?channel=${channel}`)).json()).jobs.some(job => job.id === id && job.state === 'completed'), { base, id: build.id, channel: deck.channelId });
  await page.goto(`${base}/preview/deck/${build.id}${scope}`);
  const frame = page.frameLocator('#viewer iframe');
  await frame.locator('body').waitFor();
  assert.equal(await page.locator('iframe').getAttribute('sandbox'), 'allow-scripts');
  await frame.locator('body').click();
  await page.keyboard.press('ArrowRight');
  await frame.locator('article.slide').filter({ hasText: 'Second slide' }).waitFor({ state: 'visible' });
  if (process.env.STORYBENCH_EVIDENCE_DIR) {
    await mkdir(process.env.STORYBENCH_EVIDENCE_DIR, { recursive: true });
    await page.screenshot({ path: path.join(process.env.STORYBENCH_EVIDENCE_DIR, `preview-deck-${engine.name()}.png`) });
  }
  const wrongChannel = app.store.createChannel('Wrong channel');
  for (const url of [last.url.replace(last.episode.channelId, wrongChannel.id), `${base}/preview/output/missing${scope}`, `${base}/preview/deck/missing${scope}`]) {
    assert.equal((await page.goto(url)).status(), 404);
    await page.locator('#message').filter({ hasText: 'no longer available' }).waitFor();
    assert.equal(await page.locator('#viewer img, #viewer video, #viewer iframe').count(), 0);
  }
  await rm(file);
  assert.equal((await page.goto(`${base}/preview/output/preview_draft${scope}`)).status(), 404);
  await page.locator('#message').filter({ hasText: 'no longer available' }).waitFor();
  assert.deepEqual(downloads, []);
});

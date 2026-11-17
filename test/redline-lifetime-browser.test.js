import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium, firefox } from 'playwright-core';
import { createApp } from '../src/server.js';
import { listenInRange } from '../test-support/loopback-port.js';

// A9 browser half: New chat drops the redline from an open Library panel, the old chat shows the placeholder
// without requesting the file, and Retry on that message is refused with a sentence.
for (const engine of [chromium, firefox]) test(`${engine.name()}: a new chat leaves a removed-redline placeholder, refuses its Retry and refreshes the Library panel`, { timeout: 90_000 }, async t => {
  const browser = await engine.launch(engine === chromium ? { channel: 'chromium' } : {});
  t.after(() => browser.close());
  const workspace = await mkdtemp(path.join(tmpdir(), `sb-redline-life-${engine.name()}-`));
  const codexFactory = async options => ({
    async startThread() { return `thread-${crypto.randomUUID()}`; }, async resumeThread(id) { return id; }, close() {},
    async startTurn() { queueMicrotask(() => options.onEvent({ method: 'turn/completed', params: { turn: { id: 'turn', status: 'failed' } } })); return 'turn'; },
  });
  const app = await createApp({ workspace, chatOptions: { codexFactory } });
  t.after(async () => { await app.close(); await rm(workspace, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${await listenInRange(app.server)}`;
  const folder = path.join(workspace, 'fixtures');
  await mkdir(folder, { recursive: true });
  const png = async colour => {
    const file = path.join(folder, `${colour}.png`);
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', `color=c=${colour}:s=40x30`, '-frames:v', '1', '-y', file]);
    return readFile(file);
  };
  const episode = app.store.createEpisode({ title: 'Redline lifetime' });
  const scope = `?channel=${episode.channelId}`;
  const source = await (await fetch(`${base}/api/episodes/${episode.id}/library/files${scope}`, { method: 'POST', headers: { 'x-file-name': 'white.png', 'content-type': 'image/png' }, body: await png('white') })).json();
  const mark = await (await fetch(`${base}/api/preview/library/${episode.id}/${source.id}/redline${scope}`, { method: 'POST', headers: { 'content-type': 'image/png' }, body: await png('red') })).json();
  const old = app.chat.create(episode.id, { name: 'Old chat' });
  await app.chat.send(episode.id, old.id, 'Redline on library item “white.png”.\n\nMove the logo.', [mark.id]);
  const until = async check => { for (let i = 0; i < 500 && !check(); i++) await new Promise(resolve => setTimeout(resolve, 10)); assert.ok(check()); };
  await until(() => app.chat.get(episode.id, old.id).runs?.some(run => run.state === 'failed'));

  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const fileRequests = [];
  page.on('request', request => { if (request.url().includes(`/library/${mark.id}/file`)) fileRequests.push(request.url()); });
  await page.goto(`${base}/?channel=${episode.channelId}&episode=${episode.id}`);
  await page.locator('.chat-image-link img').waitFor();
  assert.equal(await page.locator('[data-chat-retry]').count(), 1, 'The failed redline turn offers Retry');

  // A second workspace tab with the Library panel open drops the redline without a reload.
  const library = await context.newPage();
  await library.goto(`${base}/?channel=${episode.channelId}&episode=${episode.id}#media`);
  await library.click('[data-tab="media"]');
  await library.locator(`[data-library-item="${mark.id}"]`).waitFor();
  await library.evaluate(() => { window.notReloaded = true; });

  await page.bringToFront();
  await page.click('[data-chat-new]');
  await library.locator(`[data-library-item="${mark.id}"]`).waitFor({ state: 'detached' });
  assert.equal(await library.evaluate(() => window.notReloaded), true, 'The Library panel refreshed in place');
  assert.equal(await library.locator(`[data-library-item="${source.id}"]`).count(), 1, 'Other items stay');

  fileRequests.length = 0;
  await page.locator('[data-chat-history-toggle]').click();
  await page.locator(`[data-chat-id="${old.id}"]`).click();
  const placeholder = page.locator('.chat-image-removed');
  await placeholder.waitFor();
  assert.equal(await placeholder.textContent(), 'Redline image removed');
  assert.equal(await page.locator('.chat-image-link, .chat-image-download').count(), 0, 'No thumbnail or download link for the removed file');
  assert.match(await page.locator(`[data-message-id] >> text=Move the logo.`).first().textContent(), /Move the logo/);
  await page.locator('[data-chat-retry]').click();
  await page.locator('#toast.show').filter({ hasText: 'This redline image was removed when a new chat started. Send a new redline from Preview' }).waitFor();
  assert.equal(app.chat.get(episode.id, old.id).messages.filter(message => message.role === 'user').length, 1, 'The refused Retry sent nothing');
  assert.deepEqual(fileRequests, [], 'Nothing is requested for the missing file');
});

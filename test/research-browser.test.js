import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { createApp } from '../src/server.js';
import { listenInRange } from '../test-support/loopback-port.js';

test('Research guards real tab/production/channel/action navigation, preserves failed drafts, refreshes idle views and serves both kinds/stages/archive', { timeout: 60000 }, async t => {
  let browser;
  try { browser = await chromium.launch(); }
  catch { if (existsSync('/usr/bin/chromium')) browser = await chromium.launch({ executablePath: '/usr/bin/chromium' }).catch(() => null); }
  if (!browser) return t.skip('No launchable Chromium on this seat');
  t.after(() => browser.close());
  const root = mkdtempSync(path.join(os.tmpdir(), 'sb-research-browser-')), requests = [];
  const app = await createApp({ workspace: root, chatOptions: { codexFactory: async options => ({
    startThread: async () => 'thread-fixture', resumeThread: async id => id,
    startTurn: async () => { requests.push(options.request); queueMicrotask(() => options.onEvent({ method: 'turn/completed', params: { turn: { id: `turn-${requests.length}`, status: 'completed' } } })); return `turn-${requests.length}`; }, close() {},
  }) } });
  t.after(async () => { await app.close(); rmSync(root, { recursive: true, force: true }); });
  const main = app.store.getDefaultChannel(), otherChannel = app.store.createChannel('Other channel');
  const video = app.store.createEpisode({ title: 'Research video', channelId: main.id });
  const deck = app.store.createEpisode({ title: 'Research deck', channelId: main.id, kind: 'deck' });
  const port = await listenInRange(app.server), base = `http://127.0.0.1:${port}`;
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }), errors = [], remote = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => new URL(route.request().url()).origin !== base ? (remote.push(route.request().url()), route.abort()) : route.continue());
  const open = async p => { await page.goto(`${base}/episodes?channel=${main.id}&episode=${p.id}`); await page.locator('[data-chat-draft]').waitFor(); await page.click('[data-tab=research]'); await page.locator('[data-research-edit]:enabled').waitFor(); };
  const edit = async text => { await page.click('[data-research-edit]'); await page.fill('[data-research-summary]', text); };
  const leave = () => page.locator('[data-research-leave][open]').waitFor();
  const read = text => page.waitForFunction(expected => document.querySelector('[data-research-read]')?.textContent.includes(expected), text);
  await open(video);
  await edit('Unsaved findings');
  assert.equal(await page.evaluate(() => { const event = new Event('beforeunload', { cancelable: true }); dispatchEvent(event); return event.defaultPrevented; }), true);
  await page.click('#preview'); await leave(); await page.click('[data-research-stay]');
  assert.equal(requests.length, 0); assert.equal(await page.inputValue('[data-research-summary]'), 'Unsaved findings');
  await page.fill('[data-chat-draft]', 'Use my findings'); await page.click('[data-chat-send]'); await leave(); await page.click('[data-research-stay]');
  assert.equal(requests.length, 0); assert.equal(await page.inputValue('[data-chat-draft]'), 'Use my findings');
  await page.route(`**/api/episodes/${video.id}/research`, route => route.request().method() === 'PUT' ? route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Injected storage failure"}' }) : route.continue());
  await page.click('[data-tab=story]'); await leave(); await page.click('[data-research-leave-save]');
  await page.waitForFunction(() => document.querySelector('[data-research-status]').textContent.includes('Injected storage failure'));
  assert.equal(await page.inputValue('[data-research-summary]'), 'Unsaved findings');
  assert.equal(await page.locator('[data-research-leave][open]').isVisible(), true);
  await page.click('[data-research-stay]'); await page.unroute(`**/api/episodes/${video.id}/research`);
  await page.click('#preview'); await leave(); await page.click('[data-research-leave-save]');
  await page.waitForFunction(() => document.querySelectorAll('.chat-user').length === 1);
  assert.equal(requests.length, 1); assert.equal(app.store.getResearch(video.id).summary, 'Unsaved findings');
  app.store.saveResearch(video.id, 2, { summary: '# Agent idle update', links: [] }, 'agent');
  await read('Agent idle update');
  await edit('My pending entire summary');
  await page.click('[data-research-add]'); await page.fill('[data-link-field=url]', 'https://example.com/new'); await page.fill('[data-link-field=note]', 'My pending note');
  const linkId = await page.locator('[data-link-id]').getAttribute('data-link-id');
  app.store.saveResearch(video.id, 3, { summary: 'Agent concurrent change', links: [] }, 'agent');
  await page.waitForTimeout(2000);
  assert.equal(await page.inputValue('[data-research-summary]'), 'My pending entire summary');
  await page.click('[data-research-save]'); await page.locator('[data-research-conflict]').waitFor({ state: 'visible' });
  assert.equal(await page.inputValue('[data-link-field=note]'), 'My pending note');
  assert.equal(app.store.getResearch(video.id).summary, 'Agent concurrent change');
  await page.click('[data-research-reconcile]'); await page.click('[data-research-save]'); await read('My pending entire summary');
  assert.equal(app.store.getResearch(video.id).links[0].id, linkId);
  await edit('Tab cancellation'); await page.click('[data-tab=story]'); await leave(); await page.keyboard.press('Escape');
  assert.equal(await page.inputValue('[data-research-summary]'), 'Tab cancellation');
  await page.click('[data-tab=story]'); await leave(); await page.click('[data-research-discard]');
  await page.locator('[data-story-edit]').waitFor({ state: 'visible' });
  await page.click('[data-tab=research]'); await edit('Production cancellation');
  await page.click('#episodeRailToggle'); await page.click(`[data-id="${deck.id}"] [data-episode-select]`); await leave(); await page.click('[data-research-stay]');
  assert.equal(await page.inputValue('#episodeTitle'), video.title);
  await page.click(`[data-id="${deck.id}"] [data-episode-select]`); await leave(); await page.click('[data-research-discard]');
  await page.waitForFunction(title => document.querySelector('#episodeTitle').value === title, deck.title);
  await page.locator('[data-research-edit]:enabled').waitFor(); await edit('Channel cancellation');
  await page.click('#channelsToggle'); await page.click(`[data-channel-id="${otherChannel.id}"]`); await leave(); await page.click('[data-research-stay]');
  assert.equal(await page.locator('#channelName').textContent(), main.name);
  await page.click(`[data-channel-id="${otherChannel.id}"]`); await leave(); await page.click('[data-research-discard]');
  await page.waitForFunction(() => document.querySelector('#channelName').textContent === 'Other channel');
  await open(video); await edit('Archive cancellation');
  await page.click('#episodeRailToggle'); await page.selectOption(`[data-id="${video.id}"] [data-episode-state-select]`, 'Archived'); await leave(); await page.click('[data-research-stay]');
  assert.equal(app.store.getEpisode(video.id).archivedAt, null);
  assert.equal(await page.inputValue('[data-research-summary]'), 'Archive cancellation');
  await page.keyboard.press('Escape');
  await page.selectOption(`[data-id="${video.id}"] [data-episode-state-select]`, 'Archived'); await leave(); await page.click('[data-research-discard]');
  await page.waitForFunction(() => document.querySelector('#filteredEpisodeNotice').textContent.includes('Archived'));
  for (const p of [video, deck]) {
    for (const stage of ['Scaffold', 'Draft', 'Final', 'Published']) {
      const current = app.store.getEpisode(p.id); app.store.updateEpisode(p.id, current.revision, { state: stage, archived: false });
      await open(p);
      assert.deepEqual(await page.locator('.tabs > button').evaluateAll(buttons => buttons.map(b => b.dataset.tab).slice(2, 4)), ['media', 'research']);
      assert.equal(await page.locator('[data-research-read]').isVisible(), true);
      assert.equal(await page.locator('[data-chat-draft]').isVisible(), true);
    }
    const current = app.store.getEpisode(p.id); app.store.updateEpisode(p.id, current.revision, { archived: true });
    await open(p); assert.equal(await page.locator('[data-research-edit]').isVisible(), true);
  }
  assert.deepEqual(remote, []); assert.deepEqual(errors, []);
});

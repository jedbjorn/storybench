import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { createApp } from '../src/server.js';
import { listenInRange } from '../test-support/loopback-port.js';

test('global fuzzy search and production tab URLs work across channels, refresh and history', { timeout: 60000 }, async (t) => {
  let browser;
  try { browser = await chromium.launch(); }
  catch { if (existsSync('/usr/bin/chromium')) browser = await chromium.launch({ executablePath: '/usr/bin/chromium' }); }
  if (!browser) return t.skip('No launchable Chromium on this seat');
  t.after(() => browser.close());
  const root = mkdtempSync(path.join(tmpdir(), 'storybench-search-'));
  const app = await createApp({ workspace: root });
  t.after(async () => { await app.close(); rmSync(root, { recursive: true, force: true }); });
  const main = app.store.getDefaultChannel(), other = app.store.createChannel('Education');
  const first = app.store.createEpisode({ title: 'First production', channelId: main.id });
  const deck = app.store.createEpisode({ title: 'Écological Skill Acquisition', kind: 'deck', channelId: other.id });
  const archived = app.store.createEpisode({ title: '<img src=x onerror=alert(1)>', channelId: other.id });
  app.store.updateEpisode(archived.id, archived.revision, { archived: true });
  for (let i = 0; i < 10; i++) app.store.createEpisode({ title: `Production ${i}`, channelId: other.id });
  const port = await listenInRange(app.server), base = `http://127.0.0.1:${port}`;
  const response = await fetch(`${base}/api/production-search`, { headers: { 'x-storybench-channel': main.id } });
  const summaries = await response.json();
  assert.equal(summaries.length, 13, 'Global metadata includes both channels and archived productions');
  assert.deepEqual(Object.keys(summaries[0]).sort(), ['channelId', 'channelName', 'id', 'stage', 'title', 'updatedAt']);
  assert.match(summaries.find((item) => item.id === archived.id).stage, /Archived/);
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${base}/episodes?channel=${main.id}&episode=${first.id}`);
  await page.locator('[data-chat-title]').waitFor();
  assert.equal(await page.locator('#productionSearchInput').isVisible(), false);
  await page.click('#productionSearchToggle');
  const input = page.locator('#productionSearchInput'), options = page.locator('#productionSearchResults [role=option]');
  await page.waitForFunction(() => document.querySelectorAll('#productionSearchResults [role=option]').length === 13);
  assert.equal(await input.evaluate((el) => el === document.activeElement), true);
  const geometry = await page.locator('#productionSearchResults').evaluate((el) => ({ height: el.clientHeight, scroll: el.scrollHeight, row: el.firstElementChild.getBoundingClientRect().height }));
  assert.equal(geometry.height, geometry.row * 8);
  assert.ok(geometry.scroll > geometry.height);
  assert.equal(await page.locator('#productionSearchResults img').count(), 0, 'Names are escaped');
  await input.fill('production');
  await page.keyboard.press('ArrowUp');
  assert.equal(await options.last().getAttribute('aria-selected'), 'true');
  assert.ok(await page.locator('#productionSearchResults').evaluate((el) => el.scrollTop > 0));
  await input.fill('ecolgoical educ');
  assert.equal(await options.count(), 1);
  assert.equal(await options.first().locator('strong').textContent(), deck.title);
  assert.match(await options.first().locator('.search-result-meta').textContent(), /Education \| Scaffold/);
  assert.ok(await options.first().locator('time').textContent());
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
  await page.waitForFunction((id) => new URL(location.href).searchParams.get('episode') === id, deck.id);
  assert.equal(await page.inputValue('#episodeTitle'), deck.title);
  assert.equal(await page.locator('#productionSearchToggle').getAttribute('aria-expanded'), 'false');
  assert.equal(app.store.getDefaultChannel().id, main.id, 'Search does not change installation default');
  await page.goBack();
  await page.waitForFunction((id) => new URL(location.href).searchParams.get('episode') === id && document.querySelector('#episodeTitle').value === 'First production', first.id);
  await page.goForward();
  await page.waitForFunction((id) => document.querySelector('#episodeTitle').value === 'Écological Skill Acquisition' && new URL(location.href).searchParams.get('episode') === id, deck.id);

  for (const tab of ['story', 'media', 'research', 'board']) {
    await page.click(`[data-tab="${tab}"]`);
    await page.waitForURL(`**#${tab}`);
    await page.reload();
    await page.locator(`#${tab}Panel`).waitFor({ state: 'visible' });
    assert.equal(await page.locator(`[data-tab="${tab}"]`).getAttribute('class'), 'active');
  }
  await page.click('[data-tab="story"]'); await page.waitForURL('**#story');
  await page.click('[data-tab="research"]'); await page.waitForURL('**#research');
  await page.goBack(); await page.locator('#storyPanel').waitFor({ state: 'visible' });
  assert.equal(new URL(page.url()).hash, '#story');
  await page.goForward(); await page.locator('#researchPanel').waitFor({ state: 'visible' });

  // Decks cannot open video outputs; an invalid hash safely uses the board.
  await page.goto(`${base}/episodes?channel=${other.id}&episode=${deck.id}#final`);
  await page.locator('#boardPanel').waitFor({ state: 'visible' });
  await page.locator('[data-chat-title]').waitFor();
  assert.equal(await page.locator('#finalPanel').isVisible(), false);
  await page.waitForURL('**#board');
  for (const tab of ['drafts', 'final']) {
    await page.goto(`${base}/episodes?channel=${main.id}&episode=${first.id}#${tab}`);
    await page.locator(`#${tab}Panel`).waitFor({ state: 'visible' });
    await page.reload(); await page.locator(`#${tab}Panel`).waitFor({ state: 'visible' });
  }
  for (const width of [1600, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.click('#productionSearchToggle');
    await input.fill('production');
    await options.first().waitFor();
    await page.locator('.search-field').evaluate((el) => Promise.all(el.getAnimations().map((animation) => animation.finished)));
    const box = await page.locator('.search-dropdown').boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= width);
    const field = await input.boundingBox();
    assert.ok(field.x >= 0 && field.x + field.width <= width);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.equal(await options.first().evaluate((el) => {
      const rect = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(rect.left + 20, rect.top + 20));
    }), true, 'Search results appear above the production rail');
    if (process.env.STORYBENCH_SEARCH_EVIDENCE) {
      mkdirSync(process.env.STORYBENCH_SEARCH_EVIDENCE, { recursive: true });
      await page.screenshot({ path: path.join(process.env.STORYBENCH_SEARCH_EVIDENCE, `search-${width}.png`) });
    }
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#productionSearchToggle').evaluate((el) => el === document.activeElement), true);
  }
  await page.click('#productionSearchToggle');
  await input.fill('xyzzy');
  await page.getByText('No matching productions').waitFor();
  await input.fill('ecologcal');
  await options.first().click();
  await page.waitForFunction((id) => new URL(location.href).searchParams.get('episode') === id, deck.id);
  assert.equal(await page.inputValue('#episodeTitle'), deck.title);
  await page.route('**/api/production-search', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Temporarily offline' }) }));
  await page.click('#productionSearchToggle');
  await page.getByText('Search unavailable: Temporarily offline').waitFor();
  assert.equal(await options.count(), 0);
  await page.click('#episodeTitle');
  assert.equal(await page.locator('.search-dropdown').isVisible(), false);
  assert.deepEqual(errors, []);
});

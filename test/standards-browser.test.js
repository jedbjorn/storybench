import { listenInRange } from "../test-support/loopback-port.js";
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { createApp } from '../src/server.js';

async function launch() {
  try { return await chromium.launch(); }
  catch { return existsSync('/usr/bin/chromium') ? chromium.launch({ executablePath: '/usr/bin/chromium' }).catch(() => null) : null; }
}
test('Branding and Models pages save settings, render fonts, preserve episodes and guard navigation', { timeout: 60000 }, async (t) => {
  const browser = await launch();
  if (!browser) return t.skip('No launchable Chromium on this seat');
  t.after(() => browser.close());
  const root = mkdtempSync(path.join(tmpdir(), 'storybench-standards-browser-'));
  const catalog = [{ harness: 'codex', available: true, exactModelIds: false, models: [
    { id: 'model-a', displayName: 'Model A', isDefault: true, efforts: ['medium', 'high'] },
    { id: 'model-b', displayName: 'Model B', efforts: ['medium'] },
  ] }];
  const app = await createApp({ workspace: root, chatOptions: { catalog: { list: async () => catalog } } });
  t.after(async () => { await app.close(); rmSync(root, { recursive: true, force: true }); });
  const episode = app.store.createEpisode({ title: 'Brand demo' });
  app.store.updateEpisode(episode.id, episode.revision, { cards: [{ id: 'intro', title: 'Channel intro', type: 'Video', prompt: 'Blue logo' }] });
  app.store.promoteCard(episode.id, 'intro', { name: 'Brand intro', role: 'intro' });
  await listenInRange(app.server);
  const base = `http://127.0.0.1:${app.server.address().port}`, query = `?channel=${episode.channelId}&episode=${episode.id}`;
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(base + '/episodes' + query);
  await page.locator('#episodeTitle').waitFor({ state: 'visible' });
  await page.click('[data-page="branding"]');
  await page.locator('#standardsForm').waitFor();
  assert.equal(await page.locator('#episodesPage').isVisible(), false);
  assert.match(await page.textContent('#brandingTemplates'), /Brand intro/);
  await page.fill('[name="color0"]', '#0055ff');
  await page.fill('[name="color1"]', '#ffffff');
  await page.selectOption('[name="font0"]', 'Liberation Serif');
  await page.selectOption('[name="font1"]', 'DejaVu Sans');
  await page.fill('[name="stylePrompt"]', 'Bold blue titles, calm movement.');
  await page.evaluate(() => document.fonts.ready);
  assert.equal(await page.evaluate(() => document.fonts.check('21px "Liberation Serif"')), true);
  await page.getByRole('button', { name: 'Save standards', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#saveState').textContent === 'Standards saved');
  assert.deepEqual(app.store.getBrandStandards(episode.channelId).fonts, ['Liberation Serif', 'DejaVu Sans']);
  if (process.env.STORYBENCH_STANDARDS_SCREENSHOT) await page.screenshot({ path: process.env.STORYBENCH_STANDARDS_SCREENSHOT, fullPage: true });
  await page.reload();
  await page.locator('#standardsForm').waitFor();
  assert.equal(await page.inputValue('[name="color0"]'), '#0055FF');
  assert.equal(await page.inputValue('[name="stylePrompt"]'), 'Bold blue titles, calm movement.');
  await page.fill('[name="stylePrompt"]', 'Unfinished');
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.click('[data-page="models"]');
  assert.equal(new URL(page.url()).pathname, '/branding');
  assert.equal(await page.inputValue('[name="stylePrompt"]'), 'Unfinished');
  page.once('dialog', (dialog) => dialog.accept());
  await page.click('[data-page="models"]');
  await page.locator('#defaultModelEditor form').waitFor();
  await page.fill('#defaultModelEditor [name="model"]', 'model-a');
  await page.selectOption('#defaultModelEditor [name="effort"]', 'high');
  await page.getByRole('button', { name: 'Save default', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#saveState').textContent === 'Default model saved');
  assert.equal(app.store.getModelDefault().selection.model, 'model-a');
  assert.equal(app.chat.create(episode.id).settings.effort, 'high');
  await page.goBack();
  await page.locator('#standardsForm').waitFor();
  assert.equal(await page.inputValue('[name="stylePrompt"]'), 'Bold blue titles, calm movement.');
  await page.fill('[name="stylePrompt"]', 'Keep this draft');
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.goBack();
  await page.waitForURL('**/branding?**');
  assert.equal(await page.inputValue('[name="stylePrompt"]'), 'Keep this draft');
  page.once('dialog', (dialog) => dialog.accept());
  await page.click('[data-page="episodes"]');
  await page.locator('#episodeTitle').waitFor({ state: 'visible' });
  assert.equal(await page.inputValue('#episodeTitle'), 'Brand demo');
  assert.equal(new URL(page.url()).searchParams.get('episode'), episode.id);
  await page.goto(base + '/models' + query);
  await page.locator('#defaultModelEditor form').waitFor();
  assert.equal(await page.inputValue('#defaultModelEditor [name="model"]'), 'model-a');
  assert.deepEqual(errors, []);
});

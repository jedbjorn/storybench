import { listenInRange } from "../test-support/loopback-port.js";
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium, firefox } from 'playwright-core';
import { createApp } from '../src/server.js';

async function launch(browserType) {
  try { return await browserType.launch(); }
  catch { return browserType === chromium && existsSync('/usr/bin/chromium') ? chromium.launch({ executablePath: '/usr/bin/chromium' }).catch(() => null) : null; }
}
for (const browserType of [chromium, firefox]) test(`${browserType.name()}: Branding and Models pages save settings, render fonts, preserve and archive episodes, and guard navigation`, { timeout: 60000 }, async (t) => {
  const browser = await launch(browserType);
  if (!browser) return t.skip(`No launchable ${browserType.name()} on this seat`);
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
  for (const width of [1440, 900, 600]) {
    await page.setViewportSize({ width, height: 1050 });
    const nav = await page.locator('.page-nav').boundingBox();
    assert.ok(Math.abs(nav.x + nav.width / 2 - width / 2) < 1, `Navigation centered at ${width}px`);
  }
  await page.setViewportSize({ width: 1440, height: 1050 });
  assert.equal(await page.getByRole('textbox', { name: 'Base color hex', exact: true }).count(), 1);
  assert.equal(await page.getByRole('combobox', { name: 'Alternate font' }).count(), 1);
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
  await page.goto(base + '/branding' + query);
  await page.locator('#standardsForm').waitFor();
  await page.getByRole('button', { name: 'Clear base color' }).click();
  await page.fill('[name="color2"]', '#FFFFFF');
  await page.selectOption('[name="font0"]', '');
  await page.selectOption('[name="font2"]', 'Liberation Serif');
  await page.getByRole('button', { name: 'Save standards', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#saveState').textContent === 'Standards saved');
  await page.reload();
  await page.locator('#standardsForm').waitFor();
  assert.equal(await page.inputValue('[name="color0"]'), '');
  assert.equal(await page.inputValue('[name="color2"]'), '#FFFFFF');
  assert.equal(await page.inputValue('[name="font0"]'), '');
  assert.equal(await page.inputValue('[name="font1"]'), 'DejaVu Sans');
  assert.equal(await page.inputValue('[name="font2"]'), 'Liberation Serif');

  // Real pointer clicks must place the caret after switching between fields.
  async function checkCaret(selector, other) {
    const field = page.locator(selector);
    await field.fill('abcdefghijklmno');
    await page.locator(other).click();
    await field.click({ position: { x: 45, y: 12 } });
    const middle = await field.evaluate((el) => el.selectionStart);
    assert.ok(middle > 0 && middle < 15, `${selector}: middle caret is ${middle}`);
    await page.keyboard.insertText('X');
    assert.equal(await field.inputValue(), 'abcdefghijklmno'.slice(0, middle) + 'X' + 'abcdefghijklmno'.slice(middle));
    await page.locator(other).click();
    await field.waitFor({ state: 'visible' });
    const width = await field.evaluate((element) => element.getBoundingClientRect().width);
    await field.click({ position: { x: width - 12, y: 12 } });
    assert.equal(await field.evaluate((el) => el.selectionStart), 16);
  }
  await checkCaret('[name="stylePrompt"]', '[name="color0"]');
  page.once('dialog', (dialog) => dialog.accept());
  await page.click('[data-page="episodes"]');
  await page.locator('#cards [data-key="prompt"]').waitFor();
  await checkCaret('#cards [data-key="prompt"]', '#episodeTitle');
  await page.locator('#cards .card-group-heading').last().click();
  await page.waitForFunction(() => document.querySelector('#saveState').textContent.startsWith('Saved'));
  await Promise.all([
    page.waitForResponse((response) => response.url().includes('/api/episodes/' + episode.id) && response.request().method() === 'PUT'),
    page.locator('#cards .drag').dragTo(page.locator('#cards .card-group-heading').last()),
  ]);
  await page.waitForFunction(() => document.querySelector('#saveState').textContent.startsWith('Saved'));
  assert.equal(app.store.getEpisode(episode.id).cards[0].order, 1);

  const episodeState = `[data-id="${episode.id}"] [data-episode-state-select]`;
  async function moveEpisode(nextState) {
    const previous = await page.locator(episodeState).elementHandle();
    await page.selectOption(episodeState, nextState);
    await new Promise((resolve, reject) => {
      const deadline = Date.now() + 5000;
      const check = () => {
        const value = app.store.getEpisode(episode.id);
        const moved = nextState === 'Archived' ? Boolean(value.archivedAt) : !value.archivedAt && value.state === nextState;
        if (moved) resolve();
        else if (Date.now() >= deadline) reject(new Error(`Episode did not move to ${nextState}`));
        else setTimeout(check, 10);
      };
      check();
    });
    await page.waitForFunction((element) => !element.isConnected, previous);
  }
  await moveEpisode('Draft');
  assert.equal(app.store.getEpisode(episode.id).state, 'Draft');
  await moveEpisode('Archived');
  assert.equal(app.store.getEpisode(episode.id).state, 'Draft');
  assert.ok(app.store.getEpisode(episode.id).archivedAt);
  assert.doesNotMatch(await page.textContent('#episodes'), /Brand demo/);
  assert.match(await page.textContent('[data-episode-state="Archived"]'), /Archived1[\s\S]*1 episode hidden/);
  await page.click('[data-reveal-episode]');
  assert.equal(await page.inputValue('#episodeFilter'), 'Archived');
  await moveEpisode('Draft');
  assert.equal(app.store.getEpisode(episode.id).archivedAt, null);
  assert.equal(app.store.getEpisode(episode.id).state, 'Draft');
  await page.click('[data-reveal-episode]');
  assert.equal(await page.inputValue('#episodeFilter'), 'All');
  assert.match(await page.textContent('#episodes'), /Brand demo/);
  assert.deepEqual(errors, []);
});

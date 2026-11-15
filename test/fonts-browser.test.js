import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium, firefox } from 'playwright-core';
import { createApp } from '../src/server.js';
import { listenInRange } from '../test-support/loopback-port.js';

for (const browserType of [chromium, firefox]) test(`${browserType.name()}: visual font choices load actual regular/bold files and save channel roles`, { timeout: 30000 }, async t => {
  let browser = await browserType.launch().catch(() => null);
  if (!browser && browserType === chromium && existsSync('/usr/bin/chromium')) browser = await chromium.launch({ executablePath: '/usr/bin/chromium' }).catch(() => null);
  if (!browser) return t.skip(`No launchable ${browserType.name()} on this seat`);
  t.after(() => browser.close());
  const root = mkdtempSync(path.join(tmpdir(), 'storybench-font-browser-'));
  const app = await createApp({ workspace: root });
  t.after(async () => { await app.close(); rmSync(root, { recursive: true, force: true }); });
  const episode = app.store.createEpisode({ title: 'Font choices' });
  await listenInRange(app.server);
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${base}/branding?channel=${episode.channelId}`);
  await page.locator('#standardsForm').waitFor();
  const families = await page.evaluate(async () => {
    const fonts = await (await fetch('/api/fonts')).json();
    return Promise.all(fonts.map(async font => {
      const loaded = await Promise.all([400, 700].map(weight => document.fonts.load(`${weight} 24px "${font.family}"`)));
      return { family: font.family, available: font.available, loaded: loaded.map(faces => faces.length), states: loaded.flat().map(face => face.status) };
    }));
  });
  assert.equal(families.length, 26);
  for (const font of families) {
    assert.equal(font.available, true, font.family);
    assert.deepEqual(font.loaded, [1, 1], font.family);
    assert.deepEqual(font.states, ['loaded', 'loaded'], font.family);
  }
  const trigger = page.getByRole('combobox', { name: 'Base font', exact: true });
  await trigger.click();
  assert.equal(await page.getByRole('option').count(), 27);
  const kalam = page.getByRole('option', { name: 'Kalam', exact: true });
  assert.match(await kalam.evaluate(node => getComputedStyle(node).fontFamily), /Kalam/);
  assert.match(await page.getByRole('option', { name: 'Poppins', exact: true }).evaluate(node => getComputedStyle(node).fontFamily), /Poppins/);
  await kalam.click();
  assert.match(await trigger.evaluate(node => getComputedStyle(node).fontFamily), /Kalam/);
  await page.getByRole('combobox', { name: 'Accent font', exact: true }).click();
  await page.getByRole('option', { name: 'Crimson Text', exact: true }).click();
  await page.getByRole('button', { name: 'Save standards', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#saveState').textContent === 'Standards saved');
  assert.deepEqual(app.store.getBrandStandards(episode.channelId).fonts, ['Kalam', 'Crimson Text']);
  await page.reload(); await page.locator('#standardsForm').waitFor();
  assert.equal(await page.inputValue('[name=font0]'), 'Kalam');
  await page.getByRole('combobox', { name: 'Base font', exact: true }).click();
  if (process.env.STORYBENCH_FONT_EVIDENCE && browserType === chromium) await page.screenshot({ path: path.join(process.env.STORYBENCH_FONT_EVIDENCE, 'font-choices.png'), fullPage: true });
  await page.keyboard.press('Home'); await page.keyboard.press('Enter');
  assert.equal(await page.inputValue('[name=font0]'), '');
  for (const width of [600, 390]) {
    await page.setViewportSize({ width, height: 1050 });
    await page.getByRole('combobox', { name: 'Accent font', exact: true }).click();
    const box = await page.getByRole('listbox').boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= width, `Font menu fits ${width}px viewport`);
    await page.keyboard.press('Escape');
  }
  assert.deepEqual(errors, []);
});

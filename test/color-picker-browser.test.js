import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium, firefox } from 'playwright-core';
import { listenInRange } from '../test-support/loopback-port.js';
import { createApp } from '../src/server.js';

for (const browserType of [chromium, firefox]) test(`${browserType.name()}: Branding color picker chooses, cancels, validates and saves colors`, { timeout: 60000 }, async (t) => {
  let browser;
  try { browser = await browserType.launch(); }
  catch {
    if (browserType === chromium && existsSync('/usr/bin/chromium')) browser = await chromium.launch({ executablePath: '/usr/bin/chromium' });
  }
  if (!browser) return t.skip(`No launchable ${browserType.name()} on this seat`);
  t.after(() => browser.close());
  const root = mkdtempSync(path.join(tmpdir(), 'storybench-color-picker-'));
  const app = await createApp({ workspace: root });
  t.after(async () => { await app.close(); rmSync(root, { recursive: true, force: true }); });
  const episode = app.store.createEpisode({ title: 'Color picker proof' });
  await listenInRange(app.server);
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  // Exercise both capability states deterministically on every browser.
  await page.addInitScript(() => { window.EyeDropper = undefined; });
  await page.goto(`http://127.0.0.1:${app.server.address().port}/branding?channel=${episode.channelId}&episode=${episode.id}`);
  const picker = page.getByRole('dialog', { name: 'Pick base color', exact: true });
  const base = page.getByRole('button', { name: 'Pick base color', exact: true });
  const field = page.getByRole('textbox', { name: 'Base color hex', exact: true });
  await base.click();
  assert.equal(await picker.isVisible(), true);
  assert.equal(await picker.getByRole('button', { name: 'Pick from screen' }).isVisible(), false);
  assert.equal(await picker.getByRole('group', { name: 'Recent colors' }).count(), 0);
  await picker.getByRole('button', { name: 'Cancel', exact: true }).click();
  await picker.waitFor({ state: 'detached' });
  assert.equal(await field.inputValue(), '');
  assert.equal(await base.evaluate((node) => node === document.activeElement), true);
  assert.equal(await page.textContent('#saveState'), 'Ready');

  await base.click();
  await picker.getByRole('button', { name: '#3B82F6', exact: true }).click();
  await picker.waitFor({ state: 'detached' });
  assert.equal(await field.inputValue(), '#3B82F6');
  assert.equal(await page.textContent('#saveState'), 'Unsaved changes');
  assert.deepEqual(app.store.getBrandStandards(episode.channelId).colors, []);
  assert.equal(await base.locator('span').evaluate((node) => getComputedStyle(node).backgroundImage), 'none');

  await base.click();
  assert.equal(await picker.getByRole('group', { name: 'Recent colors' }).getByRole('button', { name: '#3B82F6' }).count(), 1);
  await picker.getByRole('textbox', { name: 'Hex color' }).fill('badhex');
  await picker.getByRole('button', { name: 'Apply', exact: true }).click();
  assert.match(await picker.getByRole('alert').textContent(), /six hex digits/);
  assert.equal(await field.inputValue(), '#3B82F6');
  await page.keyboard.press('Escape');
  await picker.waitFor({ state: 'detached' });
  assert.equal(await field.inputValue(), '#3B82F6');

  await base.click();
  await picker.getByRole('textbox', { name: 'Hex color' }).fill('aabbcc');
  await page.keyboard.press('Enter');
  await picker.waitFor({ state: 'detached' });
  assert.equal(await field.inputValue(), '#AABBCC');
  await page.getByRole('button', { name: 'Pick accent color', exact: true }).click();
  const accentPicker = page.getByRole('dialog', { name: 'Pick accent color', exact: true });
  await accentPicker.getByRole('group', { name: 'Recent colors' }).getByRole('button', { name: '#AABBCC' }).click();
  await accentPicker.waitFor({ state: 'detached' });
  assert.equal(await page.inputValue('[name="color1"]'), '#AABBCC');

  await page.evaluate(() => {
    window.EyeDropper = class { async open() { throw new DOMException('Cancelled', 'AbortError'); } };
  });
  await base.click();
  assert.equal(await picker.getByRole('group', { name: 'Recent colors' }).getByRole('button').count(), 2, 'Recent choices are unique');
  await picker.getByRole('button', { name: 'Pick from screen' }).click();
  assert.equal(await picker.getByRole('alert').textContent(), '');
  assert.equal(await picker.isVisible(), true);
  await page.evaluate(() => { window.EyeDropper = class { async open() { throw new Error('Unavailable'); } }; });
  await picker.getByRole('button', { name: 'Pick from screen' }).click();
  await page.waitForFunction(() => document.querySelector('#pickerError').textContent.includes('Could not pick'));
  await page.evaluate(() => { window.EyeDropper = class { async open() { return { sRGBHex: '#123456' }; } }; });
  await picker.getByRole('button', { name: 'Pick from screen' }).click();
  await picker.waitFor({ state: 'detached' });
  assert.equal(await field.inputValue(), '#123456');

  await page.getByRole('button', { name: 'Pick background color', exact: true }).click();
  const backgroundPicker = page.getByRole('dialog', { name: 'Pick background color', exact: true });
  // The optional system picker funnels its confirmed result through the same draft path.
  await backgroundPicker.locator('input[type="color"]').evaluate((node) => {
    node.value = '#abcdef'; node.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await backgroundPicker.waitFor({ state: 'detached' });
  assert.equal(await page.inputValue('[name="color2"]'), '#ABCDEF');
  await page.getByRole('button', { name: 'Save standards', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#saveState').textContent === 'Standards saved');
  assert.deepEqual(app.store.getBrandStandards(episode.channelId).colors, ['#123456', '#AABBCC', '#ABCDEF']);
  await page.reload();
  await field.waitFor();
  assert.equal(await field.inputValue(), '#123456');
  await field.fill('#fedcba');
  await base.click();
  assert.equal(await picker.getByRole('textbox', { name: 'Hex color' }).inputValue(), '#FEDCBA');
  for (const width of [1440, 600, 390, 320]) {
    await page.setViewportSize({ width, height: 720 });
    const box = await picker.boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= width, `Picker fits at ${width}px`);
    assert.equal(await picker.evaluate((node) => node.scrollWidth <= node.clientWidth), true);
  }
  if (process.env.STORYBENCH_COLOR_SCREENSHOT) await page.screenshot({ path: process.env.STORYBENCH_COLOR_SCREENSHOT });
  await picker.getByRole('button', { name: 'Cancel', exact: true }).click();
  await picker.waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'Clear base color', exact: true }).click();
  assert.equal(await field.inputValue(), '');
  assert.match(await base.locator('span').evaluate((node) => getComputedStyle(node).backgroundImage), /conic-gradient/);
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Reload saved', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[name="color0"]')?.value === '#123456');
  assert.deepEqual(errors, []);
});

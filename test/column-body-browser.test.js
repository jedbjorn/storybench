// Spec #46 task #132, Empty column body renders (Chromium and Firefox, app served on loopback). A column
// body cleared on the canvas (in-place edit) or in the Elements panel saves "", and the Columns slide still
// shows on the canvas, in the slide list's inline preview and in a built deck's Preview: the cleared column
// shows its title only, with no empty paragraph.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { chromium, firefox } from 'playwright-core';
import { createApp } from '../src/server.js';
import { listenInRange } from '../test-support/loopback-port.js';

async function launch(type) {
  let browser = await type.launch().catch(() => null);
  if (!browser && type === chromium && existsSync('/usr/bin/chromium')) browser = await chromium.launch({ executablePath: '/usr/bin/chromium' }).catch(() => null);
  return browser;
}
const SLIDES = [
  { id: 'opening', title: 'Opening', layout: 'title', body: 'First' },
  { id: 'options', title: 'Two options', layout: 'columns', body: 'Compare.', columns: [{ title: 'A', body: 'Left' }, { title: 'B', body: 'Right' }] },
];
async function frameIn(page, selector, slideId) {
  for (let i = 0; i < 200; i++) {
    const frame = await (await page.$(`${selector} iframe:not(.is-loading)`))?.contentFrame().catch(() => null);
    if (frame?.url().includes(`/${slideId}/`) && await frame.evaluate(() => Boolean(window.storybenchDeck)).catch(() => false)) return frame;
    await page.waitForTimeout(50);
  }
  throw new Error(`no ${selector} frame for ${slideId}`);
}
// Each column's title and its body paragraph (null when the column has none).
const columns = root => root.locator('.columns > section').evaluateAll(sections => sections.map(section => [section.querySelector('h2')?.textContent, section.querySelector('p')?.textContent ?? null]));
const evidence = async (page, name) => {
  if (!process.env.STORYBENCH_EVIDENCE_DIR) return;
  await mkdir(process.env.STORYBENCH_EVIDENCE_DIR, { recursive: true });
  await page.screenshot({ path: path.join(process.env.STORYBENCH_EVIDENCE_DIR, name) });
};

for (const type of [chromium, firefox]) test(`Task 132 ${type.name()}: a cleared column body saves "" and the slide still builds and shows`, { timeout: 120000 }, async t => {
  const browser = await launch(type);
  if (!browser) return t.skip(`No launchable ${type.name()} on this seat`);
  t.after(() => browser.close());
  const workspace = await mkdtemp(path.join(tmpdir(), 'sb-column-body-'));
  const app = await createApp({ workspace });
  t.after(async () => { await app.close(); await rm(workspace, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${await listenInRange(app.server)}`;
  const episode = app.store.createEpisode({ kind: 'deck', title: 'Column body deck' });
  app.store.ensureEpisodeDirectories(episode.id);
  app.store.saveDeck(episode.id, 1, SLIDES, 'human');
  const saved = () => app.store.getDeck(episode.id).slides.find(slide => slide.id === 'options').columns.map(column => [column.title, column.body]);
  const revision = () => app.store.getDeck(episode.id).revision;

  const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } }); page.setDefaultTimeout(10000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const saveDone = () => page.waitForResponse(response => response.request().method() === 'PUT' && new URL(response.url()).pathname === `/api/episodes/${episode.id}`);
  const settled = () => page.waitForFunction(() => document.querySelector('#saveState')?.textContent.startsWith('Saved'));
  await page.goto(`${base}/?channel=${episode.channelId}&episode=${episode.id}`);
  const card = page.locator('#deckSlides [data-slide-index="1"]');
  await card.waitFor();
  await card.locator('.slide-card-summary').click();
  await page.locator('#deckSlides [data-slide-edit]').click();
  const editor = page.locator('#slideEditor');
  let frame = await frameIn(page, '.deck-canvas-viewport', 'options');

  // On the canvas: clear the first column's body in place and click off; it saves "" and the canvas shows the title only.
  const box = await frame.locator('.columns > section:nth-child(1) > p').boundingBox();
  await page.mouse.dblclick(box.x + Math.min(box.width / 2, 40), box.y + box.height / 2);
  await frame.waitForFunction(() => document.querySelector('.columns > section:nth-child(1) > p')?.isContentEditable);
  await page.keyboard.press('ControlOrMeta+a'); await page.keyboard.press('Delete');
  let commit = saveDone(); await editor.locator('#slideEditorTitle').click(); await commit; await settled();
  assert.deepEqual(saved(), [['A', ''], ['B', 'Right']]);
  frame = await frameIn(page, '.deck-canvas-viewport', `${revision()}/options`);
  assert.deepEqual(await columns(frame), [['A', null], ['B', 'Right']]);
  await evidence(page, `task132-canvas-cleared-${type.name()}.png`);

  // In the Elements panel: clear the second column's body; it saves "" and the canvas shows both titles only.
  const columnsCard = editor.locator('[data-card="columns"]');
  if (!(await columnsCard.evaluate(node => node.open))) await columnsCard.locator('summary').click();
  const body = columnsCard.locator('[data-part="columns"][data-part-index="1"] [data-slide-field="body"]');
  assert.equal(await body.inputValue(), 'Right');
  await body.fill('');
  commit = saveDone(); await body.blur(); await commit; await settled();
  assert.deepEqual(saved(), [['A', ''], ['B', '']]);
  frame = await frameIn(page, '.deck-canvas-viewport', `${revision()}/options`);
  assert.deepEqual(await columns(frame), [['A', null], ['B', null]]);
  await evidence(page, `task132-elements-cleared-${type.name()}.png`);

  // The slide list's inline preview shows the slide.
  await editor.getByRole('button', { name: 'Close slide editor' }).click();
  const inline = await frameIn(page, '#deckSlides [data-slide-preview]', `${revision()}/options`);
  assert.deepEqual(await columns(inline), [['A', null], ['B', null]]);

  // The saved deck builds, and its Preview shows the slide.
  await page.click('#buildDeck');
  const preview = page.locator('#deckJobs a[title="Preview"]');
  await preview.waitFor();
  assert.equal(await page.locator('#deckBuildError').textContent(), '');
  await preview.click();
  await page.locator('#previewModal').waitFor();
  const viewer = (await page.locator('[data-preview-frame]').elementHandle()).contentFrame();
  const deck = (await viewer).frameLocator('#viewer iframe');
  await deck.locator('article.slide:not([hidden])').waitFor();
  assert.deepEqual(await columns(deck.locator('.layout-columns')), [['A', null], ['B', null]]);
  await evidence(page, `task132-preview-${type.name()}.png`);
  assert.deepEqual(errors, []);
});

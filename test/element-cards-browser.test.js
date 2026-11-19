// Spec #46 task #127, element cards, selection toolbar and snap (Chromium and Firefox, app served on
// loopback). E4: step presets write the table's values, an agent value shows as Custom, dragging a step
// reorders play on reload, the gap between stages locks Starts and Wait before after step 1, and the
// parts table gives a part one step. E5 (Play step): Play step replays one step from its start state, and
// changing Speed replays that step, read through the frame's storybenchDeck over time. E6: selecting copy
// opens the toolbar and highlights its cards, the alignment grid sets align and valign, dragging copy
// onto Right sets its position and the canvas shows it after save, and All slides writes the deck
// default. E8 (editor half): adding a candidate and starring it switches the canvas; removing the starred
// candidate is refused; starring a drawing that lacks a stepped part is refused with the spec's line.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import { crc32, deflateSync } from 'node:zlib';
import { chromium, firefox } from 'playwright-core';
import { createApp } from '../src/server.js';
import { createLibraryService } from '../src/library.js';
import { listenInRange } from '../test-support/loopback-port.js';

async function launch(type) {
  let browser = await type.launch().catch(() => null);
  if (!browser && type === chromium && existsSync('/usr/bin/chromium')) browser = await chromium.launch({ executablePath: '/usr/bin/chromium' }).catch(() => null);
  return browser;
}
// A one-colour 8 x 8 PNG.
function png([r, g, b]) {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]), length = Buffer.alloc(4), crc = Buffer.alloc(4);
    length.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(8, 0); header.writeUInt32BE(8, 4); header[8] = 8; header[9] = 2;
  const rows = Buffer.concat(Array.from({ length: 8 }, () => Buffer.from([0, ...Array.from({ length: 8 }, () => [r, g, b]).flat()])));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}
// Four slides: a drawing whose steps reveal observe, connect and plan (with a drawing lacking plan as a
// candidate); three plain steps, one at an agent's 1200 ms; three steps under a 400 ms gap; a photo.
const SLIDES = ({ svg, lacking, red, blue }) => [
  { id: 'diagram', title: 'Observe, connect, plan', layout: 'full-media', body: 'Three steps to a plan.', vector: { itemId: svg, alt: 'A plan' },
    candidates: [{ itemId: lacking, alt: '' }], stages: [
      { id: 'observe', title: 'Observe', svgGroupIds: ['observe'] },
      { id: 'connect', title: 'Connect', svgGroupIds: ['connect'], trigger: 'manual', durationMs: 800 },
      { id: 'plan', title: 'Plan', svgGroupIds: ['plan'], trigger: 'auto', afterMs: 300, durationMs: 600 }] },
  { id: 'steps', title: 'Three steps', layout: 'statement', body: 'One at a time.', stages: [
    { id: 'a', title: 'First', body: 'One' }, { id: 'b', title: 'Second', body: 'Two', trigger: 'manual', durationMs: 1200 }, { id: 'c', title: 'Third', body: 'Three', trigger: 'manual' }] },
  { id: 'gap', title: 'Evenly spaced', layout: 'statement', body: 'A steady rhythm.', design: { timing: { betweenMs: 400 } }, stages: [
    { id: 'x', title: 'X' }, { id: 'y', title: 'Y' }, { id: 'z', title: 'Z' }] },
  { id: 'photo', title: 'A photo', layout: 'text-media', body: 'With a picture.', media: { itemId: red, alt: 'Red' } },
];
async function setup(t) {
  const workspace = await mkdtemp(path.join(tmpdir(), 'sb-element-cards-'));
  const app = await createApp({ workspace });
  t.after(async () => { await app.close(); await rm(workspace, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${await listenInRange(app.server)}`;
  const episode = app.store.createEpisode({ kind: 'deck', title: 'Element cards deck' });
  app.store.ensureEpisodeDirectories(episode.id);
  const library = createLibraryService({ workspace, store: app.store });
  const register = (data, fileName, selectedCategory) => library.registerFile({ episodeId: episode.id, readable: Readable.from(data), fileName, selectedCategory });
  const source = await readFile(new URL('../src/runtime/fixtures/svg-illustration.svg', import.meta.url), 'utf8');
  const svg = await register(Buffer.from(source), 'plan.svg', 'Graphics');
  const lacking = await register(Buffer.from(source.replace(/<g id="plan">[\s\S]*?<\/g>/, '')), 'sketch.svg', 'Graphics');
  const red = await register(png([200, 30, 30]), 'red.png', 'B-roll'), blue = await register(png([30, 30, 200]), 'blue.png', 'B-roll');
  app.store.saveDeck(episode.id, 1, SLIDES({ svg: svg.id, lacking: lacking.id, red: red.id, blue: blue.id }), 'human');
  return { app, episode, items: { svg, lacking, red, blue }, url: `${base}/?channel=${episode.channelId}&episode=${episode.id}` };
}
const settled = page => page.waitForFunction(() => document.querySelector('#saveState')?.textContent.startsWith('Saved'));
// The editor's canvas frame for a slide (optionally of one revision), once its runtime is there.
async function frameIn(page, slideId, revision = null) {
  const part = revision === null ? `/${slideId}/` : `/${revision}/${slideId}/`;
  for (let i = 0; i < 200; i++) {
    const frame = await (await page.$('.deck-canvas-viewport iframe:not(.is-loading)'))?.contentFrame().catch(() => null);
    if (frame?.url().includes(part) && await frame.evaluate(() => Boolean(window.storybenchDeck)).catch(() => false)) return frame;
    await page.waitForTimeout(25);
  }
  throw new Error(`no canvas frame for ${part}`);
}
// Samples the frame's timeline until it is held (paused) after having played.
async function sample(page, frame) {
  const seen = [];
  for (let i = 0; i < 600; i++) {
    const now = await frame.evaluate(() => window.storybenchDeck.timeline()).catch(() => null);
    if (!now) break;
    const step = await page.evaluate(() => document.querySelector('.deck-canvas-stages [aria-pressed="true"]')?.textContent ?? null);
    seen.push({ state: now.state, stage: now.stage, timeMs: now.timeMs, step, ends: now.stages.map(entry => entry.motionEndMs) });
    if (seen.some(entry => entry.state === 'playing') && now.state === 'paused') break;
    await page.waitForTimeout(15);
  }
  return seen;
}
const evidence = async (page, name) => {
  if (!process.env.STORYBENCH_EVIDENCE_DIR) return;
  await mkdir(process.env.STORYBENCH_EVIDENCE_DIR, { recursive: true });
  await page.screenshot({ path: path.join(process.env.STORYBENCH_EVIDENCE_DIR, name) });
};
async function openEditor(page, index) {
  if (await page.locator('#slideEditor[open]').count()) await page.click('[data-editor-close]');
  const card = page.locator(`#deckSlides [data-slide-index="${index}"]`);
  if (!(await card.evaluate(node => node.classList.contains('is-open')))) await card.locator('.slide-card-summary').click();
  await card.locator('[data-slide-edit]').click();
  await page.locator(`#slideEditor .deck-slide[data-slide-index="${index}"]`).waitFor();
}
const cardOf = (page, key) => page.locator(`#slideEditor [data-card="${key}"]`);
async function openCard(page, key) {
  if (!(await cardOf(page, key).evaluate(node => node.open))) await cardOf(page, key).locator('summary').click();
}
const stepRow = (page, id, key) => cardOf(page, `step:${id}`).locator(`[data-step-row="${key}"]`);

for (const type of [chromium, firefox]) test(`E4, E5, E6, E8 ${type.name()}: element cards, Play step, the selection toolbar, drag to snap and picks`, { timeout: 180000 }, async t => {
  const browser = await launch(type);
  if (!browser) return t.skip(`No launchable ${type.name()} on this seat`);
  t.after(() => browser.close());
  const { app, episode, items, url } = await setup(t);
  const deck = () => app.store.getDeck(episode.id);
  const slide = id => deck().slides.find(value => value.id === id);
  const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } }); page.setDefaultTimeout(10000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  await page.locator('#deckSlides [data-slide-index="3"]').waitFor();
  // The library has loaded once the drawing's slide card counts its candidates.
  await page.waitForFunction(() => document.querySelector('#deckSlides [data-slide-index="0"] .slide-pills')?.textContent.includes('candidate'));

  // ---- E4: presets and Custom on the three-step slide.
  await openEditor(page, 1);
  for (const id of ['a', 'b']) await openCard(page, `step:${id}`);
  assert.deepEqual(await stepRow(page, 'b', 'durationMs').locator('[aria-pressed="true"]').allTextContents(), ['Custom 1.2 s'], 'the agent value 1200 shows as Custom 1.2 s');
  // E5: changing Speed replays that step: the saved revision's frame plays step 2 from its start and holds it.
  const before = deck().revision;
  await stepRow(page, 'b', 'durationMs').getByRole('button', { name: 'Slow', exact: true }).click();
  await settled(page);
  assert.equal(slide('steps').stages[1].durationMs, 1600, 'Speed Slow writes 1600');
  const replayed = await frameIn(page, 'steps', before + 1);
  const replay = await sample(page, replayed);
  assert.ok(replay.some(entry => entry.state === 'playing' && entry.stage === 1), 'step 2 played');
  assert.ok(!replay.some(entry => entry.stage === 2), 'only that step played');
  // A held stage shows the end of its motion, just before the next stage could begin (the bridge's rule).
  const held = replay.at(-1);
  assert.deepEqual([held.state, held.stage], ['paused', 1]);
  assert.ok(Math.abs(held.timeMs - held.ends[1]) <= 0.5, `it holds step 2 at the end of its motion (${held.timeMs} of ${held.ends[1]})`);
  assert.equal(held.step, '1', 'the step bar follows');
  assert.deepEqual(await stepRow(page, 'b', 'durationMs').locator('[aria-pressed="true"]').allTextContents(), ['Slow']);
  await stepRow(page, 'a', 'afterMs').getByRole('button', { name: 'Short', exact: true }).click();
  await settled(page);
  assert.equal(slide('steps').stages[0].afterMs, 300, 'Wait Short writes 300');
  assert.equal(slide('steps').stages[0].trigger, 'manual', 'waiting does not change how the step starts');
  await evidence(page, `e4-presets-${type.name()}.png`);

  // E4: dragging step 3 above step 2 changes the play order, on reload too.
  const grip = cardOf(page, 'step:c').locator('[data-step-grip]');
  const target = await cardOf(page, 'step:b').boundingBox();
  await grip.dragTo(cardOf(page, 'step:b'), { targetPosition: { x: 40, y: Math.round(target.height / 4) } });
  await settled(page);
  assert.deepEqual(slide('steps').stages.map(stage => stage.id), ['a', 'c', 'b']);
  await page.reload();
  await page.locator('#deckSlides [data-slide-index="3"]').waitFor();
  await openEditor(page, 1);
  assert.deepEqual(await page.locator('#slideEditor [data-part="stages"] [data-card]').evaluateAll(nodes => nodes.map(node => node.dataset.card)), ['step:a', 'step:c', 'step:b']);
  const reordered = await frameIn(page, 'steps', deck().revision);
  assert.deepEqual(await reordered.evaluate(() => window.storybenchDeck.timeline().stages.map(stage => stage.id)), ['a', 'c', 'b'], 'the slide plays in the new order');

  // E4: with the gap between stages set, Starts and Wait before are set by it after step 1.
  await page.click('[data-editor-nav="1"]');
  await page.locator('#slideEditor .deck-slide[data-slide-index="2"]').waitFor();
  for (const id of ['x', 'y', 'z']) await openCard(page, `step:${id}`);
  for (const key of ['trigger', 'afterMs']) {
    assert.equal(await stepRow(page, 'x', key).locator('button:disabled').count(), 0, 'step 1 is free');
    for (const id of ['y', 'z']) {
      assert.equal(await stepRow(page, id, key).locator('button:enabled').count(), 0, `step ${id}: ${key} cannot be changed`);
      assert.equal(await stepRow(page, id, key).locator('[data-locked]').textContent(), 'Set by the gap between stages');
    }
  }
  assert.equal(await stepRow(page, 'y', 'durationMs').locator('button:disabled').count(), 0, 'Speed stays free');
  await evidence(page, `e4-gap-${type.name()}.png`);

  // ---- E5: Play step replays one step from its start state.
  await openEditor(page, 0);
  await openCard(page, 'step:connect');
  const diagram = await frameIn(page, 'diagram');
  await cardOf(page, 'step:connect').getByRole('button', { name: 'Play step' }).click();
  const played = await sample(page, diagram);
  assert.equal(played.find(entry => entry.state === 'playing')?.stage, 1, 'step 2 plays');
  assert.ok(played.filter(entry => entry.state === 'playing').every(entry => entry.stage === 1), 'only step 2 plays');
  assert.ok(played.some(entry => entry.state === 'playing' && entry.timeMs < entry.ends[1]), 'from its start state');
  assert.deepEqual([played.at(-1).state, played.at(-1).stage], ['paused', 1], 'and holds it');
  assert.ok(Math.abs(played.at(-1).timeMs - played.at(-1).ends[1]) <= 0.5, 'at the end of its motion');
  assert.equal(played.at(-1).step, '1');

  // ---- E4: the drawing parts table gives each part one Appears choice.
  await openCard(page, 'visual');
  const appears = part => cardOf(page, 'visual').locator(`[data-part-appears="${part}"]`);
  assert.equal(await cardOf(page, 'visual').locator('select[multiple]').count(), 0, 'no multi-select');
  assert.equal(await appears('landscape').inputValue(), '', 'an unclaimed part appears from the start');
  await appears('landscape').selectOption({ label: 'Step 1: Observe' }); await settled(page);
  assert.deepEqual(slide('diagram').stages.map(stage => stage.svgGroupIds), [['observe', 'landscape'], ['connect'], ['plan']]);
  await appears('landscape').selectOption({ label: 'Step 3: Plan' }); await settled(page);
  assert.deepEqual(slide('diagram').stages.map(stage => stage.svgGroupIds), [['observe'], ['connect'], ['plan', 'landscape']], 'one part, one step');
  await appears('landscape').selectOption({ label: 'From the start' }); await settled(page);
  assert.deepEqual(slide('diagram').stages.map(stage => stage.svgGroupIds), [['observe'], ['connect'], ['plan']]);

  // ---- E8 (editor half): the drawing lacking plan cannot be starred; the spec's line shows at the star.
  const pickBefore = slide('diagram').vector;
  await cardOf(page, 'visual').locator(`[data-candidate-star="${items.lacking.id}"]`).click();
  assert.equal(await cardOf(page, 'visual').locator('[data-card-notice]').textContent(), 'v1 has no part plan, so a step reveals nothing.');
  assert.deepEqual(slide('diagram').vector, pickBefore, 'the pick is unchanged');
  await evidence(page, `e8-missing-part-${type.name()}.png`);

  // ---- E6: select copy: the toolbar sits above (or below) it and the Title and Body cards highlight and open.
  await page.click('.deck-canvas-block[data-select="copy"]');
  const toolbar = page.locator('.deck-canvas-toolbar[data-toolbar-block="copy"]:not([hidden])');
  await toolbar.waitFor();
  const [bar, copy] = [await toolbar.boundingBox(), await page.locator('.deck-canvas-block[data-select="copy"]').boundingBox()];
  assert.ok(bar.y + bar.height <= copy.y || bar.y >= copy.y + copy.height, 'the toolbar is above or below the selection, not over it');
  for (const key of ['title', 'body']) assert.deepEqual(await cardOf(page, key).evaluate(node => [node.classList.contains('is-active'), node.open]), [true, true], `${key} highlights and opens`);
  assert.equal(await cardOf(page, 'visual').evaluate(node => node.classList.contains('is-active')), false);
  // The alignment grid is a dropdown: Bottom right sets align and valign; Escape closes an open menu first.
  await toolbar.getByRole('button', { name: /^Alignment/ }).click();
  await page.keyboard.press('Escape');
  assert.equal(await toolbar.locator('[data-canvas-menu]:not([hidden])').count(), 0, 'Escape closed the menu');
  assert.equal(await page.locator('#slideEditor').evaluate(node => node.open), true);
  assert.equal(await page.locator('.deck-canvas-block[data-select="copy"]').getAttribute('aria-pressed'), 'true', 'the selection is kept');
  await toolbar.getByRole('button', { name: /^Alignment/ }).click();
  await toolbar.getByRole('radio', { name: 'Bottom right' }).click(); await settled(page);
  assert.deepEqual(slide('diagram').design, { copy: { align: 'end', valign: 'end' } });
  await frameIn(page, 'diagram', deck().revision);
  // Drag the copy block onto Right: four drop zones show around the visual; dropping sets position right.
  const box = await page.locator('.deck-canvas-block[data-select="copy"]').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 12, box.y + box.height / 2 + 12, { steps: 3 });
  assert.deepEqual(await page.locator('.deck-canvas-zone').allTextContents(), ['Left', 'Right', 'Above', 'Below']);
  const right = await page.locator('.deck-canvas-zone[data-zone="right"]').boundingBox();
  await page.mouse.move(right.x + right.width / 2, right.y + right.height / 2, { steps: 6 });
  await evidence(page, `e6-drag-${type.name()}.png`);
  await page.mouse.up();
  await settled(page);
  assert.deepEqual(slide('diagram').design, { copy: { align: 'end', valign: 'end', position: 'right' } }, 'dropping on Right sets position right, nothing else');
  assert.equal(await page.locator('.deck-canvas-zone').count(), 0);
  assert.equal(await page.locator('.deck-canvas-block[data-select="copy"]').getAttribute('aria-pressed'), 'true', 'the copy stays selected');
  const placed = await frameIn(page, 'diagram', deck().revision);
  await placed.waitForFunction(() => document.querySelector('.composition.placed > .arrange[data-side="right"] > .copy') !== null);
  await evidence(page, `e6-snapped-${type.name()}.png`);
  // All slides writes the deck default.
  await toolbar.getByRole('button', { name: 'All slides' }).click();
  await toolbar.getByRole('button', { name: /^Alignment/ }).click();
  await toolbar.getByRole('radio', { name: 'Centred' }).click(); await settled(page);
  assert.deepEqual(deck().design.copy, { align: 'center', valign: 'center' }, 'All slides wrote the deck default');
  assert.deepEqual(slide('diagram').design, { copy: { align: 'end', valign: 'end', position: 'right' } }, 'the slide keeps its own override');
  await toolbar.getByRole('button', { name: 'This slide' }).click();
  // The visual's toolbar names the candidate in use and opens the asset.
  await page.click('.deck-canvas-block[data-select="visual"]');
  const visualBar = page.locator('.deck-canvas-toolbar[data-toolbar-block="visual"]:not([hidden])');
  assert.equal(await visualBar.locator('.deck-canvas-in-use').textContent(), `In use: ${items.svg.label} v1`);
  assert.equal(await cardOf(page, 'visual').evaluate(node => node.classList.contains('is-active')), true);
  await evidence(page, `e6-visual-toolbar-${type.name()}.png`);

  // ---- E8 (editor half): add a candidate and star it from the Visual card; the canvas switches.
  await openEditor(page, 3);
  await openCard(page, 'visual');
  await cardOf(page, 'visual').locator('[data-candidate-add]').selectOption(items.blue.id); await settled(page);
  assert.deepEqual(slide('photo').candidates, [{ itemId: items.blue.id, alt: '' }]);
  await cardOf(page, 'visual').locator(`[data-candidate-star="${items.blue.id}"]`).click(); await settled(page);
  assert.deepEqual(slide('photo').media, { itemId: items.blue.id, alt: '' });
  assert.deepEqual(slide('photo').candidates, [{ itemId: items.red.id, alt: 'Red' }]);
  assert.equal(slide('photo').pickSetBy, 'creator');
  const src = item => `assets/media_${item.assetId.replace(/[^a-zA-Z0-9_-]/g, '_')}.png`;
  const switched = await frameIn(page, 'photo', deck().revision);
  assert.deepEqual(await switched.evaluate(() => [...document.images].map(image => image.getAttribute('src'))), [src(items.blue)], 'the canvas shows the new pick');
  // Removing the starred candidate is refused; star another first.
  const revision = deck().revision;
  await cardOf(page, 'visual').locator(`[data-candidate-remove="${items.blue.id}"]`).click();
  assert.match(await cardOf(page, 'visual').locator('[data-card-notice]').textContent(), /starred on the slide; star another first/);
  assert.equal(deck().revision, revision, 'nothing was saved');
  await evidence(page, `e8-star-${type.name()}.png`);
  assert.deepEqual(errors, []);
});

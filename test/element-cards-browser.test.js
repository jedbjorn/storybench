// Spec #46 task #127, element cards, selection toolbar and snap (Chromium and Firefox, app served on
// loopback). E4: step presets write the table's values, an agent value shows as Custom, dragging a step
// reorders play on reload, the gap between stages locks Starts and Wait before after step 1, and the
// parts table gives a part one step. E5 (Play step): Play step replays one step from its start state, and
// changing Speed replays that step, read through the frame's storybenchDeck over time. E6: selecting copy
// opens the toolbar and highlights its cards, the alignment grid sets align and valign, dragging copy
// onto Right sets its position and the canvas shows it after save, and All slides writes the deck
// default. E8 (editor half): adding a candidate and starring it switches the canvas; removing the starred
// candidate is refused; starring a drawing that lacks a stepped part is refused with the spec's line.
// Task #134 (flag #95), E4: Add element > Step on a Process slide's drawing reveals a part, saved with it.
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
// candidate); three plain steps, one at an agent's 1200 ms; three steps under a 400 ms gap; a photo; an
// automatic step that starts with the step before it.
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
  // An automatic step after an untimed one starts with it (After previous, Wait None, Speed Standard).
  { id: 'together', title: 'Together', layout: 'statement', body: 'Two at once.', stages: [
    { id: 'a', title: 'First', body: 'One' }, { id: 'b', title: 'Second', body: 'Two', trigger: 'auto' }, { id: 'c', title: 'Third', body: 'Three', trigger: 'manual', durationMs: 800 }] },
];
async function setup(t, slides = SLIDES) {
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
  // The plan without its <defs> group (tree): every part it lists is visible geometry the build accepts.
  const plain = await register(Buffer.from(source.replace(/<g id="tree">[\s\S]*?<\/g>/, '').replace(/<use href="#tree"[^>]*\/>/g, '')), 'process.svg', 'Graphics');
  const red = await register(png([200, 30, 30]), 'red.png', 'B-roll'), blue = await register(png([30, 30, 200]), 'blue.png', 'B-roll');
  app.store.saveDeck(episode.id, 1, slides({ svg: svg.id, lacking: lacking.id, plain: plain.id, red: red.id, blue: blue.id }), 'human');
  return { app, episode, register, items: { svg, lacking, plain, red, blue }, url: `${base}/?channel=${episode.channelId}&episode=${episode.id}` };
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
  // The toolbar never covers another block, so the creator can always click it: stage text selected at a
  // width where the toolbar wraps, then the copy block is clicked through.
  const overlaps = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  for (const width of [1600, 1150]) {
    await page.setViewportSize({ width, height: 1100 });
    await page.click('.deck-canvas-block[data-select="stageText"]');
    const stageBar = page.locator('.deck-canvas-toolbar[data-toolbar-block="stageText"]:not([hidden])');
    await stageBar.waitFor();
    const shown = await stageBar.boundingBox();
    for (const other of ['copy', 'visual']) assert.ok(!overlaps(shown, await page.locator(`.deck-canvas-block[data-select="${other}"]`).boundingBox()), `${width}: the stage text toolbar leaves ${other} uncovered`);
    await page.click('.deck-canvas-block[data-select="copy"]');
    await toolbar.waitFor();
  }
  await page.setViewportSize({ width: 1600, height: 1100 });
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
  assert.equal(await visualBar.getByRole('button', { name: 'All slides' }).count(), 0, 'the visual toolbar has no scope: it edits no deck value');
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

  // ---- E5: an automatic step that starts with the step before it plays from its own start, on Play step
  // and on the replay after a Speed change, and holds at the end of its motion.
  await openEditor(page, 4);
  await openCard(page, 'step:b');
  const together = await frameIn(page, 'together');
  const [first, second] = (await together.evaluate(() => window.storybenchDeck.timeline().stages)).slice(0, 2);
  assert.equal(second.startMs, first.startMs, 'step 2 starts with step 1');
  const playsStep2 = (all, label) => {
    // From the step's start: samples before the frame took the message show the slide as it was.
    const seen = all.slice(Math.max(0, all.findIndex(entry => entry.state === 'playing')));
    assert.ok(seen.some(entry => entry.state === 'playing' && entry.stage === 1 && entry.timeMs < entry.ends[1]), `${label}: step 2 plays its motion`);
    assert.ok(!seen.some(entry => entry.stage === 2), `${label}: only up to step 2`);
    const end = seen.at(-1);
    assert.deepEqual([end.state, end.stage], ['paused', 1], `${label}: and holds it`);
    assert.ok(Math.abs(end.timeMs - end.ends[1]) <= 0.5, `${label}: at the end of its motion (${end.timeMs} of ${end.ends[1]})`);
  };
  await cardOf(page, 'step:b').getByRole('button', { name: 'Play step' }).click();
  playsStep2(await sample(page, together), 'Play step');
  const sped = deck().revision;
  await stepRow(page, 'b', 'durationMs').getByRole('button', { name: 'Slow', exact: true }).click();
  await settled(page);
  assert.equal(slide('together').stages[1].durationMs, 1600);
  playsStep2(await sample(page, await frameIn(page, 'together', sped + 1)), 'Speed Slow');
  assert.deepEqual(errors, []);
});

const FIRST_PICKS = ({ svg, plain, red }) => [
  { id: 'star', title: 'Pick with the star', layout: 'full-media', candidates: [{ itemId: svg, alt: 'Landscape drawing' }, { itemId: plain, alt: 'Alternate' }] },
  { id: 'add', title: 'Pick with Add element', layout: 'title' },
  { id: 'text', title: 'Existing text steps', layout: 'full-media', media: { itemId: red, alt: 'Original image' },
    candidates: [{ itemId: svg, alt: 'New drawing' }],
    stages: [{ id: 'intro', title: 'Introduce', body: 'Authored opening', trigger: 'manual', afterMs: 300, durationMs: 800, holdMs: 120, easing: 'linear', motion: 'fade' },
      { id: 'conclude', title: 'Conclude', body: 'Authored ending', trigger: 'auto', afterMs: 100, durationMs: 400 }] },
  { id: 'unavailable', title: 'Unavailable drawings', layout: 'title' },
];
for (const type of [chromium, firefox]) test(`#100 ${type.name()}: first drawing picks, assignment, conflict, reload and exported Preview`, { timeout: 90000 }, async t => {
  const browser = await launch(type);
  if (!browser) return t.skip(`No launchable ${type.name()} on this seat`);
  t.after(() => browser.close());
  const { app, episode, items, register, url } = await setup(t, FIRST_PICKS);
  const svgSource = body => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24">${body}</svg>`);
  const empty = await register(svgSource('<defs><g id="symbol"><rect width="8" height="8"/></g></defs><use href="#symbol"/>'), 'definitions.svg', 'Graphics');
  const unavailable = await register(svgSource('<g id="only"><circle cx="6" cy="6" r="4"/></g>'), 'unavailable.svg', 'Graphics');
  const { svgGroupIds: _, svgRevealGroupIds: __, svgProfile: ___, ...missingPartsData } = unavailable.asset.metadata;
  app.store.db.prepare('UPDATE assets SET metadata=? WHERE id=?').run(JSON.stringify(missingPartsData), unavailable.assetId);
  const deck = () => app.store.getDeck(episode.id), slide = id => deck().slides.find(entry => entry.id === id);
  const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } }); page.setDefaultTimeout(10000);
  const puts = [], errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const isPick = request => request.method() === 'PUT' && new URL(request.url()).pathname === `/api/episodes/${episode.id}/slides`;
  page.on('request', request => { if (request.method() === 'PUT') puts.push(request.postDataJSON()); });
  const pickResponse = () => page.waitForResponse(response => isPick(response.request()));
  const add = page.locator('#slideEditor [data-add-element]'), visual = cardOf(page, 'visual');
  const star = item => visual.locator(`[data-candidate-star="${item.id}"]`);
  const form = page.getByRole('dialog', { name: 'Assign drawing parts' });
  const confirm = form.getByRole('button', { name: 'Pick drawing' });
  const choose = async (step, part) => {
    await form.getByRole('combobox', { name: new RegExp(`^Part for step ${step}:`) }).click();
    await form.getByRole('option', { name: part, exact: true }).click();
  };
  const expectPick = async (id, action) => {
    const before = deck().revision, requests = puts.length, response = pickResponse();
    await action();
    assert.equal((await response).status(), 200);
    await settled(page);
    assert.equal(deck().revision, before + 1);
    assert.equal(puts.length, requests + 1, 'the pick and its stage are one request');
    assert.equal(puts.at(-1).expectedRevision, before);
    assert.deepEqual(puts.at(-1).slides.find(entry => entry.id === id).stages.map(stage => stage.svgGroupIds),
      slide(id).stages.map(stage => stage.svgGroupIds));
    assert.equal(slide(id).vector.itemId, items.svg.id);
  };
  await page.goto(url);
  await openEditor(page, 0);
  await openCard(page, 'visual');
  await page.waitForFunction(id => document.querySelector(`[data-candidate-star="${id}"]`)?.getAttribute('aria-label')?.includes('plan'), items.svg.id);
  await expectPick('star', () => star(items.svg).click());
  const firstStage = slide('star').stages[0];
  assert.match(firstStage.id, /^stage_/);
  assert.deepEqual(firstStage, { id: firstStage.id, title: 'New step', body: '', svgGroupIds: ['landscape'] });
  assert.deepEqual(slide('star').vector, { itemId: items.svg.id, alt: 'Landscape drawing' });
  assert.deepEqual(slide('star').candidates, [{ itemId: items.plain.id, alt: 'Alternate' }]);
  await openEditor(page, 1);
  await expectPick('add', () => add.selectOption(`visual:${items.svg.id}`));
  assert.deepEqual(slide('add').stages.map(stage => stage.svgGroupIds), [['landscape']]);

  await openEditor(page, 3);
  const unchanged = deck(), requests = puts.length;
  await add.selectOption(`visual:${empty.id}`);
  await visual.getByRole('alert').filter({ hasText: 'has no parts that can be revealed' }).waitFor();
  await add.selectOption(`visual:${unavailable.id}`);
  await visual.getByRole('alert').filter({ hasText: 'Drawing parts are unavailable' }).waitFor();
  assert.equal(puts.length, requests);
  assert.equal(deck().revision, unchanged.revision);
  assert.deepEqual(deck().slides, unchanged.slides);

  await openEditor(page, 2);
  await openCard(page, 'visual');
  const original = slide('text'), base = deck().revision;
  await star(items.svg).click();
  await form.waitFor();
  assert.deepEqual(await form.locator('[data-drawing-steps] strong').allTextContents(), ['Step 1: Introduce', 'Step 2: Conclude']);
  assert.deepEqual(await form.locator('.drawing-step-copy').allTextContents(), ['Authored opening', 'Authored ending']);
  assert.ok(await confirm.isDisabled());
  assert.deepEqual(await form.locator('select').first().locator('option').allTextContents(), ['Choose part…', 'landscape', 'observe', 'connect', 'plan']);
  await choose(1, 'observe');
  await choose(2, 'observe');
  assert.ok(await confirm.isDisabled());
  assert.match(await form.getByRole('alert').textContent(), /different part/);
  await choose(2, 'connect');
  assert.ok(await confirm.isEnabled());
  await evidence(page, `drawing-assignment-${type.name()}.png`);
  await form.getByRole('button', { name: 'Cancel' }).click();
  await form.waitFor({ state: 'hidden' });
  assert.equal(deck().revision, base);
  assert.deepEqual(slide('text'), original);
  assert.equal(puts.length, requests);

  await star(items.svg).click();
  await choose(1, 'observe'); await choose(2, 'connect');
  app.store.saveDeck(episode.id, base, deck().slides.map(entry => entry.id === 'text' ? { ...entry, notes: 'Concurrent edit' } : entry));
  const conflicted = pickResponse();
  await confirm.click();
  assert.equal((await conflicted).status(), 409);
  await form.waitFor({ state: 'hidden' });
  await visual.getByRole('alert').filter({ hasText: 'The deck changed. Reload' }).waitFor();
  assert.equal(await star(items.red).getAttribute('aria-pressed'), 'true');
  assert.equal(deck().revision, base + 1);
  assert.deepEqual(slide('text'), { ...original, notes: 'Concurrent edit' });

  await page.reload();
  await openEditor(page, 2);
  await openCard(page, 'visual');
  await star(items.svg).click();
  await choose(1, 'observe'); await choose(2, 'connect');
  await expectPick('text', () => confirm.click());
  assert.deepEqual(slide('text').stages, original.stages.map((stage, index) => ({ ...stage, svgGroupIds: [index ? 'connect' : 'observe'] })));
  assert.deepEqual(slide('text').candidates, [{ itemId: items.red.id, alt: 'Original image' }]);
  assert.equal(slide('text').media, null);

  await page.reload();
  await openEditor(page, 0);
  await frameIn(page, 'star', deck().revision);
  await openCard(page, 'visual');
  const replacement = pickResponse(), priorRevision = deck().revision;
  await star(items.plain).click();
  assert.equal((await replacement).status(), 200);
  await settled(page);
  assert.equal(deck().revision, priorRevision + 1);
  assert.deepEqual(slide('star').stages, [firstStage], 'replacing the drawing preserves valid mappings');
  assert.deepEqual(slide('star').candidates, [{ itemId: items.svg.id, alt: 'Landscape drawing' }]);

  await page.click('[data-editor-close]');
  await page.click('#buildDeck');
  const revision = deck().revision;
  const build = () => app.store.listJobs(episode.id).find(job => job.kind === 'deck' && job.revision === revision);
  for (let i = 0; i < 200 && (!build() || ['queued', 'running'].includes(build().state)); i++) await page.waitForTimeout(25);
  assert.equal(build()?.state, 'completed', build()?.error || 'Deck build should complete');
  const preview = page.getByRole('link', { name: `Preview revision ${deck().revision}` });
  const download = await page.getByRole('link', { name: `Download revision ${deck().revision} bundle (ZIP)` }).getAttribute('href');
  await preview.click();
  const frame = page.frameLocator('#previewModal [data-preview-frame]').frameLocator('#viewer iframe');
  await frame.locator('#star [data-vector-group="landscape"]').waitFor({ state: 'attached' });
  await frame.locator('[data-go="1"]').click();
  const landscape = '#add [data-vector-group="landscape"]';
  await frame.locator('#add [data-stage="0"]').click();
  const trees = frame.locator(`${landscape}[aria-hidden="false"] use[href$="-tree"]`);
  await trees.first().waitFor();
  assert.equal(await trees.count(), 2);
  await evidence(page, `drawing-preview-${type.name()}.png`);
  assert.equal(await frame.locator('#text [data-vector-group="observe"][data-vector-step="0"]').count(), 1);
  assert.equal(await frame.locator('#text [data-vector-group="connect"][data-vector-step="1"]').count(), 1);
  const zip = Buffer.from(await (await fetch(new URL(download, url))).arrayBuffer());
  assert.equal(zip.readUInt32LE(), 0x04034b50);
  assert.ok(zip.includes(Buffer.from('data-vector-step="1" data-vector-group="connect"')));
  assert.ok(zip.includes(Buffer.from('<use href="#tree"')), 'bundle retains the source definition uses');
  assert.deepEqual(errors, []);
});

// Spec #46 task #134 (REV1 conformance F1, flag #95). E4: on a Process slide, Add element > Step reveals the
// drawing's first part no step claims, in the drawing's part order, and the step is saved with it.
// Step 1 reveals connect, so the first free part comes before it in the drawing's order.
const PROCESS = ({ svg }) => [{ id: 'process', title: 'A process', layout: 'process', body: 'Step by step.', vector: { itemId: svg, alt: 'A plan' },
  stages: [{ id: 'connect', title: 'Connect', svgGroupIds: ['connect'] }] }];
for (const type of [chromium, firefox]) test(`E4 ${type.name()}: Add element > Step on a Process slide reveals a free part and is saved with it`, { timeout: 90000 }, async t => {
  const browser = await launch(type);
  if (!browser) return t.skip(`No launchable ${type.name()} on this seat`);
  t.after(() => browser.close());
  const { app, episode, items, url } = await setup(t, PROCESS);
  const deck = () => app.store.getDeck(episode.id), stages = () => deck().slides[0].stages;
  const { svgRevealGroupIds: parts, svgRevealAncestors: _, ...oldMetadata } = items.svg.asset.metadata, free = parts[0];
  assert.deepEqual(parts, ['landscape', 'observe', 'connect', 'plan'], 'the drawing\'s parts, in order');
  assert.ok(oldMetadata.svgGroupIds.includes('tree'));
  if (type === firefox)
    app.store.db.prepare('UPDATE assets SET metadata=? WHERE id=?').run(JSON.stringify(oldMetadata), items.svg.assetId);
  const endpoint = new URL(`/api/episodes/${episode.id}/slides?channel=${episode.channelId}`, url);
  const put = (expectedRevision, slides) => fetch(endpoint, { method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expectedRevision, slides }) });
  const before = deck();
  const invalid = [{ ...before.slides[0], stages: [{ ...stages()[0], svgGroupIds: ['tree'] }] }];
  const refused = await put(before.revision, invalid);
  assert.equal(refused.status, 400);
  assert.match((await refused.json()).error, /Stage connect: SVG group tree.*definitions/);
  assert.deepEqual(deck().slides, before.slides);
  assert.equal(deck().revision, before.revision);
  if (type === firefox)
    app.store.db.prepare('UPDATE episodes SET cards=? WHERE id=?').run(JSON.stringify(invalid), episode.id);
  const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } }); page.setDefaultTimeout(10000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  await openEditor(page, 0);
  // The library has loaded once the Visual card lists the drawing's parts.
  await openCard(page, 'visual');
  const visual = cardOf(page, 'visual'), table = visual.locator('[data-parts-table]');
  await table.waitFor();
  assert.deepEqual(await table.locator('tbody th').allTextContents(), parts);
  await openCard(page, 'step:connect');
  const add = cardOf(page, 'step:connect').locator('[data-reveal-add]');
  if (type === firefox) {
    assert.match(await visual.locator('[data-missing-part]').textContent(), /tree cannot be revealed/);
    assert.deepEqual(stages()[0].svgGroupIds, ['tree'], 'opening preserves the invalid mapping for correction');
    assert.equal(deck().revision, before.revision);
    assert.deepEqual(await add.locator('option').allTextContents(), ['Replace unavailable parts…', ...parts]);
    await add.selectOption('connect');
    await settled(page);
    assert.equal(deck().revision, before.revision + 1);
    assert.deepEqual(stages()[0].svgGroupIds, ['connect']);
  }
  assert.deepEqual(await add.locator('option').allTextContents(), ['Add part…', 'landscape', 'observe', 'plan']);
  const revision = app.store.getDeck(episode.id).revision;
  await page.selectOption('#slideEditor [data-add-element]', 'step');
  await settled(page);
  for (let i = 0; i < 200 && stages().length < 2; i++) await page.waitForTimeout(25);
  assert.equal(app.store.getDeck(episode.id).revision, revision + 1, 'one save');
  assert.deepEqual(stages().map(stage => stage.svgGroupIds), [['connect'], [free]], `the new step reveals ${free}`);
  assert.equal(await page.locator('#saveState').textContent().then(text => text.startsWith('Saved')), true, 'saved, not stuck');
  // On reload the step is there with its part, and the canvas shows the slide built from it.
  await page.reload();
  await openEditor(page, 0);
  const frame = await frameIn(page, 'process', revision + 1);
  assert.equal(await frame.locator('[data-vector-group="landscape"] use[href$="-tree"]').count(), 2);
  const added = stages()[1].id;
  assert.match(await cardOf(page, `step:${added}`).locator('.element-card-summary').textContent(), new RegExp(`reveals ${free}$`));
  await openCard(page, 'visual');
  assert.equal(await cardOf(page, 'visual').locator(`[data-part-appears="${free}"]`).inputValue(), '1', `${free} appears at step 2`);
  await evidence(page, `e4-add-step-drawing-${type.name()}.png`);
  await openCard(page, 'step:connect');
  await add.selectOption('observe');
  await settled(page);
  await add.selectOption('plan');
  await settled(page);
  const full = deck();
  await page.selectOption('#slideEditor [data-add-element]', 'step');
  await visual.getByRole('alert').filter({ hasText: 'Every part already appears' }).waitFor();
  assert.equal(deck().revision, full.revision, 'an exhausted drawing leaves the revision fixed');
  assert.deepEqual(deck().slides, full.slides);
  assert.deepEqual(errors, []);
});

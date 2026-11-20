// Spec #46 task #128, Text on the slide (Chromium and Firefox, app served on loopback). E7: double-click
// the title, body, a step label or a column title or body on the canvas to edit it in place; the text
// box moves by at most 2 px between view and edit; Enter (single-line) or a click off commits exactly one
// save, which a reload shows; Escape discards; pasted formatting is dropped; outside an edit the frame is
// inert, so focus and Escape stay in the app. A refused commit keeps the typed text for Reload and retry.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import { chromium, firefox } from 'playwright-core';
import { createApp } from '../src/server.js';
import { createLibraryService } from '../src/library.js';
import { listenInRange } from '../test-support/loopback-port.js';

async function launch(type) {
  let browser = await type.launch(type === chromium ? {channel:'chromium'} : {}).catch(() => null);
  if (!browser && type === chromium && existsSync('/usr/bin/chromium')) browser = await chromium.launch({ executablePath: '/usr/bin/chromium' }).catch(() => null);
  return browser;
}
const SLIDES = svg => [
  { id: 'opening', title: 'Opening', layout: 'title', body: 'A clear first line\nMore after it' },
  { id: 'point', title: 'One point', layout: 'statement', body: 'Say one thing.', stages: [{ id: 'one', title: 'One', body: 'First' }, { id: 'two', title: 'Two', body: 'Second' }] },
  { id: 'options', title: 'Two options', layout: 'columns', body: 'Compare.', columns: [{ title: 'A', body: 'Left' }, { title: 'B', body: 'Right' }] },
  { id: 'diagram', title: 'Observe, connect, plan', layout: 'full-media', body: 'Three steps.', vector: { itemId: svg, alt: 'A plan' }, stages: [
    { id: 'observe', title: 'Observe', svgGroupIds: ['observe'] }, { id: 'connect', title: 'Connect', svgGroupIds: ['connect'] }] },
];
async function setup(t) {
  const workspace = await mkdtemp(path.join(tmpdir(), 'sb-slide-text-'));
  const app = await createApp({ workspace });
  t.after(async () => { await app.close(); await rm(workspace, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${await listenInRange(app.server)}`;
  const episode = app.store.createEpisode({ kind: 'deck', title: 'Slide text deck' });
  app.store.ensureEpisodeDirectories(episode.id);
  const library = createLibraryService({ workspace, store: app.store });
  const svg = await library.registerFile({ episodeId: episode.id, readable: Readable.from(await readFile(new URL('../src/runtime/fixtures/svg-illustration.svg', import.meta.url))), fileName: 'diagram.svg', selectedCategory: 'Graphics' });
  app.store.saveDeck(episode.id, 1, SLIDES(svg.id), 'human');
  return { app, episode, url: `${base}/?channel=${episode.channelId}&episode=${episode.id}` };
}
const card = (page, index) => page.locator(`#deckSlides [data-slide-index="${index}"]`);
async function frameIn(page, selector, slideId) {
  for (let i = 0; i < 200; i++) {
    const frame = await (await page.$(`${selector} iframe:not(.is-loading)`))?.contentFrame().catch(() => null);
    if (frame?.url().includes(`/${slideId}/`) && await frame.evaluate(() => Boolean(window.storybenchDeck)).catch(() => false)) return frame;
    await page.waitForTimeout(50);
  }
  throw new Error(`no ${selector} frame for ${slideId}`);
}
const evidence = async (page, name, directory = process.env.STORYBENCH_EVIDENCE_DIR) => {
  if (!directory) return;
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: path.join(directory, name) });
};
// The element's box in the frame's own coordinates, and on the page (through the canvas scale).
const boxes = async (frame, selector) => ({ frame: await frame.locator(selector).evaluate(node => { const r = node.getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; }),
  page: Object.values(await frame.locator(selector).boundingBox()) });
const moved = (a, b) => Math.max(...a.frame.map((value, i) => Math.abs(value - b.frame[i])), ...a.page.map((value, i) => Math.abs(value - b.page[i])));

for (const type of [chromium, firefox]) test(`E7 ${type.name()}: text is edited on the slide, in place, with one save per commit`, { timeout: 120000 }, async t => {
  const browser = await launch(type);
  if (!browser) return t.skip(`No launchable ${type.name()} on this seat`);
  t.after(() => browser.close());
  const { app, episode, url } = await setup(t);
  const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } }); page.setDefaultTimeout(10000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const puts = []; page.on('request', request => { if (request.method() === 'PUT' && new URL(request.url()).pathname === `/api/episodes/${episode.id}`) puts.push(request); });
  const saved = id => app.store.getDeck(episode.id).slides.find(slide => slide.id === id);
  const revision = () => app.store.getDeck(episode.id).revision;
  const saveDone = () => page.waitForResponse(response => response.request().method() === 'PUT' && new URL(response.url()).pathname === `/api/episodes/${episode.id}`);
  const settled = () => page.waitForFunction(() => document.querySelector('#saveState')?.textContent.startsWith('Saved'));
  await page.goto(url);
  await card(page, 3).waitFor();
  const editor = page.locator('#slideEditor'), iframe = editor.locator('.deck-canvas-viewport iframe:not(.is-loading)');
  const appHasFocus = () => page.evaluate(() => document.hasFocus() && document.activeElement?.tagName !== 'IFRAME');
  const editable = (frame, selector) => frame.locator(selector).evaluate(node => node.isContentEditable);
  // Double-clicks the element where it shows on the canvas (over the app's selection outlines) and waits for its edit.
  async function edit(frame, selector) {
    const box = await frame.locator(selector).boundingBox();
    await page.mouse.dblclick(box.x + Math.min(box.width / 2, 40), box.y + box.height / 2);
    await frame.waitForFunction(value => document.querySelector(value)?.isContentEditable && document.activeElement === document.querySelector(value), selector);
  }
  const selectAll = () => page.keyboard.press('ControlOrMeta+a');

  // Outside an edit the canvas frame is inert: focus and Escape stay in the app.
  await card(page, 0).locator('.slide-card-summary').click();
  await page.locator('#deckSlides [data-slide-edit]').click();
  let frame = await frameIn(page, '.deck-canvas-viewport', 'opening');
  assert.equal(await iframe.evaluate(node => node.inert), true);
  await page.click('.deck-canvas-block[data-select="copy"]');
  assert.equal(await appHasFocus(), true);

  // The title: double-click edits it in place; the box moves at most 2 px; Enter commits one save; a reload shows it.
  const view = await boxes(frame, '.copy > h1');
  await edit(frame, '.copy > h1');
  assert.equal(await iframe.evaluate(node => node.inert || node.hasAttribute('aria-hidden')), false, 'the frame is live during the edit');
  const editing = await boxes(frame, '.copy > h1');
  assert.ok(moved(view, editing) <= 2, `the title box moved ${moved(view, editing)} px entering edit (${JSON.stringify([view, editing])})`);
  await evidence(page, `e7-title-editing-${type.name()}.png`);
  await selectAll();
  await page.keyboard.type('A new opening');
  const before = revision(), firstSave = saveDone();
  await page.keyboard.press('Enter');
  // The edit ends: the frame is inert again and focus is back in the app.
  await page.waitForFunction(() => document.querySelector('#slideEditor .deck-canvas-viewport iframe:not(.is-loading)')?.inert === true);
  assert.equal(await iframe.evaluate(node => node.getAttribute('aria-hidden')), 'true');
  assert.equal(await appHasFocus(), true, 'focus returned to the app');
  await firstSave; await settled();
  assert.equal(saved('opening').title, 'A new opening');
  assert.equal(revision(), before + 1);
  assert.equal(puts.length, 1, 'one commit is one save');
  assert.match(await editor.locator('#slideEditorTitle').textContent(), /A new opening$/);
  frame = await frameIn(page, '.deck-canvas-viewport', `${revision()}/opening`);
  assert.equal(await frame.locator('.copy > h1').textContent(), 'A new opening');
  const after = await boxes(frame, '.copy > h1');
  assert.ok(Math.abs(after.frame[0] - view.frame[0]) <= 2 && Math.abs(after.frame[1] - view.frame[1]) <= 2, 'the saved title stays where it was');

  // The body (multi-line): Enter is a new line; a click off commits it as one save. Pasted formatting is
  // dropped: rich text copied in the editor (bold and a link) is pasted as plain text.
  await page.evaluate(() => {
    const rich = Object.assign(document.createElement('div'), { id: 'richSource', innerHTML: '<b>bold</b> and <a href="https://example.com">a link</a>' });
    document.querySelector('#slideEditor').append(rich);
    getSelection().selectAllChildren(rich);
  });
  await page.keyboard.press('ControlOrMeta+c');
  await page.evaluate(() => { getSelection().removeAllRanges(); document.getElementById('richSource').remove(); });
  await edit(frame, '.copy > .lede');
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Third ');
  await page.keyboard.press('ControlOrMeta+v');
  await frame.waitForFunction(() => document.querySelector('.copy > .lede').textContent.includes('a link'));
  assert.equal(await frame.locator('.copy > .lede').evaluate(node => node.querySelector('*:not(br)')), null, 'no pasted element entered the text');
  const bodySave = saveDone();
  await editor.locator('#slideEditorTitle').click();
  await bodySave; await settled();
  assert.equal(saved('opening').body, 'A clear first line\nMore after it\nThird bold and a link');
  assert.equal(puts.length, 2);
  frame = await frameIn(page, '.deck-canvas-viewport', `${revision()}/opening`);

  // Escape discards the edit and restores the saved text; it saves nothing, and the next Escapes are the app's.
  await page.click('.deck-canvas-block[data-select="copy"]');
  await edit(frame, '.copy > h1');
  await selectAll();
  await page.keyboard.type('Thrown away');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('#slideEditor .deck-canvas-viewport iframe:not(.is-loading)')?.inert === true);
  assert.equal(await frame.locator('.copy > h1').textContent(), 'A new opening');
  assert.equal(await editable(frame, '.copy > h1'), false);
  assert.equal(await appHasFocus(), true);
  assert.equal(await editor.evaluate(node => node.open), true, 'Escape ended the edit only');
  const selected = () => page.$$eval('.deck-canvas-block[aria-pressed="true"]', nodes => nodes.map(node => node.dataset.select));
  assert.deepEqual(await selected(), ['copy'], 'the selection is kept');
  await page.keyboard.press('Escape');
  assert.deepEqual(await selected(), [], 'the next Escape cleared the selection');
  assert.equal(await editor.evaluate(node => node.open), true);
  await page.waitForTimeout(300);
  assert.equal(puts.length, 2, 'Escape saved nothing');
  assert.equal(saved('opening').title, 'A new opening');

  // A step label (steps style) and a column title and body.
  await editor.getByRole('button', { name: 'Next slide' }).click();
  frame = await frameIn(page, '.deck-canvas-viewport', 'point');
  const stepView = await boxes(frame, '[data-step="0"] > h2 > button');
  await edit(frame, '[data-step="0"] > h2 > button');
  assert.ok(moved(stepView, await boxes(frame, '[data-step="0"] > h2 > button')) <= 2, 'the step label box stays in place');
  await selectAll(); await page.keyboard.type('Uno');
  let commit = saveDone(); await page.keyboard.press('Enter'); await commit; await settled();
  assert.deepEqual(saved('point').stages.map(stage => stage.title), ['Uno', 'Two']);
  await editor.getByRole('button', { name: 'Next slide' }).click();
  frame = await frameIn(page, '.deck-canvas-viewport', 'options');
  await edit(frame, '.columns > section:nth-child(2) > h2');
  await selectAll(); await page.keyboard.type('Option B');
  commit = saveDone(); await page.keyboard.press('Enter'); await commit; await settled();
  frame = await frameIn(page, '.deck-canvas-viewport', `${revision()}/options`);
  await edit(frame, '.columns > section:nth-child(1) > p');
  await page.keyboard.press('ControlOrMeta+End'); await page.keyboard.type(' side');
  commit = saveDone(); await editor.locator('#slideEditorTitle').click(); await commit; await settled();
  assert.deepEqual(saved('options').columns.map(column => [column.title, column.body]), [['A', 'Left side'], ['Option B', 'Right']]);

  // A chip step label is a button: Space types a space and clicking in it does not change the shown step.
  await editor.getByRole('button', { name: 'Next slide' }).click();
  frame = await frameIn(page, '.deck-canvas-viewport', 'diagram');
  const chipView = await boxes(frame, '.stage-nav [data-stage="0"]');
  await edit(frame, '.stage-nav [data-stage="0"]');
  assert.ok(moved(chipView, await boxes(frame, '.stage-nav [data-stage="0"]')) <= 2, 'the chip box stays in place');
  await frame.locator('.stage-nav [data-stage="0"]').click();
  await selectAll(); await page.keyboard.type('Look closely');
  assert.equal(await editor.locator('.deck-canvas-stages [aria-pressed="true"]').textContent(), 'All');
  assert.equal(await frame.evaluate(() => window.storybenchDeck.timeline().timeMs === window.storybenchDeck.timeline().durationMs), true, 'the slide stays at the full reveal');
  commit = saveDone(); await page.keyboard.press('Enter'); await commit; await settled();
  assert.deepEqual(saved('diagram').stages.map(stage => stage.title), ['Look closely', 'Connect']);
  assert.equal(puts.length, 6, 'each of the six commits saved once');

  // A refused commit (the production changed elsewhere) reports and keeps the typed text; Reload and retry saves it over the latest.
  frame = await frameIn(page, '.deck-canvas-viewport', `${revision()}/diagram`);
  const elsewhere = app.store.getDeck(episode.id);
  app.store.saveDeck(episode.id, elsewhere.revision, elsewhere.slides.map(slide => slide.id === 'opening' ? { ...slide, body: 'Changed by the assistant' } : slide), 'agent');
  await edit(frame, '.copy > h1');
  await selectAll(); await page.keyboard.type('Kept title');
  commit = saveDone(); await page.keyboard.press('Enter');
  assert.equal((await commit).status(), 409);
  await editor.locator('.deck-canvas-retry').waitFor();
  assert.match(await editor.locator('[data-canvas-status]').textContent(), /Your text was not saved\. It is kept: “Kept title”\./);
  assert.equal(saved('diagram').title, 'Observe, connect, plan');
  assert.equal(await editor.locator('[data-editor-elements] [data-slide-field="title"]').first().inputValue(), 'Kept title', 'the editor holds the typed text');
  await evidence(page, `e7-conflict-${type.name()}.png`);
  commit = saveDone();
  await editor.locator('.deck-canvas-retry').click();
  assert.equal((await commit).status(), 200);
  await settled();
  assert.equal(saved('diagram').title, 'Kept title');
  assert.equal(saved('opening').body, 'Changed by the assistant', 'the retry saved over the latest revision');
  assert.equal(await editor.locator('[data-canvas-status]').textContent(), '');

  // ✕ commits a pending edit, as a click off would.
  frame = await frameIn(page, '.deck-canvas-viewport', `${revision()}/diagram`);
  await edit(frame, '.copy > h1');
  await selectAll(); await page.keyboard.type('Closed with it');
  commit = saveDone(); await editor.getByRole('button', { name: 'Close slide editor' }).click(); await commit; await settled();
  assert.equal(await editor.evaluate(node => node.open), false);
  assert.equal(saved('diagram').title, 'Closed with it');

  // A reload shows every saved edit.
  await page.reload();
  await card(page, 3).waitFor();
  assert.deepEqual(await page.locator('#deckSlides .slide-card-summary strong').allTextContents(), ['A new opening', 'One point', 'Two options', 'Closed with it']);
  await card(page, 0).locator('.slide-card-summary').click();
  await page.locator('#deckSlides [data-slide-edit]').click();
  frame = await frameIn(page, '.deck-canvas-viewport', 'opening');
  assert.equal(await frame.locator('.copy > h1').textContent(), 'A new opening');
  assert.equal(await frame.locator('.copy > .lede').textContent(), 'Changed by the assistant');
  assert.deepEqual(errors, []);
});

test('canvas width handles wrap live, commit once, cancel, reset and survive reopening', async t => {
  const browser = await launch(chromium); if (!browser) return t.skip('No launchable Chromium');
  t.after(() => browser.close());
  const { app, episode, url } = await setup(t);
  const saved = () => app.store.getDeck(episode.id);
  const initial = saved();
  initial.slides[0].title = 'Better teaching. Worse practice?';
  initial.slides[0].body = 'Five stages in the process show how the route changes.\nThen we test it again.';
  initial.slides[0].layout = 'process';
  initial.slides[0].stages = [{ id: 'one', title: 'A problem and a solution' }];
  app.store.saveDeck(episode.id, initial.revision, initial.slides);
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  await page.goto(url);
  async function open() {
    await card(page, 0).locator('.slide-card-summary').click();
    await card(page, 0).locator('[data-slide-edit]').click();
    const frame = await frameIn(page, '.deck-canvas-viewport', 'opening');
    await page.locator('[data-select="copy"]').click();
    return frame;
  }
  let frame = await open();
  const handle = field => page.getByRole('slider', { name: field + ' width' });
  const before = saved().revision;
  const at = revision => frameIn(page, '.deck-canvas-viewport', revision + '/opening');
  const geometry = () => frame.evaluate(() => {
    const title = document.querySelector('.copy h1'), body = document.querySelector('.copy .lede');
    return { title: title.offsetHeight, body: body.offsetWidth, font: getComputedStyle(title).fontSize };
  });
  await handle('Title').press('End');
  frame = await at(before + 1);
  const wide = await geometry();
  const drag = async (field, dx) => {
    const box = await handle(field).boundingBox();
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + dx, y, { steps: 6 });
  };
  await drag('Title', -500);
  await frame.waitForFunction(h => document.querySelector('.copy h1').offsetHeight > h, wide.title);
  await evidence(page, 'title-resize.png', process.env.STORYBENCH_SLIDE_FIT_EVIDENCE);
  const narrow = await geometry();
  assert.equal(narrow.body, wide.body); assert.equal(narrow.font, wide.font);
  assert.equal(saved().revision, before + 1);
  await page.keyboard.press('Escape'); await page.mouse.up();
  await frame.waitForFunction(h => document.querySelector('.copy h1').offsetHeight === h, wide.title);
  assert.equal(saved().revision, before + 1);
  await drag('Title', -350); await page.mouse.up();
  frame = await at(before + 2);
  const titleWidth = saved().slides[0].design.copy.titleWidth;
  assert.ok(titleWidth >= 20 && titleWidth < 100);
  await handle('Body').press('Home');
  frame = await at(before + 3);
  assert.equal(saved().slides[0].design.copy.bodyWidth, 20);
  assert.ok((await geometry()).body < wide.body);
  await page.reload(); frame = await open();
  assert.equal(Number(await handle('Title').getAttribute('aria-valuenow')), titleWidth);
  await handle('Body').focus();
  await page.getByRole('button', { name: 'Reset body width' }).click();
  await at(before + 4);
  assert.deepEqual(saved().slides[0].design.copy, { titleWidth });
  await page.getByRole('button', { name: '16:10', exact: true }).click();
  frame = await at(before + 5);
  assert.equal(saved().design.aspectRatio, '16:10');
  const bounds = await frame.locator('.slide').boundingBox();
  assert.ok(Math.abs(bounds.width / bounds.height - 1.6) < .001);
  const concurrent = saved();
  app.store.saveDeck(episode.id, concurrent.revision, concurrent.slides, 'agent', { ...concurrent.design, aspectRatio: '16:9' });
  const refused = page.waitForResponse(r => r.request().method() === 'PUT' && r.status() === 409);
  await handle('Body').press('Home'); await refused;
  assert.equal(saved().design.aspectRatio, '16:9');
  assert.deepEqual(saved().slides[0].design.copy, { titleWidth });
  await page.reload(); await open();
  assert.equal(Number(await handle('Title').getAttribute('aria-valuenow')), titleWidth);
});

test('the editor names overflow on a later reveal and clears the warning after a saved correction', async t => {
  const browser = await launch(chromium); if (!browser) return t.skip('No launchable Chromium');
  t.after(() => browser.close());
  const { app, episode, url } = await setup(t);
  const deck = app.store.getDeck(episode.id), crowded = deck.slides[1];
  crowded.design = { stageText: { style: 'card' } };
  crowded.stages[1].body = 'An overfull final reveal.\n'.repeat(80);
  const saved = app.store.saveDeck(episode.id, deck.revision, deck.slides);
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(url);
  await card(page, 1).locator('.slide-card-summary').click();
  await card(page, 1).locator('[data-slide-edit]').click();
  await frameIn(page, '.deck-canvas-viewport', crowded.id);
  await page.locator('[data-canvas-stages]').getByRole('button', {name:'Start'}).click();
  const warning = page.locator('[data-canvas-overflow]');
  await warning.filter({ hasText: /One point.*Step 2/ }).waitFor();
  await evidence(page, 'later-reveal-warning.png', process.env.STORYBENCH_SLIDE_FIT_EVIDENCE);
  const last = page.locator('[data-card="step:two"]');
  await last.locator('summary').click();
  await last.locator('[data-slide-field="body"]').fill('Corrected.');
  await last.locator('[data-slide-field="body"]').press('Tab');
  await frameIn(page, '.deck-canvas-viewport', `${saved.revision + 1}/${crowded.id}`);
  assert.equal(await warning.textContent(), '');
});

// Spec #46 task #126, Slide list and editor shell (Chromium and Firefox, app served on loopback).
// E1: the slide list. E2: the editor opens on a slide, moves between slides, and Escape steps back one
// layer per press. E5 (Play slide): Play runs the slide's timeline in the canvas frame, read through the
// frame's storybenchDeck over time, and the step bar follows. E3 (editor half, two types): changing
// type hides and keeps values, and changing back restores them.
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
  let browser = await type.launch().catch(() => null);
  if (!browser && type === chromium && existsSync('/usr/bin/chromium')) browser = await chromium.launch({ executablePath: '/usr/bin/chromium' }).catch(() => null);
  return browser;
}
// Eight slides, one of each type and a closing statement. The diagram plays Start (there at once),
// then an On click step, then an automatic step.
const SLIDES = (svg, photo) => [
  { id: 'opening', title: 'Opening', layout: 'title', body: 'A clear first line\nMore after it' },
  { id: 'diagram', title: 'Observe, connect, plan', layout: 'full-media', body: 'Three steps to a plan.', vector: { itemId: svg, alt: 'A plan' }, stages: [
    { id: 'observe', title: 'Observe', svgGroupIds: ['observe'] },
    { id: 'connect', title: 'Connect', svgGroupIds: ['connect'], trigger: 'manual', durationMs: 600 },
    { id: 'plan', title: 'Plan', svgGroupIds: ['plan'], trigger: 'auto', afterMs: 300, durationMs: 600 }] },
  { id: 'point', title: 'One point', layout: 'statement', body: 'Say one thing.', stages: [{ id: 'one', title: 'One', body: 'First' }, { id: 'two', title: 'Two', body: 'Second' }] },
  { id: 'options', title: 'Two options', layout: 'columns', body: 'Compare.', columns: [{ title: 'A', body: 'Left' }, { title: 'B', body: 'Right' }] },
  { id: 'break', title: 'Part two', layout: 'section', body: '' },
  { id: 'photo', title: 'A photo', layout: 'text-media', body: 'With a picture.', media: { itemId: photo, alt: 'A picture' } },
  { id: 'process', title: 'The process', layout: 'process', body: 'Step by step.', vector: { itemId: svg, alt: 'A plan' }, stages: [{ id: 'p1', title: 'First', svgGroupIds: ['observe'] }] },
  { id: 'closing', title: 'Closing', layout: 'statement', body: 'Thank you.' },
];
async function setup(t) {
  const workspace = await mkdtemp(path.join(tmpdir(), 'sb-slide-list-'));
  const app = await createApp({ workspace });
  t.after(async () => { await app.close(); await rm(workspace, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${await listenInRange(app.server)}`;
  const episode = app.store.createEpisode({ kind: 'deck', title: 'Slide list deck' });
  app.store.ensureEpisodeDirectories(episode.id);
  const library = createLibraryService({ workspace, store: app.store });
  const svg = await library.registerFile({ episodeId: episode.id, readable: Readable.from(await readFile(new URL('../src/runtime/fixtures/svg-illustration.svg', import.meta.url))), fileName: 'diagram.svg', selectedCategory: 'Graphics' });
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const photo = await library.registerFile({ episodeId: episode.id, readable: Readable.from(png), fileName: 'photo.png', selectedCategory: 'B-roll' });
  app.store.saveDeck(episode.id, 1, SLIDES(svg.id, photo.id), 'human');
  return { app, episode, url: `${base}/?channel=${episode.channelId}&episode=${episode.id}` };
}
const settled = page => page.waitForFunction(() => document.querySelector('#saveState')?.textContent.startsWith('Saved'));
const card = (page, index) => page.locator(`#deckSlides [data-slide-index="${index}"]`);
// A loaded canvas frame's document, from its iframe element.
async function frameIn(page, selector, slideId) {
  for (let i = 0; i < 200; i++) {
    const frame = await (await page.$(`${selector} iframe:not(.is-loading)`))?.contentFrame().catch(() => null);
    if (frame?.url().includes(`/${slideId}/`) && await frame.evaluate(() => Boolean(window.storybenchDeck)).catch(() => false)) return frame;
    await page.waitForTimeout(50);
  }
  throw new Error(`no ${selector} frame for ${slideId}`);
}
const atFullReveal = frame => frame.evaluate(() => { const now = window.storybenchDeck.timeline(); return now.state === 'paused' && now.timeMs === now.durationMs; });
// The slide's markup; painting can leave an emptied style attribute behind, which changes nothing shown.
const article = frame => frame.evaluate(() => document.querySelector('article.slide').outerHTML.replaceAll(' style=""', ''));
// Samples the frame's timeline and the step bar (when given) until the frame holds the full reveal again.
// Starts once Play has moved the slide off the full reveal.
async function sample(page, frame, bar) {
  const seen = [], read = () => frame.evaluate(() => window.storybenchDeck.timeline());
  for (let i = 0; i < 200 && (await read()).timeMs === (await read()).durationMs; i++) await page.waitForTimeout(10);
  for (let i = 0; i < 1000; i++) {
    const now = await read();
    const [step, pulse] = bar ? await page.evaluate(selector => [document.querySelector(`${selector} [aria-pressed="true"]`)?.textContent ?? null,
      document.querySelector(`${selector} .is-pulsing`)?.textContent ?? null], bar) : [null, null];
    seen.push({ state: now.state, stage: now.stage, timeMs: now.timeMs, durationMs: now.durationMs, step, pulse });
    if (now.state === 'paused' && now.timeMs === now.durationMs) break;
    await page.waitForTimeout(15);
  }
  return seen;
}
const runs = values => values.filter((value, i) => value !== null && value !== values[i - 1]);
const evidence = async (page, name) => {
  if (!process.env.STORYBENCH_EVIDENCE_DIR) return;
  await mkdir(process.env.STORYBENCH_EVIDENCE_DIR, { recursive: true });
  await page.screenshot({ path: path.join(process.env.STORYBENCH_EVIDENCE_DIR, name) });
};

for (const type of [chromium, firefox]) test(`E1 ${type.name()}: the slide list shows collapsed cards, one open with its slide, Play, reorder and delete`, { timeout: 120000 }, async t => {
  const browser = await launch(type);
  if (!browser) return t.skip(`No launchable ${type.name()} on this seat`);
  t.after(() => browser.close());
  const { app, episode, url } = await setup(t);
  const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } }); page.setDefaultTimeout(10000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  await card(page, 7).waitFor();
  // The library has loaded once the drawing pill counts its candidates.
  await page.waitForFunction(() => document.querySelector('#deckSlides [data-slide-index="1"] .slide-pills')?.textContent.includes('candidate'));

  // All collapsed: number, title, body first line and pills, with nothing open and no inline slide.
  assert.equal(await page.locator('#deckSlides .slide-card').count(), 8);
  assert.equal(await page.locator('#deckSlides .slide-card.is-open').count(), 0);
  assert.equal(await page.locator('#deckSlides [data-slide-preview]').count(), 0);
  const summary = await page.locator('#deckSlides .slide-card').evaluateAll(cards => cards.map(node => [
    node.querySelector('.slide-number').textContent, node.querySelector('.slide-card-summary strong').textContent,
    node.querySelector('.slide-card-summary span').textContent, [...node.querySelectorAll('.slide-pill')].map(pill => pill.textContent).join(', ')]));
  assert.deepEqual(summary, [
    ['01', 'Opening', 'A clear first line', 'Title'],
    ['02', 'Observe, connect, plan', 'Three steps to a plan.', 'Full media, Drawing, 3 steps, 1 candidate'],
    ['03', 'One point', 'Say one thing.', 'Statement, 2 steps'],
    ['04', 'Two options', 'Compare.', 'Columns'],
    ['05', 'Part two', 'No body text', 'Section break'],
    ['06', 'A photo', 'With a picture.', 'Text and media, 1 candidate'],
    ['07', 'The process', 'Step by step.', 'Process, Drawing, 1 step, 1 candidate'],
    ['08', 'Closing', 'Thank you.', 'Statement'],
  ]);
  await evidence(page, `e1-collapsed-${type.name()}.png`);

  // Expanding one shows that slide inline at the full reveal, as the editor's canvas shows it.
  await card(page, 1).locator('.slide-card-summary').click();
  const preview = await frameIn(page, '#deckSlides [data-slide-preview]', 'diagram');
  assert.ok(await atFullReveal(preview), 'the inline slide holds the full reveal');
  assert.equal(await page.locator('#deckSlides .slide-card.is-open').count(), 1);
  const inline = await article(preview);
  await evidence(page, `e1-expanded-${type.name()}.png`);
  // Expanding another closes the first.
  await card(page, 2).locator('.slide-card-summary').click();
  await frameIn(page, '#deckSlides [data-slide-preview]', 'point');
  assert.deepEqual(await page.locator('#deckSlides .slide-card').evaluateAll(cards => cards.map(node => node.classList.contains('is-open'))),
    [false, false, true, false, false, false, false, false]);

  // Play on a collapsed card's hover actions opens it and runs its timeline through each step to the full reveal.
  await card(page, 1).hover();
  await card(page, 1).getByRole('button', { name: 'Play slide 02' }).click();
  const played = await frameIn(page, '#deckSlides [data-slide-preview]', 'diagram');
  const run = await sample(page, played);
  assert.deepEqual(runs(run.map(entry => entry.stage)), [0, 1, 2], 'the inline slide passed through each step in order');
  assert.ok(run.some(entry => entry.state === 'playing'), 'it played');
  assert.ok(await atFullReveal(played), 'it ends at the full reveal');
  assert.equal(await article(played), inline, 'the played slide ends as it opened');

  // The inline slide matches the editor's canvas at the full reveal: the same built slide, the same state.
  await card(page, 1).locator('[data-slide-edit]').click();
  const canvas = await frameIn(page, '.deck-canvas-viewport', 'diagram');
  assert.ok(await atFullReveal(canvas));
  assert.equal(await article(canvas), inline);
  await page.click('[data-editor-close]');

  // Reorder by arrows and by dragging the grip; both save through the revision check and survive reload.
  const order = () => app.store.getDeck(episode.id).slides.map(slide => slide.id);
  const revision = app.store.getDeck(episode.id).revision;
  // The open card moves up; once the move has saved, it shows its slide from the new revision at the full reveal.
  await card(page, 1).hover();
  await card(page, 1).getByRole('button', { name: 'Move slide up' }).click(); await settled(page);
  assert.deepEqual(order().slice(0, 3), ['diagram', 'opening', 'point']);
  assert.equal(app.store.getDeck(episode.id).revision, revision + 1);
  assert.equal(await card(page, 0).evaluate(node => node.classList.contains('is-open')), true);
  const moved = await frameIn(page, '#deckSlides [data-slide-preview]', `${revision + 1}/diagram`);
  assert.ok(await atFullReveal(moved), 'the moved card holds the full reveal');
  assert.equal(await article(moved), inline);
  const target = await card(page, 4).boundingBox();
  await card(page, 7).locator('[data-slide-grip]').dragTo(card(page, 4), { targetPosition: { x: 40, y: Math.round(target.height / 4) } });
  await settled(page);
  assert.deepEqual(order(), ['diagram', 'opening', 'point', 'options', 'closing', 'break', 'photo', 'process']);
  await page.reload();
  await card(page, 7).waitFor();
  assert.deepEqual(await page.locator('#deckSlides .slide-card-summary strong').allTextContents(),
    ['Observe, connect, plan', 'Opening', 'One point', 'Two options', 'Closing', 'Part two', 'A photo', 'The process']);

  // Delete confirms: dismissing keeps the slide; accepting removes it and saves.
  const asked = [];
  page.once('dialog', dialog => { asked.push(dialog.message()); dialog.dismiss(); });
  await card(page, 4).hover();
  await card(page, 4).getByRole('button', { name: 'Delete slide' }).click();
  assert.match(asked[0], /Delete slide 05 “Closing”\?/);
  assert.equal(order().length, 8);
  page.once('dialog', dialog => dialog.accept());
  await card(page, 4).getByRole('button', { name: 'Delete slide' }).click(); await settled(page);
  assert.deepEqual(order(), ['diagram', 'opening', 'point', 'options', 'break', 'photo', 'process']);
  assert.equal(await page.locator('#deckSlides .slide-card').count(), 7);
  // Preview and export is one toolbar line: Add slide, Build saved deck, the last build.
  const line = await page.locator('#deckOutputs').evaluate(node => [...node.children].filter(child => getComputedStyle(child).display !== 'none' && child.offsetHeight).map(child => Math.round(child.getBoundingClientRect().top + child.offsetHeight / 2)));
  assert.ok(Math.max(...line) - Math.min(...line) <= 4, `toolbar controls share one line (${line})`);
  assert.deepEqual(errors, []);
});

for (const type of [chromium, firefox]) test(`E2, E5 and E3 ${type.name()}: the editor opens on a slide, plays it, steps back with Escape, and its type decides its slots`, { timeout: 120000 }, async t => {
  const browser = await launch(type);
  if (!browser) return t.skip(`No launchable ${type.name()} on this seat`);
  t.after(() => browser.close());
  const { app, episode, url } = await setup(t);
  const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } }); page.setDefaultTimeout(10000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  await card(page, 7).waitFor();
  const editor = page.locator('#slideEditor');
  const heading = () => editor.locator('#slideEditorTitle').textContent();

  // E2: clicking the inline slide opens the editor on that slide; previous and next open its neighbours.
  await card(page, 2).locator('.slide-card-summary').click();
  await page.locator('#deckSlides [data-slide-edit]').click();
  assert.equal(await editor.evaluate(node => node.open), true);
  assert.equal(await heading(), 'Slide 03 of 8 One point');
  await frameIn(page, '.deck-canvas-viewport', 'point');
  await editor.getByRole('button', { name: 'Next slide' }).click();
  assert.equal(await heading(), 'Slide 04 of 8 Two options');
  await frameIn(page, '.deck-canvas-viewport', 'options');
  await editor.getByRole('button', { name: 'Previous slide' }).click();
  await editor.getByRole('button', { name: 'Previous slide' }).click();
  assert.equal(await heading(), 'Slide 02 of 8 Observe, connect, plan');
  const canvas = await frameIn(page, '.deck-canvas-viewport', 'diagram');
  assert.equal(await editor.locator('[data-editor-elements] [data-slot="copy"] [data-slide-field="title"]').inputValue(), 'Observe, connect, plan');
  // The header leaves the Markup and Send to chat slots for task #130.
  assert.equal(await editor.locator('[data-editor-slot]').count(), 2);

  // E5: Play slide runs the slide's timeline from Start: each step in order, an On click step pulses before
  // it is clicked, the step bar follows, and the slide ends at the full reveal.
  assert.deepEqual(await editor.locator('.deck-canvas-stages button').allTextContents(), ['Start', '1', '2', 'All']);
  assert.equal(await editor.locator('.deck-canvas-stages [aria-pressed="true"]').textContent(), 'All');
  await editor.getByRole('button', { name: 'Play slide' }).click();
  const run = await sample(page, canvas, '.deck-canvas-stages');
  assert.deepEqual(runs(run.map(entry => entry.stage)), [0, 1, 2], 'the frame passed through each step in order');
  assert.deepEqual(runs(run.map(entry => entry.step)).slice(-4), ['Start', '1', '2', 'All'], 'the step bar followed and ends at All');
  assert.deepEqual([...new Set(run.map(entry => entry.pulse).filter(Boolean))], ['1'], 'the On click step pulsed');
  assert.ok(run.some(entry => entry.state === 'playing' && entry.stage === 1 && entry.timeMs > 0), 'step 1 played its motion');
  assert.ok(await atFullReveal(canvas), 'the slide ends at the full reveal');
  await evidence(page, `e5-editor-${type.name()}.png`);

  // E2: Escape steps back one layer per press: the open Layout menu, then the selection, then the editor.
  await editor.locator('.slide-editor-layout .sb-select-trigger').click();
  await editor.locator('.sb-select-menu').waitFor();
  await page.click('.deck-canvas-block[data-select="copy"]');
  assert.equal(await page.locator('.sb-select-menu').count(), 0, 'a click elsewhere closes the menu');
  await editor.locator('.slide-editor-layout .sb-select-trigger').click();
  await editor.locator('.sb-select-menu').waitFor();
  const selected = () => page.$$eval('.deck-canvas-block[aria-pressed="true"]', nodes => nodes.map(node => node.dataset.select));
  assert.deepEqual(await selected(), ['copy']);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.sb-select-menu').count(), 0, 'Escape closed the menu');
  assert.deepEqual(await selected(), ['copy'], 'the selection is kept');
  assert.equal(await editor.evaluate(node => node.open), true);
  await page.click('.deck-canvas-block[data-select="copy"]');
  await page.keyboard.press('Escape');
  assert.deepEqual(await selected(), [], 'Escape cleared the selection');
  assert.equal(await editor.evaluate(node => node.open), true);
  await page.keyboard.press('Escape');
  assert.equal(await editor.evaluate(node => node.open), false, 'Escape closed the editor');
  // ✕ closes at any time, a selection included.
  await page.locator('#deckSlides [data-slide-edit]').click();
  await page.click('.deck-canvas-block[data-select="copy"]');
  await editor.getByRole('button', { name: 'Close slide editor' }).click();
  assert.equal(await editor.evaluate(node => node.open), false);

  // E3 (two types): Text and media shows media, drawing and gallery; Title has only a drawing. Changing
  // to Title hides the picked media and keeps it saved; changing back restores it.
  await card(page, 5).locator('.slide-card-summary').click();
  await page.locator('#deckSlides [data-slide-edit]').click();
  assert.equal(await heading(), 'Slide 06 of 8 A photo');
  const slots = () => editor.locator('[data-editor-elements] [data-slot]').evaluateAll(nodes => nodes.map(node => node.dataset.slot));
  assert.deepEqual(await slots(), ['copy', 'media', 'drawing', 'gallery', 'steps', 'more']);
  const layout = async label => { await editor.locator('.slide-editor-layout .sb-select-trigger').click(); await page.getByRole('option', { name: label, exact: true }).click(); await settled(page); };
  await layout('Title');
  assert.deepEqual(await slots(), ['copy', 'drawing', 'steps', 'more']);
  assert.match(await editor.locator('[data-hidden-count]').textContent(), /1 saved value hidden by this layout \(media\)/);
  const saved = () => app.store.getDeck(episode.id).slides.find(slide => slide.id === 'photo');
  assert.equal(saved().layout, 'title');
  assert.equal(saved().media.alt, 'A picture', 'the hidden media stays saved');
  await evidence(page, `e3-hidden-${type.name()}.png`);
  await page.reload();
  await card(page, 5).locator('.slide-card-summary').click();
  await page.locator('#deckSlides [data-slide-edit]').click();
  await editor.locator('[data-hidden-count]').waitFor();
  await layout('Text and media');
  assert.deepEqual(await slots(), ['copy', 'media', 'drawing', 'gallery', 'steps', 'more']);
  assert.equal(await editor.locator('[data-hidden-count]').count(), 0);
  assert.equal(await editor.locator('[data-slide-field="mediaAlt"]').inputValue(), 'A picture');
  assert.equal(await editor.locator('[data-slide-field="mediaItemId"]').inputValue(), saved().media.itemId);
  assert.equal(saved().layout, 'text-media');
  // A field typed in and left by Escape commits and saves: closing never drops it.
  await editor.locator('[data-slot="copy"] [data-slide-field="title"]').fill('A photo, retitled');
  await page.keyboard.press('Escape');
  assert.equal(await editor.evaluate(node => node.open), false);
  await settled(page);
  assert.equal(saved().title, 'A photo, retitled');
  assert.equal(await card(page, 5).locator('.slide-card-summary strong').textContent(), 'A photo, retitled');
  // The card left open shows the edited slide from the saved revision, at the full reveal.
  const edited = await frameIn(page, '#deckSlides [data-slide-preview]', `${app.store.getDeck(episode.id).revision}/photo`);
  assert.ok(await atFullReveal(edited), 'the edited card holds the full reveal');
  assert.match(await article(edited), /A photo, retitled/);
  assert.deepEqual(errors, []);
});

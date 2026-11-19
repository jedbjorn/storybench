// Spec #44 task #123, Editing by selection. A7: the creator edits by selecting on the Slides canvas
// (Chromium and Firefox, app served on loopback). A7b: the canvas at full reveal matches the built slide
// (Chromium, 1280x720 slide area, every layout primitive value).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import { chromium, firefox } from 'playwright-core';
import { createApp } from '../src/server.js';
import { createLibraryService } from '../src/library.js';
import { listenInRange } from '../test-support/loopback-port.js';

const STANDARDS = { colors: ['#1A2B6D', '#D0452B', '#F2EBD9'], fonts: ['Crimson Text'] };
const stages = (ids, extra = {}) => ids.map(id => ({ id, title: `About ${id}`, body: `What ${id} means here.`, svgGroupIds: [id], ...extra }));

async function launch(type) {
  let browser = await type.launch().catch(() => null);
  if (!browser && type === chromium && existsSync('/usr/bin/chromium')) browser = await chromium.launch({ executablePath: '/usr/bin/chromium' }).catch(() => null);
  return browser;
}
async function setup(t, slides, { standards = STANDARDS } = {}) {
  const workspace = await mkdtemp(path.join(tmpdir(), 'sb-canvas-'));
  const app = await createApp({ workspace });
  t.after(async () => { await app.close(); await rm(workspace, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${await listenInRange(app.server)}`;
  const episode = app.store.createEpisode({ kind: 'deck', title: 'Canvas deck' });
  app.store.ensureEpisodeDirectories(episode.id);
  if (standards) app.store.saveBrandStandards(episode.channelId, 1, { ...standards, stylePrompt: '' });
  const source = await readFile(new URL('../src/runtime/fixtures/svg-illustration.svg', import.meta.url));
  const svg = await createLibraryService({ workspace, store: app.store }).registerFile({ episodeId: episode.id, readable: Readable.from(source), fileName: 'diagram.svg', selectedCategory: 'Graphics' });
  const saved = app.store.saveDeck(episode.id, 1, slides(svg.id).slides, 'human', slides(svg.id).design);
  return { app, base, episode, saved, url: `${base}/?channel=${episode.channelId}&episode=${episode.id}` };
}
const deck = (store, id) => store.getDeck(id);
// The canvas frame's DOM (it is sandboxed, so read it through Playwright's frame access).
const canvasFrame = page => page.frames().find(frame => frame.url().includes('/deck-canvas/'));
async function frameShows(page, slideId, check, arg) {
  await page.waitForFunction(() => !document.querySelector('.deck-canvas-frame.is-loading'));
  for (let i = 0; i < 100; i++) {
    // The editor's canvas frame (the slide list's inline preview behind the editor is another canvas frame).
    const frame = await (await page.$('.deck-canvas-viewport iframe:not(.is-loading)'))?.contentFrame().catch(() => null);
    if (frame && !frame.url().includes(`/${slideId}/`)) { await page.waitForTimeout(50); continue; }
    if (frame && await frame.evaluate(check, arg).catch(() => false)) return frame;
    await page.waitForTimeout(50);
  }
  throw new Error(`canvas frame for ${slideId} never showed the change`);
}
const settled = page => page.waitForFunction(() => document.querySelector('#saveState')?.textContent.startsWith('Saved'));
const pressed = page => page.$$eval('.deck-canvas-block[aria-pressed="true"]', nodes => nodes.map(node => node.dataset.select));
const inspector = page => page.locator('.sb-inspector');
// The canvas is in the slide editor (spec #46), opened from the slide's card in the slide list.
async function openEditor(page, index) {
  if (await page.locator('#slideEditor[open]').count()) await page.click('[data-editor-close]');
  const card = page.locator(`#deckSlides [data-slide-index="${index}"]`);
  if (!(await card.evaluate(node => node.classList.contains('is-open')))) await card.locator('.slide-card-summary').click();
  await card.locator('[data-slide-edit]').click();
  await page.locator(`#slideEditor .deck-slide[data-slide-index="${index}"]`).waitFor();
}

for (const type of [chromium, firefox]) test(`A7 ${type.name()}: the creator edits slides and the deck theme by selection on the canvas`, { timeout: 120000 }, async t => {
  const browser = await launch(type);
  if (!browser) return t.skip(`No launchable ${type.name()} on this seat`);
  t.after(() => browser.close());
  const { app, episode, url } = await setup(t, svg => ({ slides: [
    { id: 'diagram', title: 'Observe, connect, plan', body: 'Three steps to a plan.', layout: 'full-media', vector: { itemId: svg }, stages: stages(['observe', 'connect', 'plan']) },
    { id: 'steps', title: 'Clarity creates momentum', body: 'Choose one outcome first.', layout: 'statement', stages: [{ id: 'one', title: 'One', body: 'First' }, { id: 'two', title: 'Two', body: 'Second' }] },
  ] }));
  const channelBefore = app.store.getBrandStandards(episode.channelId);
  const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } }); page.setDefaultTimeout(10000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  await openEditor(page, 0);
  await page.waitForSelector('.deck-canvas-block[data-select="copy"]');

  // Click the copy block: it shows selected and the inspector shows its arguments.
  await page.click('.deck-canvas-block[data-select="copy"]');
  assert.deepEqual(await pressed(page), ['copy']);
  await assert.doesNotReject(inspector(page).getByRole('heading', { name: 'Title and text' }).waitFor());
  assert.equal(await inspector(page).getByRole('radiogroup').count(), 2, 'position picker and alignment grid');

  // Change position and alignment: the saved slide override changes and the canvas shows it, with no build.
  await inspector(page).getByRole('radio', { name: 'Left of visual' }).click(); await settled(page);
  await inspector(page).getByRole('radio', { name: 'Centred' }).click(); await settled(page);
  assert.deepEqual(deck(app.store, episode.id).slides[0].design, { copy: { position: 'left', align: 'center', valign: 'center' } });
  await frameShows(page, 'diagram', () => document.querySelector('.composition.placed > .arrange[data-side="left"] > .copy') !== null
    && document.querySelector('.composition').dataset.copyAlign === 'center');
  assert.equal(app.store.listJobs(episode.id).filter(job => job.kind === 'deck').length, 0, 'no build was needed');
  assert.deepEqual(await pressed(page), ['copy'], 'the selection survives the canvas refresh');
  await assert.doesNotReject(inspector(page).getByText('Changed on this slide').waitFor(), 'a slide override is marked');

  // All slides + stage text style: the deck default changes and the other slide follows.
  await page.click('.deck-canvas-block[data-select="stageText"]');
  await inspector(page).getByRole('button', { name: 'All slides' }).click();
  await inspector(page).getByRole('button', { name: 'List', exact: true }).click(); await settled(page);
  assert.deepEqual(deck(app.store, episode.id).design.stageText, { style: 'list' });
  assert.equal(deck(app.store, episode.id).slides[1].design, undefined, 'no override on the other slide');
  await page.click('[data-editor-nav="1"]');
  await frameShows(page, 'steps', () => document.querySelector('.stage-list') !== null);
  // The step bar holds the slide at a step without motion; All (the full reveal) is the default.
  assert.equal(await page.locator('.deck-canvas-stages [aria-pressed="true"]').textContent(), 'All');
  await page.locator('.deck-canvas-stages').getByRole('button', { name: 'Start' }).click();
  await frameShows(page, 'steps', () => document.querySelector('.stage-list > li[aria-current]') === document.querySelector('.stage-list > li')
    && document.querySelector('.stage-list > li:nth-child(2)').dataset.pending === 'true' && window.storybenchDeck.timeline().state === 'paused');
  // The last stage holds too, and the canvas exchange settles: no message crosses once it is shown.
  await page.evaluate(() => { window.canvasMessages = 0; window.addEventListener('message', event => { if (event.data?.type === 'storybench-canvas') window.canvasMessages++; }); });
  await page.locator('.deck-canvas-stages').getByRole('button', { name: '1', exact: true }).click();
  await frameShows(page, 'steps', () => document.querySelector('.stage-list > li[aria-current]') === document.querySelector('.stage-list > li:nth-child(2)')
    && document.querySelector('.stage-list > li:nth-child(2)').dataset.pending === 'false' && window.storybenchDeck.timeline().state === 'paused'
    && window.storybenchDeck.timeline().stage === 1);
  await page.waitForTimeout(100);
  const before = await page.evaluate(() => window.canvasMessages);
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => window.canvasMessages), before, 'no canvas messages after the last stage is shown');
  assert.ok(before < 10, `the last stage settled in ${before} canvas messages`);
  assert.equal(await page.locator('.deck-canvas-stages [aria-pressed="true"]').textContent(), '1');
  await page.locator('.deck-canvas-stages').getByRole('button', { name: 'All' }).click();
  await frameShows(page, 'steps', () => document.querySelector('.stage-list > li:nth-child(2)').dataset.pending === 'false');

  // Deselect: a click on empty canvas, and separately Escape.
  await page.waitForSelector('.deck-canvas-block[data-select="copy"]');
  await page.click('.deck-canvas-block[data-select="copy"]');
  assert.deepEqual(await pressed(page), ['copy']);
  const surface = await page.locator('.deck-canvas-surface').boundingBox();
  await page.mouse.click(surface.x + surface.width - 6, surface.y + surface.height - 6);
  assert.deepEqual(await pressed(page), [], 'click on empty canvas deselects');
  await page.click('.deck-canvas-block[data-select="copy"]');
  await page.keyboard.press('Escape');
  assert.deepEqual(await pressed(page), [], 'Escape deselects');

  // Tab reaches each element and Enter selects it (the canvas follows the editor's header).
  await page.locator('[data-editor-close]').focus();
  for (const key of ['copy', 'stageText']) {
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.select), key);
    await page.keyboard.press('Enter');
    assert.deepEqual(await pressed(page), [key]);
  }
  await page.keyboard.press('Escape');

  // Theme: inherited roles show prefilled and marked; a change becomes this deck's own; the channel is unchanged.
  const row = name => inspector(page).locator(`[data-control="${name}"]`);
  await assert.doesNotReject(row('theme.colors.accent').getByText('From Brand Standards').waitFor());
  assert.match(await row('theme.colors.accent').locator('.deck-canvas-swatch').textContent(), /#D0452B/);
  await row('theme.colors.accent').locator('.deck-canvas-swatch').click();
  await page.fill('#pickerHex', '#2E7D4F'); await page.getByRole('button', { name: 'Apply' }).click(); await settled(page);
  await row('theme.fonts.base').locator('.sb-select-trigger').click();
  await page.getByRole('option', { name: 'Lato', exact: true }).click(); await settled(page);
  await row('theme.colors.base').locator('.deck-canvas-swatch').click();
  await page.fill('#pickerHex', '#202020'); await page.getByRole('button', { name: 'Apply' }).click(); await settled(page);
  const theme = deck(app.store, episode.id).design.theme;
  assert.deepEqual(theme.colors, { accent: '#2E7D4F', base: '#202020' }); assert.deepEqual(theme.fonts, { base: 'Lato' });
  assert.deepEqual(theme.setBy, { colors: { accent: 'creator', base: 'creator' }, fonts: { base: 'creator' } });
  assert.deepEqual(app.store.getBrandStandards(episode.channelId), channelBefore, "the channel's standards are unchanged");
  await assert.doesNotReject(row('theme.colors.accent').getByText('This deck').waitFor());
  await frameShows(page, 'steps', () => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim().toUpperCase() === '#2E7D4F');
  // Use Brand Standards resets one.
  await row('theme.colors.base').getByRole('button', { name: 'Base color: use Brand Standards' }).click(); await settled(page);
  assert.deepEqual(deck(app.store, episode.id).design.theme.colors, { accent: '#2E7D4F' });
  await assert.doesNotReject(row('theme.colors.base').getByText('From Brand Standards').waitFor());

  // Save, reload: every value shows.
  await page.reload();
  await page.locator('#deckSlides [data-slide-index="0"]').waitFor();
  await openEditor(page, 0);
  await page.waitForSelector('.deck-canvas-block[data-select="copy"]');
  assert.match(await row('theme.colors.accent').textContent(), /#2E7D4F.*This deck/);
  assert.match(await row('theme.colors.base').textContent(), /#1A2B6D.*From Brand Standards/);
  assert.match(await row('theme.fonts.base').textContent(), /Lato.*This deck/);
  await page.click('.deck-canvas-block[data-select="stageText"]');
  assert.equal(await inspector(page).getByRole('button', { name: 'List', exact: true }).getAttribute('aria-pressed'), 'true');
  await page.click('.deck-canvas-block[data-select="copy"]');
  for (const name of ['Left of visual', 'Centred']) assert.equal(await inspector(page).getByRole('radio', { name }).getAttribute('aria-checked'), 'true');

  // The next build matches the canvas: the same slide markup and the same palette and fonts.
  await page.click('[data-editor-close]');
  await page.click('#buildDeck');
  let job;
  for (let i = 0; i < 400 && !['completed', 'failed'].includes((job = app.store.listJobs(episode.id).find(item => item.kind === 'deck'))?.state); i++) await page.waitForTimeout(25);
  assert.equal(job.state, 'completed', job.error);
  const { revision } = deck(app.store, episode.id), served = file => fetch(`${new URL(url).origin}${file}`).then(response => response.text());
  const article = (html, id) => html.match(new RegExp(`<article class="slide[^"]*" id="${id}"[\\s\\S]*?</article>`))[0].replace(/_sbv\d+/g, '_sbv');
  for (const id of ['diagram', 'steps']) {
    const canvas = await served(`/api/episodes/${episode.id}/deck-canvas/${revision}/${id}/index.html`);
    assert.equal(article(canvas, id), article(await served(`/api/jobs/${job.id}/deck/index.html`), id), `slide ${id} markup`);
    assert.equal(await served(`/api/episodes/${episode.id}/deck-canvas/${revision}/${id}/styles.css`), await served(`/api/jobs/${job.id}/deck/styles.css`), `slide ${id} styles`);
  }
  assert.deepEqual(errors, []);
});

// A7b: every layout primitive value, the canvas at full reveal against the built slide at full reveal.
const VALUES = svg => ({ design: { type: { scale: 'compact' } }, slides: [
  { id: 'plain', title: 'No design values', body: 'The template as it is.', layout: 'full-media', vector: { itemId: svg }, stages: stages(['observe', 'connect']) },
  { id: 'chips', title: 'Chips under the diagram', body: 'Left and top.', layout: 'full-media', vector: { itemId: svg }, stages: stages(['observe', 'connect', 'plan']),
    design: { copy: { position: 'left', align: 'start', valign: 'start' }, stageText: { style: 'chips', position: 'bottom', align: 'center', valign: 'end' }, spacing: { density: 'compact' } } },
  { id: 'steps', title: 'Steps above', body: 'Right, centred.', layout: 'text-media', vector: { itemId: svg }, stages: stages(['observe', 'connect']),
    design: { copy: { position: 'right', align: 'center', valign: 'center' }, stageText: { style: 'steps', position: 'top', align: 'end', valign: 'start' }, type: { scale: 'large' }, spacing: { density: 'spacious' } } },
  { id: 'list', title: 'A numbered list', body: 'Top, end.', layout: 'full-media', vector: { itemId: svg }, stages: stages(['observe', 'connect', 'plan']),
    design: { copy: { position: 'top', align: 'end', valign: 'end' }, stageText: { style: 'list', position: 'left', align: 'start', valign: 'center', numbered: true }, type: { scale: 'standard' }, spacing: { density: 'standard' } } },
  { id: 'card', title: 'A flipping card', body: 'Below the visual.', layout: 'full-media', vector: { itemId: svg }, stages: stages(['observe', 'connect', 'plan']),
    design: { copy: { position: 'bottom' }, stageText: { style: 'card', position: 'right', align: 'center', valign: 'end', numbered: true, flipMs: 300 }, timing: { betweenMs: 400 } } },
  { id: 'bullets', title: 'Plain list and card', body: 'Unnumbered.', layout: 'process', vector: { itemId: svg }, stages: stages(['observe', 'connect']),
    design: { stageText: { style: 'list', numbered: false, align: 'center' } } },
  { id: 'plaincard', title: 'Unnumbered card', body: 'Centred text.', layout: 'statement', stages: [{ id: 'a', title: 'First', body: 'One' }, { id: 'b', title: 'Second', body: 'Two' }],
    design: { copy: { align: 'center', valign: 'end' }, stageText: { style: 'card', numbered: false, valign: 'center' } } },
] });

test('A7b chromium: each slide on the canvas at full reveal matches the built slide at full reveal', { timeout: 180000 }, async t => {
  const browser = await launch(chromium);
  if (!browser) return t.skip('No launchable chromium on this seat');
  t.after(() => browser.close());
  const { app, base, episode, saved, url } = await setup(t, VALUES);
  const queued = app.decks.enqueue({ episodeId: episode.id, expectedRevision: saved.revision });
  let job;
  for (let i = 0; i < 400 && ['queued', 'running'].includes((job = app.store.getJob(queued.id)).state); i++) await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(job.state, 'completed', job.error);
  // Wide enough that the canvas shows the slide area at scale 1.
  const editor = await browser.newPage({ viewport: { width: 2400, height: 1400 } });
  const built = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await editor.goto(url); await openEditor(editor, 0); await editor.waitForSelector('.deck-canvas-block');
  const compare = (a, b) => editor.evaluate(async ([left, right]) => {
    const pixels = async source => {
      const image = new Image(); image.src = `data:image/png;base64,${source}`; await image.decode();
      const canvas = Object.assign(document.createElement('canvas'), { width: image.width, height: image.height }), context = canvas.getContext('2d');
      context.drawImage(image, 0, 0);
      return { width: image.width, height: image.height, data: context.getImageData(0, 0, image.width, image.height).data };
    };
    const [x, y] = [await pixels(left), await pixels(right)];
    if (x.width !== y.width || x.height !== y.height) return { size: [x.width, x.height, y.width, y.height] };
    let differing = 0;
    for (let i = 0; i < x.data.length; i += 4) if (x.data[i] !== y.data[i] || x.data[i + 1] !== y.data[i + 1] || x.data[i + 2] !== y.data[i + 2]) differing++;
    return { differing };
  }, [a.toString('base64'), b.toString('base64')]);
  for (const [index, slide] of VALUES('x').slides.entries()) {
    await built.goto(`${base}/api/jobs/${job.id}/deck/index.html#${slide.id}`);
    await built.waitForFunction(id => window.storybenchDeck?.timeline().slideId === id, slide.id);
    await built.evaluate(() => document.fonts.ready.then(() => window.storybenchDeck.seek(window.storybenchDeck.timeline().durationMs)));
    await built.mouse.move(1279, 719);
    const area = await built.evaluate(() => { const box = document.getElementById('presentation').getBoundingClientRect(); return { x: box.left, y: box.top, width: box.width, height: box.height }; });
    const expected = await built.screenshot({ clip: area });

    if (index) await editor.click('[data-editor-nav="1"]');
    const frame = await frameShows(editor, slide.id, () => document.fonts.ready.then(() => true));
    await frame.evaluate(() => document.fonts.ready);
    await editor.waitForFunction(() => document.querySelector('.deck-canvas-viewport').clientWidth === 1056);
    await editor.mouse.move(2, 2);
    const box = await editor.locator('.deck-canvas-viewport').boundingBox();
    const actual = await editor.screenshot({ clip: { x: box.x, y: box.y, width: area.width, height: area.height } });
    const result = await compare(actual, expected);
    if (process.env.STORYBENCH_EVIDENCE_DIR) {
      await mkdir(process.env.STORYBENCH_EVIDENCE_DIR, { recursive: true });
      await writeFile(path.join(process.env.STORYBENCH_EVIDENCE_DIR, `a7b-${slide.id}-canvas.png`), actual);
      await writeFile(path.join(process.env.STORYBENCH_EVIDENCE_DIR, `a7b-${slide.id}-built.png`), expected);
    }
    assert.deepEqual(result, { differing: 0 }, `slide ${slide.id}: canvas and build differ`);
  }
});

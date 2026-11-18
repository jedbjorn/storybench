// Spec #44 "Layout primitives" in a real browser: A5 (primitives render), A5b (the card follows the
// timeline), A5c (one gap per slide) and A6 (unset means unchanged, against the template before this change).
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { buildDeck } from '../src/deck-template/build.js';
import { effectiveSlideDesign } from '../src/deck-data.js';
import { exampleDeck, exampleAssets } from '../src/deck-template/example.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
// Eight independent groups: a centred diagram with enough stages to wrap the chip row (issue #124).
const GROUPS = ['g1', 'g2', 'g3', 'g4', 'g5', 'g6', 'g7', 'g8'];
const art = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200" viewBox="0 0 400 200"><rect width="400" height="200" fill="#ffffff"/>${GROUPS.map((id, i) => `<g id="${id}"><rect x="${10 + i * 48}" y="80" width="40" height="40" fill="#294b60"/></g>`).join('')}</svg>`);
const assets = { ...exampleAssets, 'assets/art.svg': art };
const TITLES = ['Collect the raw signals', 'Sort', 'Find the outliers quickly', 'Group', 'Name each theme', 'Draft the story arc', 'Test', 'Share the decision with everyone'];
const vectorStages = (count = 8, extra = () => ({})) => GROUPS.slice(0, count).map((id, i) => ({ id, title: TITLES[i], body: `Body of ${TITLES[i]}.`, svgGroupIds: [id], ...extra(i) }));
const vector = (id, design, extra = {}) => ({ id, title: 'A centred diagram', layout: 'full-media', vector: { type: 'image', src: 'assets/art.svg', alt: 'Eight squares' }, stages: vectorStages(), design, ...extra });
const media = (id, design) => ({ id, title: 'See the whole picture', body: 'A simple visual gives the group a common starting point.', layout: 'text-media', media: { type: 'image', src: 'assets/example.png', alt: 'A study' }, design });
const statement = (id, design, extra = {}) => ({ id, title: 'Clarity creates momentum.', body: 'Choose one useful outcome before choosing the tools.', layout: 'statement', design, ...extra });
const ACCENT = 'rgb(38, 104, 107)';

async function launch(t) {
  let browser = await chromium.launch().catch(() => null);
  if (!browser && existsSync('/usr/bin/chromium')) browser = await chromium.launch({ executablePath: '/usr/bin/chromium' }).catch(() => null);
  if (!browser) { t.skip('No launchable chromium on this seat'); return null; }
  t.after(() => browser.close());
  return browser;
}
function write(t, files) {
  const dir = mkdtempSync(path.join(tmpdir(), 'sb-primitives-browser-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const [name, bytes] of files) { mkdirSync(path.dirname(path.join(dir, name)), { recursive: true }); writeFileSync(path.join(dir, name), bytes); }
  return dir;
}
async function open(t, browser, slides, { viewport = { width: 1280, height: 720 }, context = {}, build = buildDeck } = {}) {
  const dir = write(t, build({ title: 'Primitives', slides }, { assets }));
  const pages = await browser.newContext({ viewport, ...context });
  t.after(() => pages.close());
  const page = await pages.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, []));
  await page.goto(`${pathToFileURL(path.join(dir, 'index.html'))}#${slides[0].id}`);
  await page.waitForFunction(() => window.storybenchDeck);
  await page.evaluate(() => document.fonts.ready);
  return page;
}
const go = async (page, id) => { await page.evaluate(slide => { location.hash = slide; }, id); await page.waitForFunction(slide => !document.getElementById(slide).hidden, id); };
const rect = (page, selector) => page.locator(selector).first().evaluate(el => el.getBoundingClientRect().toJSON());
// The rows of a wrapped button row, with the slack left and right of each.
const rows = (page, selector) => page.locator(selector).first().evaluate(nav => {
  const outer = nav.getBoundingClientRect(), found = new Map();
  for (const button of nav.querySelectorAll('button')) {
    const box = button.getBoundingClientRect(), row = found.get(Math.round(box.top)) ?? { left: Infinity, right: -Infinity };
    found.set(Math.round(box.top), { left: Math.min(row.left, box.left), right: Math.max(row.right, box.right) });
  }
  return [...found.values()].map(row => ({ left: row.left - outer.left, right: outer.right - row.right }));
});
// Where the text itself sits, whatever box holds it.
const ink = (page, selector) => page.locator(selector).first().evaluate(el => { const range = document.createRange(); range.selectNodeContents(el); return range.getBoundingClientRect().toJSON(); });
const style = (page, selector, property) => page.locator(selector).first().evaluate((el, name) => getComputedStyle(el).getPropertyValue(name), property);
const seek = (page, ms) => page.evaluate(time => window.storybenchDeck.seek(time), ms);
const near = (actual, expected, message, tolerance = 1) => assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} vs ${expected}`);

for (const viewport of [{ width: 1280, height: 720 }, { width: 960, height: 720 }]) test(`A5 ${viewport.width}x${viewport.height}: stageText.align center centres every wrapped chip row under a full-media vector (issue #124)`, { timeout: 60000 }, async t => {
  const browser = await launch(t); if (!browser) return;
  const page = await open(t, browser, [vector('today'), vector('centred', { stageText: { align: 'center' } }), vector('ended', { stageText: { align: 'end' } })], { viewport });
  const today = await rows(page, '#today .stage-nav');
  assert.ok(today.length >= 2, `the chip row wraps (${today.length} rows)`);
  for (const row of today) near(row.left, 0, 'unset: each row starts flush left');
  assert.ok(today.at(-1).right > 100, `unset: the short last row leaves slack on the right (${today.at(-1).right}px), the issue`);
  await go(page, 'centred');
  const centred = await rows(page, '#centred .stage-nav');
  assert.equal(centred.length, today.length);
  for (const [i, row] of centred.entries()) near(row.left, row.right, `centre: row ${i + 1} slack is equal left and right`);
  await go(page, 'ended');
  for (const row of await rows(page, '#ended .stage-nav')) near(row.right, 0, 'end: each row ends flush right');
});

test('A5: each position places copy and stage text on the stated side of the visual', { timeout: 60000 }, async t => {
  const browser = await launch(t); if (!browser) return;
  const sides = ['left', 'right', 'top', 'bottom'];
  const page = await open(t, browser, [...sides.map(side => media(`copy-${side}`, { copy: { position: side } })),
    ...sides.map(side => vector(`stage-${side}`, { stageText: { position: side, style: 'steps' } }))]);
  const beside = (block, visual, side) => ({ left: block.right <= visual.left + 0.5, right: block.left >= visual.right - 0.5, top: block.bottom <= visual.top + 0.5, bottom: block.top >= visual.bottom - 0.5 })[side];
  for (const [kind, selector] of [['copy', '.copy'], ['stage', '.stage-text']]) for (const side of sides) {
    const id = `${kind}-${side}`;
    await go(page, id);
    const block = await rect(page, `#${id} ${selector}`), visual = await rect(page, `#${id} .visual`);
    assert.ok(block.width > 0 && block.height > 0 && visual.width > 0 && visual.height > 0, `${id}: both boxes render`);
    assert.ok(beside(block, visual, side), `${id}: the block is ${side} of the visual (${JSON.stringify({ block, visual })})`);
  }
});

test('A5: align and valign move copy and stage text as stated', { timeout: 60000 }, async t => {
  const browser = await launch(t); if (!browser) return;
  const values = ['start', 'center', 'end'];
  const page = await open(t, browser, [
    ...values.map(align => statement(`align-${align}`, { copy: { align } })),
    ...values.map(valign => statement(`column-${valign}`, { copy: { valign } })),
    ...values.map(valign => media(`beside-${valign}`, { copy: { position: 'left', valign } })),
    ...values.map(valign => vector(`stage-${valign}`, { stageText: { position: 'right', valign } }, { stages: vectorStages(3) })),
  ]);
  for (const align of values) {
    await go(page, `align-${align}`);
    const copy = await rect(page, `#align-${align} .copy`), text = await ink(page, `#align-${align} h1`);
    if (align === 'start') near(text.left, copy.left, 'align start: the title starts at the block start');
    if (align === 'center') near((text.left + text.right) / 2, (copy.left + copy.right) / 2, 'align center: the title is centred in the block', 2);
    if (align === 'end') near(text.right, copy.right, 'align end: the title ends at the block end', 2);
  }
  // On a slide without a visual the copy's area is the composition.
  for (const valign of values) {
    await go(page, `column-${valign}`);
    const area = await rect(page, `#column-${valign} .composition`), copy = await rect(page, `#column-${valign} .copy`);
    const top = copy.top - area.top - Number.parseFloat(await style(page, `#column-${valign} .composition`, 'padding-top')), bottom = area.bottom - copy.bottom;
    if (valign === 'start') near(top, 0, 'column valign start: copy at the top');
    if (valign === 'center') near(top, bottom, 'column valign center: copy centred', 2);
    if (valign === 'end') near(bottom, 0, 'column valign end: copy at the bottom');
  }
  // Beside the visual the area is the row: content moves within the copy block.
  for (const [prefix, selector] of [['beside', '.copy'], ['stage', '.stage-text']]) for (const valign of values) {
    const id = `${prefix}-${valign}`;
    await go(page, id);
    const area = await rect(page, `#${id} ${selector}`);
    const content = await page.locator(`#${id} ${selector}`).evaluate(el => { const boxes = [...el.children].filter(c => getComputedStyle(c).display !== 'none').map(c => c.getBoundingClientRect()); return { top: Math.min(...boxes.map(b => b.top)), bottom: Math.max(...boxes.map(b => b.bottom)) }; });
    assert.ok(area.height > content.bottom - content.top + 40, `${id}: the area is taller than its content`);
    if (valign === 'start') near(content.top, area.top, `${id}: start keeps content at the top`);
    if (valign === 'center') near(content.top - area.top, area.bottom - content.bottom, `${id}: center centres it`, 2);
    if (valign === 'end') near(content.bottom, area.bottom, `${id}: end puts it at the bottom`);
  }
});

test('A5: type scales headings and body together; spacing scales padding and gaps; a list marks its current item', { timeout: 60000 }, async t => {
  const browser = await launch(t); if (!browser) return;
  const stages = [{ id: 'a', title: 'Observe', body: 'Name it.' }, { id: 'b', title: 'Try', body: 'Test one change.', afterMs: 1000 }, { id: 'c', title: 'Learn', body: 'Share it.', afterMs: 1000 }];
  const page = await open(t, browser, [statement('plain'), statement('compact', { type: { scale: 'compact' }, spacing: { density: 'compact' } }),
    statement('large', { type: { scale: 'large' }, spacing: { density: 'spacious' } }), statement('list', { stageText: { style: 'list', numbered: true } }, { stages })]);
  const measure = async id => { await go(page, id); return { h1: Number.parseFloat(await style(page, `#${id} h1`, 'font-size')), lede: Number.parseFloat(await style(page, `#${id} .lede`, 'font-size')),
    padding: Number.parseFloat(await style(page, `#${id}`, 'padding-top')), gap: Number.parseFloat(await style(page, `#${id} .composition`, 'row-gap')) }; };
  const plain = await measure('plain'), compact = await measure('compact'), large = await measure('large');
  for (const key of ['h1', 'lede', 'padding', 'gap']) assert.ok(compact[key] < plain[key] && plain[key] < large[key], `${key}: compact < standard < large (${compact[key]}, ${plain[key]}, ${large[key]})`);
  near(large.h1 / plain.h1, large.lede / plain.lede, 'heading and body scale together', 0.01);
  await go(page, 'list');
  await seek(page, 1500);
  const marked = () => page.locator('#list .stage-list > li').evaluateAll(items => items.map(li => ({ current: li.getAttribute('aria-current'), rule: getComputedStyle(li).borderLeftColor })));
  const second = await marked();
  assert.deepEqual(second.map(item => item.current), [null, 'step', null]);
  assert.equal(second[1].rule, ACCENT); assert.equal(second[0].rule, 'rgba(0, 0, 0, 0)');
  assert.equal(await page.locator('#list .stage-list').evaluate(el => el.tagName), 'OL');
  await page.locator('#list .stage-list [data-stage="0"]').click();
  assert.deepEqual((await marked()).map(item => item.current), ['step', null, null], 'each item selects its stage');
});

test('A5: slide value beats deck value beats default', { timeout: 60000 }, async t => {
  const browser = await launch(t); if (!browser) return;
  // As the build resolves them (deck-service): per argument, the slide's value, else the deck's.
  const deck = { stageText: { align: 'end' } }, resolved = slide => ({ ...slide, design: effectiveSlideDesign(deck, slide.design, { hasVisual: true }) });
  const page = await open(t, browser, [resolved(vector('slide', { stageText: { align: 'center' } })), resolved(vector('deck')), vector('template')]);
  for (const row of await rows(page, '#slide .stage-nav')) near(row.left, row.right, 'slide override: centred');
  await go(page, 'deck');
  for (const row of await rows(page, '#deck .stage-nav')) near(row.right, 0, 'deck default: ends flush right');
  await go(page, 'template');
  for (const row of await rows(page, '#template .stage-nav')) near(row.left, 0, 'template default: starts flush left');
});

test('A5b: the card follows the timeline: faces, constant height, flipMs, reduced motion, print and stage controls', { timeout: 60000 }, async t => {
  const browser = await launch(t); if (!browser) return;
  const stages = [{ id: 'a', title: 'Alpha', body: 'Short.' }, { id: 'b', title: 'Beta', body: 'A much longer body. '.repeat(12), afterMs: 1000 }, { id: 'c', title: 'Gamma', body: 'Middle length body here.', afterMs: 1000 }];
  const slides = [statement('card', { stageText: { style: 'card', flipMs: 600, numbered: true } }, { stages })];
  const page = await open(t, browser, slides);
  const timeline = await seek(page, 0);
  assert.deepEqual(timeline.stages.map(s => [s.startMs, s.motionEndMs]), [[0, 0], [1000, 1600], [2000, 2600]], 'each flip is part of its stage\'s motion');
  const faces = () => page.locator('#card .stage-card > [data-step]').evaluateAll(els => els.map(el => ({ shown: el.dataset.pending !== 'true', visible: getComputedStyle(el).visibility === 'visible',
    title: el.querySelector('h2').textContent, body: el.querySelector('p').textContent, transform: el.style.transform })));
  const height = () => page.locator('#card .stage-card').evaluate(el => el.getBoundingClientRect().height);
  const heights = new Set();
  for (const [n, stage] of stages.entries()) {
    await seek(page, timeline.stages[n].motionEndMs);
    const shown = (await faces()).filter(face => face.shown && face.visible);
    assert.deepEqual(shown.map(face => [face.title, face.body, face.transform]), [[stage.title, stage.body, '']], `at stage ${n + 1} the card shows that stage`);
    heights.add(await height());
  }
  assert.equal(heights.size, 1, `the card keeps one height across stages (${[...heights]})`);
  // The flip starts exactly when its stage starts and spans flipMs.
  for (const n of [1, 2]) {
    const { startMs } = timeline.stages[n];
    await seek(page, startMs - 1);
    assert.deepEqual((await faces()).filter(f => f.shown).map(f => [f.title, f.transform]), [[stages[n - 1].title, '']], `just before stage ${n + 1}: still the previous face, unturned`);
    await seek(page, startMs + 60);
    const leaving = (await faces()).filter(f => f.shown);
    assert.equal(leaving[0].title, stages[n - 1].title); assert.match(leaving[0].transform, /^rotateY\((\d+\.?\d*)deg\)$/, 'the outgoing face turns away');
    assert.ok(Number.parseFloat(leaving[0].transform.slice(8)) > 0);
    await seek(page, startMs + 540);
    const arriving = (await faces()).filter(f => f.shown);
    assert.equal(arriving[0].title, stages[n].title); assert.match(arriving[0].transform, /^rotateY\(-\d+\.?\d*deg\)$/, 'the incoming face turns in');
    await seek(page, startMs + 599);
    assert.notEqual((await faces()).find(f => f.shown).transform, '', 'still turning just before flipMs has passed');
    await seek(page, startMs + 600);
    assert.deepEqual((await faces()).filter(f => f.shown).map(f => [f.title, f.transform]), [[stages[n].title, '']], 'flat once flipMs has passed');
  }
  // [data-stage] controls name every stage for Preview, Presenter and the keyboard.
  assert.deepEqual(await page.locator('#card [data-stage]').evaluateAll(els => els.map(el => [el.dataset.stage, el.getAttribute('aria-label'), el.textContent])),
    [['0', 'Alpha', '1'], ['1', 'Beta', '2'], ['2', 'Gamma', '3']]);
  // Print shows every stage, as a list.
  await page.emulateMedia({ media: 'print' }); await page.evaluate(() => window.storybenchDeck.timeline());
  const printed = await page.locator('#card .stage-card > [data-step]').evaluateAll(els => els.map(el => ({ visible: getComputedStyle(el).visibility === 'visible' && getComputedStyle(el).opacity === '1', top: el.getBoundingClientRect().top, bottom: el.getBoundingClientRect().bottom })));
  assert.ok(printed.every(face => face.visible), 'print shows every stage');
  for (let i = 1; i < printed.length; i++) assert.ok(printed[i].top >= printed[i - 1].bottom, 'printed stages do not overlap');
  await page.emulateMedia({ media: 'screen' });
  // Reduced motion swaps faces with no flip.
  const reduced = await open(t, browser, slides, { context: { reducedMotion: 'reduce' } });
  const still = () => reduced.locator('#card .stage-card > [data-step]').evaluateAll(els => els.map(el => ({ shown: getComputedStyle(el).visibility === 'visible', inline: el.style.transform, computed: getComputedStyle(el).transform })));
  const end = await still();
  assert.deepEqual(end.map(face => face.shown), [false, false, true], 'reduced motion: the last stage shows');
  assert.ok(end.every(face => face.inline === '' && face.computed === 'none'), 'reduced motion: no flip transform');
  await reduced.locator('#card [data-stage="0"]').click();
  const first = await still();
  assert.deepEqual(first.map(face => face.shown), [true, false, false], 'reduced motion: selecting a stage swaps faces');
  assert.ok(first.every(face => face.inline === '' && face.computed === 'none'));
});

test('A5c: with timing.betweenMs every stage after the first starts that long after the previous stage\'s motion ends, card and diagram alike', { timeout: 60000 }, async t => {
  const browser = await launch(t); if (!browser) return;
  const page = await open(t, browser, [
    vector('diagram', { stageText: { style: 'card', flipMs: 500 }, timing: { betweenMs: 700 } }, { stages: vectorStages(3, i => [{ afterMs: 200 }, { durationMs: 900 }, {}][i]) }),
    statement('text', { timing: { betweenMs: 250 } }, { stages: [{ id: 'a', title: 'A', durationMs: 300 }, { id: 'b', title: 'B' }, { id: 'c', title: 'C', durationMs: 1200 }] }),
  ]);
  const diagram = await seek(page, 0);
  assert.equal(diagram.stages[0].startMs, 200, 'the first stage keeps its own afterMs');
  for (let n = 1; n < 3; n++) {
    assert.equal(diagram.stages[n].startMs, diagram.stages[n - 1].motionEndMs + 700, `diagram stage ${n + 1}`);
    assert.equal(diagram.stages[n].trigger, 'auto');
  }
  // The diagram's group and the card's flip both begin at the stage's start.
  const { startMs } = diagram.stages[1];
  await seek(page, startMs - 1);
  assert.equal(await page.locator('#diagram [data-vector-group="g2"]').getAttribute('data-pending'), 'true');
  await seek(page, startMs + 20);
  assert.equal(await page.locator('#diagram [data-vector-group="g2"]').getAttribute('data-pending'), 'false');
  assert.match(await page.locator('#diagram .stage-card > [data-step="0"]').evaluate(el => el.style.transform), /^rotateY\(/);
  await go(page, 'text');
  const text = await seek(page, 0);
  for (let n = 1; n < 3; n++) assert.equal(text.stages[n].startMs, text.stages[n - 1].motionEndMs + 250, `stage text ${n + 1}`);
  assert.deepEqual(text.stages.map(s => s.startMs), [0, 550, 1250]);
});

// A6: a deck with no design values and no channel colours renders every slide and stage pixel-identical
// to the template on main before this change, with the same computed palette.
const BEFORE = '3251ec1e65d506d10f078cb41c2239f1b8826fa0';
test('A6: with no design values every slide and stage renders pixel-identical to the template before layout primitives', { timeout: 120000 }, async t => {
  try { execFileSync('git', ['-C', ROOT, 'cat-file', '-e', `${BEFORE}^{commit}`], { stdio: 'ignore' }); }
  catch { return t.skip(`main before this change (${BEFORE.slice(0, 8)}) is not in this clone; fetch it to compare`); }
  const browser = await launch(t); if (!browser) return;
  const old = mkdtempSync(path.join(tmpdir(), 'sb-primitives-before-'));
  t.after(() => rmSync(old, { recursive: true, force: true }));
  const archive = execFileSync('git', ['-C', ROOT, 'archive', '--format=tar', BEFORE, 'src/deck-template', 'src/deck-data.js', 'src/fonts.js', 'src/svg.js'], { maxBuffer: 64 << 20 });
  execFileSync('tar', ['-x', '-C', old], { input: archive });
  symlinkSync(path.join(ROOT, 'node_modules'), path.join(old, 'node_modules'));
  const before = (await import(pathToFileURL(path.join(old, 'src/deck-template/build.js')).href)).buildDeck;
  const text = [{ id: 't1', title: 'Gather', body: 'Collect.' }, { id: 't2', title: 'Shape', body: 'Sort.', afterMs: 900 }, { id: 't3', title: 'Share', body: 'Tell.', afterMs: 900 }];
  const slides = [...structuredClone(exampleDeck.slides), vector('diagram', undefined, { stages: vectorStages(8, i => (i ? { afterMs: 500 } : {})) }), statement('staged', undefined, { stages: text }),
    { ...vector('gallery'), vector: undefined, stages: [], gallery: [{ label: 'One', media: { type: 'image', src: 'assets/example.png', alt: 'One' } }, { label: 'Two' }], caption: 'A caption' }];
  const pair = [await open(t, browser, slides, { build: before }), await open(t, browser, slides)];
  const palette = page => page.evaluate(() => Object.fromEntries(['--paper', '--ink', '--muted', '--accent', '--line', '--active'].map(name => [name, getComputedStyle(document.documentElement).getPropertyValue(name)])));
  assert.deepEqual(await palette(pair[1]), await palette(pair[0]));
  let compared = 0;
  for (const slide of slides) {
    const shots = [];
    for (const page of pair) {
      await go(page, slide.id); await page.mouse.move(1270, 700);
      const timeline = await seek(page, 0), states = timeline.stages.length ? timeline.stages.map(s => s.motionEndMs) : [0];
      const images = [];
      for (const time of states) { await seek(page, time); images.push(await page.screenshot()); }
      shots.push(images);
    }
    assert.equal(shots[1].length, shots[0].length);
    for (const [i, image] of shots[1].entries()) { assert.ok(image.equals(shots[0][i]), `${slide.id}, stage ${i + 1}: pixel-identical`); compared++; }
  }
  assert.ok(compared >= slides.length + 10, `${compared} slide states compared`);
});

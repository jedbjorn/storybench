// Spec #44 A2 (no leftover template hue), A3 (one role changes only its surfaces) and the colour half of A6 (unset means unchanged):
// computed styles of a built deck, audience and Presenter, in Chromium and Firefox at 1280x720.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, firefox } from 'playwright-core';
import { buildDeck, deckPalette } from '../src/deck-template/build.js';
import { exampleDeck, exampleAssets } from '../src/deck-template/example.js';

// Today's template hues, as literals (main 1727f35f styles.css).
const TODAY = ['#f7f4ed', '#252c30', '#505b60', '#26686b', '#c8cecb', '#e2eae5', '#efeee7', '#dce6df', '#fffaf1', '#dfe9e2', '#e0e5e0', '#ffffff'];
const DISTINCT = { base: '#1A2B6D', accent: '#D0452B', background: '#F2EBD9' };
const rgb = hex => `rgb(${[1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;
const TRANSPARENT = 'rgba(0, 0, 0, 0)';

async function launch(type) {
  let browser = await type.launch().catch(() => null);
  if (!browser && type === chromium && existsSync('/usr/bin/chromium')) browser = await chromium.launch({ executablePath: '/usr/bin/chromium' }).catch(() => null);
  return browser;
}
function exportDeck(t, colors) {
  const dir = mkdtempSync(path.join(tmpdir(), 'sb-theme-browser-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const [name, bytes] of buildDeck({ ...structuredClone(exampleDeck), colors }, { assets: exampleAssets })) {
    mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    writeFileSync(path.join(dir, name), bytes);
  }
  return dir;
}
// Every themed surface: [label, selector, property, state]. Colours are read as computed rgb().
const SURFACES = [
  ['page text', 'body', 'color'], ['page', 'html', 'background-color'],
  ['rail', '.rail', 'background-color'], ['rail border', '.rail', 'border-right-color'],
  ['current rail item', '.rail button[aria-current]', 'background-color'], ['current rail marker', '.rail button[aria-current]', 'border-left-color'],
  ['footer', 'footer', 'background-color'], ['footer rule', 'footer', 'border-top-color'],
  ['button border', 'footer button', 'border-top-color'], ['button hover', 'footer button', 'background-color', 'hover'],
  ['skip link', '.skip', 'background-color'],
  ['eyebrow', '#welcome header', 'color'], ['title rule', '#welcome .composition', 'border-bottom-color'],
  ['section slide', '#chapter', 'background-color'], ['muted text', '#chapter .lede', 'color'],
  ['step number', '#steps .step-number', 'color'], ['stage rule', '#steps .stages section', 'border-top-color'],
  ['active stage button', '#steps .stage-steps [aria-pressed="true"]', 'background-color'], ['active stage text', '#steps .stage-steps [aria-pressed="true"]', 'color'],
  ['figure placeholder', '#detail figure img', 'background-color'],
  ['slide glow', '#welcome', 'background-image'],
];
// The template variable that colours each surface, and today's value of each variable.
const OWNER = { 'page text': '--ink', page: '--paper', rail: '--rail-fill', 'rail border': '--line', 'current rail item': '--rail-current',
  'current rail marker': '--accent', footer: '--paper', 'footer rule': '--line', 'button border': '--line', 'button hover': '--hover', 'skip link': '--skip',
  eyebrow: '--accent', 'title rule': '--accent', 'section slide': '--section', 'muted text': '--muted', 'step number': '--accent', 'stage rule': '--accent',
  'active stage button': '--active', 'active stage text': '--paper', 'figure placeholder': '--placeholder', 'slide glow': '--highlight' };
const TEMPLATE = { '--ink': '#252c30', '--paper': '#f7f4ed', '--muted': '#505b60', '--accent': '#26686b', '--line': '#c8cecb', '--hover': '#e2eae5', '--rail-fill': '#efeee7',
  '--rail-current': '#dce6df', '--highlight': '#fffaf1', '--section': '#dfe9e2', '--placeholder': '#e0e5e0', '--active': '#252c30', '--skip': '#ffffff' };
async function surfaces(page) {
  const found = {};
  for (const [label, selector, property, state] of SURFACES) {
    const slide = selector.match(/^#(\w+)/)?.[1];
    if (slide) await page.evaluate(id => { location.hash = id; }, slide);
    const node = page.locator(selector).first();
    if (slide) await node.waitFor({ state: 'visible' });
    if (state === 'hover') await node.hover(); else await page.mouse.move(1270, 10);
    found[label] = await node.evaluate((el, prop) => getComputedStyle(el).getPropertyValue(prop), property);
  }
  return found;
}
const colours = value => value.match(/rgba?\([^)]*\)/g) ?? [];

for (const type of [chromium, firefox]) test(`${type.name()}: a distinctive palette leaves no template hue; one role changes only its surfaces; no colours keeps today's palette`, { timeout: 60000 }, async t => {
  const browser = await launch(type);
  if (!browser) return t.skip(`No launchable ${type.name()} on this seat`);
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } }); page.setDefaultTimeout(5000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));

  // A2: every surface resolves to a role or a value derived from the roles; none to a template literal.
  const palette = deckPalette(DISTINCT), allowed = new Set([...Object.values(palette).map(hex => rgb(hex)), rgb(DISTINCT.background), TRANSPARENT]);
  const today = new Set(TODAY.map(rgb));
  await page.goto(pathToFileURL(path.join(exportDeck(t, DISTINCT), 'index.html')).href + '#welcome');
  const themed = await surfaces(page);
  for (const [label, value] of Object.entries(themed)) {
    assert.ok(colours(value).length, `${label} resolved a colour (${value})`);
    for (const colour of colours(value)) {
      assert.ok(allowed.has(colour), `${label}: ${colour} is a role or derived value`);
      assert.ok(!today.has(colour), `${label}: ${colour} is not a template hue`);
    }
  }
  assert.equal(themed['page text'], rgb(DISTINCT.base)); assert.equal(themed.page, rgb(DISTINCT.background));
  assert.equal(themed.eyebrow, rgb(DISTINCT.accent)); assert.equal(themed['active stage button'], rgb(DISTINCT.accent));
  assert.equal(themed['section slide'], rgb(palette['--section'])); assert.equal(themed['figure placeholder'], rgb(palette['--placeholder']));
  assert.equal(themed['button hover'], rgb(palette['--hover']));
  await page.emulateMedia({ media: 'print' });
  assert.equal(await page.locator('#welcome').evaluate(el => getComputedStyle(el).backgroundColor), rgb(DISTINCT.background), 'print page follows the background role');
  await page.emulateMedia({ media: 'screen' });
  if (process.env.STORYBENCH_COLOR_SCREENSHOT) await page.screenshot({ path: path.join(process.env.STORYBENCH_COLOR_SCREENSHOT, `deck-theme-${type.name()}.png`) });
  const presenter = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await presenter.goto(pathToFileURL(path.join(path.dirname(new URL(page.url()).pathname), 'presenter.html')).href);
  const presented = await presenter.evaluate(() => ({ text: getComputedStyle(document.body).color, page: getComputedStyle(document.documentElement).backgroundColor,
    notes: getComputedStyle(document.querySelector('#notes')).borderLeftColor, button: getComputedStyle(document.querySelector('button')).borderTopColor }));
  assert.deepEqual(presented, { text: rgb(DISTINCT.base), page: rgb(DISTINCT.background), notes: rgb(DISTINCT.accent), button: rgb(palette['--line']) });

  // A6 colour half: with no colours, every surface keeps today's literal hue.
  await page.goto(pathToFileURL(path.join(exportDeck(t, undefined), 'index.html')).href + '#welcome');
  const plain = await surfaces(page);
  assert.deepEqual(plain, {
    'page text': rgb('#252c30'), page: rgb('#f7f4ed'), rail: rgb('#efeee7'), 'rail border': rgb('#c8cecb'),
    'current rail item': rgb('#dce6df'), 'current rail marker': rgb('#26686b'), footer: rgb('#f7f4ed'), 'footer rule': rgb('#c8cecb'),
    'button border': rgb('#c8cecb'), 'button hover': rgb('#e2eae5'), 'skip link': rgb('#ffffff'),
    eyebrow: rgb('#26686b'), 'title rule': rgb('#26686b'), 'section slide': rgb('#dfe9e2'), 'muted text': rgb('#505b60'),
    'step number': rgb('#26686b'), 'stage rule': rgb('#26686b'), 'active stage button': rgb('#252c30'), 'active stage text': rgb('#f7f4ed'),
    'figure placeholder': rgb('#e0e5e0'), 'slide glow': plain['slide glow'],
  });
  assert.deepEqual(colours(plain['slide glow']), [rgb('#fffaf1'), TRANSPARENT]);
  await page.emulateMedia({ media: 'print' });
  assert.equal(await page.locator('#welcome').evaluate(el => getComputedStyle(el).backgroundColor), rgb('#ffffff'));
  await page.emulateMedia({ media: 'screen' });

  // A3: one role set changes only that role's surfaces and the hues derived from it; every other surface keeps today's value.
  for (const role of ['base', 'accent', 'background']) {
    const single = deckPalette({ [role]: DISTINCT[role] });
    await page.goto(pathToFileURL(path.join(exportDeck(t, { [role]: DISTINCT[role] }), 'index.html')).href + '#welcome');
    const found = await surfaces(page);
    for (const [label, variable] of Object.entries(OWNER)) {
      const expected = rgb(single[variable] ?? TEMPLATE[variable]);
      assert.equal(label === 'slide glow' ? colours(found[label])[0] : found[label], expected, `${role} only: ${label} (${variable})`);
    }
  }
  assert.deepEqual(errors, []);
});

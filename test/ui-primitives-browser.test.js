import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium, firefox } from 'playwright-core';
import { listenInRange } from '../test-support/loopback-port.js';
import { createApp } from '../src/server.js';

// A blank page: the app's tokens and the primitives, no app shell, no channel, no deck data.
const blankPage = `<!doctype html><html><head><meta charset="utf-8"><title>UI primitives</title>
<link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/ui/ui.css"></head><body>
<button id="before">Before</button>
<main style="display:flex;gap:24px;padding:24px;align-items:start">
  <div id="canvas" style="width:520px;height:300px;padding:16px;background:var(--card)">
    <section data-select="copy" data-select-label="Copy block" style="width:220px"><h1>Title</h1><p>Body</p></section>
    <figure data-select="visual" data-select-label="Visual" style="width:160px;height:90px;margin:0;background:var(--pale)"></figure>
    <div data-select="stages" data-select-label="Stage text" style="width:220px">One · Two</div>
  </div>
  <div id="side" style="width:300px"></div>
</main>
<script type="module">
  import { createSelectionSurface } from '/ui/selection-surface.js';
  import { createInspectorPanel } from '/ui/inspector-panel.js';
  import { createSegmentedChoice } from '/ui/segmented-choice.js';
  import { createPositionPicker } from '/ui/position-picker.js';
  import { createAlignmentGrid } from '/ui/alignment-grid.js';
  import { createDurationField } from '/ui/duration-field.js';
  import { createScopeSwitch } from '/ui/scope-switch.js';
  const log = window.log = [], note = (name) => (value) => log.push([name, value]);
  window.outsideEscapes = 0;
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') window.outsideEscapes++; });
  const scope = window.scope = createScopeSwitch({ onChange: note('scope'), onReset: () => { note('reset')(true); scope.overridden = false; } });
  const empty = () => [
    createSegmentedChoice({ label: 'Text size', options: [{ value: 'compact', label: 'Compact' }, { value: 'standard', label: 'Standard' }, { value: 'large', label: 'Large' }], onChange: note('scale') }).element,
    createDurationField({ label: 'Gap between stages', max: 60000, onChange: note('gap') }).element,
  ];
  const inspector = createInspectorPanel({ emptyTitle: 'Slide', empty });
  document.querySelector('#side').append(inspector.element);
  createSelectionSurface(document.querySelector('#canvas'), {
    onChange(key, element) {
      note('select')(key);
      if (!key) return inspector.show(null);
      inspector.show({ title: element.dataset.selectLabel, content: [
        createPositionPicker({ onChange: note('position') }).element,
        createAlignmentGrid({ onChange: note('align') }).element,
        scope.element,
      ] });
    },
  });
  window.ready = true;
</script></body></html>`;

for (const browserType of [chromium, firefox]) test(`${browserType.name()}: UI primitives mount on a blank page and meet their keyboard behaviour`, { timeout: 60000 }, async (t) => {
  let browser;
  try { browser = await browserType.launch(); }
  catch {
    if (browserType === chromium && existsSync('/usr/bin/chromium')) browser = await chromium.launch({ executablePath: '/usr/bin/chromium' });
  }
  if (!browser) return t.skip(`No launchable ${browserType.name()} on this seat`);
  t.after(() => browser.close());
  const root = mkdtempSync(path.join(tmpdir(), 'storybench-ui-primitives-'));
  const app = await createApp({ workspace: root });
  t.after(async () => { await app.close(); rmSync(root, { recursive: true, force: true }); });
  await listenInRange(app.server);
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const page = await browser.newPage({ viewport: { width: 1000, height: 640 } });
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.route(`${base}/ui-primitives-blank`, (route) => route.fulfill({ contentType: 'text/html', body: blankPage }));
  await page.goto(`${base}/ui-primitives-blank`);
  await page.waitForFunction(() => window.ready);
  const log = () => page.evaluate(() => window.log.splice(0));
  const focused = () => page.evaluate(() => document.activeElement.getAttribute('aria-label') || document.activeElement.textContent.trim());
  const token = (name) => page.evaluate((name) => {
    const probe = document.body.appendChild(document.createElement('i'));
    probe.style.color = `var(${name})`; const value = getComputedStyle(probe).color; probe.remove(); return value;
  }, name);
  const outline = (selector) => page.locator(selector).evaluate((node) => { const style = getComputedStyle(node); return [style.outlineStyle, style.outlineColor]; });
  const copy = page.locator('[data-select=copy]'), side = page.locator('#side');
  const heading = side.locator('h2');

  // Selection surface: hover and selection outlines, click to select, click off to deselect.
  assert.equal(await heading.textContent(), 'Slide');
  await copy.hover();
  assert.deepEqual(await outline('[data-select=copy]'), ['dashed', await token('--muted')]);
  await copy.click();
  assert.equal(await copy.getAttribute('aria-pressed'), 'true');
  await page.mouse.move(900, 600);
  assert.deepEqual(await outline('[data-select=copy]'), ['solid', await token('--deep')]);
  assert.equal(await heading.textContent(), 'Copy block');
  await page.locator('#canvas').click({ position: { x: 500, y: 290 } });
  assert.equal(await copy.getAttribute('aria-pressed'), 'false');
  assert.equal(await heading.textContent(), 'Slide');
  assert.deepEqual(await log(), [['select', 'copy'], ['select', null]]);

  // Keyboard: Tab reaches each element, Enter or Space selects, Escape deselects and stays inside.
  await page.focus('#before');
  await page.keyboard.press('Tab'); assert.equal(await focused(), 'Copy block');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab'); assert.equal(await focused(), 'Visual');
  await page.keyboard.press('Space');
  await page.keyboard.press('Tab'); assert.equal(await focused(), 'Stage text');
  await page.keyboard.press('Enter');
  assert.equal(await heading.textContent(), 'Stage text');
  assert.deepEqual(await outline('[data-select=stages]'), ['solid', await token('--accent')], 'Focus ring shows over the selection');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('[aria-pressed=true][data-select]').count(), 0);
  assert.equal(await page.evaluate(() => window.outsideEscapes), 0, 'Escape on the surface never reaches other handlers');
  assert.deepEqual(await log(), [['select', 'copy'], ['select', 'visual'], ['select', 'stages'], ['select', null]]);
  await page.focus('#before'); await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => window.outsideEscapes), 1);

  // Inspector is reachable by keyboard; position picker and alignment grid are one Tab stop each.
  await page.focus('[data-select=copy]'); await page.keyboard.press('Enter');
  await page.keyboard.press('Tab'); await page.keyboard.press('Tab'); await page.keyboard.press('Tab');
  assert.equal(await focused(), 'Above visual');
  assert.equal(await side.evaluate((node) => node.contains(document.activeElement)), true);
  for (const key of ['ArrowRight', 'ArrowDown', 'ArrowLeft']) await page.keyboard.press(key);
  assert.equal(await focused(), 'Left of visual');
  assert.equal(await side.locator('[role=radio][aria-checked=true]').getAttribute('aria-label'), 'Left of visual');
  await page.keyboard.press('Tab'); assert.equal(await focused(), 'Top left', 'Tab leaves the position picker in one step');
  for (const key of ['ArrowRight', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowRight', 'ArrowRight']) await page.keyboard.press(key);
  assert.equal(await focused(), 'Bottom right');
  await page.keyboard.press('Space');
  assert.deepEqual(await log(), [['select', 'copy'], ['position', 'right'], ['position', 'bottom'], ['position', 'left'],
    ['align', { align: 'center', valign: 'start' }], ['align', { align: 'center', valign: 'center' }], ['align', { align: 'center', valign: 'end' }], ['align', { align: 'end', valign: 'end' }]]);

  // Scope switch: Tab to All slides, Enter; reset hides itself and keeps focus inside the switch.
  await page.keyboard.press('Tab'); assert.equal(await focused(), 'This slide');
  await page.keyboard.press('Tab'); assert.equal(await focused(), 'All slides');
  await page.keyboard.press('Enter');
  assert.equal(await side.getByRole('button', { name: 'All slides' }).getAttribute('aria-pressed'), 'true');
  await page.evaluate(() => { window.scope.overridden = true; });
  assert.equal(await side.getByText('Changed on this slide').isVisible(), true);
  await page.keyboard.press('Tab'); assert.equal(await focused(), 'Use deck default');
  await page.keyboard.press('Enter');
  assert.equal(await side.getByRole('button', { name: 'Use deck default' }).isVisible(), false);
  assert.equal(await side.getByText('Changed on this slide').isVisible(), false);
  assert.equal(await focused(), 'All slides');
  assert.deepEqual(await log(), [['scope', 'deck'], ['reset', true]]);

  // Empty state: segmented choice and duration field.
  await page.locator('#canvas').click({ position: { x: 500, y: 290 } });
  await log();
  await side.getByRole('button', { name: 'Standard' }).focus();
  await page.keyboard.press('Space');
  assert.equal(await side.getByRole('button', { name: 'Standard' }).getAttribute('aria-pressed'), 'true');
  await page.keyboard.press('Tab'); await page.keyboard.press('Enter');
  assert.equal(await side.getByRole('button', { name: 'Large' }).getAttribute('aria-pressed'), 'true');
  assert.equal(await side.getByRole('button', { name: 'Standard' }).getAttribute('aria-pressed'), 'false');
  const gap = side.getByRole('spinbutton', { name: 'Gap between stages' });
  assert.equal(await gap.getAttribute('placeholder'), 'Default');
  await gap.fill('70000'); await page.keyboard.press('Enter');
  assert.match(await side.getByRole('alert').textContent(), /from 0 to 60,000/);
  assert.equal(await gap.getAttribute('aria-invalid'), 'true');
  await gap.fill('1500'); await page.keyboard.press('Enter');
  assert.equal(await side.locator('[role=alert]').textContent(), '');
  assert.equal(await gap.getAttribute('aria-invalid'), null);
  await gap.fill(''); await page.keyboard.press('Shift+Tab');
  assert.deepEqual(await log(), [['scale', 'standard'], ['scale', 'large'], ['gap', 1500], ['gap', null]]);

  // Every colour the primitives paint resolves to an existing :root token.
  await page.mouse.move(900, 600); await page.focus('#before'); await page.evaluate(() => document.activeElement.blur());
  await page.locator('[data-select=visual]').click(); await page.mouse.move(900, 600);
  await page.evaluate(() => { window.scope.overridden = true; document.activeElement.blur(); });
  const tokens = await page.evaluate(() => {
    const names = [...document.styleSheets].flatMap((sheet) => [...sheet.cssRules]).filter((rule) => rule.selectorText === ':root')
      .flatMap((rule) => [...rule.style]).filter((name) => name.startsWith('--'));
    return Object.fromEntries(names.map((name) => {
      const probe = document.body.appendChild(document.createElement('i'));
      probe.style.color = `var(${name})`; const value = getComputedStyle(probe).color; probe.remove(); return [value, name];
    }));
  });
  const painted = await page.evaluate(() => {
    const out = [];
    const read = (node, props) => { const style = getComputedStyle(node); for (const prop of props) out.push([node.className || node.tagName, prop, style[prop]]); };
    for (const node of document.querySelectorAll('#side *')) {
      if (!node.getClientRects().length) continue;
      read(node, ['color', 'backgroundColor']);
      if (getComputedStyle(node).borderTopStyle !== 'none') read(node, ['borderTopColor']);
    }
    read(document.querySelector('[aria-pressed=true][data-select]'), ['outlineColor']);
    return out;
  });
  assert.ok(painted.length > 40);
  for (const [where, prop, value] of painted)
    assert.ok(value === 'rgba(0, 0, 0, 0)' || tokens[value], `${where} ${prop} ${value} is a :root token`);
  if (process.env.STORYBENCH_EVIDENCE_DIR) await page.screenshot({ path: path.join(process.env.STORYBENCH_EVIDENCE_DIR, `ui-primitives-${browserType.name()}.png`) });
  assert.deepEqual(errors, []);
});

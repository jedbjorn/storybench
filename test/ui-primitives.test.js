import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { createSelectionSurface } from '../public/ui/selection-surface.js';
import { createInspectorPanel } from '../public/ui/inspector-panel.js';
import { createSegmentedChoice } from '../public/ui/segmented-choice.js';
import { createPositionPicker } from '../public/ui/position-picker.js';
import { createAlignmentGrid } from '../public/ui/alignment-grid.js';
import { createDurationField } from '../public/ui/duration-field.js';
import { createScopeSwitch } from '../public/ui/scope-switch.js';

const uiDir = new URL('../public/ui/', import.meta.url);
function blank(t, html = '') {
  const dom = new JSDOM(`<!doctype html><body>${html}</body>`);
  t.after(() => dom.window.close());
  const doc = dom.window.document;
  const key = (node, key) => node.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  return { doc, win: dom.window, key };
}

test('selection surface selects by click, Enter and Space, and deselects by empty click and Escape', (t) => {
  const { doc, win, key } = blank(t, '<div id="canvas"><section data-select="copy" data-select-label="Copy block"><h1>Title</h1></section><figure data-select="visual" data-select-label="Visual"></figure><p id="empty">gap</p></div>');
  const canvas = doc.querySelector('#canvas'), copy = doc.querySelector('[data-select=copy]'), visual = doc.querySelector('[data-select=visual]');
  const changes = [], events = [];
  canvas.addEventListener('sb-selectionchange', (event) => events.push(event.detail.key));
  const surface = createSelectionSurface(canvas, { onChange: (selected, element) => changes.push([selected, element?.dataset.select]) });
  assert.deepEqual([copy.getAttribute('role'), copy.tabIndex, copy.getAttribute('aria-label'), copy.getAttribute('aria-pressed')], ['button', 0, 'Copy block', 'false']);

  doc.querySelector('h1').click();
  assert.equal(surface.selected, 'copy');
  assert.equal(copy.getAttribute('aria-pressed'), 'true');
  doc.querySelector('#empty').click();
  assert.equal(surface.selected, null);
  assert.equal(copy.getAttribute('aria-pressed'), 'false');

  key(visual, 'Enter'); assert.equal(surface.selected, 'visual');
  key(copy, ' '); assert.equal(surface.selected, 'copy');
  let outside = 0; doc.addEventListener('keydown', () => outside++);
  const escape = new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  copy.dispatchEvent(escape);
  assert.equal(surface.selected, null);
  assert.equal(escape.defaultPrevented, true);
  key(copy, 'Escape');
  assert.equal(surface.selected, null, 'Escape with nothing selected changes nothing');
  assert.equal(outside, 0, 'Escape inside the surface never reaches other handlers');
  key(copy, 'a'); assert.equal(outside, 1, 'Other keys still bubble');
  assert.deepEqual(changes, [['copy', 'copy'], [null, undefined], ['visual', 'visual'], ['copy', 'copy'], [null, undefined]]);
  assert.deepEqual(events, ['copy', null, 'visual', 'copy', null]);

  surface.select('visual');
  const rendered = doc.createElement('figure'); rendered.dataset.select = 'visual';
  visual.replaceWith(rendered); surface.refresh();
  assert.equal(surface.selected, 'visual', 'Selection survives a re-render of the same key');
  assert.equal(doc.querySelector('[data-select=visual]').getAttribute('aria-pressed'), 'true');
  doc.querySelector('[data-select=visual]').remove(); surface.refresh();
  assert.equal(surface.selected, null, 'A vanished selection clears');
  surface.select('missing'); assert.equal(surface.selected, null);
  surface.destroy(); copy.click();
  assert.equal(surface.selected, null);
});

test('inspector panel follows the selection and returns to its empty state', (t) => {
  const { doc } = blank(t);
  let renders = 0;
  const inspector = createInspectorPanel({ doc, emptyTitle: 'Slide', empty: () => { renders++; return [doc.createElement('button'), 'Slide-wide'] } });
  doc.body.append(inspector.element);
  const heading = inspector.element.querySelector('h2');
  assert.equal(inspector.element.getAttribute('aria-labelledby'), heading.id);
  assert.equal(heading.textContent, 'Slide');
  assert.equal(inspector.element.classList.contains('sb-inspector-empty'), true);
  assert.equal(renders, 1);
  const input = doc.createElement('input');
  inspector.show({ title: 'Copy block', content: input });
  assert.equal(heading.textContent, 'Copy block');
  assert.equal(inspector.element.classList.contains('sb-inspector-empty'), false);
  inspector.focus(); assert.equal(doc.activeElement, input);
  inspector.show({ title: 'Visual', content: 'Nothing to change' });
  inspector.focus(); assert.equal(doc.activeElement, heading, 'Focus falls back to the title');
  inspector.show(null);
  assert.equal(renders, 2, 'The empty state renders fresh nodes each time');
  assert.match(inspector.element.textContent, /Slide-wide/);
  assert.equal(createInspectorPanel({ doc }).element.textContent, 'Nothing selectedSelect an element to change it.');
});

test('segmented choice presses exactly one option and reports changes once', (t) => {
  const { doc } = blank(t);
  const changes = [];
  const choice = createSegmentedChoice({ doc, label: 'Stage text', value: null, onChange: (value) => changes.push(value),
    options: [{ value: 'chips', label: 'Chips' }, { value: 'list', label: 'List' }, { value: false, label: 'Plain' }] });
  doc.body.append(choice.element);
  const buttons = [...choice.element.querySelectorAll('button')];
  assert.equal(choice.element.getAttribute('role'), 'group');
  assert.equal(choice.element.getAttribute('aria-label'), 'Stage text');
  assert.deepEqual(buttons.map((button) => button.getAttribute('aria-pressed')), ['false', 'false', 'false']);
  buttons[1].click(); buttons[1].click(); buttons[2].click();
  assert.deepEqual(changes, ['list', false]);
  assert.deepEqual(buttons.map((button) => button.getAttribute('aria-pressed')), ['false', 'false', 'true']);
  choice.value = 'chips';
  assert.equal(changes.length, 2, 'Setting the value does not fire onChange');
  assert.equal(buttons[0].getAttribute('aria-pressed'), 'true');
  choice.focus(); assert.equal(doc.activeElement, buttons[0]);
});

test('position picker is one tab stop and arrow keys go straight to each side', (t) => {
  const { doc, key } = blank(t);
  const changes = [];
  const picker = createPositionPicker({ doc, onChange: (side) => changes.push(side) });
  doc.body.append(picker.element);
  const radio = (side) => picker.element.querySelector(`[data-value=${side}]`);
  assert.equal(picker.element.getAttribute('role'), 'radiogroup');
  assert.deepEqual([...picker.element.querySelectorAll('[role=radio]')].map((node) => [node.getAttribute('aria-label'), node.tabIndex]),
    [['Above visual', 0], ['Left of visual', -1], ['Right of visual', -1], ['Below visual', -1]]);
  radio('top').focus();
  key(doc.activeElement, 'ArrowRight');
  assert.equal(doc.activeElement, radio('right'));
  key(doc.activeElement, 'ArrowDown');
  key(doc.activeElement, 'ArrowLeft');
  key(doc.activeElement, 'ArrowUp');
  assert.deepEqual(changes, ['right', 'bottom', 'left', 'top']);
  assert.equal(picker.value, 'top');
  assert.deepEqual([...picker.element.querySelectorAll('[role=radio]')].map((node) => node.getAttribute('aria-checked')), ['true', 'false', 'false', 'false']);
  key(doc.activeElement, 'ArrowUp');
  assert.equal(changes.length, 4, 'Choosing the current side again is not a change');
  radio('bottom').click();
  assert.equal(radio('bottom').tabIndex, 0);
  assert.equal(radio('top').tabIndex, -1);
  picker.value = null;
  assert.equal(radio('top').tabIndex, 0, 'Unset leaves the first side as the tab stop');
});

test('alignment grid sets align and valign together and arrows stop at the edges', (t) => {
  const { doc, key } = blank(t);
  const changes = [];
  const grid = createAlignmentGrid({ doc, value: { align: 'center', valign: 'center' }, onChange: (value) => changes.push(value) });
  doc.body.append(grid.element);
  const cells = [...grid.element.querySelectorAll('[role=radio]')];
  assert.deepEqual(cells.map((node) => node.getAttribute('aria-label')),
    ['Top left', 'Top centre', 'Top right', 'Middle left', 'Centred', 'Middle right', 'Bottom left', 'Bottom centre', 'Bottom right']);
  assert.deepEqual(cells.map((node) => node.tabIndex), [-1, -1, -1, -1, 0, -1, -1, -1, -1]);
  grid.focus();
  key(doc.activeElement, 'ArrowDown');
  key(doc.activeElement, 'ArrowRight');
  key(doc.activeElement, 'ArrowRight');
  key(doc.activeElement, 'ArrowDown');
  assert.deepEqual(changes, [{ align: 'center', valign: 'end' }, { align: 'end', valign: 'end' }]);
  assert.equal(doc.activeElement.getAttribute('aria-label'), 'Bottom right');
  cells[0].click();
  assert.deepEqual(grid.value, { align: 'start', valign: 'start' });
  grid.value = { align: 'start', valign: null };
  assert.equal(grid.value, null, 'A half-set value checks no cell');
  assert.equal(cells[0].tabIndex, 0);
  assert.equal(changes.length, 3);
});

test('duration field accepts bounded whole milliseconds, empty as default, and refuses the rest', (t) => {
  const { doc, win, key } = blank(t);
  const changes = [];
  const field = createDurationField({ doc, label: 'Flip time', max: 2000, value: 600, onChange: (value) => changes.push(value) });
  doc.body.append(field.element);
  const { input } = field, error = field.element.querySelector('[role=alert]');
  assert.equal(field.element.querySelector('label').control, input);
  assert.deepEqual([input.type, input.min, input.max, input.value, input.placeholder], ['number', '0', '2000', '600', 'Default']);
  assert.match(input.getAttribute('aria-describedby'), /-unit .*-error$/);
  const enter = (text) => { input.value = text; input.dispatchEvent(new win.Event('change', { bubbles: true })); };
  enter('2500');
  assert.match(error.textContent, /from 0 to 2,000/);
  assert.equal(input.getAttribute('aria-invalid'), 'true');
  enter('12.5'); assert.match(error.textContent, /whole milliseconds/);
  assert.equal(field.value, 600);
  enter('1500');
  assert.equal(error.textContent, ''); assert.equal(input.hasAttribute('aria-invalid'), false);
  input.value = '0'; key(input, 'Enter');
  enter('');
  assert.deepEqual(changes, [1500, 0, null]);
  enter(''); assert.equal(changes.length, 3, 'An unchanged value is not reported again');
  input.value = '700'; key(input, 'Enter'); input.value = ''; input.dispatchEvent(new win.FocusEvent('blur'));
  assert.deepEqual(changes.slice(3), [700, null], 'Leaving the field commits an edit made after Enter');
  field.value = 900;
  assert.equal(input.value, '900'); assert.equal(changes.length, 5);
  const big = createDurationField({ doc, label: 'Gap', min: 0, max: 60000 });
  big.input.value = '-5'; big.input.dispatchEvent(new win.Event('change'));
  assert.match(big.element.textContent, /from 0 to 60,000/);
});

test('scope switch toggles slide and deck, marks an override and moves focus off a spent reset', (t) => {
  const { doc } = blank(t);
  const changes = []; let resets = 0;
  const scope = createScopeSwitch({ doc, onChange: (value) => changes.push(value), onReset: () => { resets++; scope.overridden = false; } });
  doc.body.append(scope.element);
  const [slide, deck] = scope.element.querySelectorAll('[role=group] button');
  const marker = scope.element.querySelector('.sb-scope-marker'), reset = scope.element.querySelector('.sb-scope-reset');
  assert.deepEqual([slide.textContent, deck.textContent, scope.value], ['This slide', 'All slides', 'slide']);
  assert.equal(slide.getAttribute('aria-pressed'), 'true');
  assert.equal(marker.hidden && reset.hidden, true);
  deck.click(); slide.click();
  assert.deepEqual(changes, ['deck', 'slide']);
  scope.overridden = true;
  assert.equal(marker.hidden || reset.hidden, false);
  assert.equal(marker.textContent, 'Changed on this slide');
  assert.equal(reset.textContent, 'Use deck default');
  reset.focus(); reset.click();
  assert.equal(resets, 1);
  assert.equal(reset.hidden, true);
  assert.equal(doc.activeElement, slide);
  const custom = createScopeSwitch({ doc, value: 'deck', overridden: true, labels: { slide: 'This scene', deck: 'Every scene' } });
  assert.deepEqual([...custom.element.querySelectorAll('[role=group] button')].map((node) => [node.textContent, node.getAttribute('aria-pressed')]),
    [['This scene', 'false'], ['Every scene', 'true']]);
});

test('primitives depend on nothing outside the UI module and style only with existing tokens', () => {
  const files = readdirSync(uiDir);
  for (const file of files.filter((name) => name.endsWith('.js'))) {
    const source = readFileSync(new URL(file, uiDir), 'utf8');
    for (const [, from] of source.matchAll(/from\s+'([^']+)'/g)) assert.match(from, /^\.\/[a-z-]+\.js$/, `${file} imports only sibling primitives`);
    assert.doesNotMatch(source, /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|\.style\.(?!gridArea)/i, `${file} sets no colours or inline styles`);
    assert.doesNotMatch(source, /fetch\(|\/api\/|localStorage|storybench/i, `${file} reads no app or deck data`);
  }
  const tokens = new Set([...readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8').match(/:root\s*{[^}]*}/)[0].matchAll(/(--[a-z-]+)\s*:/g)].map((match) => match[1]));
  const css = readFileSync(new URL('ui.css', uiDir), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const used = [...css.matchAll(/var\((--[a-z-]+)\)/g)].map((match) => match[1]);
  assert.ok(used.length > 10);
  for (const token of used) assert.ok(tokens.has(token), `${token} is an existing :root token`);
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|\b(white|black|red|blue|green|gray|grey)\b/i, 'ui.css has no colour literals');
  assert.doesNotMatch(css, /^\s*--/m, 'ui.css defines no tokens of its own');
  assert.ok(files.includes('README.md'), 'The module carries its usage note');
});

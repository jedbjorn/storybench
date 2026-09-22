import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { installSelectControls } from '../public/select-control.js';
import { installWorkspaceChrome } from '../public/workspace-chrome.js';
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test('shared selects preserve forms and change handlers with accessible keyboard choices', async (t) => {
  const dom = new JSDOM('<form><label>Stage<select name="stage"><option>Scaffold</option><option disabled>Draft</option><option>Final</option></select></label><input id="next"></form>');
  const doc = dom.window.document, controls = installSelectControls(doc);
  t.after(() => { controls.destroy(); dom.window.close(); });
  const field = doc.querySelector('select'), trigger = doc.querySelector('[role=combobox]');
  let changed = 0; field.addEventListener('change', () => changed++);
  assert.equal(trigger.getAttribute('aria-label'), 'Stage');
  const key = (key) => trigger.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key, bubbles: true }));
  trigger.click(); key('ArrowDown'); key('Enter');
  assert.equal(field.value, 'Final'); assert.equal(changed, 1);
  assert.equal(new dom.window.FormData(doc.querySelector('form')).get('stage'), 'Final');
  trigger.click(); key('Home'); key('Escape');
  assert.equal(field.value, 'Final'); assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  trigger.click(); key('s'); key('Enter'); assert.equal(field.value, 'Scaffold');
  field.innerHTML = '<option>Published</option>'; await tick(); assert.equal(trigger.textContent, 'Published');
  field.disabled = true; await tick(); assert.equal(trigger.disabled, true);
  field.disabled = false; await tick(); trigger.click(); doc.querySelector('#next').focus();
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  field.closest('label').remove(); await tick(); assert.equal(doc.querySelector('[role=listbox]'), null);
});

test('editable model combobox filters suggestions and preserves exact unlisted IDs', async (t) => {
  const dom = new JSDOM('<label>Model<input name="model" list="models"></label><datalist id="models"><option value="model-a">Model A</option><option value="model-b">Model B</option></datalist>');
  const doc = dom.window.document, controls = installSelectControls(doc);
  t.after(() => { controls.destroy(); dom.window.close(); });
  const input = doc.querySelector('input'); input.value = 'model-b'; input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  assert.equal(doc.querySelectorAll('[role=option]').length, 1);
  doc.querySelector('[role=option]').click(); assert.equal(input.value, 'model-b');
  input.value = 'exact-custom-model'; input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
  assert.equal(input.value, 'exact-custom-model'); assert.equal(input.hasAttribute('list'), false);
});

test('Episodes collapse preference survives reload and exposes a labelled reopen control', () => {
  const dom = new JSDOM('<main id="episodesPage"><button id="episodeRailToggle"></button></main>', { url: 'http://localhost' });
  installWorkspaceChrome(dom.window.document);
  const toggle = dom.window.document.querySelector('button'); toggle.click();
  assert.equal(dom.window.localStorage.getItem('storybench.episodesCollapsed'), 'true');
  assert.equal(toggle.getAttribute('aria-label'), 'Expand Episodes');
  assert.equal(toggle.getAttribute('aria-expanded'), 'false'); dom.window.close();
});

// Spec #46 task #126, Slide list and editor shell. E3, the editor half in the local suite: for each of
// the seven slide types the editor shows exactly the slots of the Slide Types table; changing type
// hides and keeps values and changing back restores them; a saved slide using a combination the editor
// does not offer loads, renders and saves unchanged. Also the slide card's summary (part of E1).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { Store } from '../src/store.js';
import { createDeckService } from '../src/deck-service.js';
import { SLIDE_TYPES } from '../public/slide-types.js';
import { slideFieldsHTML, bindSlideFields, slideListHTML, layoutOptions, hiddenValues } from '../public/deck-workspace.js';

// The Slide Types table, as the editor's slots. Every type has copy and steps; More (notes, minutes,
// story section) is not a slot of the table and always shows.
const TABLE = {
  title: ['copy', 'drawing', 'steps'],
  section: ['copy', 'steps'],
  statement: ['copy', 'steps'],
  'text-media': ['copy', 'media', 'drawing', 'gallery', 'steps'],
  columns: ['copy', 'columns', 'steps'],
  'full-media': ['copy', 'media', 'drawing', 'gallery', 'steps'],
  process: ['copy', 'drawing', 'steps'],
};
// The control that proves each slot is there.
const CONTROL = { copy: '[data-slide-field="title"]', media: '[data-slide-field="mediaItemId"]', drawing: '[data-slide-field="vectorItemId"]',
  gallery: '[data-slide-action="add-subnav"]', columns: '[data-slide-action="add-columns"]', steps: '[data-slide-action="add-stages"]' };

function editor(slides, items = []) {
  const dom = new JSDOM('<main></main>'), root = dom.window.document.querySelector('main');
  const render = () => { root.innerHTML = `<div data-slide-index="0"><select data-slide-field="layout">${layoutOptions(slides[0].layout)}</select>${slideFieldsHTML(slides[0], 0, items, [])}</div>`; };
  render();
  bindSlideFields(root, { getSlides: () => slides, onDirty() {}, onSave() {}, render });
  const slots = () => [...root.querySelectorAll('[data-slot]')].map(node => node.dataset.slot);
  const choose = (selector, value) => {
    const field = root.querySelector(selector); field.value = value;
    for (const name of ['input', 'change']) field.dispatchEvent(new dom.window.Event(name, { bubbles: true }));
  };
  return { dom, root, slots, choose };
}

test('E3: for each of the seven types the editor shows exactly the slots of the Slide Types table', t => {
  assert.deepEqual(Object.keys(TABLE).sort(), Object.keys(SLIDE_TYPES).sort());
  for (const [layout, expected] of Object.entries(TABLE)) {
    const { dom, root, slots } = editor([{ id: 'one', title: 'One', layout, body: '' }]);
    t.after(() => dom.window.close());
    assert.deepEqual(slots(), [...expected, 'more'], layout);
    for (const [slot, selector] of Object.entries(CONTROL)) assert.equal(Boolean(root.querySelector(selector)), expected.includes(slot), `${layout}: ${slot}`);
    assert.equal(root.querySelector('[data-hidden-count]'), null, `${layout}: nothing hidden`);
    // The layout choice names every type by its plain name.
    assert.equal(root.querySelector('[data-slide-field="layout"]').selectedOptions[0].textContent, SLIDE_TYPES[layout].label);
  }
});

test('E3: changing type hides values the new type has no slot for, keeps them saved, and changing back restores them', t => {
  const items = [{ id: 'photo', label: 'Photo', asset: { kind: 'image', metadata: { contentType: 'image/png' } } }];
  const slides = [{ id: 'one', title: 'Media slide', layout: 'text-media', body: 'Body', media: { itemId: 'photo', alt: 'A photo' },
    subnav: [{ id: 'view', label: 'Detail', itemId: 'photo' }] }];
  const { dom, root, slots, choose } = editor(slides, items);
  t.after(() => dom.window.close());
  const before = structuredClone(slides[0]);
  choose('[data-slide-field="layout"]', 'columns');
  assert.deepEqual(slots(), ['copy', 'columns', 'steps', 'more']);
  assert.equal(root.querySelector('[data-hidden-count]').dataset.hiddenCount, '2');
  assert.match(root.querySelector('[data-hidden-count]').textContent, /2 saved values hidden by this layout \(media, gallery\)/);
  assert.deepEqual({ ...slides[0], layout: 'text-media' }, before, 'only the layout changed; media and gallery are kept');
  choose('[data-slide-field="layout"]', 'text-media');
  assert.deepEqual(slides[0], before);
  assert.equal(root.querySelector('[data-hidden-count]'), null);
  assert.equal(root.querySelector('[data-slide-field="mediaItemId"]').value, 'photo');
  assert.equal(root.querySelector('[data-slide-field="mediaAlt"]').value, 'A photo');
  assert.equal(root.querySelector('[data-part="subnav"] [data-slide-field="label"]').value, 'Detail');
});

test('E3: a saved slide using a combination the editor does not offer loads, renders and saves unchanged', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sb-slide-editor-'));
  const store = new Store(root), decks = createDeckService({ store });
  t.after(async () => { await decks.close(); store.close(); await rm(root, { recursive: true, force: true }); });
  const deck = store.createEpisode({ kind: 'deck', title: 'Unoffered' });
  store.ensureEpisodeDirectories(deck.id);
  // A gallery on a Statement: today's code accepts it; the editor offers a gallery only on media types.
  const saved = store.saveDeck(deck.id, 1, [{ id: 'quote', title: 'A statement with views', layout: 'statement', body: 'Said once.',
    subnav: [{ id: 'a', label: 'First view' }, { id: 'b', label: 'Second view' }] }]);
  const slide = saved.slides[0];
  assert.deepEqual(hiddenValues(slide), ['gallery']);
  // Renders: the canvas build of the slide shows its gallery as the bundle would.
  const html = String(await decks.canvasFile(deck.id, saved.revision, 'quote', 'index.html'));
  assert.match(html, /<article class="slide layout-statement" id="quote"/);
  assert.match(html, /data-gallery="1">Second view</);
  // The editor shows it, with the gallery hidden and counted; an edit elsewhere saves the gallery unchanged.
  const slides = structuredClone(saved.slides);
  const { dom, root: panel, slots } = editor(slides);
  t.after(() => dom.window.close());
  assert.deepEqual(slots(), ['copy', 'steps', 'more']);
  assert.equal(panel.querySelector('[data-hidden-count]').dataset.hiddenCount, '1');
  const title = panel.querySelector('[data-slide-field="title"]');
  title.value = 'A statement, retitled';
  title.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  const next = store.saveDeck(deck.id, saved.revision, slides);
  assert.deepEqual(next.slides[0], { ...slide, title: 'A statement, retitled' });
  assert.deepEqual(store.saveDeck(deck.id, next.revision, structuredClone(next.slides)).slides, next.slides, 'saving it again changes nothing');
});

test('E1 (local half): a slide card shows its number, title, the body first line, pills and warnings', t => {
  const items = [{ id: 'plan', label: 'Plan', asset: { kind: 'image', metadata: { contentType: 'image/svg+xml', svgGroupIds: ['observe', 'connect'] } } }];
  const slides = [
    { id: 'one', title: 'Opening', layout: 'title', body: '\n  The first line\nThe second line' },
    { id: 'two', title: 'Plan', layout: 'process', body: '', vector: { itemId: 'plan', alt: '' },
      stages: [{ id: 'a', title: 'A', svgGroupIds: ['observe'] }, { id: 'b', title: 'B', svgGroupIds: ['route-a'] }], candidates: [{ itemId: 'other', alt: '' }] },
    { id: 'three', title: 'Gone', layout: 'text-media', body: 'Media', media: { itemId: 'missing', alt: '' } },
    { id: 'four', title: 'Unpicked', layout: 'text-media', body: 'Media', candidates: [{ itemId: 'plan', alt: '' }] },
  ];
  const dom = new JSDOM(`<main>${slideListHTML(slides, items, 'two')}</main>`);
  t.after(() => dom.window.close());
  const cards = [...dom.window.document.querySelectorAll('.slide-card')];
  const text = (card, selector) => card.querySelector(selector)?.textContent.trim();
  assert.deepEqual(cards.map(card => text(card, '.slide-number')), ['01', '02', '03', '04']);
  assert.deepEqual(cards.map(card => text(card, '.slide-card-summary strong')), ['Opening', 'Plan', 'Gone', 'Unpicked']);
  assert.equal(text(cards[0], '.slide-card-summary span'), 'The first line');
  assert.deepEqual([...cards[1].querySelectorAll('.slide-pill:not(.warn)')].map(node => node.textContent), ['Process', 'Drawing', '2 steps', '2 candidates']);
  assert.equal(text(cards[1], '[data-slide-warning]'), 'A step reveals nothing');
  assert.equal(text(cards[2], '[data-slide-warning]'), 'Missing media');
  assert.equal(text(cards[3], '[data-slide-warning]'), 'No pick for the visual');
  assert.equal(cards[0].querySelector('[data-slide-warning]'), null);
  // One card is open: only it holds the inline slide and its Play and Edit slide.
  assert.deepEqual(cards.map(card => card.classList.contains('is-open')), [false, true, false, false]);
  assert.equal(dom.window.document.querySelectorAll('[data-slide-edit]').length, 1);
  assert.ok(cards[1].querySelector('[data-slide-action="edit"]') && cards[1].querySelector('.slide-card-foot [data-slide-action="play"]'));
  // Until the library loads, nothing is reported missing.
  const loading = new JSDOM(slideListHTML(slides, null, null));
  t.after(() => loading.window.close());
  assert.equal(loading.window.document.querySelectorAll('[data-slide-warning]').length, 1, 'only the unpicked candidate warns');
});

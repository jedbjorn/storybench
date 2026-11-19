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
import { slideListHTML, slideWarnings, layoutOptions } from '../public/deck-workspace.js';
import { elementCardsHTML, bindElementCards, hiddenValues } from '../public/element-cards.js';
import { askFromSlideText } from '../public/deck-library.js';
import { validateVectorStages } from '../src/deck-data.js';

// The Slide Types table, as the editor's element cards. Every type has copy (Title and Body) and steps;
// More (notes, minutes, story section) is not a slot of the table and always shows. The Visual card
// names what the type's visual slot offers.
const TABLE = {
  title: [['copy', 'visual', 'steps'], 'drawing'],
  section: [['copy', 'steps'], ''],
  statement: [['copy', 'steps'], ''],
  'text-media': [['copy', 'visual', 'steps'], 'image video drawing gallery'],
  columns: [['copy', 'columns', 'steps'], ''],
  'full-media': [['copy', 'visual', 'steps'], 'image video drawing gallery'],
  process: [['copy', 'visual', 'steps'], 'drawing'],
};
const CARDS = { copy: ['title', 'body'], visual: ['visual'], columns: ['columns'], steps: [] };

function editor(slides, items = [], { design = {}, onReplay = () => {}, gallery = false, onDrawingPick } = {}) {
  const dom = new JSDOM('<main></main>'), root = dom.window.document.querySelector('main');
  const notices = [], saves = [], asks = [], galleries = new Set(gallery ? [slides[0].id] : []);
  let notice = null;
  const render = () => { root.innerHTML = `<div data-slide-index="0"><select data-slide-field="layout">${layoutOptions(slides[0].layout)}</select>${elementCardsHTML(slides[0], 0, { items, sections: [], design, notice, gallery: galleries.has(slides[0].id) })}</div>`; };
  render();
  bindElementCards(root, { getSlides: () => slides, getItems: () => items, onDirty() { notice = null; }, onSave() { saves.push(structuredClone(slides[0])); }, render, onReplay, onDrawingPick, onAskForAnother: text => asks.push(text),
    notify(card, text) { notice = { card, text }; notices.push(text); render(); }, isGallery: id => galleries.has(id), onGalleryMode(id, on) { if (on) galleries.add(id); else galleries.delete(id); } });
  const slots = () => [...new Set([...root.querySelectorAll('[data-card], [data-card-group]')].map(node => {
    const key = node.dataset.card || node.dataset.cardGroup;
    return key.startsWith('step:') ? 'steps' : ['title', 'body'].includes(key) ? 'copy' : key;
  }))];
  const choose = (selector, value) => {
    const field = root.querySelector(selector); field.value = value;
    for (const name of ['input', 'change']) field.dispatchEvent(new dom.window.Event(name, { bubbles: true }));
  };
  const click = selector => root.querySelector(selector).dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  return { dom, root, slots, choose, click, notices, saves, asks };
}

test('E3: for each of the seven types the editor shows exactly the slots of the Slide Types table', t => {
  assert.deepEqual(Object.keys(TABLE).sort(), Object.keys(SLIDE_TYPES).sort());
  for (const [layout, [expected, visual]] of Object.entries(TABLE)) {
    const { dom, root, slots } = editor([{ id: 'one', title: 'One', layout, body: '' }]);
    t.after(() => dom.window.close());
    assert.deepEqual(slots(), [...expected, 'more'], layout);
    for (const [slot, cards] of Object.entries(CARDS)) for (const key of cards) assert.equal(Boolean(root.querySelector(`[data-card="${key}"]`)), expected.includes(slot), `${layout}: ${key}`);
    assert.equal(root.querySelector('[data-card="visual"]')?.dataset.visualKinds ?? '', visual, `${layout}: what the visual offers`);
    assert.equal(Boolean(root.querySelector('[data-slide-action="add-columns"]')), expected.includes('columns'), `${layout}: Add column`);
    assert.ok(root.querySelector('[data-add-element] option[value="step"]'), `${layout}: Add element offers a step`);
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
  // The Visual card shows both picks starred (media and the gallery view), the description and the view's label.
  assert.deepEqual([...root.querySelectorAll('[data-candidate-star][aria-pressed="true"]')].map(node => node.dataset.candidateStar), ['photo', 'photo']);
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
  assert.equal(text(cards[1], '[data-slide-warning]'), 'v1 has no part route-a, so a step reveals nothing.');
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

// Spec #46 task #127, element cards. E4 (local half): presets write the table's exact values, a value
// matching no preset shows as Custom, the decision #119 gap locks Starts and Wait before after the first
// step, and the parts table gives each part one place. E8 (editor half): star = pick, a starred
// candidate cannot be removed, and a drawing lacking a stepped part warns and refuses the star.
const DRAWING = (id, parts, iteration = 1) => ({ id, label: 'Floor plan', iteration, episodeId: 'e', asset: { kind: 'image', metadata: { contentType: 'image/svg+xml', svgGroupIds: parts } } });
const PHOTO = id => ({ id, label: `Photo ${id}`, episodeId: 'e', asset: { kind: 'image', metadata: { contentType: 'image/png' } } });
const stepRow = (root, i, key) => root.querySelector(`[data-part="stages"][data-part-index="${i}"] [data-step-row="${key}"]`);
const pressedIn = row => [...row.querySelectorAll('[aria-pressed="true"]')].map(node => node.textContent);

test('E4: Speed and Wait before write the exact table values; an unlisted value shows as Custom; a change asks for a replay', t => {
  const replays = [];
  const slides = [{ id: 's', title: 'Steps', layout: 'statement', body: '', stages: [{ id: 'a', title: 'A', body: '' }, { id: 'b', title: 'B', body: '', durationMs: 1200, afterMs: 700, trigger: 'auto' }] }];
  const { dom, root, click, saves } = editor(slides, [], { onReplay: i => replays.push(i) });
  t.after(() => dom.window.close());
  // The agent's 1200 ms shows as Custom 1.2 s, its 700 ms wait as Custom 0.7 s; an unset speed is Standard.
  assert.deepEqual(pressedIn(stepRow(root, 1, 'durationMs')), ['Custom 1.2 s']);
  assert.deepEqual(pressedIn(stepRow(root, 1, 'afterMs')), ['Custom 0.7 s']);
  assert.deepEqual(pressedIn(stepRow(root, 0, 'durationMs')), []);
  assert.match(stepRow(root, 0, 'durationMs').textContent, /Standard/);
  assert.deepEqual(pressedIn(stepRow(root, 0, 'afterMs')), ['None']);
  assert.deepEqual(pressedIn(stepRow(root, 0, 'trigger')), ['On click']);
  click('[data-part-index="1"] [data-step-set="durationMs"][data-value="1600"]');
  assert.equal(slides[0].stages[1].durationMs, 1600);
  assert.deepEqual(pressedIn(stepRow(root, 1, 'durationMs')), ['Slow']);
  click('[data-part-index="0"] [data-step-set="afterMs"][data-value="300"]');
  assert.equal(slides[0].stages[0].afterMs, 300);
  // Waiting never changes how a step starts: the unset trigger is pinned to On click.
  assert.equal(slides[0].stages[0].trigger, 'manual');
  click('[data-part-index="0"] [data-step-set="trigger"][data-value="auto"]');
  assert.equal(slides[0].stages[0].trigger, 'auto');
  // Choosing the value already set changes nothing.
  click('[data-part-index="0"] [data-step-set="trigger"][data-value="auto"]');
  assert.deepEqual(replays, [1, 0, 0]);
  assert.equal(saves.length, 3);
  for (const [label, ms] of [['Fast', 400], ['Medium', 800], ['Slow', 1600]]) assert.equal(stepRow(root, 0, 'durationMs').querySelector(`[data-value="${ms}"]`).textContent, label);
  for (const [label, ms] of [['None', 0], ['Short', 300], ['Medium', 1000], ['Long', 2500]]) assert.equal(stepRow(root, 0, 'afterMs').querySelector(`[data-value="${ms}"]`).textContent, label);
});

test('E4: with the gap between stages set, Starts and Wait before after the first step are set by it and cannot be changed', t => {
  const slides = [{ id: 's', title: 'Steps', layout: 'statement', body: '', stages: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }, { id: 'c', title: 'C' }] }];
  for (const [design, own] of [[{ timing: { betweenMs: 400 } }, undefined], [{}, { timing: { betweenMs: 0 } }]]) {
    slides[0].design = own;
    const { dom, root } = editor(slides, [], { design });
    t.after(() => dom.window.close());
    for (const key of ['trigger', 'afterMs']) {
      assert.equal(stepRow(root, 0, key).querySelector('[data-locked]'), null, 'the first step is free');
      for (const i of [1, 2]) {
        assert.equal(stepRow(root, i, key).querySelector('[data-locked]').textContent, 'Set by the gap between stages');
        assert.ok([...stepRow(root, i, key).querySelectorAll('button')].every(button => button.disabled), `step ${i + 1} ${key} is disabled`);
      }
    }
    assert.ok(![...stepRow(root, 1, 'durationMs').querySelectorAll('button')].some(button => button.disabled), 'Speed stays free');
  }
});

test('E4: the drawing parts table gives each part one Appears choice; a step is never left revealing nothing', t => {
  const plan = DRAWING('plan', ['observe', 'connect', 'plan']);
  const slides = [{ id: 's', title: 'Plan', layout: 'process', body: '', vector: { itemId: 'plan', alt: '' }, stages: [
    { id: 'a', title: 'A', svgGroupIds: ['observe'] }, { id: 'b', title: 'B', svgGroupIds: ['connect'] }] }];
  const { dom, root, choose, notices } = editor(slides, [plan]);
  t.after(() => dom.window.close());
  const appears = () => Object.fromEntries([...root.querySelectorAll('[data-part-appears]')].map(node => [node.dataset.partAppears, node.value]));
  assert.deepEqual(appears(), { observe: '0', connect: '1', plan: '' });
  // One select per part: a part is in one step only. Moving plan to step 1 takes it from nowhere else.
  assert.equal(root.querySelectorAll('[data-part-appears] [multiple], select[multiple]').length, 0);
  choose('[data-part-appears="plan"]', '0');
  assert.deepEqual(slides[0].stages.map(stage => stage.svgGroupIds), [['observe', 'plan'], ['connect']]);
  choose('[data-part-appears="plan"]', '1');
  assert.deepEqual(slides[0].stages.map(stage => stage.svgGroupIds), [['observe'], ['connect', 'plan']]);
  // Step 1's only part cannot leave it: the change is refused on the card and nothing changes.
  choose('[data-part-appears="observe"]', '');
  assert.deepEqual(slides[0].stages.map(stage => stage.svgGroupIds), [['observe'], ['connect', 'plan']]);
  assert.deepEqual(notices, ['Step 1 would reveal nothing; give it another part first.']);
  assert.equal(root.querySelector('[data-card="visual"] [data-card-notice]').textContent, 'Step 1 would reveal nothing; give it another part first.');
  // A step's Reveals: remove a part (to From the start) and Add part offers only unclaimed parts.
  root.querySelector('[data-card="step:b"] [data-reveal-remove="plan"]').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  assert.deepEqual(slides[0].stages[1].svgGroupIds, ['connect']);
  assert.deepEqual([...root.querySelectorAll('[data-card="step:a"] [data-reveal-add] option')].map(node => node.value), ['', 'plan']);
  choose('[data-card="step:a"] [data-reveal-add]', 'plan');
  assert.deepEqual(slides[0].stages[0].svgGroupIds, ['observe', 'plan']);
});

test('E8 (editor half): star = pick; a starred candidate cannot be removed; a drawing lacking a stepped part warns and refuses the star', t => {
  const v1 = DRAWING('v1', ['observe', 'connect'], 1), v2 = DRAWING('v2', ['observe', 'connect', 'route-a'], 2), photo = PHOTO('p');
  const slides = [{ id: 's', title: 'Plan', layout: 'full-media', body: '', vector: { itemId: 'v2', alt: 'Plan' }, candidates: [{ itemId: 'v1', alt: '' }, { itemId: 'p', alt: '' }],
    stages: [{ id: 'a', title: 'A', svgGroupIds: ['observe'] }, { id: 'b', title: 'Route', svgGroupIds: ['route-a'] }] }];
  const { dom, root, click, notices, saves } = editor(slides, [v1, v2, photo]);
  t.after(() => dom.window.close());
  const starred = () => [...root.querySelectorAll('[data-candidate-star][aria-pressed="true"]')].map(node => node.dataset.candidateStar);
  assert.deepEqual(starred(), ['v2']);
  assert.equal(root.querySelector('[data-card="visual"] .element-card-summary').textContent, 'Floor plan v2');
  // Removing the starred candidate is refused; star another first.
  click('[data-candidate-remove="v2"]');
  assert.equal(slides[0].vector.itemId, 'v2');
  assert.match(notices.at(-1), /starred on the slide; star another first/);
  // Starring v1, which has no part route-a, is refused at the star with the spec's line.
  click('[data-candidate-star="v1"]');
  assert.equal(notices.at(-1), 'v1 has no part route-a, so a step reveals nothing.');
  assert.equal(root.querySelector('[data-card="visual"] [data-card-notice]').textContent, 'v1 has no part route-a, so a step reveals nothing.');
  assert.equal(slides[0].vector.itemId, 'v2');
  assert.equal(saves.length, 0, 'nothing was saved');
  // Starring the photo swaps the pick: the drawing returns to the candidates, the steps lose its parts.
  click('[data-candidate-star="p"]');
  assert.deepEqual(slides[0].media, { itemId: 'p', alt: '' });
  assert.equal(slides[0].vector, null);
  assert.deepEqual(slides[0].candidates.map(c => c.itemId).sort(), ['v1', 'v2']);
  assert.ok(slides[0].stages.every(stage => stage.svgGroupIds === undefined));
  assert.deepEqual(starred(), ['p']);
  // An unpicked candidate is removed; unstarring leaves the slot empty with the asset kept as a candidate.
  click('[data-candidate-remove="v1"]');
  assert.deepEqual(slides[0].candidates.map(c => c.itemId), ['v2']);
  click('[data-candidate-star="p"]');
  assert.equal(slides[0].media, null);
  assert.deepEqual(slides[0].candidates.map(c => c.itemId), ['v2', 'p']);
  assert.equal(root.querySelector('[data-card="visual"] .element-card-summary').textContent, 'No pick');
});

test('E8 (editor half): a saved pick lacking a stepped part warns on the Visual card and the slide card', t => {
  const v1 = DRAWING('v1', ['observe']);
  const slides = [{ id: 's', title: 'Plan', layout: 'process', body: '', vector: { itemId: 'v1', alt: '' }, stages: [{ id: 'a', title: 'A', svgGroupIds: ['route-a'] }] }];
  const { dom, root } = editor(slides, [v1]);
  t.after(() => dom.window.close());
  assert.equal(root.querySelector('[data-card="visual"] [data-missing-part]').textContent, 'v1 has no part route-a, so a step reveals nothing.');
  const list = new JSDOM(slideListHTML(slides, [v1], null));
  t.after(() => list.window.close());
  assert.equal(list.window.document.querySelector('[data-slide-warning]').textContent, 'v1 has no part route-a, so a step reveals nothing.');
  // Each missing part has its own line.
  slides[0].stages.push({ id: 'b', title: 'B', svgGroupIds: ['route-b'] });
  const twice = editor(slides, [v1]);
  t.after(() => twice.dom.window.close());
  assert.deepEqual([...twice.root.querySelectorAll('[data-card="visual"] [data-missing-part]')].map(node => node.textContent),
    ['v1 has no part route-a, so a step reveals nothing.', 'v1 has no part route-b, so a step reveals nothing.']);
  assert.deepEqual(slideWarnings(slides[0], [v1]), ['v1 has no part route-a, so a step reveals nothing.', 'v1 has no part route-b, so a step reveals nothing.']);
});

test('E8 (editor half): a gallery stars several candidates and they play in their order', t => {
  const items = ['a', 'b', 'c'].map(PHOTO);
  const slides = [{ id: 's', title: 'Gallery', layout: 'text-media', body: '', candidates: items.map(item => ({ itemId: item.id, alt: '' })) }];
  const { dom, root, click } = editor(slides, items);
  t.after(() => dom.window.close());
  click('[data-visual-mode="gallery"]');
  click('[data-candidate-star="c"]');
  click('[data-candidate-star="a"]');
  assert.deepEqual(slides[0].subnav.map(view => [view.itemId, view.label]), [['c', 'Photo c'], ['a', 'Photo a']]);
  assert.equal(slides[0].media ?? null, null);
  assert.deepEqual(slides[0].candidates.map(c => c.itemId), ['b']);
  // The views reorder; back to one visual keeps the first view as the pick.
  click('[data-part="subnav"][data-part-index="1"] [data-slide-action="part-up"]');
  assert.deepEqual(slides[0].subnav.map(view => view.itemId), ['a', 'c']);
  click('[data-visual-mode="single"]');
  assert.deepEqual(slides[0].media, { itemId: 'a', alt: '' });
  assert.deepEqual(slides[0].subnav, []);
  assert.deepEqual(slides[0].candidates.map(c => c.itemId).sort(), ['b', 'c']);
});

// Spec #46 Iterations, task #133: Ask for another from a slide's Visual card. The note names the slide
// (number, title), the picked asset and its iteration, so the deck guidance's slide route applies: the new
// iteration becomes an unstarred candidate of that slide. Nothing is saved; the note waits in the composer.
test('Iterations: the Visual card asks for another of its one pick with a note naming the slide; otherwise it is disabled with a reason', t => {
  const v2 = DRAWING('v2', ['observe'], 2);
  const slide = { id: 'plan-slide', title: 'Observe, connect, plan', layout: 'full-media', body: '', vector: { itemId: 'v2', alt: '' } };
  assert.equal(askFromSlideText(slide, 5, v2), 'On slide 06 “Observe, connect, plan” (plan-slide): make another iteration of its picked visual “Floor plan” (library item v2, v2). '
    + "Register it with iterationOf v2 and add it to this slide's candidates, unstarred unless I say to use it. What to change: ");
  const slides = [slide];
  const { dom, root, click, asks, saves } = editor(slides, [v2]);
  t.after(() => dom.window.close());
  const ask = () => root.querySelector('[data-card="visual"] [data-ask-another]');
  assert.equal(ask().textContent, 'Ask for another');
  assert.equal(ask().disabled, false);
  click('[data-ask-another]');
  assert.deepEqual(asks, [askFromSlideText(slide, 0, v2)]);
  assert.match(asks[0], /^On slide 01 “Observe, connect, plan” \(plan-slide\): make another iteration of its picked visual “Floor plan” \(library item v2, v2\)\./);
  assert.equal(saves.length, 0, 'asking saves nothing');
  // No pick: disabled with the reason; a gallery with several picks: disabled, name the view in chat.
  const empty = editor([{ ...slide, vector: null, candidates: [{ itemId: 'v2', alt: '' }] }], [v2]);
  t.after(() => empty.dom.window.close());
  const none = empty.root.querySelector('[data-card="visual"] [data-ask-another]');
  assert.equal(none.disabled, true);
  assert.equal(none.title, 'Star a candidate first: Ask for another makes a new iteration of the pick.');
  const photos = ['a', 'b'].map(PHOTO);
  const gallery = editor([{ id: 'g', title: 'Gallery', layout: 'text-media', body: '', subnav: photos.map(item => ({ id: `view-${item.id}`, label: item.label, itemId: item.id })) }], photos);
  t.after(() => gallery.dom.window.close());
  const several = gallery.root.querySelector('[data-card="visual"] [data-ask-another]');
  assert.equal(several.disabled, true);
  assert.equal(several.title, 'Several views are picked: name the one to remake in chat.');
  // One starred view is one pick: it asks for that view.
  const one = editor([{ id: 'g', title: 'Gallery', layout: 'text-media', body: '', subnav: [{ id: 'view-a', label: 'Photo a', itemId: 'a' }] }], photos);
  t.after(() => one.dom.window.close());
  one.click('[data-ask-another]');
  assert.match(one.asks[0], /^On slide 01 “Gallery” \(g\): make another iteration of its picked visual “Photo a” \(library item a, v1\)\./);
});

test('E4: steps reorder, are added from Add element and removed', t => {
  const slides = [{ id: 's', title: 'Steps', layout: 'statement', body: '', stages: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }, { id: 'c', title: 'C' }] }];
  const { dom, root, click, choose } = editor(slides);
  t.after(() => dom.window.close());
  click('[data-part="stages"][data-part-index="2"] [data-slide-action="part-up"]');
  assert.deepEqual(slides[0].stages.map(stage => stage.id), ['a', 'c', 'b']);
  choose('[data-add-element]', 'step');
  assert.equal(slides[0].stages.length, 4);
  assert.equal(slides[0].stages[3].title, 'New step');
  click('[data-part="stages"][data-part-index="0"] [data-slide-action="part-delete"]');
  assert.deepEqual(slides[0].stages.map(stage => stage.id).slice(0, 2), ['c', 'b']);
  assert.ok(root.querySelector('[data-part="stages"][data-part-index="0"] [data-play-step="0"]'), 'each step has Play step');
});

// Spec #46 task #134 (REV1 conformance F1, flag #95): on a drawing slide every step reveals a part, as the
// server requires (validateVectorStages). Add element > Step takes the drawing's first unclaimed part, in
// the drawing's part order; with none free it is refused on the Visual card; a drawing starred onto a slide
// with a step that would reveal nothing is refused with the server's wording. A refusal saves nothing.
test('E4: on a drawing slide Add element > Step reveals the first unclaimed part and saves once', t => {
  const plan = DRAWING('plan', ['observe', 'connect', 'plan']);
  const slides = [{ id: 's', title: 'Plan', layout: 'process', body: '', vector: { itemId: 'plan', alt: '' }, stages: [{ id: 'a', title: 'A', svgGroupIds: ['connect'] }] }];
  const { dom, root, choose, notices, saves } = editor(slides, [plan]);
  t.after(() => dom.window.close());
  choose('[data-add-element]', 'step');
  assert.deepEqual(slides[0].stages.map(stage => stage.svgGroupIds), [['connect'], ['observe']], 'the first part no step claims, in the drawing\'s order');
  assert.equal(saves.length, 1);
  assert.deepEqual(saves[0].stages[1].svgGroupIds, ['observe']);
  assert.doesNotThrow(() => validateVectorStages(saves[0].stages, plan.asset.metadata.svgGroupIds), 'the server accepts the saved steps');
  assert.deepEqual(notices, []);
  assert.equal(root.querySelector('[data-card^="step:stage_"] .element-card-summary').textContent, 'On click · Standard · reveals observe');
});

test('E4: on a drawing slide whose parts are all claimed Add element > Step is refused on the Visual card and saves nothing', t => {
  const plan = DRAWING('plan', ['observe', 'connect']);
  const slides = [{ id: 's', title: 'Plan', layout: 'process', body: '', vector: { itemId: 'plan', alt: '' }, stages: [
    { id: 'a', title: 'A', svgGroupIds: ['observe'] }, { id: 'b', title: 'B', svgGroupIds: ['connect'] }] }];
  const before = structuredClone(slides[0]);
  const { dom, root, choose, notices, saves } = editor(slides, [plan]);
  t.after(() => dom.window.close());
  choose('[data-add-element]', 'step');
  assert.deepEqual(slides[0], before, 'no step is added');
  assert.equal(saves.length, 0);
  assert.deepEqual(notices, ['Every part already appears in a step; free one first']);
  assert.equal(root.querySelector('[data-card="visual"] [data-card-notice]').textContent, 'Every part already appears in a step; free one first');
});

test('starring the first drawing with text steps hands an isolated pick draft to the assignment form', t => {
  const plan = DRAWING('plan', ['observe', 'connect']), photo = PHOTO('p');
  const slides = [{ id: 's', title: 'Plan', layout: 'full-media', body: '', media: { itemId: 'p', alt: 'Photo' }, candidates: [{ itemId: 'plan', alt: '' }],
    stages: [{ id: 'a', title: 'A', body: 'Text only' }] }];
  const before = structuredClone(slides[0]);
  let draft;
  const { dom, click, saves } = editor(slides, [plan, photo], { onDrawingPick: (_slide, next) => { draft = next; } });
  t.after(() => dom.window.close());
  click('[data-candidate-star="plan"]');
  assert.deepEqual(slides[0], before, 'the pick is unchanged');
  assert.equal(saves.length, 0);
  assert.deepEqual(draft.vector, { itemId: 'plan', alt: '' });
  assert.deepEqual(draft.candidates, [{ itemId: 'p', alt: 'Photo' }]);
  assert.deepEqual(draft.stages, before.stages);
});

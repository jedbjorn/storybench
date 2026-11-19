// Spec #46 task #129 (E9, library half): the deck Media Library's model in public/deck-library.js —
// groupings, tile states, where an item is used, Clean up eligibility and the slide changes the library
// makes. The browser half is test/deck-library-browser.test.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { addCandidate, bySlide, cleanupEligible, iterationGroups, notOnSlide, removeCandidate, slideOffers, tileState, typeOf, usageText, useOnSlide } from '../public/deck-library.js';
import { validateSlides } from '../src/deck-data.js';

const image = (id, extra = {}) => ({ id, label: id, iterationGroup: id, iteration: 1, asset: { kind: 'image', metadata: { contentType: 'image/png' } }, ...extra });
const drawing = (id, extra = {}) => ({ ...image(id, extra), asset: { kind: 'image', metadata: { contentType: 'image/svg+xml', svgGroupIds: ['a', 'b'], svgGroups: [{ id: 'a', stroked: true }, { id: 'b', stroked: true }] } } });
const audio = id => ({ id, label: id, iterationGroup: id, iteration: 1, asset: { kind: 'audio', metadata: {} } });
const text = id => ({ id, label: id, iterationGroup: id, iteration: 1, asset: { kind: 'document', metadata: {} } });
// Floor plan v1..v3 (v2 starred on slide 01, v1 a candidate there); hero photo starred on 02 with sky as a
// candidate; an unused group of two; a reference and audio.
const items = [
  drawing('plan1', { label: 'Floor plan' }), drawing('plan2', { label: 'Floor plan', iterationGroup: 'plan1', iteration: 2 }), drawing('plan3', { label: 'Floor plan', iterationGroup: 'plan1', iteration: 3 }),
  image('hero'), image('sky'), image('spare1'), image('spare2', { iterationGroup: 'spare1', iteration: 2 }), text('notes'), audio('voice'),
];
const slides = [
  { id: 'plan', title: 'The plan', layout: 'process', vector: { itemId: 'plan2', alt: 'Plan' }, candidates: [{ itemId: 'plan1', alt: 'Old plan' }], stages: [{ id: 's1', title: 'A', svgGroupIds: ['a'], motion: 'draw' }], referenceItemIds: [] },
  { id: 'hero', title: 'Hero', layout: 'text-media', media: { itemId: 'hero', alt: 'Hero' }, candidates: [{ itemId: 'sky', alt: 'Sky' }], subnav: [], stages: [] },
  { id: 'words', title: 'Words', layout: 'statement', stages: [] },
];

test('By slide: slides with picks or candidates hold their iteration groups, then groups on no slide, then references and audio', () => {
  const view = bySlide(slides, items);
  assert.deepEqual(view.slides.map(entry => [entry.slide.id, entry.groups.map(group => group.map(item => item.id))]),
    [['plan', [['plan1', 'plan2', 'plan3']]], ['hero', [['hero'], ['sky']]]]);
  assert.deepEqual(view.unused.map(group => group.map(item => item.id)), [['spare1', 'spare2']]);
  assert.deepEqual(view.context.map(item => item.id), ['notes', 'voice']);
  // Tile states on the plan slide: v2 starred, v1 a candidate, v3 dimmed (in the group, not a candidate).
  assert.deepEqual(['plan1', 'plan2', 'plan3'].map(id => tileState(slides[0], id)), ['candidate', 'on', 'dimmed']);
});

test('By type and the filter: where each item is used, and the visual items on no slide', () => {
  assert.deepEqual(items.map(typeOf), ['drawing', 'drawing', 'drawing', 'image', 'image', 'image', 'image', 'reference', 'audio']);
  assert.equal(usageText(slides, 'plan2'), 'On 01');
  assert.equal(usageText(slides, 'sky'), 'Candidate for 02');
  assert.equal(usageText(slides, 'plan3'), '');
  assert.deepEqual(notOnSlide(slides, items).map(item => item.id), ['plan3', 'spare1', 'spare2']);
  assert.deepEqual(iterationGroups(items).map(group => group.length), [3, 1, 1, 2, 1, 1]);
});

test('Clean up offers only unstarred, non-candidate, unreferenced iterations in groups of two or more', () => {
  const episode = { cards: slides, referenceItemIds: [] };
  assert.deepEqual(cleanupEligible(episode, items).map(item => item.id), ['plan3', 'spare1', 'spare2']);
  // An assistant reference on a slide or on the deck is held; references and audio are never offered.
  const referenced = { cards: [{ ...slides[0], referenceItemIds: ['plan3'] }, slides[1]], referenceItemIds: ['spare2'] };
  assert.deepEqual(cleanupEligible(referenced, items).map(item => item.id), ['spare1']);
  assert.deepEqual(cleanupEligible({ cards: [] }, [text('a'), text('b', { iterationGroup: 'a' }), audio('c')]), []);
  // A one-iteration group is never offered.
  assert.deepEqual(cleanupEligible({ cards: [] }, [image('alone')]), []);
});

test('Use on slide stars a candidate: the replaced pick returns to the candidates, and the result validates', () => {
  const plan = useOnSlide(slides[0], items[0]);
  assert.deepEqual(plan.vector, { itemId: 'plan1', alt: 'Old plan' });
  assert.deepEqual(plan.candidates, [{ itemId: 'plan2', alt: 'Plan' }]);
  assert.deepEqual(plan.stages, slides[0].stages, 'a drawing replacing a drawing keeps the step parts');
  const hero = useOnSlide(slides[1], items[4]);
  assert.deepEqual([hero.media, hero.candidates], [{ itemId: 'sky', alt: 'Sky' }, [{ itemId: 'hero', alt: 'Hero' }]]);
  validateSlides([plan, hero, slides[2]], { libraryItems: items, previous: slides, setBy: 'creator' });
  assert.equal(useOnSlide(slides[0], items[1]), slides[0], 'using the current pick changes nothing');
  assert.equal(useOnSlide(slides[0], items[8]), slides[0], 'audio is never a pick');
});

test('Use on slide: a gallery gains a starred view; switching drawing and media moves the other pick back and drops part-only fields', () => {
  const gallery = { id: 'g', title: 'Views', layout: 'full-media', subnav: [{ id: 'view1', label: 'Hero', itemId: 'hero' }], candidates: [{ itemId: 'sky', alt: '', label: 'Sky at dusk' }], stages: [] };
  const added = useOnSlide(gallery, items[4]);
  assert.deepEqual(added.subnav, [{ id: 'view1', label: 'Hero', itemId: 'hero' }, { id: 'view2', label: 'Sky at dusk', itemId: 'sky' }]);
  assert.deepEqual(added.candidates, []);
  const toMedia = useOnSlide({ ...slides[0], layout: 'text-media', candidates: [{ itemId: 'hero', alt: 'Hero' }] }, items[3]);
  assert.equal(toMedia.vector, null);
  assert.deepEqual(toMedia.media, { itemId: 'hero', alt: 'Hero' });
  assert.deepEqual(toMedia.candidates, [{ itemId: 'plan2', alt: 'Plan' }]);
  assert.deepEqual(toMedia.stages, [{ id: 's1', title: 'A' }], 'draw and the part mapping go with the drawing');
  const toDrawing = useOnSlide({ ...slides[1], candidates: [{ itemId: 'plan3', alt: 'Plan v3' }] }, items[2]);
  assert.deepEqual([toDrawing.media, toDrawing.vector, toDrawing.candidates], [null, { itemId: 'plan3', alt: 'Plan v3' }, [{ itemId: 'hero', alt: 'Hero' }]]);
});

test('Candidate for a slide adds an unstarred candidate where the type has a slot; removing a starred asset is refused', () => {
  assert.deepEqual(addCandidate(slides[2], items[3]).candidates, [{ itemId: 'hero', alt: '' }]);
  assert.equal(addCandidate(slides[0], items[0]), slides[0], 'already a candidate');
  assert.deepEqual([slideOffers(slides[0], items[2]), slideOffers(slides[0], items[3]), slideOffers(slides[1], items[3]), slideOffers(slides[2], items[3]), slideOffers(slides[1], items[7])],
    [true, false, true, false, false]);
  assert.deepEqual(removeCandidate(slides[0], 'plan1').candidates, []);
  assert.throws(() => removeCandidate(slides[0], 'plan2'), /starred on the slide; star another first/);
});

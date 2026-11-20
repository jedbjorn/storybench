// Spec #44 "Layout primitives" (task #122): validation on every save path and round-trips (A4),
// and the effective design reaching the snapshot, manifest and template (deck default, slide override).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Store } from '../src/store.js';
import { createDeckService } from '../src/deck-service.js';
import { createApp } from '../src/server.js';
import { validateDeckDesign, validatePrimitives, validateSlides, effectiveSlideDesign, emptyDesign } from '../src/deck-data.js';
import { buildDeck } from '../src/deck-template/build.js';
import { exampleDeck, exampleAssets } from '../src/deck-template/example.js';
import { listenInRange } from '../test-support/loopback-port.js';

const steps = (extra = {}) => [{ id: 'one', title: 'One', body: 'First' }, { id: 'two', title: 'Two', body: 'Second', ...extra }, { id: 'three', title: 'Three' }];
const slides = () => [
  { id: 'opening', title: 'Hello', layout: 'statement', body: 'Offline', stages: steps() },
  { id: 'closing', title: 'Bye', layout: 'statement', body: 'Done' },
];
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sb-primitives-')), store = new Store(root), decks = createDeckService({ store });
  t.after(async () => { await decks.close(); store.close(); await rm(root, { recursive: true, force: true }); });
  const deck = store.createEpisode({ kind: 'deck', title: 'Primitives' }); store.saveDeck(deck.id, 1, slides());
  return { root, store, decks, id: deck.id };
}

test('A4: unknown primitives, arguments and values, CSS strings and non-enum types are refused naming the deck or slide, primitive and argument', () => {
  const deck = (design, pattern) => assert.throws(() => validateDeckDesign(design, { setBy: 'agent' }), pattern);
  deck({ aspectRatio: '4:3' }, /aspectRatio must be 16:9 or 16:10/);
  for (const bad of [19, 101, '50%', Infinity]) deck({ copy: { titleWidth: bad } }, /titleWidth must be a number from 20 to 100/);
  deck({ layout: {} }, /^Error: Deck design: layout is not supported; use theme, aspectRatio, copy, stageText, type, spacing, timing$/);
  deck({ copy: { margin: '4px' } }, /Deck design: copy\.margin is not supported; use position, align, valign/);
  deck({ copy: { align: 'justify' } }, /Deck design: copy\.align must be one of start, center, end/);
  deck({ stageText: { style: 'display:none' } }, /Deck design: stageText\.style must be one of chips, steps, list, card/);
  deck({ stageText: { position: 'calc(10px)' } }, /Deck design: stageText\.position must be one of top, bottom, left, right/);
  deck({ stageText: { numbered: 'true' } }, /Deck design: stageText\.numbered must be true or false/);
  deck({ stageText: { flipMs: 2001 } }, /Deck design: stageText\.flipMs must be a number from 0 to 2000/);
  deck({ stageText: { flipMs: '300ms' } }, /stageText\.flipMs must be a number/);
  deck({ type: { scale: 1.2 } }, /Deck design: type\.scale must be one of compact, standard, large/);
  deck({ spacing: { density: 'tight' } }, /Deck design: spacing\.density must be one of compact, standard, spacious/);
  deck({ timing: { betweenMs: -1 } }, /Deck design: timing\.betweenMs must be a number from 0 to 60000/);
  deck({ timing: 'betweenMs:500' }, /Deck design: timing must be an object of betweenMs/);
  const slide = (design, pattern, extra = {}) => assert.throws(() => validateSlides([{ ...slides()[0], ...extra, design }]), pattern);
  slide({ theme: {} }, /Slide opening: design\.theme is not supported; use copy, stageText, type, spacing, timing/);
  slide({ stageText: { align: 'middle' } }, /Slide opening: design\.stageText\.align must be one of start, center, end/);
  slide({ copy: { valign: '<b>' } }, /Slide opening: design\.copy\.valign must be one of/);
  slide({ stageText: { css: 'color:red' } }, /Slide opening: design\.stageText\.css is not supported/);
  slide('center', /Slide opening: design must be an object/);
  // A position needs a visual; on a slide without one it is refused naming the slide.
  slide({ copy: { position: 'left' } }, /Slide opening: design\.copy\.position needs a visual/);
  slide({ stageText: { position: 'top' } }, /Slide opening: design\.stageText\.position needs a visual/);
  // Unset values (absent or null) are dropped; a valid design is kept as given.
  assert.deepEqual(validatePrimitives({ copy: { align: null }, type: null }, 'x', 'x.'), {});
  assert.deepEqual(validateSlides([{ ...slides()[0], design: { stageText: { style: 'card', numbered: true, flipMs: 0 }, type: { scale: 'large' } } }])[0].design,
    { stageText: { style: 'card', numbered: true, flipMs: 0 }, type: { scale: 'large' } });
  assert.equal('design' in validateSlides([{ ...slides()[0], design: { copy: {} } }])[0], false, 'an empty slide design is not stored');
});

test('A4: a position is accepted where the slide has a visual: media on text-media or full-media, a vector, or a gallery', () => {
  const image = { id: 'img', asset: { kind: 'image', metadata: { contentType: 'image/png' } } };
  const valid = slide => validateSlides([{ id: 's', title: 'S', ...slide, design: { copy: { position: 'right' } } }], { libraryItems: [image] })[0].design;
  assert.deepEqual(valid({ layout: 'text-media', media: { itemId: 'img' } }), { copy: { position: 'right' } });
  assert.deepEqual(valid({ layout: 'statement', subnav: [{ id: 'g', label: 'View', itemId: 'img' }] }), { copy: { position: 'right' } });
  // Media on a layout that does not show it is no visual.
  assert.throws(() => valid({ layout: 'statement', media: { itemId: 'img' } }), /Slide s: design\.copy\.position needs a visual/);
  // A deck default position applies only where a visual exists.
  assert.deepEqual(effectiveSlideDesign({ copy: { position: 'left', align: 'center' } }, {}, { hasVisual: false }), { copy: { align: 'center' } });
});

test('A5c (save): with timing.betweenMs, afterMs, holdMs and a manual trigger after the first stage are refused naming slide and stage', () => {
  const refuse = (stage, design, deckDesign, pattern) => assert.throws(() => validateSlides([{ ...slides()[0], stages: steps(stage), design }], { design: deckDesign }), pattern);
  refuse({ afterMs: 500 }, { timing: { betweenMs: 300 } }, {}, /^Error: Slide opening: Stage two: afterMs conflicts with timing\.betweenMs/);
  refuse({ holdMs: 500 }, undefined, { timing: { betweenMs: 300 } }, /Slide opening: Stage two: holdMs conflicts with timing\.betweenMs/);
  refuse({ trigger: 'manual' }, undefined, { timing: { betweenMs: 0 } }, /Slide opening: Stage two: trigger manual conflicts/);
  // The first stage keeps its own afterMs; an automatic trigger agrees with the gap; unset betweenMs keeps per-stage timing.
  const first = [{ id: 'one', title: 'One', afterMs: 800, holdMs: 100 }, { id: 'two', title: 'Two', trigger: 'auto' }];
  assert.equal(validateSlides([{ ...slides()[0], stages: first }], { design: { timing: { betweenMs: 300 } } })[0].stages[0].afterMs, 800);
  assert.equal(validateSlides([{ ...slides()[0], stages: steps({ afterMs: 500, holdMs: 10 }) }], { design: {} })[0].stages[1].afterMs, 500);
});

test('A4: deck and slide primitives save with the deck revision through the store; omitted design is kept; history and undo restore them; refusals store nothing', async t => {
  const { store, id } = await fixture(t);
  const designed = slides(); designed[0].design = { copy: { bodyWidth: 42 }, stageText: { style: 'list', numbered: true }, type: { scale: 'compact' } };
  const saved = store.saveDeck(id, 2, designed, 'agent', { aspectRatio: '16:10', copy: { titleWidth: 88 }, stageText: { align: 'center' }, spacing: { density: 'spacious' }, timing: { betweenMs: 400 } });
  assert.equal(saved.revision, 3);
  assert.deepEqual(saved.design, { ...emptyDesign(), aspectRatio: '16:10', copy: { titleWidth: 88 }, stageText: { align: 'center' }, spacing: { density: 'spacious' }, timing: { betweenMs: 400 } });
  assert.deepEqual(saved.slides[0].design, designed[0].design);
  assert.equal('design' in saved.slides[1], false);
  // Reload: a new store on the same workspace reads the same values.
  const reopened = new Store(store.workspace); t.after(() => reopened.close());
  assert.deepEqual(reopened.getDeck(id).design, saved.design); assert.deepEqual(reopened.getDeck(id).slides, saved.slides);
  // Omitting design keeps it; the slide override travels on the slide.
  const kept = store.saveDeck(id, 3, saved.slides);
  assert.deepEqual(kept.design, saved.design);
  // A design whose slide-wide gap conflicts with a slide's per-stage timing is refused naming slide and stage, and stores nothing.
  const timed = slides(); timed[0].stages = steps({ afterMs: 900 });
  assert.throws(() => store.saveDeck(id, 4, timed, 'human'), /Slide opening: Stage two: afterMs conflicts with timing\.betweenMs/);
  assert.throws(() => store.saveDeck(id, 4, slides(), 'human', { copy: { align: 'left' } }), /Deck design: copy\.align must be one of/);
  assert.equal(store.getDeck(id).revision, 4);
  // Undo restores the previous revision's design and slide designs.
  const changed = store.saveDeck(id, 4, slides(), 'human', { copy: { valign: 'end' } });
  assert.deepEqual(changed.design.copy, { valign: 'end' }); assert.equal(changed.design.stageText, undefined);
  const undone = store.undoEpisode(id, 5);
  assert.deepEqual(undone.design, saved.design); assert.deepEqual(store.getDeck(id).slides[0].design, designed[0].design);
  // A design-only change is checked against the saved slides too.
  const gapped = store.saveDeck(id, undone.revision, timed, 'human', {});
  assert.throws(() => store.updateEpisode(id, gapped.revision, { design: { timing: { betweenMs: 400 } } }, 'human'), /Slide opening: Stage two: afterMs conflicts with timing\.betweenMs/);
  assert.equal(store.getDeck(id).revision, gapped.revision);
});

test('A4: the human save routes refuse invalid primitives naming slide, primitive and argument, and round-trip valid ones', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sb-primitives-http-')), app = await createApp({ workspace: root });
  t.after(async () => { await app.close(); await rm(root, { recursive: true, force: true }); });
  await listenInRange(app.server);
  const deck = app.store.createEpisode({ kind: 'deck', title: 'Routes' });
  const url = (suffix = '') => `http://127.0.0.1:${app.server.address().port}/api/episodes/${deck.id}${suffix}?channel=${deck.channelId}`;
  const put = (suffix, body) => fetch(url(suffix), { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const refusals = [
    [{ slides: [{ ...slides()[0], design: { stageText: { align: 'text-align:center' } } }] }, /Slide opening: design\.stageText\.align must be one of start, center, end/],
    [{ slides: [{ ...slides()[0], design: { copy: { position: 'left' } } }] }, /Slide opening: design\.copy\.position needs a visual/],
    [{ slides: slides(), design: { stageText: { style: 'grid' } } }, /Deck design: stageText\.style must be one of/],
    [{ slides: slides(), design: { spacing: { padding: 12 } } }, /Deck design: spacing\.padding is not supported/],
  ];
  for (const [body, pattern] of refusals) {
    const refused = await put('/slides', { expectedRevision: 1, ...body });
    assert.equal(refused.status, 400); assert.match((await refused.json()).error, pattern);
  }
  assert.equal(app.store.getDeck(deck.id).revision, 1, 'refused saves store nothing');
  const designed = slides(); designed[1].design = { copy: { align: 'center', valign: 'start' } };
  const saved = await put('/slides', { expectedRevision: 1, slides: designed, design: { stageText: { style: 'card', flipMs: 600 } } });
  assert.equal(saved.status, 200);
  const board = await put('', { expectedRevision: 2, cards: (await saved.json()).slides, design: { stageText: { style: 'card', flipMs: 600 }, type: { scale: 'large' } } });
  assert.equal(board.status, 200);
  const read = await (await fetch(url('/slides'))).json();
  assert.deepEqual(read.design.stageText, { style: 'card', flipMs: 600 }); assert.deepEqual(read.design.type, { scale: 'large' });
  assert.deepEqual(read.slides[1].design, { copy: { align: 'center', valign: 'start' } });
});

test('build: the snapshot and manifest carry the deck defaults and each slide\'s effective design (slide beats deck beats template)', async t => {
  const f = await fixture(t), { store, decks, id, root } = f;
  const designed = slides(); designed[0].design = { stageText: { align: 'end', style: 'list' } };
  store.saveDeck(id, 2, designed, 'agent', { stageText: { align: 'center' }, copy: { position: 'left', valign: 'end' }, type: { scale: 'large' } });
  const job = decks.enqueue({ episodeId: id, expectedRevision: 3 });
  let done;
  for (let n = 0; n < 400; n++) { done = decks.getJob(id, job.id); if (!['queued', 'running'].includes(done.state)) break; await new Promise(r => setTimeout(r, 5)); }
  assert.equal(done.state, 'completed', done.error);
  const expected = {
    deck: { stageText: { align: 'center' }, copy: { position: 'left', valign: 'end' }, type: { scale: 'large' } },
    // Neither slide has a visual, so the deck's default position does not reach them.
    slides: { opening: { copy: { valign: 'end' }, stageText: { align: 'end', style: 'list' }, type: { scale: 'large' } }, closing: { copy: { valign: 'end' }, stageText: { align: 'center' }, type: { scale: 'large' } } },
  };
  assert.deepEqual(done.snapshot.design, expected);
  const base = path.dirname(path.join(root, done.outputPath));
  assert.deepEqual(JSON.parse(await readFile(path.join(base, 'manifest.json'), 'utf8')).design, expected);
  const html = await readFile(path.join(base, 'index.html'), 'utf8');
  assert.match(html, /<article class="slide layout-statement" id="opening"[^>]* data-type="large" hidden>.*?<div class="composition" data-copy-valign="end" data-stage-align="end">/s);
  assert.match(html, /<ul class="stages stage-list">/);
  assert.match(html, /id="closing"[^>]* data-type="large" hidden>.*?<div class="composition" data-copy-valign="end" data-stage-align="center">/s);
});

test('template: unset design adds no attributes; styles use their own controls and preserve Presenter labels', () => {
  const html = deck => buildDeck(deck, { assets: exampleAssets }).get('index.html');
  const plain = html(structuredClone(exampleDeck));
  assert.doesNotMatch(plain, /data-(copy|stage)-(align|valign)|data-type=|data-spacing=|data-between-ms|data-flip-ms|class="composition placed"|stage-list|stage-card/);
  // Design values of {} build exactly as no design.
  assert.equal(html({ ...structuredClone(exampleDeck), slides: exampleDeck.slides.map(slide => ({ ...structuredClone(slide), design: {} })) }), plain);
  const process = exampleDeck.slides.find(slide => slide.id === 'steps');
  for (const [style, numbered] of [['chips'], ['steps'], ['list', false], ['list', true], ['card', true]]) {
    const out = html({ title: 'Styles', slides: [{ ...structuredClone(process), design: { stageText: { style, numbered } } }] });
    const controls = [...out.matchAll(/<button data-stage="(\d)"(?: aria-label="([^"]*)")?>([^<]*)<\/button>/g)];
    assert.deepEqual(controls.map(m => Number(m[1])), style === 'card' ? [] : [0, 1, 2], `${style}: rendered controls`);
    assert.deepEqual([...out.matchAll(/data-nav-label="([^"]+)"/g)].map(m => m[1]), ['Discover', 'Experiment', 'Reflect']);
    const names = controls.map(m => m[2] ?? m[3]);
    assert.deepEqual(names, style === 'card' ? [] : style === 'chips' ? ['Discover', 'Experiment', 'Reflect'] : ['Observe', 'Try', 'Learn'], `${style}: controls carry the stage labels`);
    assert.equal(/<div class="stages" hidden/.test(out), style === 'chips', `${style}: only chips hide the stage bodies`);
    if (style === 'list') assert.match(out, numbered ? /<ol class="stages stage-list">/ : /<ul class="stages stage-list">/);
    if (style === 'card') assert.match(out, /<div class="stages stage-card"><section data-step="0"[^>]*><span class="step-number">1<\/span><h2>Observe<\/h2><p>Name the obstacle\.<\/p><\/section>/);
  }
  // The build validates again whatever saved the design, naming slide, primitive and argument.
  const refuse = (slide, pattern) => assert.throws(() => html({ title: 'T', slides: [slide] }), pattern);
  refuse({ ...structuredClone(process), design: { stageText: { style: 'grid' } } }, /Slide steps: design\.stageText\.style must be one of/);
  refuse({ ...structuredClone(process), design: { copy: { position: 'right' } } }, /Slide steps: design\.copy\.position needs a visual/);
  refuse({ ...structuredClone(process), design: { timing: { betweenMs: 100 } } }, /Slide steps: Stage Try: afterMs conflicts with timing\.betweenMs/);
});

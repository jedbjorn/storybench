import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { Store } from '../src/store.js';
import { createLibraryService } from '../src/library.js';
import { createDeckService } from '../src/deck-service.js';
import { HeavyJobQueue } from '../src/job-runner.js';
import { buildDeck } from '../src/deck-template/build.js';
import { parseSvg } from '../src/svg.js';
import { mediaSummary } from '../src/runtime/media-inspect.js';
import { motionSvg, motionDeck } from '../test-support/motion-deck.js';

async function fixture(t, source = motionSvg) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sb-motion-')), store = new Store(root);
  const queue = new HeavyJobQueue(), decks = createDeckService({ store, queue });
  t.after(async () => { await decks.close(); store.close(); await rm(root, { recursive: true, force: true }); });
  const deck = store.createEpisode({ kind: 'deck', title: 'Motion' });
  const item = await createLibraryService({ workspace: root, store }).registerFile({ episodeId: deck.id, readable: Readable.from(source), fileName: 'art.svg', contentType: 'image/svg+xml', selectedCategory: 'Graphics' });
  return { root, store, decks, queue, deck, item };
}
// A valid moving slide: a drawn track, an entering dot, then the dot travelling along the track.
const stages = () => [
  { id: 'draw', title: 'Draw', svgGroupIds: ['track'], motion: 'draw', trigger: 'auto', afterMs: 0, durationMs: 1000, holdMs: 200, easing: 'linear' },
  { id: 'arrive', title: 'Arrive', svgGroupIds: ['dot'], motion: 'enter', from: { y: -40, opacity: 0 }, trigger: 'auto', afterMs: 0, durationMs: 400 },
  { id: 'travel', title: 'Travel', changes: [{ groupId: 'dot', to: { x: 360 } }], trigger: 'auto', afterMs: 0, durationMs: 2000, easing: 'ease-in-out' },
];
const saved = (item, list) => [{ id: 'moving', title: 'Moving', layout: 'full-media', vector: { itemId: item.id, alt: 'Art' }, stages: list }];
const built = (list, source = motionSvg) => buildDeck(motionDeck(list), { assets: { 'assets/art.svg': source } });

test('asset metadata and inspect_media report stroked geometry per SVG group', async t => {
  const { root, item } = await fixture(t);
  const expected = [['track', true], ['dot', false], ['frame', true], ['plain', false], ['spare', false]].map(([id, stroked]) => ({ id, stroked }));
  assert.deepEqual(item.asset.metadata.svgGroups, expected);
  assert.deepEqual(item.asset.metadata.svgGroupIds, expected.map(group => group.id));
  assert.deepEqual((await mediaSummary(path.join(root, item.asset.path))).svgGroups, expected);
  // The cascade: an #id rule beats a .class rule, inline style beats both, and stroke inherits.
  const groups = body => parseSvg(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">${body}</svg>`)).groups.map(group => group.stroked);
  assert.deepEqual(groups('<style>.on{stroke:#000000}#off{stroke:none}</style><g id="a"><path id="off" class="on" d="M0 0H5"/></g><g id="b" class="on"><path d="M0 0H5"/></g><g id="c"><path class="on" style="stroke:none" d="M0 0H5"/></g><g id="d"><text stroke="#000000">x</text></g>'), [false, true, false, false]);
});

test('B1: every timing and motion field accepts its bounds and saves unchanged', async t => {
  const { store, deck, item } = await fixture(t);
  const list = stages();
  assert.deepEqual(store.saveDeck(deck.id, 1, saved(item, list)).slides[0].stages, list.map(stage => ({ ...stage, body: '' })).map(({ id, svgGroupIds, title, body, ...rest }) => ({ id, ...(svgGroupIds ? { svgGroupIds } : {}), title, body, ...rest })));
  let revision = 2;
  for (const change of [
    { afterMs: 0, trigger: 'auto' }, { afterMs: 3600000 }, { trigger: 'manual' }, { durationMs: 0 }, { durationMs: 60000 }, { holdMs: 0 }, { holdMs: 3600000 },
    { easing: 'linear' }, { easing: 'ease-in' }, { easing: 'ease-out' }, { easing: 'ease-in-out' }, { motion: 'fade' }, { motion: 'draw' }, { motion: 'enter' },
    { motion: 'enter', from: { x: -8192, y: 8192, scale: 0, rotate: -3600, opacity: 0 } }, { motion: 'enter', from: { x: 8192, y: -8192, scale: 16, rotate: 3600, opacity: 1 } },
    { motion: 'fade', from: { x: 5 } }, { trigger: null, durationMs: null, from: null },
  ]) {
    const next = stages(); Object.assign(next[0], { motion: 'fade' }, change);
    assert.doesNotThrow(() => { store.saveDeck(deck.id, revision++, saved(item, next)); built(next); }, JSON.stringify(change));
  }
  for (const to of [{ x: -8192, y: 8192, scale: 0, rotate: -3600, opacity: 0 }, { x: 8192, y: -8192, scale: 16, rotate: 3600, opacity: 1 }, {}]) {
    const next = stages(); next[2].changes = [{ groupId: 'dot', to }, { groupId: 'track', to: { opacity: 0.5 } }];
    assert.doesNotThrow(() => { store.saveDeck(deck.id, revision++, saved(item, next)); built(next); });
  }
  // A text stage takes timing and easing; a stage with neither field keeps its saved shape.
  const text = [{ id: 'words', title: 'Words', layout: 'process', stages: [{ id: 'one', title: 'One' }, { id: 'two', title: 'Two', trigger: 'auto', afterMs: 0, durationMs: 800, holdMs: 100, easing: 'ease-out', motion: 'fade' }] }];
  assert.deepEqual(store.saveDeck(deck.id, revision, text).slides[0].stages[0], { id: 'one', title: 'One', body: '' });
  assert.doesNotThrow(() => buildDeck({ title: 'Words', slides: text }));
});

test('B1: bad timing and motion input is refused at save and at build, naming slide and stage', async t => {
  const many = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">${Array.from({ length: 66 }, (_, i) => `<g id="g${i}"><path d="M0 0H5" stroke="#000000"/></g>`).join('')}</svg>`);
  const { store, deck, item } = await fixture(t);
  const refused = (list, pattern, { source = motionSvg, target = item, stage = list[0].id } = {}) => {
    for (const run of [() => store.saveDeck(deck.id, 1, saved(target, list)), () => built(list, source)]) {
      assert.throws(run, error => {
        assert.match(error.message, pattern);
        assert.match(error.message, new RegExp(`Slide moving: Stage ${stage}: `), error.message);
        return true;
      }, `${pattern}`);
    }
    assert.equal(store.getDeck(deck.id).revision, 1);
  };
  for (const [change, pattern] of [
    [{ trigger: 'click' }, /trigger must be one of auto, manual/], [{ easing: 'bounce' }, /easing must be one of/], [{ motion: 'spin' }, /motion must be one of fade, draw, enter/],
    [{ afterMs: -1 }, /afterMs must be a number from 0 to 3600000/], [{ afterMs: 3600001 }, /afterMs/], [{ afterMs: NaN }, /afterMs/],
    [{ durationMs: -1 }, /durationMs must be a number from 0 to 60000/], [{ durationMs: 60001 }, /durationMs/], [{ durationMs: '100' }, /durationMs/],
    [{ holdMs: -1 }, /holdMs must be a number from 0 to 3600000/], [{ holdMs: 3600001 }, /holdMs/],
    [{ from: { x: 8193 } }, /from\.x must be a number from -8192 to 8192/], [{ from: { x: -8193 } }, /from\.x/], [{ from: { y: 8193 } }, /from\.y/], [{ from: { y: -8193 } }, /from\.y/],
    [{ from: { scale: -0.1 } }, /from\.scale must be a number from 0 to 16/], [{ from: { scale: 16.1 } }, /from\.scale/],
    [{ from: { rotate: 3601 } }, /from\.rotate must be a number from -3600 to 3600/], [{ from: { rotate: -3601 } }, /from\.rotate/],
    [{ from: { opacity: 1.1 } }, /from\.opacity must be a number from 0 to 1/], [{ from: { opacity: -0.1 } }, /from\.opacity/],
    [{ from: { skew: 1 } }, /from\.skew is not supported/], [{ from: 'left' }, /from must be an object/],
  ]) { const list = stages(); Object.assign(list[0], change); refused(list, pattern); }
  for (const [to, pattern] of [
    [{ x: 8193 }, /changes\[0\]\.to\.x/], [{ y: -8193 }, /changes\[0\]\.to\.y/], [{ scale: 17 }, /changes\[0\]\.to\.scale/], [{ rotate: -3601 }, /changes\[0\]\.to\.rotate/],
    [{ opacity: 2 }, /changes\[0\]\.to\.opacity/], [undefined, /changes\[0\]\.to must be an object/],
  ]) { const list = stages(); list[2].changes = [{ groupId: 'dot', to }]; refused(list, pattern, { stage: 'travel' }); }
  const change = (edit, pattern, stage) => { const list = stages(); edit(list); refused(list, pattern, { stage }); };
  change(list => { list[1].svgGroupIds = ['dot']; list[1].motion = 'draw'; }, /draw needs stroked geometry and SVG group dot has none/, 'arrive');
  change(list => { list[2].motion = 'enter'; }, /enter moves SVG groups; a text-only stage can only fade/, 'travel');
  change(list => { list[2].motion = 'draw'; }, /draw moves SVG groups; a text-only stage can only fade/, 'travel');
  change(list => { list[2].changes = [{ groupId: 'nowhere', to: {} }]; }, /changes names unknown SVG group nowhere/, 'travel');
  change(list => { list[2].changes = [{ groupId: 'spare', to: {} }]; }, /changes names SVG group spare, which no stage reveals/, 'travel');
  change(list => { list[0].changes = [{ groupId: 'dot', to: {} }]; }, /changes names SVG group dot, first revealed by later stage arrive/, 'draw');
  change(list => { list[1].changes = [{ groupId: 'dot', to: {} }]; }, /which this stage reveals/, 'arrive');
  change(list => { list[2].changes = [{ groupId: 'dot', to: {} }, { groupId: 'dot', to: {} }]; }, /changes names SVG group dot twice/, 'travel');
  change(list => { list[2].changes = 'dot'; }, /changes must be an array/, 'travel');
  change(list => { list[2].changes = [{ to: {} }]; }, /changes\[0\] needs a groupId/, 'travel');
  // Sixty-four changes on one stage are accepted; sixty-five are refused.
  const wide = await fixture(t, many);
  const reveal = { id: 'all', title: 'All', svgGroupIds: Array.from({ length: 66 }, (_, i) => `g${i}`) };
  const moves = count => [reveal, { id: 'shift', title: 'Shift', changes: Array.from({ length: count }, (_, i) => ({ groupId: `g${i}`, to: { x: 1 } })) }];
  assert.doesNotThrow(() => { wide.store.saveDeck(wide.deck.id, 1, saved(wide.item, moves(64))); built(moves(64), many); });
  assert.throws(() => wide.store.saveDeck(wide.deck.id, 2, saved(wide.item, moves(65))), /Slide moving: Stage shift: changes holds at most 64 entries/);
  assert.throws(() => built(moves(65), many), /Slide moving: Stage shift: changes holds at most 64 entries/);
  // Text slides: motion kinds and changes need SVG groups.
  for (const [extra, pattern] of [[{ motion: 'draw' }, /draw moves SVG groups/], [{ motion: 'enter' }, /enter moves SVG groups/], [{ changes: [{ groupId: 'dot', to: {} }] }, /require a vector composition/], [{ durationMs: 60001 }, /durationMs/]]) {
    const text = [{ id: 'words', title: 'Words', layout: 'process', stages: [{ id: 'one', title: 'One', ...extra }] }];
    for (const run of [() => store.saveDeck(deck.id, 1, text), () => buildDeck({ title: 'Words', slides: text })]) assert.throws(run, error => pattern.test(error.message) && /Slide words: Stage one: /.test(error.message));
  }
  // Metadata registered before stroke reporting defers the draw check to the build, which reads the source.
  const old = store.saveAsset({ name: 'old.svg', hash: 'old-metadata', kind: 'image', path: 'media/old.svg', metadata: { contentType: 'image/svg+xml', svgGroupIds: ['track', 'dot'] } });
  const oldItem = store.attachLibraryItem(deck.id, old.id, { category: 'Graphics' });
  assert.doesNotThrow(() => store.saveDeck(deck.id, 1, saved(oldItem, [{ id: 'draw', title: 'Draw', svgGroupIds: ['dot'], motion: 'draw' }])));
});

test('deleting the library SVG behind a moving slide leaves a deck that saves and builds', async t => {
  const { store, decks, queue, deck, item } = await fixture(t);
  const list = stages(); list[1].motion = 'fade';
  // A layout that needs no media, so the build's verdict is about the stages alone.
  const before = store.saveDeck(deck.id, 1, saved(item, list).map(slide => ({ ...slide, layout: 'process' })));
  const cards = store.deleteLibraryItem(deck.id, item.id, item.revision, before.revision).cards;
  assert.equal(cards[0].vector, null);
  // Group-only fields go; timing, easing and an explicit fade stay.
  assert.deepEqual(cards[0].stages, [
    { id: 'draw', title: 'Draw', body: '', trigger: 'auto', afterMs: 0, durationMs: 1000, holdMs: 200, easing: 'linear' },
    { id: 'arrive', title: 'Arrive', body: '', trigger: 'auto', afterMs: 0, durationMs: 400, motion: 'fade' },
    { id: 'travel', title: 'Travel', body: '', trigger: 'auto', afterMs: 0, durationMs: 2000, easing: 'ease-in-out' },
  ]);
  const after = store.getDeck(deck.id);
  const resaved = store.saveDeck(deck.id, after.revision, after.slides);
  assert.deepEqual(resaved.slides[0].stages, cards[0].stages);
  const job = decks.enqueue({ episodeId: deck.id, expectedRevision: resaved.revision });
  await queue.draining;
  const done = decks.getJob(deck.id, job.id); assert.equal(done.state, 'completed', done.error);
});

test('B10: the registered SVG and its ZIP copy are byte-identical with motion configured', async t => {
  const { root, store, decks, queue, deck, item } = await fixture(t);
  const build = async list => {
    const job = decks.enqueue({ episodeId: deck.id, expectedRevision: store.saveDeck(deck.id, store.getDeck(deck.id).revision, saved(item, list)).revision });
    await queue.draining;
    const done = decks.getJob(deck.id, job.id); assert.equal(done.state, 'completed', done.error);
    return { zip: await readFile(path.join(root, done.outputPath)), dir: path.dirname(path.join(root, done.outputPath)), manifest: done.snapshot.manifest };
  };
  const entry = (zip, name) => {
    for (let at = 0; zip.readUInt32LE(at) === 0x04034b50;) {
      const size = zip.readUInt32LE(at + 18), length = zip.readUInt16LE(at + 26), data = zip.subarray(at + 30 + length, at + 30 + length + size);
      if (zip.subarray(at + 30, at + 30 + length).toString() === name) return data;
      at += 30 + length + size;
    }
    throw new Error(`No ${name} in ZIP`);
  };
  const plain = await build(stages().map(({ id, title, svgGroupIds }) => ({ id, title, svgGroupIds: svgGroupIds ?? ['frame'] })));
  const moving = await build(stages());
  const registered = await readFile(path.join(root, item.asset.path));
  assert.deepEqual(registered, motionSvg);
  for (const bundle of [plain, moving]) {
    const file = bundle.manifest.assets[0].editableSource;
    assert.deepEqual(entry(bundle.zip, file), registered);
    assert.deepEqual(await readFile(path.join(bundle.dir, file)), registered);
  }
  // Motion is data on the stage, read by the runtime: no script, style or attribute enters the artwork.
  const html = entry(moving.zip, 'index.html').toString();
  assert.match(html, /data-motion="[^"]*&quot;motion&quot;:&quot;draw&quot;/);
  assert.doesNotMatch(html, /<animate|stroke-dashoffset|<script(?! src="audience\.js" defer>)/);
  assert.doesNotMatch(entry(plain.zip, 'index.html').toString(), /data-motion/);
});

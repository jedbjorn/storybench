// Spec #46 task #125, Types, candidates and iterations in data and tools. E11 (assistant tools), and the
// data and build halves of E8 (candidates and picks) and E9 (iterations in the tool and store).
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store, SCHEMA_VERSION } from '../src/store.js';
import { SLIDE_TYPES, DECK_LAYOUTS, validateSlides, visualKind } from '../src/deck-data.js';
import { createDeckService } from '../src/deck-service.js';
import { createLibraryService } from '../src/library.js';
import { createChatService } from '../src/chat.js';
import { STORYBENCH_TOOLS } from '../src/codex.js';
import { TOOL_DELIVERED } from '../src/tool-delivery.js';
import { initDataRoot, openDataRoot } from '../src/services/data-root.js';
import { createChannel } from '../src/services/channels.js';
import { createScopedTools } from '../src/runtime/tools.js';

const exec = promisify(execFile);
const SVG = new URL('../src/runtime/fixtures/svg-illustration.svg', import.meta.url);

// Library items as validateSlides reads them: id and asset kind/content type only.
const fake = (id, kind, contentType = kind === 'image' ? 'image/png' : undefined) => ({ id, asset: { kind, metadata: { contentType } } });
const ITEMS = [fake('red', 'image'), fake('green', 'image'), fake('blue', 'image'), fake('clip', 'video'), fake('drawing', 'image', 'image/svg+xml'),
  fake('voice', 'audio'), fake('notes', 'reference')];
const check = (slides, options = {}) => validateSlides(slides, { libraryItems: ITEMS, ...options });
const media = (overrides = {}) => ({ id: 's1', title: 'Picked', layout: 'text-media', media: { itemId: 'red', alt: 'Red' }, ...overrides });

test('the slide-type declaration states the Slide Types table and is what validation and save_deck read', () => {
  assert.deepEqual(Object.fromEntries(Object.entries(SLIDE_TYPES).map(([name, type]) => [name, [type.label, type.copy, type.visual.join('/'), type.columns?.join('-') ?? null, type.steps]])), {
    title: ['Title', true, 'drawing', null, 'optional'],
    section: ['Section break', true, '', null, 'optional'],
    statement: ['Statement', true, '', null, 'optional'],
    'text-media': ['Text and media', true, 'image/video/drawing/gallery', null, 'optional'],
    columns: ['Columns', true, '', '2-3', 'optional'],
    'full-media': ['Full media', true, 'image/video/drawing/gallery', null, 'optional'],
    process: ['Process', true, 'drawing', null, 'required'],
  });
  assert.deepEqual(DECK_LAYOUTS, ['title', 'section', 'statement', 'text-media', 'columns', 'full-media', 'process'], 'saved values stay as today');
  assert.ok(Object.isFrozen(SLIDE_TYPES) && Object.isFrozen(SLIDE_TYPES.title.visual));
  // validateSlides takes the drawing types from the declaration; the refusal reads as today.
  assert.throws(() => check([{ id: 's1', title: 'x', layout: 'statement', vector: { itemId: 'drawing' }, stages: [{ id: 'a', title: 'A', svgGroupIds: ['g'] }] }]),
    /Slide s1: vector requires title, text-media, full-media or process layout/);
  const tool = STORYBENCH_TOOLS.find(spec => spec.name === 'save_deck'), slide = tool.inputSchema.properties.slides.items;
  assert.deepEqual(slide.properties.layout.enum, DECK_LAYOUTS);
  for (const text of ['title (Title): visual drawing', 'section (Section break): no visual', 'columns (Columns): no visual, 2-3 columns', 'text-media (Text and media): visual image/video/drawing/gallery', 'process (Process): visual drawing, steps required'])
    assert.ok(tool.description.includes(text), text);
  assert.deepEqual(Object.keys(slide.properties.candidates.items.properties), ['itemId', 'alt', 'label']);
  assert.deepEqual(slide.properties.pickSetBy.enum, ['creator', 'agent', null]);
});

test('today\'s accepted combinations still save: a value the type has no slot for is kept, and limits stay with the build', () => {
  const kept = check([
    { id: 'gallery', title: 'Gallery on a statement', layout: 'statement', subnav: [{ id: 'v1', label: 'One', itemId: 'red' }] },
    { id: 'hidden', title: 'Media on a section', layout: 'section', media: { itemId: 'red', alt: '' }, candidates: [{ itemId: 'blue' }] },
    { id: 'cols', title: 'One column', layout: 'columns', columns: [{ title: 'Only' }] },
    { id: 'proc', title: 'Process before its steps', layout: 'process' },
  ]);
  assert.deepEqual(kept.map(slide => slide.id), ['gallery', 'hidden', 'cols', 'proc']);
  assert.deepEqual(kept[1].candidates, [{ itemId: 'blue', alt: '' }], 'candidates are kept, hidden, on a type without a visual');
});

test('candidates: slot kinds, one place per asset, same production, and a saved deck without them keeps today\'s shape', () => {
  const legacy = { id: 's1', title: 'Legacy', layout: 'text-media', body: 'b', media: { itemId: 'red', alt: 'Red' }, subnav: [], stages: [], columns: [] };
  const [plain] = check([legacy]);
  assert.equal(Object.hasOwn(plain, 'candidates'), false, 'no candidate key without candidates');
  assert.equal(Object.hasOwn(plain, 'pickSetBy'), false, 'no recorded setter without a save');
  const [withCandidates] = check([media({ candidates: [{ itemId: 'blue', alt: 'Blue square', label: 'Blue', extra: 'dropped' }, { itemId: 'clip' }, { itemId: 'drawing', label: '' }] })]);
  assert.deepEqual(withCandidates.candidates, [{ itemId: 'blue', alt: 'Blue square', label: 'Blue' }, { itemId: 'clip', alt: '' }, { itemId: 'drawing', alt: '' }]);
  assert.deepEqual(visualKind(ITEMS[4]), 'drawing'); assert.equal(visualKind(ITEMS[0]), 'image'); assert.equal(visualKind(ITEMS[3]), 'video');
  assert.throws(() => check([media({ candidates: [{ itemId: 'voice' }] })]), /Slide s1: candidate voice is audio; candidates are images, video or SVG drawings/);
  assert.throws(() => check([media({ candidates: [{ itemId: 'notes' }] })]), /candidate notes is reference/);
  assert.throws(() => check([media({ candidates: [{ itemId: 'elsewhere' }] })]), /Slide s1: library item not found: elsewhere/, 'only items of this production');
  assert.throws(() => check([media({ candidates: [{ itemId: 'blue' }, { itemId: 'blue' }] })]), /candidate blue is listed twice/);
  assert.throws(() => check([media({ candidates: [{ itemId: 'red' }] })]), /candidate red is also the slide's pick/);
  assert.throws(() => check([media({ subnav: [{ id: 'v', label: 'V', itemId: 'blue' }], candidates: [{ itemId: 'blue' }] })]), /candidate blue is also the slide's pick/);
  assert.throws(() => check([media({ candidates: { itemId: 'blue' } })]), /candidates must be an array/);
  assert.throws(() => check([media({ candidates: [{ alt: 'no item' }] })]), /each candidate needs an itemId/);
  assert.throws(() => check([media({ candidates: [{ itemId: 'blue', alt: 7 }] })]), /candidate alt must be text/);
  // Starring a drawing where media is picked follows today's rules and messages.
  assert.throws(() => check([media({ vector: { itemId: 'drawing' }, stages: [{ id: 'a', title: 'A', svgGroupIds: ['g'] }] })]), /vector composition cannot also contain media or gallery views/);
});

test('saves: star moves an asset between the picks and candidates, a starred candidate cannot be removed, and omitted candidates are kept', () => {
  const [saved] = check([media({ candidates: [{ itemId: 'blue', alt: 'Blue' }] })], { previous: [], setBy: 'creator' });
  const save = (slide, setBy = 'creator') => check([slide], { previous: [saved], setBy })[0];
  // Star blue: it moves into media and red moves into candidates.
  const starred = save(media({ media: { itemId: 'blue', alt: 'Blue' }, candidates: [{ itemId: 'red', alt: 'Red' }] }));
  assert.deepEqual([starred.media.itemId, starred.candidates], ['blue', [{ itemId: 'red', alt: 'Red' }]]);
  // Unstar: no pick, both candidates, the slot is empty.
  const unstarred = save(media({ media: null, candidates: [{ itemId: 'red' }, { itemId: 'blue' }] }));
  assert.equal(unstarred.media, null); assert.deepEqual(unstarred.candidates.map(c => c.itemId), ['red', 'blue']);
  // Removing the starred candidate (red) is refused, whether or not another is starred in its place.
  assert.throws(() => save(media({ media: null, candidates: [{ itemId: 'blue' }] })), /Slide s1: red is starred on this slide and cannot be removed; star another or keep it in candidates, then remove it/);
  assert.throws(() => save(media({ media: { itemId: 'blue' }, candidates: [] })), /red is starred on this slide and cannot be removed/);
  // Removing an unpicked candidate is fine.
  assert.equal(Object.hasOwn(save(media({ candidates: [] })), 'candidates'), false);
  // A save that omits candidates keeps the saved list, less what it now picks: it behaves as today.
  assert.deepEqual(save(media({ body: 'Edited' })).candidates, [{ itemId: 'blue', alt: 'Blue' }]);
  const replaced = save(media({ media: { itemId: 'blue', alt: '' } }));
  assert.equal(replaced.media.itemId, 'blue'); assert.equal(Object.hasOwn(replaced, 'candidates'), false, 'the newly picked asset left the list; red is replaced as today');
  // A new slide, a deleted slide and a build (no save) never meet the removal rule.
  assert.equal(check([media({ id: 's2', media: null })], { previous: [saved], setBy: 'agent' })[0].media, null);
  assert.deepEqual(check([{ id: 'other', title: 'Other', layout: 'statement' }], { previous: [saved], setBy: 'creator' }).map(s => s.id), ['other']);
  assert.equal(check([media({ media: null, candidates: [] })])[0].media, null);
});

test('a save that changes a slide\'s picks records who changed it; other saves keep the record', () => {
  const save = (slides, previous, setBy) => check(slides, { previous, setBy });
  const [first] = save([media()], [], 'agent');
  assert.equal(first.pickSetBy, 'agent', 'a new slide with a pick records the saver');
  assert.equal(save([{ id: 'bare', title: 'No pick', layout: 'statement' }], [], 'agent')[0].pickSetBy, undefined, 'no pick, nothing to record');
  const [edited] = save([media({ body: 'Creator edits text', pickSetBy: 'creator' })], [first], 'creator');
  assert.equal(edited.pickSetBy, 'agent', 'unchanged picks keep the record; a supplied pickSetBy is ignored');
  const [restarred] = save([media({ media: { itemId: 'blue', alt: '' }, candidates: [{ itemId: 'red' }] })], [first], 'creator');
  assert.equal(restarred.pickSetBy, 'creator');
  const gallery = media({ media: null, layout: 'full-media', subnav: [{ id: 'a', label: 'A', itemId: 'red' }, { id: 'b', label: 'B', itemId: 'blue' }] });
  const [ordered] = save([gallery], [restarred], 'agent');
  const [reordered] = save([{ ...gallery, subnav: [...gallery.subnav].reverse() }], [{ ...ordered, pickSetBy: 'creator' }], 'agent');
  assert.equal(reordered.pickSetBy, 'agent', 'gallery play order is part of the pick');
  const [relabelled] = save([{ ...gallery, subnav: gallery.subnav.map(v => ({ ...v, label: `${v.label}!` })) }], [{ ...ordered, pickSetBy: 'creator' }], 'agent');
  assert.equal(relabelled.pickSetBy, 'creator', 'labels are not picks');
  // Without a setter (undo restores, the build reads) the recorded value is kept as saved, and checked.
  assert.equal(check([media({ pickSetBy: 'creator' })])[0].pickSetBy, 'creator');
  assert.throws(() => check([media({ pickSetBy: 'someone' })]), /Slide s1: pickSetBy must be creator or agent/);
});

async function png(dir, name, color) {
  const file = path.join(dir, name);
  await exec('ffmpeg', ['-v', 'error', '-nostdin', '-f', 'lavfi', '-i', `color=c=${color}:s=64x48:d=1`, '-frames:v', '1', file]);
  return file;
}
async function deckFixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sb-candidates-')), scratch = await mkdtemp(path.join(os.tmpdir(), 'sb-candidates-src-'));
  const store = new Store(root), decks = createDeckService({ store }), library = createLibraryService({ workspace: root, store });
  t.after(async () => { await decks.close(); store.close(); await rm(root, { recursive: true, force: true }); await rm(scratch, { recursive: true, force: true }); });
  const deck = store.createEpisode({ kind: 'deck', title: 'Candidates' });
  store.ensureEpisodeDirectories(deck.id);
  const register = async (file, label, selectedCategory = 'Graphics') => library.registerFile({ episodeId: deck.id, readable: Readable.from(await readFile(file)), fileName: path.basename(file), label, selectedCategory });
  const items = {
    red: await register(await png(scratch, 'red.png', 'red'), 'Red'),
    green: await register(await png(scratch, 'green.png', 'green'), 'Green'),
    blue: await register(await png(scratch, 'blue.png', 'blue'), 'Blue'),
    drawing: await register(fileURLToPath(SVG), 'Drawing'),
  };
  const build = async () => {
    const job = decks.enqueue({ episodeId: deck.id, expectedRevision: store.getDeck(deck.id).revision });
    for (let n = 0; n < 400; n++) {
      const value = decks.getJob(deck.id, job.id);
      if (!['queued', 'running'].includes(value.state)) {
        assert.equal(value.state, 'completed', value.error);
        const base = path.dirname(path.join(root, value.outputPath)), files = {};
        for (const file of value.snapshot.manifest.files) files[file] = await readFile(path.join(base, file));
        return { job: value, files, html: String(files['index.html']) };
      }
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error('build timed out');
  };
  return { root, store, decks, deck, items, build, save: (slides, actor = 'human') => store.saveDeck(deck.id, store.getDeck(deck.id).revision, slides, actor) };
}
const srcOf = item => `assets/media_${item.assetId.replace(/[^a-zA-Z0-9_-]/g, '_')}.png`;

test('E8 build half: starring switches the next build\'s slide, a gallery builds exactly its starred views in order, and candidates never reach the build', async t => {
  const { items, build, save, store, deck } = await deckFixture(t);
  const { red, green, blue } = items;
  save([{ id: 'hero', title: 'Hero', layout: 'text-media', media: { itemId: red.id, alt: 'Red' }, candidates: [{ itemId: blue.id, alt: 'Blue' }] }]);
  const before = await build();
  assert.ok(before.html.includes(srcOf(red)) && !before.html.includes(srcOf(blue)), 'only the pick is built');
  assert.equal(before.job.snapshot.slides[0].candidates, undefined, 'the build snapshot carries no candidates');
  save([{ id: 'hero', title: 'Hero', layout: 'text-media', media: { itemId: blue.id, alt: 'Blue' }, candidates: [{ itemId: red.id, alt: 'Red' }] }]);
  const after = await build();
  assert.ok(after.html.includes(srcOf(blue)) && !after.html.includes(srcOf(red)), 'the starred candidate is built');
  // Three candidates, two starred: the gallery holds exactly the two, in their order.
  save([{ id: 'hero', title: 'Gallery', layout: 'full-media', media: null,
    subnav: [{ id: 'v1', label: 'Green', itemId: green.id }, { id: 'v2', label: 'Red', itemId: red.id }], candidates: [{ itemId: blue.id, alt: 'Blue' }] }]);
  const gallery = await build();
  const order = [green, red, blue].map(item => gallery.html.indexOf(srcOf(item)));
  assert.ok(order[0] > 0 && order[1] > order[0], `green then red: ${order}`);
  assert.equal(order[2], -1, 'the unstarred candidate is not built');
  assert.ok(!Object.keys(gallery.files).some(name => name === srcOf(blue)), 'nor packaged');
  // The same deck with no candidates builds byte-identical files.
  const slides = store.getDeck(deck.id).slides.map(({ candidates, pickSetBy, ...slide }) => slide);
  save(slides);
  const bare = await build();
  assert.deepEqual(Object.keys(bare.files).sort(), Object.keys(gallery.files).sort());
  for (const [name, bytes] of Object.entries(gallery.files)) if (name !== 'manifest.json') assert.ok(bare.files[name].equals(bytes), `${name} identical`);
  const manifest = value => { const { sourceRevision, ...rest } = JSON.parse(value.files['manifest.json']); return rest; };
  assert.deepEqual(manifest(bare), manifest(gallery));
});

test('E8: a deck saved before this change loads, validates to today\'s shape and builds; undo and library delete keep candidates consistent', async t => {
  const { items, build, store, deck, save } = await deckFixture(t);
  const { red, blue, green } = items;
  // A pre-change saved deck: slides exactly as today's code stored them.
  const legacy = [{ id: 'opening', title: 'Opening', layout: 'text-media', body: 'B', notes: '', eyebrow: '', caption: '', targetMinutes: 1, sectionId: null,
    referenceItemIds: [], stages: [], subnav: [], columns: [], media: { itemId: red.id, alt: 'Red' } }];
  store.db.prepare('UPDATE episodes SET cards=? WHERE id=?').run(JSON.stringify(legacy), deck.id);
  assert.deepEqual(store.getDeck(deck.id).slides, legacy, 'loads unchanged');
  assert.deepEqual(store.validateDeckSlides(deck.id, legacy), legacy, 'validates to exactly the saved shape');
  assert.ok((await build()).html.includes(srcOf(red)));
  // A creator save that changes only text leaves the pick unrecorded (the pick did not change).
  const edited = save([{ ...legacy[0], body: 'Edited' }]);
  assert.equal(edited.slides[0].pickSetBy, undefined);
  // Undo restores a recorded state whole, even one without the current pick.
  save([{ ...legacy[0], media: { itemId: green.id, alt: '' }, candidates: [{ itemId: red.id }, { itemId: blue.id }] }]);
  const current = store.getDeck(deck.id);
  assert.equal(current.slides[0].pickSetBy, 'creator');
  const undone = store.undoEpisode(deck.id, current.revision);
  assert.equal(undone.cards[0].media.itemId, red.id); assert.equal(undone.cards[0].candidates, undefined);
  // Deleting an unpicked candidate from the library removes it from candidate lists.
  save([{ ...legacy[0], candidates: [{ itemId: blue.id }, { itemId: green.id }] }]);
  const withList = store.getDeck(deck.id), blueItem = store.getLibraryItem(deck.id, blue.id);
  store.deleteLibraryItem(deck.id, blue.id, blueItem.revision, withList.revision);
  assert.deepEqual(store.getDeck(deck.id).slides[0].candidates, [{ itemId: green.id, alt: '' }]);
  assert.equal(store.getDeck(deck.id).slides[0].media.itemId, red.id);
  assert.ok((await build()).html.includes(srcOf(red)), 'still builds after the delete');
});

// The real assistant tools: chat.js binds read_deck and save_deck for a deck production's turn.
function chatFixture(t, onTurn) {
  return (async () => {
    const f = await deckFixture(t);
    let turns = 0;
    const factory = async (options) => ({
      startThread: async () => 'thread', resumeThread: async () => 'thread', close() {},
      async startTurn() {
        turns++;
        try { await onTurn(options.tools, f); } catch (error) { f.error = error; }
        queueMicrotask(() => options.onEvent({ method: 'turn/completed', params: { turn: { id: `turn-${turns}`, status: 'completed' } } }));
        return `turn-${turns}`;
      },
    });
    const chat = createChatService({ store: f.store, codexFactory: factory });
    t.after(() => chat.close());
    const conversation = chat.create(f.deck.id);
    await chat.send(f.deck.id, conversation.id, 'Add the blue one as a candidate, then use it');
    for (let i = 0; i < 400 && (turns === 0 || chat.get(f.deck.id, conversation.id).state !== 'idle'); i++) await new Promise(resolve => setTimeout(resolve, 10));
    if (f.error) throw f.error;
    return f;
  })();
}

test('E11: read_deck returns candidates, save_deck round-trips them, a pick change records the agent, and saves without candidates behave as today', async t => {
  const seen = {};
  const f = await chatFixture(t, async (tools, { items, store, deck }) => {
    const { red, blue, green } = items;
    store.saveDeck(deck.id, store.getDeck(deck.id).revision, [{ id: 'hero', title: 'Hero', layout: 'text-media', media: { itemId: red.id, alt: 'Red' } }], 'human');
    const research = tools.read_research(); research[TOOL_DELIVERED]();
    // Add a candidate without changing the pick.
    let read = tools.read_deck();
    seen.creatorPick = read.slides[0].pickSetBy;
    let saved = tools.save_deck({ expectedRevision: read.revision, slides: read.slides.map(slide => ({ ...slide, candidates: [{ itemId: blue.id, alt: 'Blue', label: 'Option B' }] })) });
    seen.afterCandidate = saved.slides[0];
    // Round-trip: what read_deck returns saves back unchanged.
    read = tools.read_deck();
    seen.read = read.slides[0];
    saved = tools.save_deck({ expectedRevision: read.revision, slides: read.slides });
    seen.roundTrip = saved.slides[0];
    // Use it: the star moves to blue; red stays as a candidate.
    saved = tools.save_deck({ expectedRevision: saved.revision, slides: [{ ...saved.slides[0], media: { itemId: blue.id, alt: 'Blue' }, candidates: [{ itemId: red.id, alt: 'Red' }] }] });
    seen.used = saved.slides[0];
    // Dropping the starred blue is refused.
    try { tools.save_deck({ expectedRevision: saved.revision, slides: [{ ...saved.slides[0], media: { itemId: green.id }, candidates: [{ itemId: red.id }] }] }); }
    catch (error) { seen.refused = error.message; }
    // A save without candidates (today's shape) replaces media as today and keeps the list.
    const { candidates, pickSetBy, ...today } = saved.slides[0];
    saved = tools.save_deck({ expectedRevision: saved.revision, slides: [{ ...today, media: { itemId: green.id, alt: 'Green' } }] });
    seen.today = saved.slides[0];
  });
  const { red, blue, green } = f.items;
  assert.equal(seen.creatorPick, 'creator');
  assert.deepEqual(seen.afterCandidate.candidates, [{ itemId: blue.id, alt: 'Blue', label: 'Option B' }]);
  assert.equal(seen.afterCandidate.pickSetBy, 'creator', 'adding a candidate does not change the pick or its record');
  assert.deepEqual(seen.read.candidates, seen.afterCandidate.candidates, 'read_deck returns candidates');
  assert.deepEqual(seen.roundTrip, seen.read, 'save_deck round-trips read_deck slides');
  assert.equal(seen.used.media.itemId, blue.id); assert.deepEqual(seen.used.candidates, [{ itemId: red.id, alt: 'Red' }]);
  assert.equal(seen.used.pickSetBy, 'agent', 'the pick change records the agent');
  assert.match(seen.refused, new RegExp(`${blue.id} is starred on this slide and cannot be removed`));
  assert.equal(seen.today.media.itemId, green.id); assert.deepEqual(seen.today.candidates, [{ itemId: red.id, alt: 'Red' }]);
  const history = f.store.listEpisodeHistory(f.deck.id);
  assert.equal(history[0].actor, 'agent');
});

test('E9 store and tool half: migration makes existing items one-iteration groups; register_work_file iterationOf lands the next iteration', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sb-iterations-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  initDataRoot(root);
  const channel = createChannel(root, 'Iterations'), other = createChannel(root, 'Other');
  let store = openDataRoot(root);
  const deck = store.createEpisode({ kind: 'deck', title: 'Plans', channelId: channel.id }), elsewhere = store.createEpisode({ kind: 'deck', title: 'Elsewhere', channelId: other.id });
  for (const episode of [deck, elsewhere]) store.ensureEpisodeDirectories(episode.id);
  const work = store.episodeWorkDirectory(deck.id), svg = await readFile(SVG, 'utf8');
  await writeFile(path.join(work, 'plan-v1.svg'), svg);
  await writeFile(path.join(work, 'plan-v2.svg'), svg.replace('id="plan"', 'id="plan-b"'));
  await writeFile(path.join(work, 'plan-v3.svg'), svg.replace('id="plan"', 'id="plan-c"'));
  await exec('ffmpeg', ['-v', 'error', '-nostdin', '-f', 'lavfi', '-i', 'color=c=gray:s=32x32:d=1', '-frames:v', '1', path.join(store.episodeWorkDirectory(elsewhere.id), 'x.png')]);
  const scope = episode => ({ requestId: 'request_iter', conversationId: null, harness: 'codex', model: 'm', channelId: episode.channelId, episodeId: episode.id, dataRoot: root,
    episodeDir: store.episodeDirectory(episode.id), workDir: store.episodeWorkDirectory(episode.id), requestWorkDir: path.join(store.episodeWorkDirectory(episode.id), 'request_iter') });
  const tools = episode => createScopedTools(scope(episode), { store, library: createLibraryService({ workspace: root, store }) });
  const call = async (episode, args) => JSON.parse((await tools(episode).call('register_work_file', args)).text);
  const v1 = await call(deck, { path: 'work/plan-v1.svg', name: 'Floor plan' });
  assert.deepEqual([v1.iterationGroup, v1.iteration, v1.label], [v1.libraryItemId, 1, 'Floor plan'], 'without iterationOf a file starts its own group');
  const v2 = await call(deck, { path: 'work/plan-v2.svg', name: 'Floor plan, wider door', iterationOf: v1.libraryItemId });
  assert.deepEqual([v2.iterationGroup, v2.iteration, v2.label], [v1.libraryItemId, 2, 'Floor plan'], 'v2 joins the group and shares its label');
  const v3 = await call(deck, { path: 'work/plan-v3.svg', iterationOf: v2.libraryItemId });
  assert.deepEqual([v3.iterationGroup, v3.iteration], [v1.libraryItemId, 3], 'naming any member continues the group');
  assert.notEqual(store.getLibraryItem(deck.id, v1.libraryItemId).asset.hash, store.getLibraryItem(deck.id, v2.libraryItemId).asset.hash, 'files are never changed in place');
  const outside = await call(elsewhere, { path: 'work/x.png' });
  await assert.rejects(tools(deck).call('register_work_file', { path: 'work/plan-v2.svg', iterationOf: outside.libraryItemId }), { code: 'INVALID_ITERATION' });
  await assert.rejects(tools(deck).call('register_work_file', { path: 'work/plan-v2.svg', iterationOf: 'library_missing' }), { code: 'INVALID_ITERATION' });
  // The assistant sees the groups in get_context.
  const context = (await import('../src/production-read-tools.js')).createProductionReadTools({ store, episodeId: deck.id, brandStandards: null });
  const listed = context.get_context().library.filter(item => item.iterationGroup === v1.libraryItemId).map(item => item.iteration);
  assert.deepEqual(listed, [1, 2, 3]);
  // Migration: a database from before groups gets one-iteration groups and keeps every item.
  store.db.exec('DROP INDEX library_items_iteration; ALTER TABLE library_items DROP COLUMN iteration_group; ALTER TABLE library_items DROP COLUMN iteration; PRAGMA user_version=21');
  store.close();
  store = openDataRoot(root);
  t.after(() => store.close());
  assert.equal(Number(store.db.prepare('PRAGMA user_version').get().user_version), SCHEMA_VERSION);
  const migrated = store.listEpisodeLibrary(deck.id);
  assert.equal(migrated.length, 3);
  for (const item of migrated) assert.deepEqual([item.iterationGroup, item.iteration], [item.id, 1]);
  assert.deepEqual(store.db.prepare('SELECT COUNT(*) AS n FROM library_items WHERE iteration_group IS NULL').get().n, 0);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { Store, RESEARCH_LIMITS } from '../src/store.js';
import { createChatService } from '../src/chat.js';
import { AUTHORING_TOOLS, STORYBENCH_TOOLS } from '../src/codex.js';
import { createV9ConversationPersistence } from '../src/runtime/conversation-persistence.js';
import { mergeTools, defaultBootContextFor } from '../src/runtime/app-runtime.js';
import { createScopedTools } from '../src/runtime/tools.js';
import { selectKindTools } from '../src/runtime/kinds.js';
import { renderEpisodeBoot } from '../src/runtime/boot.js';
import { nativeFixture } from '../test-support/research-harness.js';

const tick = () => new Promise(resolve => setTimeout(resolve, 5));
async function until(check) { for (let i = 0; i < 400; i++) { if (check()) return; await tick(); } throw new Error('Fixture did not settle'); }
const findings = (label = 'first') => ({ summary: `# Distinctive ${label} findings\n\nUncertainty: this is a fixture, not verified.\n${'Factual context. '.repeat(400)}\nEND-${label}`, links: [{ id: 'stable_source', url: `https://unavailable.example.test/${label}.png`, title: `${label} source`, note: 'Saved URL, not fetched contents or output media' }] });
const slide = () => ({ id: 'slide_one', title: 'Opening', layout: 'statement', body: 'A claim', notes: 'Explain uncertainty', targetMinutes: 1 });
function fixture(t, { kind = 'video', stage = 'Scaffold', archived = false, continuity = false, acknowledgePrompt = true } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'sb-ra-')), store = new Store(root), launches = [], enqueued = [];
  let p = store.createEpisode({ kind });
  p = store.updateEpisode(p.id, p.revision, { state: stage, archived, ...(kind === 'video' ? { cards: [{ id: 'card_one', title: 'Scene', type: 'Static Graphic', duration: 1 }] } : {}) });
  const persistence = createV9ConversationPersistence(store);
  const renderJob = input => { enqueued.push(input); return store.saveJob({ episodeId: p.id, kind: 'draft', state: 'completed', revision: store.getEpisode(p.id).revision, snapshot: { savedInput: input }, requestId: input.requestId }); };
  const renders = { enqueueRender: renderJob, enqueueGraphic: renderJob, getJob: (_episode, id) => store.getJob(id),
    createGraphicRecipe: (episode, input, actor) => store.createGraphicRecipe(episode, { ...input, kind: 'still' }, actor),
    updateGraphicRecipe: (...args) => store.updateGraphicRecipe(...args) };
  const factory = async options => {
    const entry = { options, prompt: null, resumed: null }; launches.push(entry);
    return { startThread: async () => `thread-${launches.length}`, resumeThread: async id => { entry.resumed = id; return id; },
      startTurn: async (_id, text, _images, { onDelivered } = {}) => { entry.prompt = JSON.parse(JSON.stringify(text)); if (acknowledgePrompt) onDelivered?.(); return `turn-${launches.length}`; },
      interrupt: async () => options.onEvent({ method: 'turn/completed', params: { turn: { id: `turn-${launches.length}`, status: 'interrupted' } } }), close() {} };
  };
  const catalog = ['codex', 'claude', 'opencode'].map(harness => ({ harness, source: `${harness}-login`, available: true, models: [{ id: 'fixture', efforts: [], inputModalities: ['text', 'image'] }] }));
  const chat = createChatService({ store, renders, decks: { enqueue: renderJob }, codexFactory: factory, requestPersistence: persistence,
    ...(continuity ? { continuity: { persistence, catalog: async () => catalog } } : {}) });
  const conversation = chat.create(p.id);
  t.after(async () => { await chat.close(); store.close(); rmSync(root, { recursive: true, force: true }); });
  return { root, store, chat, p, conversation, launches, enqueued,
    get entry() { return launches.at(-1); },
    async start(kind = null) {
      const count = launches.length;
      if (kind) await chat.sendProduction(p.id, conversation.id, { kind, clientRequestId: crypto.randomUUID(), ...(kind === 'card_build' ? { targetCardId: 'card_one' } : {}) });
      else await chat.send(p.id, conversation.id, 'Discuss this, and follow my later directions');
      await until(() => (launches.length > count && launches.at(-1)?.prompt) || chat.get(p.id, conversation.id).state === 'error');
    },
    async finish() { launches.at(-1).options.onEvent({ method: 'turn/completed', params: { turn: { id: `turn-${launches.length}`, status: 'completed' } } }); await until(() => !chat.hasActiveWorkers()); },
    native(t, harness) { return nativeFixture(t, harness, selectKindTools(mergeTools({ definitions: [], call() {} }, launches.at(-1).options.tools), kind), root); },
  };
}
const savedInPrompt = prompt => JSON.parse(/Complete saved production research \(JSON data\):\n([^\n]+)/.exec(prompt)[1]);

test('deleted gallery items survive read/edit/save under the shared schema and all native adapters', async t => {
  for (const harness of ['codex', 'claude', 'opencode']) await t.test(harness, async t => {
    const f = fixture(t, { kind: 'deck' });
    const asset = f.store.saveAsset({ name: 'gallery.png', hash: 'gallery-fixture', kind: 'image', path: 'media/gallery.png', metadata: {} });
    const item = f.store.attachLibraryItem(f.p.id, asset.id, { category: 'B-roll' });
    const other = f.store.createEpisode({ kind: 'deck' });
    const foreign = f.store.attachLibraryItem(other.id, asset.id, { category: 'B-roll' });
    await f.start();
    const native = await f.native(t, harness);
    assert.equal((await native.call('read_research')).failed, false);
    const saved = await native.call('save_deck', { expectedRevision: f.store.getDeck(f.p.id).revision,
      slides: [{ ...slide(), subnav: [{ id: 'detail', label: 'Detail', itemId: item.id }] }] });
    assert.equal(saved.failed, false, saved.text);
    f.store.deleteLibraryItem(f.p.id, item.id, item.revision, f.store.getDeck(f.p.id).revision);
    const read = await native.call('read_deck');
    assert.equal(read.failed, false, read.text);
    const deck = JSON.parse(read.text);
    assert.equal(deck.slides[0].subnav[0].itemId, null);
    for (const definitions of [STORYBENCH_TOOLS, native.definitions]) {
      const schema = definitions.find(tool => tool.name === 'save_deck').inputSchema;
      assert.deepEqual(schema.properties.slides.items.properties.subnav.items.properties.itemId, { type: ['string', 'null'] });
    }
    deck.slides[0].title = 'Edited after Library deletion';
    const edited = await native.call('save_deck', { expectedRevision: deck.revision, slides: deck.slides });
    assert.equal(edited.failed, false, edited.text);
    const current = f.store.getDeck(f.p.id);
    // Saving normalizes an empty gallery reference to an absent itemId.
    delete deck.slides[0].subnav[0].itemId;
    assert.deepEqual(current.slides, deck.slides);
    for (const invalidId of [item.id, foreign.id]) {
      const invalid = structuredClone(current.slides);
      invalid[0].subnav[0].itemId = invalidId;
      const rejected = await native.call('save_deck', { expectedRevision: current.revision, slides: invalid });
      assert.equal(rejected.failed, true, rejected.text);
      assert.deepEqual(f.store.getDeck(f.p.id), current);
    }
  });
});

// The JSON Schema keywords these tool schemas use; returns the first violation, or null.
function schemaViolation(schema, value, at = '$') {
  if (schema.anyOf) return schema.anyOf.some(branch => !schemaViolation(branch, value, at)) ? null : `${at}: matches no anyOf branch`;
  const types = [schema.type ?? []].flat(), type = value === null ? 'null' : Array.isArray(value) ? 'array' : Number.isInteger(value) ? 'integer' : typeof value;
  if (types.length && !types.includes(type) && !(type === 'integer' && types.includes('number'))) return `${at}: ${type} is not ${types.join('|')}`;
  if (schema.enum && !schema.enum.includes(value)) return `${at}: ${JSON.stringify(value)} is not in the enum`;
  if (type === 'object') {
    for (const key of schema.required ?? []) if (!(key in value)) return `${at}.${key}: required`;
    for (const [key, child] of Object.entries(value)) {
      if (!schema.properties?.[key]) { if (schema.additionalProperties === false) return `${at}.${key}: not allowed`; continue; }
      const found = schemaViolation(schema.properties[key], child, `${at}.${key}`); if (found) return found;
    }
  }
  if (type === 'array' && schema.items) for (const [index, child] of value.entries()) { const found = schemaViolation(schema.items, child, `${at}[${index}]`); if (found) return found; }
  return null;
}

test('spec #44: the complete design read_deck returns saves back through save_deck; unchanged values keep their setBy', async t => {
  for (const harness of ['codex', 'claude', 'opencode']) await t.test(harness, async t => {
    const f = fixture(t, { kind: 'deck' });
    await f.start();
    const native = await f.native(t, harness);
    assert.equal((await native.call('read_research')).failed, false);
    const agentSaved = await native.call('save_deck', { expectedRevision: f.store.getDeck(f.p.id).revision, slides: [slide()],
      design: { theme: { colors: { base: '#123456' }, fonts: { accent: 'Kalam' } } } });
    assert.equal(agentSaved.failed, false, agentSaved.text);
    const human = f.store.getDeck(f.p.id);
    f.store.saveDeck(f.p.id, human.revision, human.slides, 'human', { theme: { colors: { base: '#123456', accent: '#C03060' }, fonts: { accent: 'Kalam' } } });
    const read = await native.call('read_deck');
    assert.equal(read.failed, false, read.text);
    const deck = JSON.parse(read.text);
    assert.deepEqual(deck.design.theme.setBy, { colors: { base: 'agent', accent: 'creator' }, fonts: { accent: 'agent' } });
    // Modify one value and send the complete returned design back, setBy included.
    deck.design.theme.colors.background = '#F0E0A0';
    const input = { expectedRevision: deck.revision, slides: deck.slides, design: deck.design };
    for (const definitions of [STORYBENCH_TOOLS, native.definitions])
      assert.equal(schemaViolation(definitions.find(tool => tool.name === 'save_deck').inputSchema, input), null);
    const saved = await native.call('save_deck', input);
    assert.equal(saved.failed, false, saved.text);
    assert.deepEqual(f.store.getDeck(f.p.id).design.theme, { colors: { base: '#123456', accent: '#C03060', background: '#F0E0A0' }, fonts: { accent: 'Kalam' },
      setBy: { colors: { base: 'agent', accent: 'creator', background: 'agent' }, fonts: { accent: 'agent' } } });
    // A caller's setBy is provenance the save path ignores: claiming a creator value as the agent's changes nothing.
    const claimed = f.store.getDeck(f.p.id);
    claimed.design.theme.setBy.colors.accent = 'agent';
    const reclaimed = await native.call('save_deck', { expectedRevision: claimed.revision, slides: claimed.slides, design: claimed.design });
    assert.equal(reclaimed.failed, false, reclaimed.text);
    assert.equal(f.store.getDeck(f.p.id).design.theme.setBy.colors.accent, 'creator');
  });
});

test('spec #44 layout primitives: save_deck accepts deck defaults and slide overrides within its schema, refuses unbounded values naming slide, primitive and argument, and read_deck returns them', async t => {
  for (const harness of ['codex', 'claude', 'opencode']) await t.test(harness, async t => {
    const f = fixture(t, { kind: 'deck' });
    await f.start();
    const native = await f.native(t, harness);
    assert.equal((await native.call('read_research')).failed, false);
    const design = { stageText: { align: 'center', style: 'card', numbered: true, flipMs: 500 }, type: { scale: 'large' }, spacing: { density: 'compact' }, timing: { betweenMs: 300 } };
    const slides = [{ ...slide(), design: { copy: { align: 'end', valign: 'start' }, stageText: { style: 'list' } } }];
    const input = { expectedRevision: f.store.getDeck(f.p.id).revision, slides, design };
    for (const definitions of [STORYBENCH_TOOLS, native.definitions])
      assert.equal(schemaViolation(definitions.find(tool => tool.name === 'save_deck').inputSchema, input), null);
    const saved = await native.call('save_deck', input);
    assert.equal(saved.failed, false, saved.text);
    const read = JSON.parse((await native.call('read_deck')).text);
    assert.deepEqual(read.design.stageText, design.stageText); assert.deepEqual(read.design.timing, design.timing);
    assert.deepEqual(read.slides[0].design, slides[0].design);
    for (const [bad, pattern] of [
      [{ slides: [{ ...slide(), design: { copy: { align: 'text-align:right' } } }] }, /Slide slide_one: design\.copy\.align must be one of start, center, end/],
      [{ slides: [{ ...slide(), design: { copy: { position: 'left' } } }] }, /Slide slide_one: design\.copy\.position needs a visual/],
      [{ slides, design: { stageText: { style: 'carousel' } } }, /Deck design: stageText\.style must be one of chips, steps, list, card/],
    ]) {
      const refused = await native.call('save_deck', { expectedRevision: read.revision, ...bad });
      assert.equal(refused.failed, true); assert.match(refused.text, pattern);
    }
    assert.equal(f.store.getDeck(f.p.id).revision, read.revision, 'refused saves store nothing');
  });
});

test('typed authoring matrix: full content, not metadata or an undelivered return, authorizes each request; stale context is refused across kinds/stages/archive and native adapters', async t => {
  const originalFetch = globalThis.fetch, fetched = []; globalThis.fetch = async (...args) => { fetched.push(args); throw new Error('No network allowed'); }; t.after(() => { globalThis.fetch = originalFetch; });
  for (const kind of ['video', 'deck']) for (const harness of ['codex', 'claude', 'opencode']) for (const state of ['Scaffold', 'Draft', 'Final', 'Published', 'Archived']) await t.test(`${kind}/${harness}/${state}`, async t => {
    const f = fixture(t, { kind, stage: state === 'Archived' ? 'Final' : state, archived: state === 'Archived' });
    const initial = f.store.saveResearch(f.p.id, 1, findings()); await f.start();
    assert.doesNotMatch(f.entry.prompt, /Distinctive first findings|END-first|unavailable\.example/);
    const context = f.entry.options.tools.get_context();
    assert.deepEqual(context.research, { episodeId: f.p.id, available: true, researchRevision: 2, readOperation: 'read_research' });
    assert.doesNotMatch(JSON.stringify(context), /Distinctive first findings|END-first|unavailable\.example/);
    const mutate = () => kind === 'deck' ? f.entry.options.tools.save_deck({ expectedRevision: f.store.getEpisode(f.p.id).revision, slides: [slide()], researchRevision: initial.researchRevision }) : f.entry.options.tools.update_cards({ expectedRevision: f.store.getEpisode(f.p.id).revision, cards: [], researchRevision: initial.researchRevision });
    const native = await f.native(t, harness);
    const name = kind === 'deck' ? 'save_deck' : 'update_cards';
    const args = () => kind === 'deck' ? { expectedRevision: f.store.getEpisode(f.p.id).revision, slides: [slide()] } : { expectedRevision: f.store.getEpisode(f.p.id).revision, cards: [] };
    const before = f.store.getEpisode(f.p.id);
    const missing = await native.call(name, args()); assert.equal(missing.failed, true); assert.match(missing.text, /has not been delivered/);
    assert.throws(mutate, /has not been delivered/);
    const notDelivered = f.entry.options.tools.read_research();
    assert.deepEqual(JSON.parse(JSON.stringify(notDelivered)), initial);
    assert.throws(mutate, /has not been delivered/, 'calling a handler or guessing a number cannot claim serialization');
    const delivered = await native.call('read_research'); assert.equal(delivered.failed, false);
    assert.deepEqual(JSON.parse(delivered.text), initial);
    assert.deepEqual(f.store.getEpisode(f.p.id), before); assert.equal((await native.call(name, args())).failed, false);
    const newer = f.store.saveResearch(f.p.id, 2, findings('newer'), 'human'), after = f.store.getEpisode(f.p.id);
    assert.throws(mutate, /changed since delivery/); const stale = await native.call(name, args()); assert.equal(stale.failed, true); assert.match(stale.text, /changed since delivery/); assert.deepEqual(f.store.getEpisode(f.p.id), after);
    const refreshed = await native.call('read_research'); assert.deepEqual(JSON.parse(refreshed.text), newer); assert.equal((await native.call(name, args())).failed, false);
    assert.equal(f.enqueued.length, 0); assert.equal(f.store.listEpisodeLibrary(f.p.id).length, 0, 'research URLs do not register media');
  });
  assert.deepEqual(fetched, []);
});

test('every direct authoring path and compatibility alias refuses the first call, then accepts full current delivery; research edits preserve already captured jobs', async t => {
  const covered = new Set();
  for (const kind of ['video', 'deck']) {
    const names = kind === 'deck' ? ['save_deck', 'build_deck', 'update_story'] : AUTHORING_TOOLS.filter(name => !['save_deck', 'build_deck'].includes(name));
    for (const name of names) await t.test(`${kind}/${name}`, async t => {
      const f = fixture(t, { kind }); await f.start();
      const recipe = kind === 'video' ? f.store.createGraphicRecipe(f.p.id, { name: 'Graphic', kind: 'still', cardId: 'card_one', recipe: { kind: 'still' } }) : null;
      const branding = kind === 'video' ? f.store.promoteCard(f.p.id, 'card_one', { name: 'Reusable scene' }) : null;
      const args = () => ({
        save_deck: { expectedRevision: f.store.getEpisode(f.p.id).revision, slides: [slide()] }, build_deck: { expectedRevision: f.store.getEpisode(f.p.id).revision },
        update_story: { expectedStoryRevision: f.store.getStory(f.p.id).storyRevision, source: '# Revised story' },
        update_cards: { expectedRevision: f.store.getEpisode(f.p.id).revision, cards: [] }, update_storyboard: { expectedRevision: f.store.getEpisode(f.p.id).revision, cards: [] },
        create_draft: { expectedRenderRevision: 'saved' }, create_final: { expectedRenderRevision: 'saved' }, create_graphic_recipe: { name: 'New', recipe: { kind: 'still' } },
        update_graphic_recipe: { recipeId: recipe?.id, expectedRevision: 1, recipe: { kind: 'still', changed: true } }, render_graphic: { recipeId: recipe?.id, expectedRecipeRevision: 1 }, apply_branding: { templateId: branding?.id },
      })[name];
      const snapshot = () => ({ p: f.store.getEpisode(f.p.id), story: f.store.getStory(f.p.id), recipes: f.store.listGraphicRecipes(f.p.id), jobs: f.store.listJobs(f.p.id) });
      const before = snapshot();
      assert.throws(() => f.entry.options.tools[name](args()), /has not been delivered/); assert.deepEqual(snapshot(), before); assert.equal(f.enqueued.length, 0);
      const native = await f.native(t, 'codex'); const empty = JSON.parse((await native.call('read_research')).text);
      assert.deepEqual({ summary: empty.summary, links: empty.links, researchRevision: empty.researchRevision }, { summary: '', links: [], researchRevision: 1 });
      f.entry.options.tools[name](args()); covered.add(name);
      const jobs = f.store.listJobs(f.p.id); const changed = f.store.saveResearch(f.p.id, 1, findings('after-job'));
      assert.throws(() => f.entry.options.tools[name](args()), /changed since delivery/);
      assert.deepEqual(f.store.listJobs(f.p.id), jobs, 'later research does not rewrite finished/running saved-input jobs');
      assert.equal(f.store.getEpisode(f.p.id).state, 'Scaffold');
      assert.equal(changed.researchRevision, 2);
    });
  }
  assert.deepEqual([...covered].sort(), [...AUTHORING_TOOLS].sort());
});

test('explicit app authoring actions inject complete fresh research at every stage/archive before composition, without boot/transcript truncation', async t => {
  for (const kind of ['video', 'deck']) for (const action of ['card_build', 'still_graphic', 'animated_graphic', 'draft', 'final']) await t.test(`${kind}/${action}`, async t => {
    const f = fixture(t, { kind });
    if (kind === 'deck') f.store.saveDeck(f.p.id, f.store.getEpisode(f.p.id).revision, [slide()]);
    for (const stage of ['Scaffold', 'Draft', 'Final', 'Published', 'Archived']) {
      const current = f.store.getEpisode(f.p.id); f.store.updateEpisode(f.p.id, current.revision, { state: stage === 'Archived' ? 'Final' : stage, archived: stage === 'Archived' });
      const revision = f.store.getResearchMetadata(f.p.id).researchRevision;
      const saved = f.store.saveResearch(f.p.id, revision, findings('button-' + stage));
      if (kind === 'deck' && action === 'card_build') {
        const count = f.launches.length;
        await f.chat.sendProduction(f.p.id, f.conversation.id, { kind: action, targetCardId: 'slide_one', clientRequestId: crypto.randomUUID() }); await until(() => f.launches.length > count && f.entry?.prompt);
      } else await f.start(action);
      assert.deepEqual(savedInPrompt(f.entry.prompt), saved);
      assert.equal(f.entry.options.tools.get_context().research.researchRevision, saved.researchRevision);
      if (kind === 'deck') f.entry.options.tools.save_deck({ expectedRevision: f.store.getEpisode(f.p.id).revision, slides: [slide()] });
      else f.entry.options.tools.update_story({ expectedStoryRevision: f.store.getStory(f.p.id).storyRevision, source: '# Revised from current research' });
      await f.finish();
    }
  });
});

test('new/resumed conversations and harness switches reset delivery; full saved tool results count only after delivery', async t => {
  const f = fixture(t, { kind: 'deck', continuity: true });
  let previousTools;
  for (const harness of ['codex', 'codex', 'claude', 'opencode', 'codex']) {
    const settings = f.store.requireConversation(f.conversation.id).settingsRevision;
    f.store.updateConversationSettings(f.conversation.id, settings, { harness, model: 'fixture' });
    const revision = f.store.getResearch(f.p.id).researchRevision;
    f.store.saveResearch(f.p.id, revision, findings(harness + revision));
    const count = f.launches.length; await f.start(); await until(() => f.launches.length > count && f.entry.prompt);
    const mutate = () => f.entry.options.tools.save_deck({ expectedRevision: f.store.getEpisode(f.p.id).revision, slides: [slide()] });
    assert.throws(mutate, /has not been delivered/);
    if (previousTools) assert.throws(() => previousTools.read_research(), /no longer active/);
    const native = await f.native(t, harness);
    const saved = JSON.parse((await native.call('save_research', { expectedResearchRevision: revision + 1, ...findings('model-return') })).text);
    assert.equal(saved.actor, 'agent'); assert.equal((await native.call('save_deck', { expectedRevision: f.store.getEpisode(f.p.id).revision, slides: [slide()] })).failed, false);
    assert.ok(f.entry.resumed || harness !== 'codex' || f.launches.length !== 2);
    previousTools = f.entry.options.tools; await f.finish();
  }
});

test('read failure or oversized required context never authorizes mutation or starts an explicit authoring turn; maximum complete content round-trips through all native adapters', async t => {
  for (const harness of ['codex', 'claude', 'opencode']) await t.test(harness, async t => {
    const f = fixture(t, { kind: 'deck' }); const originalRead = f.store.getResearch.bind(f.store);
    await f.start(); const native = await f.native(t, harness);
    f.store.getResearch = () => { throw new Error('Injected research read failure'); };
    assert.equal((await native.call('read_research')).failed, true);
    assert.throws(() => f.entry.options.tools.build_deck({ expectedRevision: f.store.getEpisode(f.p.id).revision }), /has not been delivered/); assert.equal(f.enqueued.length, 0);
    f.store.getResearch = originalRead;
    const maximum = f.store.saveResearch(f.p.id, 1, { summary: 'é'.repeat(RESEARCH_LIMITS.summaryBytes / 2 - 4) + 'END-MAX', links: findings().links });
    assert.deepEqual(JSON.parse((await native.call('read_research')).text), maximum);
    assert.equal((await native.call('save_deck', { expectedRevision: f.store.getEpisode(f.p.id).revision, slides: [slide()] })).failed, false);
    f.store.db.prepare('UPDATE production_research SET summary=?,revision=revision+1 WHERE episode_id=?').run('x'.repeat(RESEARCH_LIMITS.summaryBytes + 1), f.p.id);
    const oversized = await native.call('read_research'); assert.equal(oversized.failed, true); assert.match(oversized.text, /limit|completely/);
    assert.throws(() => f.entry.options.tools.build_deck({ expectedRevision: f.store.getEpisode(f.p.id).revision }), /has not been delivered/);
    await f.finish();
    await f.start('draft'); assert.equal(f.entry.prompt, null); assert.match(f.chat.get(f.p.id, f.conversation.id).error, /completely|limit/); assert.equal(f.enqueued.length, 0);
  });
});

test('indirect media assignment gates before work and rechecks freshness/Stop after async preparation; library-only registration remains exempt', async t => {
  const f = fixture(t); await f.start();
  const scope = { requestId: f.entry.options.requestId, conversationId: f.conversation.id, harness: 'codex', channelId: f.p.channelId, episodeId: f.p.id, episodeDir: f.store.episodeDirectory(f.p.id), workDir: f.store.episodeWorkDirectory(f.p.id) };
  const source = f.store.saveAsset({ name: 'Source', hash: 'fixture', kind: 'image', path: 'media/source.png', metadata: {} });
  const item = f.store.attachLibraryItem(f.p.id, source.id, { category: 'Graphics' });
  let copyCalls = 0, duringCopy = () => {};
  const library = { reuseItem: async () => { copyCalls++; await duringCopy(); return { item }; } };
  const tools = createScopedTools(scope, { store: f.store, library, assertAuthoringContext: f.entry.options.assertAuthoringContext });
  const args = { sourceEpisodeId: f.p.id, sourceItemId: item.id, cardId: 'card_one', expectedRevision: f.store.getEpisode(f.p.id).revision };
  await assert.rejects(tools.call('register_work_file', { path: 'work/missing.png', cardId: 'card_one' }), /has not been delivered/);
  await assert.rejects(tools.call('reuse_project_item', args), /has not been delivered/); assert.equal(copyCalls, 0);
  const native = await f.native(t, 'codex'); await native.call('read_research');
  duringCopy = () => f.store.saveResearch(f.p.id, 1, findings('during-copy'));
  const before = f.store.getEpisode(f.p.id);
  await assert.rejects(tools.call('reuse_project_item', args), /changed since delivery/); assert.deepEqual(f.store.getEpisode(f.p.id), before);
  await native.call('read_research');
  const image = path.join(scope.workDir, 'title.png'); execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=16x16', '-frames:v', '1', image]);
  const edit = setTimeout(() => f.store.saveResearch(f.p.id, 2, findings('during-registration')), 100);
  await assert.rejects(tools.call('register_work_file', { path: 'work/title.png', cardId: 'card_one', expectedRevision: before.revision }), /changed since delivery/); clearTimeout(edit);
  assert.deepEqual(f.store.getEpisode(f.p.id), before);
  // Omitting cardId registers completed media without changing draft authoring state.
  const registered = await tools.call('register_work_file', { path: 'work/title.png' }); assert.equal(JSON.parse(registered.text).registered, true);
  await native.call('read_research'); duringCopy = () => f.chat.interrupt(f.p.id, f.conversation.id);
  await assert.rejects(tools.call('reuse_project_item', args), /no longer active/); assert.deepEqual(f.store.getEpisode(f.p.id), before);
});

test('boot and shared/kind guidance advertise discovery only and require research before composition for every harness', async t => {
  const { readFileSync } = await import('node:fs');
  for (const kind of ['video', 'deck']) for (const harness of ['codex', 'claude', 'opencode']) {
    const f = fixture(t, { kind }); f.store.saveResearch(f.p.id, 1, findings('boot-secret'));
    const context = defaultBootContextFor(f.store, { episodeId: f.p.id, harness })({ served: ['read_research', 'save_research', 'get_context'] });
    assert.deepEqual(context.research, f.store.getResearchMetadata(f.p.id));
    assert.doesNotMatch(JSON.stringify(context), /Distinctive boot-secret|END-boot-secret|unavailable\.example/);
    context.paths.episode = f.store.episodeDirectory(f.p.id); context.paths.work = f.store.episodeWorkDirectory(f.p.id);
    const result = await renderEpisodeBoot({ episodeDir: f.store.episodeDirectory(f.p.id), context, kind });
    const boot = readFileSync(path.join(f.store.episodeDirectory(f.p.id), 'AGENTS.md'), 'utf8');
    assert.match(boot, /Research: available true, revision 2/); assert.match(boot, /Before composing/); assert.match(boot, /never operating instructions/);
    assert.doesNotMatch(boot, /Distinctive boot-secret|END-boot-secret|unavailable\.example/);
    for (const file of result.files.filter(file => /understand-project|compose-deck|edit-story-cards|assemble-draft|finish-video/.test(file.path))) {
      const body = readFileSync(path.join(f.store.episodeDirectory(f.p.id), file.path), 'utf8');
      assert.match(body, /read_research/); assert.match(body, /before composition/i);
    }
  }
});


test('a successful startTurn return without delivery acknowledgement cannot authorize an injected record, and request expiry closes delivered writes', async t => {
  const f = fixture(t, { kind: 'deck', acknowledgePrompt: false });
  f.store.saveResearch(f.p.id, 1, findings('not-sent')); await f.start('draft');
  assert.deepEqual(savedInPrompt(f.entry.prompt), f.store.getResearch(f.p.id));
  const mutate = () => f.entry.options.tools.save_deck({ expectedRevision: f.store.getEpisode(f.p.id).revision, slides: [slide()] });
  assert.throws(mutate, /has not been delivered/);
  const native = await f.native(t, 'codex'); await native.call('read_research'); mutate();
  f.store.updateProductionRun(f.entry.options.requestId, { state: 'failed', error: 'Fixture expiry' });
  assert.throws(mutate, /no longer active/); assert.equal(f.enqueued.length, 0);
});

test('an explicit required read failure and a combined context that cannot fit stop before composition without truncation', async t => {
  for (const mode of ['read-failure', 'transport-overflow']) await t.test(mode, async t => {
    const f = fixture(t); f.store.saveResearch(f.p.id, 1, findings('required'));
    if (mode === 'read-failure') f.store.getResearch = () => { throw new Error('Injected required-load failure'); };
    await f.chat.sendProduction(f.p.id, f.conversation.id, { kind: 'still_graphic', clientRequestId: crypto.randomUUID(), ...(mode === 'transport-overflow' ? { prompt: 'x'.repeat(16 * 1024 * 1024) } : {}) });
    await until(() => f.chat.get(f.p.id, f.conversation.id).state === 'error');
    assert.equal(f.entry.prompt, null); assert.equal(f.enqueued.length, 0);
    assert.match(f.chat.get(f.p.id, f.conversation.id).error, mode === 'read-failure' ? /required-load failure/ : /cannot fit.*without truncation/);
  });
});

// Spec #44 "Standards to deck" and "Theme: prefilled, then per deck": the deck theme primitive,
// its storage and setBy, and colour and font roles reaching the build (A1, A3; A6 colour half).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Store } from '../src/store.js';
import { createDeckService } from '../src/deck-service.js';
import { createApp } from '../src/server.js';
import { validateDeckDesign, effectiveDeckTheme, emptyDesign, TEMPLATE_COLORS } from '../src/deck-data.js';
import { buildDeck, deckPalette, DERIVED_HUES } from '../src/deck-template/build.js';
import { exampleDeck, exampleAssets } from '../src/deck-template/example.js';
import { listenInRange } from '../test-support/loopback-port.js';

const slides = [{ id: 'opening', title: 'Hello', layout: 'statement', body: 'Offline', notes: 'Pause' }];
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sb-theme-')), store = new Store(root), decks = createDeckService({ store });
  t.after(async () => { await decks.close(); store.close(); await rm(root, { recursive: true, force: true }); });
  const deck = store.createEpisode({ kind: 'deck', title: 'Themed' }); store.saveDeck(deck.id, 1, slides);
  return { root, store, decks, id: deck.id, channelId: deck.channelId };
}
async function build(t, { root, store, decks, id }) {
  const job = decks.enqueue({ episodeId: id, expectedRevision: store.getDeck(id).revision });
  let done;
  for (let n = 0; n < 400; n++) { done = decks.getJob(id, job.id); if (!['queued', 'running'].includes(done.state)) break; await new Promise(r => setTimeout(r, 5)); }
  assert.equal(done.state, 'completed', done.error);
  const base = path.dirname(path.join(root, done.outputPath));
  return { job: done, css: await readFile(path.join(base, 'styles.css'), 'utf8'), manifest: JSON.parse(await readFile(path.join(base, 'manifest.json'), 'utf8')), zip: await readFile(path.join(base, 'bundle.zip')) };
}
// The palette block the build appends: the last `:root{...}` in styles.css, as a map.
const appendedPalette = (css) => {
  const block = css.trimEnd().split('\n').at(-1);
  if (!/^:root\{--(ink|accent|paper|muted|line|hover|rail|placeholder|highlight|section|active|skip|print)/.test(block)) return {};
  return Object.fromEntries(block.slice(6, -1).split(';').map(entry => entry.split(':')));
};
const standards = (store, channelId, colors, fonts = []) => store.saveBrandStandards(channelId, store.getBrandStandards(channelId).revision, { colors, fonts, stylePrompt: '' });

test('deck design validation refuses unknown fields, bad colours and unsupported fonts, naming the field', () => {
  const refuse = (design, pattern) => assert.throws(() => validateDeckDesign(design, { setBy: 'creator' }), pattern);
  refuse([], /Deck design must be an object/);
  refuse({ palette: {} }, /Deck design: palette is not supported/);
  refuse({ theme: { css: 'body{}' } }, /theme\.css is not supported/);
  refuse({ theme: { colors: { primary: '#112233' } } }, /theme\.colors\.primary is not supported; use base, accent, background/);
  refuse({ theme: { colors: { base: 'red' } } }, /theme\.colors\.base must be a six-digit hex colour/);
  refuse({ theme: { colors: { accent: '#12345' } } }, /theme\.colors\.accent must be a six-digit hex/);
  refuse({ theme: { colors: { background: 'url(x)' } } }, /theme\.colors\.background/);
  refuse({ theme: { fonts: { heading: 'Lato' } } }, /theme\.fonts\.heading is not supported; use base, accent, alternate/);
  refuse({ theme: { fonts: { accent: 'Comic Sans MS' } } }, /theme\.fonts\.accent must be a supported font family/);
  refuse({ theme: { fonts: [] } }, /theme\.fonts must be an object/);
  assert.deepEqual(validateDeckDesign(undefined), emptyDesign());
  const saved = validateDeckDesign({ theme: { colors: { accent: '#c03060', base: null }, fonts: { alternate: 'Space Mono' } } }, { setBy: 'agent' });
  assert.deepEqual(saved, { theme: { colors: { accent: '#C03060' }, fonts: { alternate: 'Space Mono' }, setBy: { colors: { accent: 'agent' }, fonts: { alternate: 'agent' } } } });
  // A supplied setBy is ignored on save; an unchanged value keeps its recorded setBy, a changed one takes the saver's.
  const next = validateDeckDesign({ theme: { colors: { accent: '#C03060', base: '#101010' }, fonts: { alternate: 'Space Mono' }, setBy: { colors: { base: 'agent' } } } }, { previous: saved, setBy: 'creator' });
  assert.deepEqual(next.theme.setBy, { colors: { accent: 'agent', base: 'creator' }, fonts: { alternate: 'agent' } });
  // Restore (undo) keeps recorded setBy and requires one per value.
  assert.deepEqual(validateDeckDesign(next, { setBy: null }), next);
  assert.throws(() => validateDeckDesign({ theme: { colors: { base: '#101010' } } }, { setBy: null }), /theme\.setBy\.colors\.base must be creator or agent/);
});

test('deck theme saves with the deck revision: setBy per saver, omitted design kept, history and undo restore it', async t => {
  const { store, id } = await fixture(t);
  assert.deepEqual(store.getDeck(id).design, emptyDesign(), 'decks start with an empty theme');
  const agent = store.saveDeck(id, 2, slides, 'agent', { theme: { colors: { accent: '#C03060' }, fonts: { accent: 'Kalam' } } });
  assert.equal(agent.revision, 3);
  assert.deepEqual(agent.design.theme.setBy, { colors: { accent: 'agent' }, fonts: { accent: 'agent' } });
  const kept = store.saveDeck(id, 3, slides);
  assert.equal(kept.revision, 4); assert.deepEqual(kept.design, agent.design, 'omitting design keeps the saved one');
  const creator = store.saveDeck(id, 4, slides, 'human', { theme: { colors: { accent: '#C03060', base: '#101820' }, fonts: {} } });
  assert.deepEqual(creator.design.theme, { colors: { accent: '#C03060', base: '#101820' }, fonts: {}, setBy: { colors: { accent: 'agent', base: 'creator' }, fonts: {} } });
  // Refused saves store nothing and leave the revision.
  assert.throws(() => store.saveDeck(id, 5, slides, 'agent', { theme: { colors: { base: 'not-a-colour' } } }), /theme\.colors\.base/);
  assert.throws(() => store.saveDeck(id, 4, slides, 'agent', { theme: {} }), /Stale revision/);
  assert.equal(store.getDeck(id).revision, 5);
  const undone = store.undoEpisode(id, 5);
  assert.deepEqual(undone.design, agent.design, 'undo restores the prior design with its setBy');
  assert.deepEqual(store.getDeck(id).design, agent.design, 'reload shows the restored design');
  const video = store.createEpisode({ title: 'Video' });
  assert.throws(() => store.updateEpisode(video.id, video.revision, { design: { theme: {} } }), /design applies only to deck productions/);
  assert.equal(store.getEpisode(video.id).design, undefined);
});

test('migration 21 adds the design column to existing decks without changing them', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sb-theme-migrate-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  let store = new Store(root);
  const deck = store.createEpisode({ kind: 'deck', title: 'Legacy' }); store.saveDeck(deck.id, 1, slides);
  store.db.exec('ALTER TABLE episodes DROP COLUMN design; ALTER TABLE episode_history DROP COLUMN design; PRAGMA user_version=20');
  store.close();
  store = new Store(root);
  t.after(() => store.close());
  assert.equal(Number(store.db.prepare('PRAGMA user_version').get().user_version), 21);
  const legacy = store.getDeck(deck.id);
  assert.equal(legacy.revision, 2); assert.deepEqual(legacy.slides.map(s => s.id), ['opening']);
  assert.deepEqual(legacy.design, emptyDesign());
  assert.equal(store.saveDeck(deck.id, 2, slides, 'human', { theme: { colors: { base: '#000000' } } }).design.theme.colors.base, '#000000');
});

test('human save routes record creator, refuse invalid design naming the field and store nothing', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sb-theme-http-')), app = await createApp({ workspace: root });
  t.after(async () => { await app.close(); await rm(root, { recursive: true, force: true }); });
  await listenInRange(app.server);
  const deck = app.store.createEpisode({ kind: 'deck', title: 'Routes' });
  const url = (suffix = '') => `http://127.0.0.1:${app.server.address().port}/api/episodes/${deck.id}${suffix}?channel=${deck.channelId}`;
  const put = (suffix, body) => fetch(url(suffix), { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const refused = await put('/slides', { expectedRevision: 1, slides, design: { theme: { colors: { accent: 'var(--ink)' } } } });
  assert.equal(refused.status, 400); assert.match((await refused.json()).error, /theme\.colors\.accent must be a six-digit hex/);
  assert.equal(app.store.getDeck(deck.id).revision, 1);
  const saved = await put('/slides', { expectedRevision: 1, slides, design: { theme: { colors: { accent: '#C03060' }, fonts: { base: 'Lato' } } } });
  assert.equal(saved.status, 200);
  assert.deepEqual((await saved.json()).design.theme.setBy, { colors: { accent: 'creator' }, fonts: { base: 'creator' } });
  const board = await put('', { expectedRevision: 2, cards: slides, design: { theme: { colors: { accent: '#C03060', background: '#FFF8E0' } } } });
  assert.equal(board.status, 200);
  assert.deepEqual((await board.json()).design.theme, { colors: { accent: '#C03060', background: '#FFF8E0' }, fonts: {}, setBy: { colors: { accent: 'creator', background: 'creator' }, fonts: {} } });
  const read = await (await fetch(url('/slides'))).json();
  assert.equal(read.design.theme.colors.background, '#FFF8E0');
});

test('A1/A6: with no colours set the stylesheet gains no palette; three channel roles become the root palette and manifest', async t => {
  const f = await fixture(t);
  const plain = await build(t, f);
  assert.deepEqual(appendedPalette(plain.css), {}, 'no palette block when nothing is set');
  const template = await readFile(new URL('../src/deck-template/styles.css', import.meta.url), 'utf8');
  assert.ok(plain.css.startsWith(template), 'the packaged template stylesheet is unchanged');
  assert.deepEqual(plain.manifest.colors, { base: null, accent: null, background: null });
  assert.deepEqual(plain.manifest.theme.colors, { base: { value: TEMPLATE_COLORS.base, source: 'template' }, accent: { value: TEMPLATE_COLORS.accent, source: 'template' }, background: { value: TEMPLATE_COLORS.background, source: 'template' } });
  assert.deepEqual(plain.manifest.fonts, [null, null, null]);
  standards(f.store, f.channelId, ['#102030', '#C03060', '#F0E0A0']);
  const themed = await build(t, f);
  const palette = appendedPalette(themed.css);
  assert.equal(palette['--ink'], '#102030'); assert.equal(palette['--accent'], '#C03060'); assert.equal(palette['--paper'], '#F0E0A0');
  assert.deepEqual(Object.keys(palette).sort(), ['--ink', '--accent', '--paper', ...DERIVED_HUES.map(([name]) => name)].sort(), 'every template hue is derived when all three roles are set');
  assert.deepEqual(themed.manifest.colors, { base: '#102030', accent: '#C03060', background: '#F0E0A0' });
  assert.deepEqual(themed.manifest.theme.colors.accent, { value: '#C03060', source: 'channel', setBy: 'creator' });
  assert.deepEqual(themed.job.snapshot.theme, themed.manifest.theme, 'the snapshot records the same effective roles');
});

test('A3: per role, the deck theme beats the channel, which beats the template; channel changes follow on the next build', async t => {
  const f = await fixture(t);
  standards(f.store, f.channelId, ['#102030', '#C03060', '#F0E0A0'], ['Crimson Text', 'Poppins', 'Space Mono']);
  f.store.saveDeck(f.id, 2, slides, 'agent', { theme: { colors: { accent: '#2050D0' }, fonts: { base: 'Kalam' } } });
  const first = await build(t, f);
  assert.deepEqual(first.manifest.theme, {
    colors: { base: { value: '#102030', source: 'channel', setBy: 'creator' }, accent: { value: '#2050D0', source: 'deck', setBy: 'agent' }, background: { value: '#F0E0A0', source: 'channel', setBy: 'creator' } },
    fonts: { base: { value: 'Kalam', source: 'deck', setBy: 'agent' }, accent: { value: 'Poppins', source: 'channel', setBy: 'creator' }, alternate: { value: 'Space Mono', source: 'channel', setBy: 'creator' } },
  });
  assert.equal(appendedPalette(first.css)['--accent'], '#2050D0');
  assert.match(first.css, /--font-base:"Kalam";--font-accent:"Poppins";--font-alternate:"Space Mono"/);
  assert.doesNotMatch(first.css, /Crimson Text/, 'a deck font replaces the channel font for that role');
  assert.ok(first.zip.includes(Buffer.from('assets/font-kalam-regular.ttf')) && first.zip.includes(Buffer.from('assets/font-kalam-bold.ttf')) && first.zip.includes(Buffer.from('assets/font-kalam-LICENSE.txt')), 'theme fonts ship in the bundle');
  // A role with no deck value follows the channel's current value; the deck's own value stays.
  standards(f.store, f.channelId, ['#300010', '#00A000', null], ['Lato', 'Poppins']);
  const second = await build(t, f), palette = appendedPalette(second.css);
  assert.equal(palette['--ink'], '#300010'); assert.equal(palette['--accent'], '#2050D0'); assert.equal(palette['--paper'], undefined);
  assert.deepEqual(second.manifest.theme.colors.background, { value: TEMPLATE_COLORS.background, source: 'template' });
  assert.deepEqual(second.manifest.theme.fonts.alternate, { value: 'Manrope', source: 'template' });
  assert.deepEqual(second.manifest.fonts, ['Kalam', 'Poppins', null]);
  // Removing the deck value returns the role to the channel (Use Brand Standards).
  f.store.saveDeck(f.id, 3, slides, 'human', { theme: { fonts: { base: 'Kalam' } } });
  const third = await build(t, f);
  assert.equal(appendedPalette(third.css)['--accent'], '#00A000');
  assert.deepEqual(third.manifest.theme.colors.accent, { value: '#00A000', source: 'channel', setBy: 'creator' });
  assert.equal(appendedPalette(first.css)['--accent'], '#2050D0', 'earlier bundles are untouched');
});

test('A3: each single-role case changes only that role and its derivations', () => {
  const only = role => Object.keys(deckPalette({ [role]: '#123456' })).sort();
  assert.deepEqual(only('base'), ['--ink', '--muted', '--line', '--rail-fill', '--placeholder', '--highlight'].sort());
  assert.deepEqual(only('accent'), ['--accent', '--hover', '--rail-current', '--section', '--active'].sort());
  assert.deepEqual(only('background'), ['--paper', '--muted', '--line', '--rail-fill', '--placeholder', '--highlight', '--hover', '--rail-current', '--section', '--skip', '--print-paper'].sort());
  assert.deepEqual(deckPalette({}), {}); assert.deepEqual(deckPalette({ base: null, accent: null, background: null }), {});
  // Derivations use the effective values: an unset role contributes its template value.
  const accent = deckPalette({ accent: '#C03060' });
  assert.equal(accent['--hover'], deckPalette({ accent: '#C03060', background: TEMPLATE_COLORS.background })['--hover']);
  assert.throws(() => deckPalette({ primary: '#123456' }), /Unsupported deck colour role: primary/);
  assert.throws(() => deckPalette({ base: 'red;}body{' }), /six-digit hex/);
  // Built bundles apply them after the template's own :root.
  const files = buildDeck({ ...structuredClone(exampleDeck), colors: { accent: '#C03060' } }, { assets: exampleAssets });
  assert.deepEqual(appendedPalette(String(files.get('styles.css'))), Object.fromEntries(Object.entries(accent)));
  assert.deepEqual(appendedPalette(String(buildDeck(structuredClone(exampleDeck), { assets: exampleAssets }).get('styles.css'))), {});
});

test('effective theme marks each role by source and the QA report treats a channel colour change as a stale build', async t => {
  const theme = effectiveDeckTheme({ colorRoles: { base: '#111111', accent: null, background: null }, fontRoles: { base: null, accent: 'Lato', alternate: null } }, validateDeckDesign({ theme: { colors: { background: '#EEEEEE' } } }, { setBy: 'creator' }));
  assert.deepEqual(theme.colors, { base: { value: '#111111', source: 'channel', setBy: 'creator' }, accent: { value: TEMPLATE_COLORS.accent, source: 'template' }, background: { value: '#EEEEEE', source: 'deck', setBy: 'creator' } });
  assert.deepEqual(theme.fonts.accent, { value: 'Lato', source: 'channel', setBy: 'creator' });
  const f = await fixture(t), { getQaReport } = await import('../src/deck-qa-report.js');
  const { job } = await build(t, f);
  const fresh = await getQaReport(f.store, f.id, job.id);
  assert.ok(!fresh.missing.some(line => /stale build/.test(line)), JSON.stringify(fresh.missing));
  standards(f.store, f.channelId, ['#102030']);
  const stale = await getQaReport(f.store, f.id, job.id);
  assert.ok(stale.missing.some(line => /stale build: saved revision, fonts, colours/.test(line)));
});

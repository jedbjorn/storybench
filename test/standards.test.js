import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Store, SCHEMA_VERSION } from '../src/store.js';
import { createApp } from '../src/server.js';

function temp(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'storybench-standards-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
export const catalog = [{ harness: 'codex', available: true, exactModelIds: false, models: [
  { id: 'model-a', displayName: 'Model A', isDefault: true, efforts: ['medium', 'high'] },
  { id: 'model-b', displayName: 'Model B', efforts: ['medium'] },
] }];
const standards = { colors: ['#0055ff', '#FFFFFF'], fonts: ['DejaVu Sans', 'Liberation Serif'], stylePrompt: 'Calm blue graphics with generous space.' };

test('channel standards persist independently, validate limits and refuse stale saves', (t) => {
  const root = temp(t); let store = new Store(root); t.after(() => store.close());
  const a = store.getDefaultChannel(), b = store.createChannel('Second');
  const saved = store.saveBrandStandards(a.id, 1, standards);
  assert.equal(saved.revision, 2); assert.equal(saved.colors[0], '#0055FF');
  assert.deepEqual(store.getBrandStandards(b.id).fonts, []);
  for (const bad of [{ colors: ['red'] }, { colors: Array(4).fill('#FFFFFF') }, { fonts: ['missing'] }, { fonts: Array(4).fill('DejaVu Sans') }, { stylePrompt: 1 }])
    assert.throws(() => store.saveBrandStandards(a.id, 2, { ...standards, ...bad }), { statusCode: 400 });
  assert.throws(() => store.saveBrandStandards(a.id, 1, standards), { statusCode: 409 });
  store.close(); store = new Store(root);
  assert.deepEqual(store.getBrandStandards(a.id), saved);
  assert.deepEqual(store.saveBrandStandards(a.id, 2, { colors: [], fonts: [], stylePrompt: '' }).fonts, []);
});

test('v9 migration backs up data and leaves branding and conversations intact', (t) => {
  const root = temp(t); let store = new Store(root); t.after(() => store.close());
  const ep = store.createEpisode();
  store.updateEpisode(ep.id, ep.revision, { cards: [{ id: 'intro', title: 'Hello', type: 'Video' }] });
  const template = store.promoteCard(ep.id, 'intro', { role: 'intro' });
  store.db.exec('DROP TABLE channel_standards; DROP TABLE model_default; DELETE FROM migration_log WHERE version=10; PRAGMA user_version=9');
  store.close(); store = new Store(root);
  assert.equal(store.dataRootIdentity().schemaVersion, SCHEMA_VERSION);
  assert.ok(existsSync(path.join(root, 'storybench.pre-v10.sqlite')));
  assert.equal(store.createEpisode().cards[0].brandingTemplateId, template.id);
  assert.deepEqual(store.getModelDefault(), { selection: null, revision: 1 });
});

test('API validates app default; future chats inherit it and overrides never rewrite it', async (t) => {
  const app = await createApp({ workspace: temp(t), chatOptions: { catalog: { list: async () => catalog } } });
  t.after(() => app.close());
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const put = (url, body) => fetch(base + url, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const episode = app.store.createEpisode();
  const old = app.chat.create(episode.id);
  const selection = { harness: 'codex', model: 'model-a', effort: 'high' };
  assert.equal((await put('/api/model-default', { expectedRevision: 1, selection: { ...selection, model: 'missing' } })).status, 400);
  assert.equal((await put('/api/model-default', { expectedRevision: 1, selection })).status, 200);
  assert.equal((await put('/api/model-default', { expectedRevision: 1, selection })).status, 409);
  const created = app.chat.create(episode.id);
  assert.equal(created.settings.model, 'model-a');
  assert.equal(app.store.getConversation(old.id).model, null);
  app.store.updateConversationSettings(created.id, created.settings.revision, { harness: 'codex', model: 'model-b', effort: 'medium' });
  assert.equal(app.chat.create(episode.id).settings.model, 'model-a');
  const other = app.store.createChannel('Another');
  assert.equal(app.chat.create(app.store.createEpisode({ channelId: other.id }).id).settings.model, 'model-a');
  assert.equal((await put('/api/brand-standards?channel=' + other.id, { expectedRevision: 1, ...standards })).status, 200);
  assert.deepEqual(app.store.getBrandStandards(episode.channelId).colors, []);
  assert.equal((await fetch(base + '/api/brand-standards?channel=missing')).status, 404);
});

test('each turn receives current channel standards and font paths; in-flight context stays stable', async (t) => {
  const prompts = [], contexts = [];
  let app;
  const factory = async (options) => ({
    startThread: async () => 'thread-standards', resumeThread: async (id) => id, close() {},
    async startTurn(threadId, prompt) {
      prompts.push(prompt);
      if (prompts.length === 1) app.store.saveBrandStandards(contexts[0].channelId, 2, { ...standards, stylePrompt: 'New warm direction' });
      contexts.push(options.tools.get_context());
      queueMicrotask(() => options.onEvent({ method: 'turn/completed', params: { threadId, turn: { id: `turn-${prompts.length}`, status: 'completed' } } }));
      return `turn-${prompts.length}`;
    },
  });
  app = await createApp({ workspace: temp(t), chatOptions: { codexFactory: factory } }); t.after(() => app.close());
  const episode = app.store.createEpisode();
  app.store.saveBrandStandards(episode.channelId, 1, standards);
  contexts.push({ channelId: episode.channelId });
  for (let i = 0; i < 2; i++) {
    await app.chat.send(episode.id, 'Make a title');
    for (let n = 0; n < 100 && app.chat.get(episode.id).state !== 'idle'; n++) await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(app.chat.get(episode.id).state, 'idle');
  }
  assert.match(prompts[0], /Calm blue/); assert.match(prompts[1], /New warm direction/);
  assert.equal(contexts[1].brandStandards.stylePrompt, standards.stylePrompt);
  assert.equal(contexts[2].brandStandards.stylePrompt, 'New warm direction');
  assert.equal(contexts[1].fonts.length, 6);
  assert.ok(contexts[1].fonts.every((font) => font.files.regular && font.files.bold));
});

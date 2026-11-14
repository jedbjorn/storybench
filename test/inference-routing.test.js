import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, stat, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createChatService } from '../src/chat.js';
import { Store } from '../src/store.js';
import { createV9ConversationPersistence } from '../src/runtime/conversation-persistence.js';
import { planTurn, changeSettings } from '../src/runtime/conversation-runtime.js';
import { openCodeConfig } from '../src/runtime/opencode.js';
import { workerRunArgs, validateHostConfig } from '../src/runtime/layout.js';
import { createHost } from '../src/runtime/host.js';

test('sources sharing a harness start separate segments and defaults remain keyed by kind', async (t) => {
 const root = await mkdtemp(path.join(os.tmpdir(), 'routing-')); t.after(() => rm(root, { recursive: true, force: true }));
 const store = new Store(root); t.after(() => store.close()); const ep = store.createEpisode();
 const c = createChatService({ store }).create(ep.id);
 const p = createV9ConversationPersistence(store);
 const catalog = ['codex-login','openai'].map((source) => ({ source, harness: 'codex', available: true, models: [{ id: 'model', efforts: [] }] }));
 changeSettings(p, c.id, { source: 'openai', harness: 'codex', model: 'model' }, { catalog, expectedRevision: 1 });
 const segment = p.createSegment({ conversationId: c.id, harness: 'codex', inferenceSource: 'openai', reason: 'initial' });
 p.setSegmentSession(segment.id, 'native-session');
 assert.equal(planTurn(p, c.id).resumeId, 'native-session');
 changeSettings(p, c.id, { source: 'codex-login', harness: 'codex', model: 'model' }, { catalog, expectedRevision: 2 });
 assert.equal(planTurn(p, c.id, { hasEarlierMessages: true }).seed, true);
 assert.equal(planTurn(p, c.id).resumeId, null);
 store.saveModelDefault(1, { source: 'openai', harness: 'codex', model: 'model' });
 store.saveModelDefault(0, { source: 'gateway-local', harness: 'opencode', model: 'local' }, 'future-kind');
 assert.equal(store.getModelDefault().selection.source, 'openai');
 assert.equal(store.getModelDefault('future-kind').selection.model, 'local');
 assert.equal(store.requireConversation(c.id).inferenceSource, 'codex-login');
 assert.deepEqual(store.db.prepare('PRAGMA foreign_key_check').all(), []);
});
test('protocol configs contain only selected provider and MCP, and API workers mount no login', () => {
 for (const protocol of ['openai','anthropic']) {
   const config = openCodeConfig({ id: 'gateway-test', name: 'Test', baseUrl: 'http://host.docker.internal:9000/v1', protocol, keyEnv: 'SELECTED_KEY' }, { model: 'fake', mcp: { command: 'node', args: ['bridge'], env: { TOKEN: 'bridge-token' } } });
   assert.deepEqual(Object.keys(config.provider), ['gateway-test']); assert.match(config.provider['gateway-test'].npm, protocol === 'anthropic' ? /anthropic/ : /openai-compatible/);
   assert.equal(config.provider['gateway-test'].options.apiKey, '{env:SELECTED_KEY}');
   assert.deepEqual(config.provider['gateway-test'].models.fake.modalities, { input: ['text', 'image'], output: ['text'] });
 }
 const config = validateHostConfig({ installId: 'test', dataRoot: '/data', stateRoot: '/state', runtimeRoot: '/runtime', port: 4000, credentials: { codex: '/auth/codex', claude: '/auth/claude' }, images: { app: 'sha256:'+'a'.repeat(64), worker: 'sha256:'+'b'.repeat(64) } });
 const args = workerRunArgs(config, { requestId: 'req', harness: 'codex', segmentId: 'seg', episode: { relative: 'episodes/ep', work: 'episodes/ep/work' } }, { presentRoots: ['episodes'], envFile: '/private/selected.env', route: { source: 'openai' } });
 assert.ok(!args.some((arg) => arg.includes('auth.json') || arg.includes('.credentials.json')));
 assert.ok(!args.includes('host.docker.internal:host-gateway')); assert.ok(args.includes('/private/selected.env'));
});

for (const action of ['stop', 'reconcile', 'shutdown', 'launch-failure']) test(`host-local request stages only a private capability and cleans it on ${action}`, async (t) => {
 const root = await mkdtemp(path.join(os.tmpdir(), 'relay-host-')); t.after(() => rm(root, { recursive: true, force: true }));
 const config = { installId: 'relay-test', dataRoot: path.join(root, 'data'), stateRoot: path.join(root, 'state'), runtimeRoot: path.join(root, 'runtime'), port: 4000, images: { app: 'sha256:'+'a'.repeat(64), worker: 'sha256:'+'b'.repeat(64) }, credentials: { codex: '/absent/auth.json', claude: '/absent/.credentials.json' } };
 await mkdir(path.join(config.dataRoot, 'episodes', 'ep', 'work'), { recursive: true });
 const route = { id: 'gateway-local', custom: true, harness: 'opencode', protocol: 'openai', baseUrl: 'http://127.0.0.1:9999/v1', key: 'selected-host-only', env: 'STORYBENCH_GATEWAY_LOCAL_KEY' };
 const calls = [];
 const host = createHost(config, { providerService: { route: async () => route }, log: () => {}, followLogs: () => ({ stop() {} }), dockerApi: {
  async docker(args) { calls.push(args); if (args[0] === 'run' && action === 'launch-failure') throw new Error('Fake launch failure'); return 'c'.repeat(64); },
  async listByLabels() { return []; }, async inspectContainer() { return null; }, async ensureNetwork() {},
 } });
 const request = { op: 'worker.start', requestId: 'req-one', source: 'gateway-local', harness: 'opencode', model: 'fake', segmentId: 'seg-one', episodeDir: 'episodes/ep', workDir: 'episodes/ep/work' };
 const credentialDirectory = path.join(config.runtimeRoot, 'credentials', request.requestId);
 if (action === 'launch-failure') {
  await assert.rejects(host.handle(request), /Fake launch failure/);
 } else {
  await host.handle(request);
  const args = calls.find((args) => args[0] === 'run');
  const binding = JSON.parse(await readFile(path.join(credentialDirectory, 'gateway/binding.json'), 'utf8'));
  assert.equal(binding.requestId, request.requestId); assert.equal(binding.source, request.source);
  assert.equal((await stat(path.join(credentialDirectory, 'gateway/relay.sock'))).mode & 0o777, 0o600);
  assert.equal(await readFile(path.join(credentialDirectory, 'selected.env'), 'utf8'), '');
  assert.ok(args.some((arg) => arg.includes('target=/run/storybench/gateway,readonly')));
  assert.ok(!JSON.stringify(args).includes(route.key));
  assert.ok(!JSON.stringify(binding).includes(route.key));
  assert.ok(!args.some((arg) => arg.includes('/absent/') || arg.includes('host-gateway')));
  const workerRoute = JSON.parse(args.find((arg) => arg.startsWith('STORYBENCH_ROUTE=')).slice('STORYBENCH_ROUTE='.length));
  assert.equal(workerRoute.baseUrl, route.baseUrl); assert.equal(workerRoute.localRelay, true); assert.equal(workerRoute.keyEnv, null);
  await assert.rejects(host.handle({ ...request, source: 'gateway-other' }), { code: 'DUPLICATE_REQUEST' });
  if (action === 'stop') await host.handle({ op: 'worker.stop', requestId: request.requestId });
  if (action === 'reconcile') await host.reconcile();
  if (action === 'shutdown') await host.stop();
 }
 assert.equal(host.workers.size, 0);
 await assert.rejects(stat(credentialDirectory), { code: 'ENOENT' });
 await assert.rejects(stat(path.join(config.runtimeRoot, 'requests', request.requestId)), { code: 'ENOENT' });
});

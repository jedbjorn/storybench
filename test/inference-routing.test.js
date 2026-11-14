import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createChatService } from '../src/chat.js';
import { Store } from '../src/store.js';
import { createV9ConversationPersistence } from '../src/runtime/conversation-persistence.js';
import { planTurn, changeSettings } from '../src/runtime/conversation-runtime.js';
import { openCodeConfig } from '../src/runtime/opencode.js';
import { workerRunArgs, validateHostConfig } from '../src/runtime/layout.js';

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
 }
 const config = validateHostConfig({ installId: 'test', dataRoot: '/data', stateRoot: '/state', runtimeRoot: '/runtime', port: 4000, credentials: { codex: '/auth/codex', claude: '/auth/claude' }, images: { app: 'sha256:'+'a'.repeat(64), worker: 'sha256:'+'b'.repeat(64) } });
 const args = workerRunArgs(config, { requestId: 'req', harness: 'codex', segmentId: 'seg', episode: { relative: 'episodes/ep', work: 'episodes/ep/work' } }, { presentRoots: ['episodes'], envFile: '/private/selected.env', route: { source: 'openai' } });
 assert.ok(!args.some((arg) => arg.includes('auth.json') || arg.includes('.credentials.json')));
 assert.ok(args.includes('host.docker.internal:host-gateway')); assert.ok(args.includes('/private/selected.env'));
});

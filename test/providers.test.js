import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createProviderService, gatewayDefinition, PROVIDERS } from '../src/runtime/providers.js';

test('credential rotation is atomic, private, fresh and rejects invalid candidates without clobbering', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'providers-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const calls = [];
  const service = createProviderService({ directory, fetchImpl: async (url, options) => {
    calls.push({ url: String(url), headers: options.headers });
    return new Response(JSON.stringify({ data: [{ id: 'model-a' }] }), { status: Object.values(options.headers).includes('Bearer rejected-secret') ? 401 : 200 });
  } });
  await service.replace('openai', 'first-secret');
  const running = await service.route('openai');
  assert.equal((await stat(path.join(directory, 'providers.env'))).mode & 0o777, 0o600);
  await assert.rejects(service.replace('openai', 'rejected-secret'), /Key rejected/);
  assert.equal((await service.route('openai')).key, 'first-secret');
  await service.replace('openai', 'rotated-secret');
  assert.equal(running.key, 'first-secret'); assert.equal((await service.route('openai')).key, 'rotated-secret');
  assert.ok(!JSON.stringify(await service.list()).includes('rotated-secret'));
  assert.equal((await service.status('openai')).suffix, 'cret');
  await writeFile(path.join(directory, 'providers.env'), 'OPENAI_API_KEY=hand-edited\n');
  assert.equal((await service.route('openai')).key, 'hand-edited');
  await service.remove('openai'); await assert.rejects(service.route('openai'), /No key/);
  assert.ok(!(await readFile(path.join(directory, 'providers.env'), 'utf8')).includes('OPENAI_API_KEY'));
});
test('named routes, optional gateway key and explicit unchecked saves', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'providers-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const service = createProviderService({ directory, fetchImpl: async () => new Response('', { status: 404 }) });
  for (const source of Object.keys(PROVIDERS)) {
    await assert.rejects(service.replace(source, 'fake-key'), /explicitly save/);
    await service.replace(source, 'fake-key', { saveUnchecked: true });
    const route = await service.route(source);
    assert.equal(route.harness, PROVIDERS[source].harness); assert.equal(route.protocol, PROVIDERS[source].protocol);
    assert.equal((await service.status(source)).status, 'Not checked');
  }
  const gateway = { id: 'gateway-local', name: 'Local', baseUrl: 'http://localhost:9000/v1', protocol: 'anthropic', models: ['local'] };
  assert.equal(gatewayDefinition(gateway).baseUrl, 'http://localhost:9000/v1');
  await service.saveGateway(gateway); assert.equal((await service.route(gateway.id)).key, null);
  assert.equal((await service.models(gateway.id)).models[0].eligibilityReason, 'Unverified capabilities');
  assert.throws(() => gatewayDefinition({ ...gateway, baseUrl: 'http://secret@localhost' }), /without credentials/);
});

test('OpenCode models require explicit selection and expose only supported per-model variants', async (t) => {
  const { validateSelection } = await import('../src/runtime/conversation-runtime.js');
  const { openCodeConfig, OpenCodeConnection } = await import('../src/runtime/opencode.js');
  const { PassThrough } = await import('node:stream');
  const { EventEmitter } = await import('node:events');
  const directory = await mkdtemp(path.join(os.tmpdir(), 'variants-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const service = createProviderService({ directory, fetchImpl: async (url) => new Response(JSON.stringify(String(url).includes('models.dev') ? {
    deepseek: { models: { 'deepseek-chat': { tool_call: true, modalities: { input: ['text', 'image'] }, variants: { low: { reasoningEffort: 'low' }, high: { reasoningEffort: 'high' }, disabled: { disabled: true } } } } },
  } : { data: [{ id: 'deepseek-chat' }] })) });
  await service.replace('deepseek', 'fake-key');
  const entry = await service.models('deepseek'), catalog = [entry];
  const selection = { source: 'deepseek', harness: 'opencode', model: 'deepseek-chat', effort: 'high' };
  assert.throws(() => validateSelection(catalog, { ...selection, model: null }), { code: 'INVALID_MODEL' });
  assert.throws(() => validateSelection(catalog, { ...selection, model: 'unknown' }), { code: 'UNKNOWN_MODEL' });
  assert.deepEqual(entry.models[0].efforts, ['low', 'high']);
  assert.equal(validateSelection(catalog, selection).effort, 'high');
  assert.throws(() => validateSelection(catalog, { ...selection, effort: 'max' }), { code: 'UNSUPPORTED_EFFORT' });
  const config = openCodeConfig({ ...await service.route('deepseek'), id: 'deepseek' }, { model: selection.model, mcp: { command: 'node', args: [] } });
  assert.deepEqual(config.provider.deepseek.models['deepseek-chat'].variants.high, { reasoningEffort: 'high' });
  let header;
  const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stdin: new PassThrough(), kill() {} });
  const connection = new OpenCodeConnection({ model: selection.model, effort: selection.effort, spawnSession: async (value) => { header = value; return child; } });
  await connection.startTurn('session', 'hello');
  assert.equal(header.effort, 'high');
  child.stdout.end();
  for (const harness of ['codex', 'claude']) {
    assert.equal(validateSelection([{ source: `${harness}-login`, harness, available: true, models: [] }], { harness }).model, null);
  }
});

test('login capabilities cross-check text, image and tools without discarding native efforts', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'login-capabilities-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const vision = { tool_call: true, modalities: { input: ['text', 'image'] } };
  const metadata = {
    anthropic: { models: { 'claude-sonnet-4-5': vision, 'claude-opus-4-5': vision } },
    openai: { models: { good: vision, 'no-tools': { ...vision, tool_call: false }, 'no-text': { ...vision, modalities: { input: ['image'] } } } },
  };
  const service = createProviderService({ directory, fetchImpl: async () => Response.json(metadata) });
  const claude = await service.loginModels({ harness: 'claude', available: true, models: ['sonnet', 'opus', 'missing'].map((id) => ({ id, efforts: ['high'] })) });
  assert.deepEqual(claude.models.map((model) => model.eligible), [true, true, false]);
  assert.deepEqual(claude.models[0].efforts, ['high']);
  assert.equal(claude.models[0].eligibilityReason, null);
  assert.equal(claude.models[2].eligibilityReason, 'Unverified capabilities');
  const codex = await service.loginModels({ harness: 'codex', available: true, models: ['good', 'no-tools', 'no-text', 'unknown'].map((id) => ({ id, inputModalities: ['text', 'image'], efforts: ['low', 'high'] })) });
  assert.deepEqual(codex.models.map((model) => model.eligibilityReason), [null, 'No tool calling', 'No text input', 'Unverified capabilities']);
  assert.deepEqual(codex.models[0].efforts, ['low', 'high']);
  const nativeTextOnly = await service.loginModels({ harness: 'codex', available: true, models: [{ id: 'good', inputModalities: ['text'] }] });
  assert.equal(nativeTextOnly.models[0].eligible, false);
  const unavailable = createProviderService({ directory, fetchImpl: async () => { throw new Error('offline'); } });
  assert.equal((await unavailable.loginModels({ harness: 'claude', available: true, models: [{ id: 'sonnet' }] })).models[0].eligibilityReason, 'Unverified capabilities');
});

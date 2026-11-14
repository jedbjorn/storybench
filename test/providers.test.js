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
  assert.equal(gatewayDefinition(gateway).baseUrl, 'http://host.docker.internal:9000/v1');
  await service.saveGateway(gateway); assert.equal((await service.route(gateway.id)).key, null);
  assert.equal((await service.models(gateway.id)).models[0].eligibilityReason, 'Unverified capabilities');
  assert.throws(() => gatewayDefinition({ ...gateway, baseUrl: 'http://secret@localhost' }), /without credentials/);
});

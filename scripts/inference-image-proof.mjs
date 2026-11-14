// Exact pinned worker against fake protocols on the Docker host. No provider account.
import assert from 'node:assert/strict';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);
import { mkdtemp, mkdir, writeFile, rm, readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import * as dockerApi from '../src/runtime/docker.js';
import { docker, ensureNetwork } from '../src/runtime/docker.js';
import { createHost } from '../src/runtime/host.js';
import { createProviderService } from '../src/runtime/providers.js';
import { hostPaths, names } from '../src/runtime/layout.js';
import { startBridge } from '../src/runtime/bridge.js';
import { connectHarness } from '../src/runtime/channel.js';
import { OpenCodeConnection } from '../src/runtime/opencode.js';
import { Store } from '../src/store.js';
import { createChatService } from '../src/chat.js';
import { createV9ConversationPersistence } from '../src/runtime/conversation-persistence.js';
const image = process.argv[2]; assert.match(image || '', /^sha256:/);
const root = await mkdtemp(path.join(os.tmpdir(), 'storybench-inference-'));
const server = http.createServer();
let protocol, mode, calls, tools, sawImage, sawCredential, started, cancelled, currentToolCall;
server.on('request', async (req, res) => {
  let text = ''; for await (const part of req) text += part;
  assert.ok(req.url.startsWith('/v1/'), 'saved base path is preserved');
  if (protocol === 'anthropic') {
    assert.equal(req.headers['x-api-key'], 'fake-fixture-key'); assert.equal(req.headers.authorization, undefined);
  } else {
    assert.equal(req.headers.authorization, 'Bearer fake-fixture-key'); assert.equal(req.headers['x-api-key'], undefined);
  }
  if (req.url.endsWith('/models')) { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ data: [{ id: 'fixture-model' }] })); return; }
  if (mode === 'failure') { res.writeHead(401, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { message: 'Fake rejected fake-fixture-key', type: 'authentication_error' } })); return; }
  const body = JSON.parse(text); calls++;
  assert.equal(body.model, 'fixture-model');
  sawImage ||= /image_url|"type":"image"/.test(text);
  sawCredential ||= req.headers.authorization === 'Bearer fake-fixture-key' || req.headers['x-api-key'] === 'fake-fixture-key';
  const tool = body.tools?.find((tool) => (tool.function?.name || tool.name).includes('probe'));
  if (body.tools?.length) assert.ok(tool, 'bridge tool schema reaches protocol');
  if (mode === 'cancel' && tool) {
    req.socket.once('close', () => cancelled());
    res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write(': waiting\n\n'); started(); return;
  }
  // OpenCode also asks for a session title without tools. Only the actual agent
  // request should trigger a bridge call; background metadata gets ordinary text.
  const completed = tools > 0 || !tool;
  const name = tool?.function?.name || tool?.name;
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const send = (data, event = null) => res.write(`${event ? `event: ${event}\n` : ''}data: ${JSON.stringify(data)}\n\n`);
  if (protocol === 'openai') {
    const delta = completed ? { content: 'fake-protocol-complete' } : { tool_calls: [{ index: 0, id: 'call_fixture', type: 'function', function: { name, arguments: '{}' } }] };
    send({ id: 'chatcmpl-fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture-model', choices: [{ index: 0, delta, finish_reason: null }] });
    send({ id: 'chatcmpl-fixture', object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: completed ? 'stop' : 'tool_calls' }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } });
    res.end('data: [DONE]\n\n'); return;
  }
  send({ type: 'message_start', message: { id: 'msg_fixture', type: 'message', role: 'assistant', model: 'fixture-model', content: [], stop_reason: null, usage: { input_tokens: 10, output_tokens: 0 } } }, 'message_start');
  send({ type: 'content_block_start', index: 0, content_block: completed ? { type: 'text', text: '' } : { type: 'tool_use', id: 'tool_fixture', name, input: {} } }, 'content_block_start');
  send({ type: 'content_block_delta', index: 0, delta: completed ? { type: 'text_delta', text: 'fake-protocol-complete' } : { type: 'input_json_delta', partial_json: '{}' } }, 'content_block_delta');
  send({ type: 'content_block_stop', index: 0 }, 'content_block_stop');
  send({ type: 'message_delta', delta: { stop_reason: completed ? 'end_turn' : 'tool_use', stop_sequence: null }, usage: { output_tokens: 10 } }, 'message_delta');
  send({ type: 'message_stop' }, 'message_stop'); res.end();
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const config = { installId: `proof-${randomUUID().slice(0,8)}`, dataRoot: path.join(root, 'data'), stateRoot: path.join(root, 'state'), runtimeRoot: path.join(root, 'runtime'), port: 4000, credentials: { codex: path.join(root, 'absent-codex'), claude: path.join(root, 'absent-claude') }, images: { app: image, worker: image } };
const providers = createProviderService({ directory: path.join(root, 'providers') });
// Production uses rootless Docker: container root maps to the invoking host user.
// Rootful CI needs that same file owner for private 0700 mounts. Match the runner
// UID explicitly in this fixture rather than relaxing directory/socket permissions.
const rootless = (await docker(['info', '--format', '{{json .SecurityOptions}}'])).includes('rootless');
const runFixtureDocker = (args, options) => {
 if (rootless || args[0] !== 'run') return docker(args, options);
 const mapped = [...args], uid = process.getuid(), gid = process.getgid();
 const user = mapped.indexOf('--user'); if (user >= 0) mapped[user + 1] = `${uid}:${gid}`;
 for (let i = 0; i < mapped.length; i++) if (mapped[i] === '--tmpfs' && mapped[i + 1].startsWith('/storybench/home:')) mapped[i + 1] += `,uid=${uid},gid=${gid}`;
 return docker(mapped, options);
};
const host = createHost(config, { providerService: providers, log: () => {}, dockerApi: { ...dockerApi, docker: runFixtureDocker } });
console.log(`seat: ${rootless ? 'rootless' : 'rootful (supplementary)'} Docker ${await docker(['version', '--format', '{{.Server.Version}}'])}; worker ${image}; head ${(await execFileAsync('git', ['rev-parse', 'HEAD'])).stdout.trim()}; listener ${server.address().address}`);
const paths = hostPaths(config), network = names(config.installId).workerNetwork;
await mkdir(path.join(config.dataRoot, 'episodes', 'fixture', 'work'), { recursive: true });
await ensureNetwork(network, {});
let previousBinding;
const capabilities = [];
const deadline = (promise, label) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out`)), 90000).unref())]);
try {
 for (protocol of ['openai','anthropic']) {
  const source = `gateway-${protocol}`;
  await providers.saveGateway({ id: source, name: protocol, baseUrl: `http://127.0.0.1:${port}/v1`, protocol, models: ['fixture-model'] });
  await providers.replace(source, 'fake-fixture-key');
  for (mode of ['success', 'failure', 'cancel']) {
  calls = 0; tools = 0; sawImage = false; sawCredential = false;
  const upstreamStarted = new Promise((resolve) => { started = resolve; });
  const upstreamCancelled = new Promise((resolve) => { cancelled = resolve; });
  const requestId = `req-${protocol}-${mode}`, segmentId = `seg-${protocol}-${mode}`;
  await host.handle({ op: 'worker.start', requestId, harness: 'opencode', source, model: 'fixture-model', segmentId, episodeDir: 'episodes/fixture', workDir: 'episodes/fixture/work' });
  const binding = JSON.parse(await readFile(path.join(paths.credentialDir(requestId), 'gateway/binding.json'), 'utf8'));
  capabilities.push(binding.token);
  // Execute at the actual worker boundary, using only its private mounted capability.
  await docker(['exec', host.workers.get(requestId).containerId, 'node', '--input-type=module', '-e', `
    import http from 'node:http'; import fs from 'node:fs/promises'; import assert from 'node:assert/strict';
    const binding = JSON.parse(await fs.readFile('/run/storybench/gateway/binding.json', 'utf8'));
    assert.ok(!Object.values(process.env).some(value => value.includes('fake-fixture-key')));
    assert.equal((await fs.stat('/run/storybench/gateway/relay.sock')).mode & 0o777, 0o600);
    const send = (target, changes = {}) => new Promise((resolve, reject) => {
      const req = http.request({ socketPath: '/run/storybench/gateway/relay.sock', path: target, headers: { host: 'storybench-relay', 'x-storybench-token': binding.token, 'x-storybench-request': binding.requestId, 'x-storybench-source': binding.source, ...changes } }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); }); req.on('error', reject); req.end();
    });
    for (const target of ['http://other.test/v1/messages', '//other.test/v1/messages', '/v1/../outside', '/v1/%2e%2e/outside', '/outside']) assert.equal(await send(target), 400);
    for (const headers of [{ 'x-storybench-token': 'wrong' }, { 'x-storybench-request': 'wrong' }, { 'x-storybench-source': 'gateway-other' }, { authorization: 'Bearer unrelated-key' }, { 'x-api-key': 'unrelated-key' }]) assert.equal(await send('/v1/models', headers), 403);
    assert.equal(await send('/v1/models', { host: 'other.test' }), 400);
    const previous = ${JSON.stringify(previousBinding || null)};
    if (previous) assert.equal(await send('/v1/models', { 'x-storybench-token': previous.token, 'x-storybench-request': previous.requestId, 'x-storybench-source': previous.source }), 403);
  `]);
  previousBinding = binding;
  assert.match(await docker(['exec', host.workers.get(requestId).containerId, 'opencode', '--version']), /1\.19\.5/);
  const appDir = path.join(paths.requestDir(requestId), 'app');
  const bridge = await startBridge({ socketPath: path.join(appDir, 'bridge.sock'), token: 'fixture-token-01234567890123456789', tools: { definitions: [{ name: 'probe', description: 'Read fake context', inputSchema: { type: 'object', properties: {} } }], call: async () => { tools++; currentToolCall?.({ name: 'probe' }); return { text: 'tool executed' }; } } });
  await writeFile(path.join(appDir, 'mcp.json'), JSON.stringify({ mcpServers: { storybench: { command: 'node', args: ['/opt/storybench/app/src/runtime/worker/mcp-bridge.mjs'], env: { STORYBENCH_BRIDGE_SOCKET: '/run/storybench/request/app/bridge.sock', STORYBENCH_BRIDGE_TOKEN: 'fixture-token-01234567890123456789' } } } }));
  const events = []; let finish;
  const done = new Promise((resolve) => { finish = resolve; });
  const databaseRoot = path.join(root, `${protocol}-${mode}-conversation`);
  const store = new Store(databaseRoot), episode = store.createEpisode();
  const connection = new OpenCodeConnection({ model: 'fixture-model', spawnSession: (header) => connectHarness(path.join(paths.requestDir(requestId), 'worker', 'harness.sock'), header) });
  const startTurn = connection.startTurn.bind(connection);
  // Inject a disposable image at the harness input; chat's normal event consumer
  // must persist the actual returned stream and tools in its SQLite conversation.
  connection.startTurn = (thread, text) => startTurn(thread, text, [{ mimeType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAACXBIWXMAAAABAAAAAQBPJcTWAAAANklEQVR4nO3QwQkAMAwDsRS6/8aFjnCv/KQBbLjzZtdd3h8HSaIkUZIoSZQkShIliZJESaIpHwOEAXtEFT2UAAAAAElFTkSuQmCC' }]);
  const chat = createChatService({ store, continuity: { persistence: createV9ConversationPersistence(store), catalog: async () => [{ source, harness: 'opencode', available: true, models: [{ id: 'fixture-model', inputModalities: ['text', 'image'] }] }] }, codexFactory: async (options) => {
    assert.equal(options.source, source); assert.equal(options.harness, 'opencode');
    currentToolCall = options.onToolCall; connection.onError = options.onError;
    connection.onEvent = (event) => { options.onEvent(event); events.push(event); if (event.method === 'turn/completed') finish(event); };
    return connection;
  } });
  const conversation = chat.create(episode.id);
  try {
   await chat.updateSettings(episode.id, conversation.id, { source, harness: 'opencode', model: 'fixture-model', expectedRevision: 1 });
   await chat.send(episode.id, conversation.id, 'Call storybench probe, then say fake-protocol-complete.');
   if (mode === 'cancel') { await deadline(upstreamStarted, 'upstream start'); await chat.interrupt(episode.id, conversation.id); }
   const terminal = await deadline(done, protocol);
   await new Promise(setImmediate);
   assert.equal(terminal.params.turn.status, mode === 'success' ? 'completed' : mode === 'cancel' ? 'interrupted' : 'failed', JSON.stringify(events));
   const persisted = chat.get(episode.id, conversation.id);
   assert.equal(persisted.state, mode === 'success' ? 'idle' : mode === 'cancel' ? 'interrupted' : 'error');
   assert.ok(!JSON.stringify(persisted).includes('fake-fixture-key'));
   if (mode === 'success') {
    assert.ok(tools > 0 && calls > 1 && sawImage && sawCredential, JSON.stringify({ tools, calls, sawImage, sawCredential }));
    assert.ok(persisted.messages.some((message) => message.role === 'assistant' && message.text.includes('fake-protocol-complete')));
    assert.ok(persisted.events.some((event) => event.type === 'tool.called' && event.payload.name === 'probe'));
    assert.equal(persisted.runs.at(-1).state, 'completed');
   }
   console.log(`${protocol}/${mode}: pinned worker, private binding, loopback relay, conversation persistence and terminal state passed`);
  } catch (error) {
   // These are isolated fake-provider workers: retain bounded diagnostics with fixture
   // credential values removed, without exposing a real user's worker logs.
   try {
    const output = await execFileAsync('docker', ['logs', host.workers.get(requestId).containerId], { timeout: 10000, maxBuffer: 1024 * 1024 });
    let diagnostic = (output.stdout + output.stderr).slice(-4000).replaceAll('fake-fixture-key', '[fixture-key]').replaceAll('fixture-token-01234567890123456789', '[bridge-token]');
    for (const capability of capabilities) diagnostic = diagnostic.replaceAll(capability, '[transport-capability]');
    console.error(diagnostic);
   } catch { /* Original failure is authoritative. */ }
   const session = paths.sessionDir('opencode', segmentId);
   for (const file of await readdir(session, { recursive: true })) {
    if (!file.endsWith('.log')) continue;
    const log = await readFile(path.join(session, file), 'utf8');
    let diagnostic = log.slice(-12000).replaceAll('fake-fixture-key', '[fixture-key]').replaceAll('fixture-token-01234567890123456789', '[bridge-token]');
    for (const capability of capabilities) diagnostic = diagnostic.replaceAll(capability, '[transport-capability]');
    console.error(diagnostic);
   }
   throw error;
  } finally { await chat.close(); store.close(); connection.close(); await host.handle({ op: 'worker.stop', requestId }); await bridge.close(); }
  if (mode === 'cancel') await deadline(upstreamCancelled, 'upstream cancellation');
  assert.equal(await dockerApi.inspectContainer(names(config.installId).worker(requestId)), null);
  await assert.rejects(stat(paths.credentialDir(requestId)), { code: 'ENOENT' });
  await assert.rejects(stat(paths.requestDir(requestId)), { code: 'ENOENT' });
  }
 }
} finally { await host.stop(); await docker(['network', 'rm', network]).catch(() => {}); server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); await rm(root, { recursive: true, force: true }); }

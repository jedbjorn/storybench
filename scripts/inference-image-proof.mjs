// Exact pinned worker against fake protocols on the Docker host. No provider account.
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { docker, ensureNetwork } from '../src/runtime/docker.js';
import { createHost } from '../src/runtime/host.js';
import { createProviderService } from '../src/runtime/providers.js';
import { hostPaths, names } from '../src/runtime/layout.js';
import { startBridge } from '../src/runtime/bridge.js';
import { connectHarness } from '../src/runtime/channel.js';
import { OpenCodeConnection } from '../src/runtime/opencode.js';
const image = process.argv[2]; assert.match(image || '', /^sha256:/);
const root = await mkdtemp(path.join(os.tmpdir(), 'storybench-inference-'));
const server = http.createServer();
let protocol, calls, tools, sawImage, sawCredential, failRequests = false;
server.on('request', async (req, res) => {
  let text = ''; for await (const part of req) text += part;
  if (req.url.endsWith('/models')) { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ data: [{ id: 'fixture-model' }] })); return; }
  if (failRequests) { res.writeHead(401, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { message: 'Fake rejected key', type: 'authentication_error' } })); return; }
  const body = JSON.parse(text); calls++;
  assert.equal(body.model, 'fixture-model');
  sawImage ||= /image_url|"type":"image"/.test(text);
  sawCredential ||= req.headers.authorization === 'Bearer fake-fixture-key' || req.headers['x-api-key'] === 'fake-fixture-key';
  const tool = body.tools?.find((tool) => (tool.function?.name || tool.name).includes('probe'));
  assert.ok(tool, 'bridge tool schema reaches protocol');
  const name = tool.function?.name || tool.name;
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const send = (data, event = null) => res.write(`${event ? `event: ${event}\n` : ''}data: ${JSON.stringify(data)}\n\n`);
  if (protocol === 'openai') {
    const delta = tools ? { content: 'fake-protocol-complete' } : { tool_calls: [{ index: 0, id: 'call_fixture', type: 'function', function: { name, arguments: '{}' } }] };
    send({ id: 'chatcmpl-fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture-model', choices: [{ index: 0, delta, finish_reason: null }] });
    send({ id: 'chatcmpl-fixture', object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: tools ? 'stop' : 'tool_calls' }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } });
    res.end('data: [DONE]\n\n'); return;
  }
  send({ type: 'message_start', message: { id: 'msg_fixture', type: 'message', role: 'assistant', model: 'fixture-model', content: [], stop_reason: null, usage: { input_tokens: 10, output_tokens: 0 } } }, 'message_start');
  send({ type: 'content_block_start', index: 0, content_block: tools ? { type: 'text', text: '' } : { type: 'tool_use', id: 'tool_fixture', name, input: {} } }, 'content_block_start');
  send({ type: 'content_block_delta', index: 0, delta: tools ? { type: 'text_delta', text: 'fake-protocol-complete' } : { type: 'input_json_delta', partial_json: '{}' } }, 'content_block_delta');
  send({ type: 'content_block_stop', index: 0 }, 'content_block_stop');
  send({ type: 'message_delta', delta: { stop_reason: tools ? 'end_turn' : 'tool_use', stop_sequence: null }, usage: { output_tokens: 10 } }, 'message_delta');
  send({ type: 'message_stop' }, 'message_stop'); res.end();
});
await new Promise((resolve) => server.listen(0, '0.0.0.0', resolve));
const port = server.address().port;
const config = { installId: `proof-${randomUUID().slice(0,8)}`, dataRoot: path.join(root, 'data'), stateRoot: path.join(root, 'state'), runtimeRoot: path.join(root, 'runtime'), port: 4000, credentials: { codex: path.join(root, 'absent-codex'), claude: path.join(root, 'absent-claude') }, images: { app: image, worker: image } };
const providers = createProviderService({ directory: path.join(root, 'providers') });
const host = createHost(config, { providerService: providers, log: () => {} });
const paths = hostPaths(config), network = names(config.installId).workerNetwork;
await mkdir(path.join(config.dataRoot, 'episodes', 'fixture', 'work'), { recursive: true });
await ensureNetwork(network, {});
try {
 for (protocol of ['openai','anthropic']) {
  calls = 0; tools = 0; sawImage = false; sawCredential = false;
  const source = `gateway-${protocol}`;
  await providers.saveGateway({ id: source, name: protocol, baseUrl: `http://localhost:${port}/v1`, protocol, models: ['fixture-model'] });
  await providers.replace(source, 'fake-fixture-key');
  const requestId = `req-${protocol}`, segmentId = `seg-${protocol}`;
  await host.handle({ op: 'worker.start', requestId, harness: 'opencode', source, model: 'fixture-model', segmentId, episodeDir: 'episodes/fixture', workDir: 'episodes/fixture/work' });
  const appDir = path.join(paths.requestDir(requestId), 'app');
  const bridge = await startBridge({ socketPath: path.join(appDir, 'bridge.sock'), token: 'fixture-token-01234567890123456789', tools: { definitions: [{ name: 'probe', description: 'Read fake context', inputSchema: { type: 'object', properties: {} } }], call: async () => { tools++; return { text: 'tool executed' }; } } });
  await writeFile(path.join(appDir, 'mcp.json'), JSON.stringify({ mcpServers: { storybench: { command: 'node', args: ['/opt/storybench/app/src/runtime/worker/mcp-bridge.mjs'], env: { STORYBENCH_BRIDGE_SOCKET: '/run/storybench/request/app/bridge.sock', STORYBENCH_BRIDGE_TOKEN: 'fixture-token-01234567890123456789' } } } }));
  const events = []; let finish;
  const done = new Promise((resolve) => { finish = resolve; });
  const connection = new OpenCodeConnection({ model: 'fixture-model', spawnSession: (header) => connectHarness(path.join(paths.requestDir(requestId), 'worker', 'harness.sock'), header), onEvent: (event) => { events.push(event); if (event.method === 'turn/completed') finish(event); } });
  try {
   const thread = await connection.startThread();
   await connection.startTurn(thread, 'Call storybench probe, then say fake-protocol-complete.', [{ mimeType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4ZkAAAAASUVORK5CYII=' }]);
   const terminal = await Promise.race([done, new Promise((_, reject) => setTimeout(() => reject(new Error(`${protocol} timed out`)), 90000).unref())]);
   assert.equal(terminal.params.turn.status, 'completed', JSON.stringify(events));
   assert.ok(tools > 0 && calls > 1 && sawImage && sawCredential, JSON.stringify({ tools, calls, sawImage, sawCredential }));
   assert.ok(events.some((event) => event.params.delta?.includes('fake-protocol-complete')));
   console.log(`${protocol}: pinned image tool, image, selected credential, host gateway and stream passed`);
  } finally { connection.close(); await host.handle({ op: 'worker.stop', requestId }); await bridge.close(); }
 }
} finally { await docker(['network', 'rm', network]); await new Promise((resolve) => server.close(resolve)); await rm(root, { recursive: true, force: true }); }

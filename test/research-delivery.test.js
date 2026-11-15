import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { connect } from 'node:net';
import { Store, RESEARCH_LIMITS } from '../src/store.js';
import { TOOL_DELIVERED } from '../src/tool-delivery.js';
import { createResearchContext } from '../src/research-context.js';
import { CodexConnection } from '../src/codex.js';
import { WorkerCodexConnection, ClaudeChatConnection } from '../src/runtime/harnesses.js';
import { OpenCodeConnection } from '../src/runtime/opencode.js';
import { startBridge } from '../src/runtime/bridge.js';
import { mergeTools } from '../src/runtime/app-runtime.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'sb-rdeliver-')), store = new Store(root), p = store.createEpisode();
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
  let active = true;
  const research = createResearchContext({ store, episodeId: p.id, assertActive: () => { if (!active) throw new Error('Expired'); } });
  return { root, store, p, research, expire: () => { active = false; } };
}
function childFixture(harness) {
  const child = new EventEmitter(), writes = []; let release;
  child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.exitCode = null;
  child.kill = () => { child.exitCode = 0; child.emit('exit', 0); };
  child.stdin = new Writable({ write(chunk, _encoding, callback) {
    const value = JSON.parse(String(chunk)); writes.push(value);
    if (harness === 'codex' || harness === 'legacy-codex') {
      if (value.method === 'initialize') child.stdout.write(JSON.stringify({ id: value.id, result: {} }) + '\n');
      if (value.method === 'thread/start') child.stdout.write(JSON.stringify({ id: value.id, result: { thread: { id: 'thread-fixture' } } }) + '\n');
      if (value.method === 'turn/start') {
        release = error => { callback(error); child.stdout.write(JSON.stringify({ id: value.id, result: { turn: { id: 'turn-fixture' } } }) + '\n'); };
        return;
      }
    } else {
      release = callback;
      if (harness === 'claude') child.stdout.write(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'session-fixture' }) + '\n');
      return;
    }
    callback();
  } });
  child.stdin.on('error', () => {});
  return { child, writes, release: error => release(error), ready: () => Boolean(release) };
}

test('all native prompt serializers deliver the complete saved record before granting authoring, including maximum and empty context', async t => {
  for (const harness of ['codex', 'legacy-codex', 'claude', 'opencode']) for (const empty of [false, true]) await t.test(`${harness}/${empty ? 'empty' : 'maximum'}`, async t => {
    const f = fixture(t), native = childFixture(harness);
    if (!empty) f.store.saveResearch(f.p.id, 1, { summary: 'x'.repeat(RESEARCH_LIMITS.summaryBytes - 7) + 'END-MAX', links: [{ id: 'source', url: 'https://unavailable.example.test/image.png', title: 'Source', note: 'No automatic read' }] });
    const saved = f.store.getResearch(f.p.id), input = f.research.prompt();
    const options = { cwd: f.root, spawn: () => native.child, child: native.child, tools: harness === 'codex' ? { definitions: [], call() {} } : {}, spawnSession: async () => native.child };
    const connection = harness === 'codex' ? new WorkerCodexConnection(options) : harness === 'legacy-codex' ? new CodexConnection(options) : harness === 'claude' ? new ClaudeChatConnection(options) : new OpenCodeConnection(options);
    t.after(() => connection.close());
    await connection.open(); const thread = await connection.startThread();
    const started = connection.startTurn(thread, input.text, [], { onDelivered: input.onDelivered });
    while (!native.ready()) await tick();
    assert.throws(() => f.research.requireCurrent(), /has not been delivered/);
    const wire = native.writes.at(-1);
    const text = wire.params?.input?.[0]?.text ?? wire.message?.content?.[0]?.text ?? wire.text;
    assert.deepEqual(JSON.parse(/JSON data\):\n([^\n]+)/.exec(text)[1]), saved);
    native.release(); await started; await tick(); f.research.requireCurrent();
    f.expire(); input.onDelivered(); assert.throws(() => f.research.requireCurrent(), /Expired/);
  });
});

test('failed writes, abandoned replies and old read callbacks never grant or restore authoring delivery', async t => {
  for (const harness of ['codex', 'claude', 'opencode']) await t.test(`${harness}/failed-input`, async t => {
    const f = fixture(t), native = childFixture(harness), input = f.research.prompt();
    const options = { child: native.child, tools: { definitions: [], call() {} }, cwd: f.root, spawnSession: async () => native.child };
    const connection = harness === 'codex' ? new WorkerCodexConnection(options) : harness === 'claude' ? new ClaudeChatConnection(options) : new OpenCodeConnection(options);
    t.after(() => connection.close()); await connection.open(); const thread = await connection.startThread();
    const started = connection.startTurn(thread, input.text, [], { onDelivered: input.onDelivered });
    while (!native.ready()) await tick(); native.release(new Error('Injected write failure')); await started; await tick();
    assert.throws(() => f.research.requireCurrent(), /has not been delivered/);
  });
  const f = fixture(t), old = f.research.read();
  f.store.saveResearch(f.p.id, 1, { summary: 'New content', links: [] });
  const current = f.research.read(); current[TOOL_DELIVERED](); old[TOOL_DELIVERED](); f.research.requireCurrent();
  f.research.invalidate(); old[TOOL_DELIVERED](); assert.throws(() => f.research.requireCurrent(), /has not been delivered/);
  let release;
  const tools = mergeTools({ definitions: [], call() {} }, { read_research: async () => { const read = f.research.read(); await new Promise(resolve => { release = resolve; }); return read; } });
  const socketPath = path.join(f.root, 'abandoned.sock'), token = 'a'.repeat(64);
  const bridge = await startBridge({ socketPath, token, tools }); t.after(() => bridge.close());
  const socket = connect(socketPath); socket.on('error', () => {});
  await new Promise(resolve => socket.on('connect', resolve)); socket.write(JSON.stringify({ token, op: 'tools/call', name: 'read_research' }) + '\n');
  while (!release) await tick(); socket.destroy(); await tick(); release(); await tick();
  assert.throws(() => f.research.requireCurrent(), /has not been delivered/);
});


test('MCP app-to-proxy delivery alone is insufficient; native-write receipts are unguessable, one-use and request-local', async t => {
  const f = fixture(t), socketPath = path.join(f.root, 'receipt.sock'), token = 'r'.repeat(64);
  const tools = mergeTools({ definitions: [], call() {} }, { read_research: () => f.research.read() });
  const bridge = await startBridge({ socketPath, token, tools }); t.after(() => bridge.close());
  const rpc = message => new Promise((resolve, reject) => {
    const socket = connect(socketPath); let reply = '';
    socket.on('connect', () => socket.write(JSON.stringify({ token, ...message }) + '\n'));
    socket.on('data', chunk => { reply += chunk; }); socket.on('end', () => resolve(JSON.parse(reply))); socket.on('error', reject);
  });
  const reply = await rpc({ op: 'tools/call', name: 'read_research' });
  assert.deepEqual(JSON.parse(reply.result.content[0].text), f.store.getResearch(f.p.id));
  assert.match(reply.deliveryId, /^[0-9a-f-]{36}$/);
  assert.throws(() => f.research.requireCurrent(), /has not been delivered/);
  assert.equal((await rpc({ op: 'tools/acknowledge', deliveryId: '1' })).ok, false);
  assert.throws(() => f.research.requireCurrent(), /has not been delivered/);
  assert.equal((await rpc({ op: 'tools/acknowledge', deliveryId: reply.deliveryId })).ok, true); f.research.requireCurrent();
  assert.equal((await rpc({ op: 'tools/acknowledge', deliveryId: reply.deliveryId })).ok, false);
  const old = await rpc({ op: 'tools/call', name: 'read_research' }); f.research.invalidate();
  await rpc({ op: 'tools/acknowledge', deliveryId: old.deliveryId }); assert.throws(() => f.research.requireCurrent(), /has not been delivered/);
});

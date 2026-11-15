import { nativeFixture } from '../test-support/research-harness.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { connect } from 'node:net';
import { RESEARCH_LIMITS, RESEARCH_TRANSPORT_BYTES } from '../src/store.js';
import { createApp } from '../src/server.js';
import { mergeTools } from '../src/runtime/app-runtime.js';
import { selectKindTools } from '../src/runtime/kinds.js';
import { startBridge } from '../src/runtime/bridge.js';

const tick = () => new Promise(resolve => setTimeout(resolve, 5));
async function until(check) { for (let n = 0; n < 200; n++) { if (check()) return; await tick(); } throw new Error('Fixture did not settle'); }

test('real Codex dynamic and Claude/OpenCode stdio MCP paths share complete human/model research and lifecycle refusals for both kinds', async t => {
  for (const kind of ['video', 'deck']) for (const harness of ['codex', 'claude', 'opencode']) await t.test(`${kind}/${harness}`, async t => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'sb-rtools-'));
    let captured, prompt;
    const app = await createApp({ workspace: root, chatOptions: { codexFactory: async options => {
      captured = options;
      return { startThread: async () => 'thread-fixture', resumeThread: async id => id, startTurn: async (_thread, text) => { prompt = text; return 'turn-fixture'; },
        interrupt: async () => options.onEvent({ method: 'turn/completed', params: { turn: { id: 'turn-fixture', status: 'interrupted' } } }), close() {} };
    } } });
    const { store, chat } = app, p = store.createEpisode({ kind }), other = store.createEpisode();
    await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
    const humanApi = async (body = null) => {
      const response = await fetch(`http://127.0.0.1:${app.server.address().port}/api/episodes/${p.id}/research`, body ? { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
      assert.equal(response.status, 200); return response.json();
    };
    t.after(async () => { await app.close(); rmSync(root, { recursive: true, force: true }); });
    await humanApi({ expectedResearchRevision: 1, summary: 'Human findings with distinctive content', links: [{ id: 'human_link', url: 'https://example.com/human', note: 'Human note' }] });
    await chat.send(p.id, 'Revise the research'); await until(() => captured && prompt);
    assert.doesNotMatch(prompt, /Human findings with distinctive content/);
    assert.doesNotMatch(JSON.stringify(captured.tools.get_context()), /Human findings with distinctive content/);
    const tools = selectKindTools(mergeTools({ definitions: [], call: async () => { throw new Error('Unexpected runtime tool'); } }, captured.tools), kind);
    const native = await nativeFixture(t, harness, tools, root);
    for (const name of ['read_research', 'save_research']) assert.deepEqual(native.definitions.find(spec => spec.name === name), tools.definitions.find(spec => spec.name === name));
    const result = await native.call('read_research'); assert.equal(result.failed, false);
    const read = JSON.parse(result.text); assert.deepEqual(read, store.getResearch(p.id));
    assert.equal(read.episodeId, p.id); assert.equal(read.researchRevision, 2);
    const savedReply = await native.call('save_research', { expectedResearchRevision: read.researchRevision, summary: 'Agent findings', links: [{ ...read.links[0], title: 'Agent-edited title' }] });
    assert.equal(savedReply.failed, false); const saved = JSON.parse(savedReply.text);
    assert.equal(saved.actor, 'agent'); assert.deepEqual(saved, await humanApi()); assert.equal(saved.links[0].id, 'human_link');
    const human = await humanApi({ expectedResearchRevision: saved.researchRevision, summary: 'Human correction', links: saved.links });
    assert.deepEqual(JSON.parse((await native.call('read_research')).text), human);
    const stale = await native.call('save_research', { expectedResearchRevision: saved.researchRevision, summary: 'stale', links: [] });
    assert.equal(stale.failed, true); assert.deepEqual(JSON.parse(stale.text).current, human);
    for (const args of [{ episodeId: other.id }, { channelId: 'wrong-channel' }]) {
      const refusal = await native.call('save_research', { ...args, expectedResearchRevision: human.researchRevision, summary: 'wrong destination', links: [] });
      assert.equal(refusal.failed, true); assert.match(refusal.text, /bound to this request/);
    }
    for (const links of [[{ url: 'javascript:alert(1)' }], [{ url: 'https://example.com', note: 4 }]]) {
      assert.equal((await native.call('save_research', { expectedResearchRevision: human.researchRevision, summary: 'bad', links })).failed, true);
      assert.deepEqual(store.getResearch(p.id), human);
    }
    const oversize = await native.call('save_research', { expectedResearchRevision: human.researchRevision, summary: 'x'.repeat(RESEARCH_LIMITS.summaryBytes + 1), links: [] });
    assert.equal(oversize.failed, true); assert.match(oversize.text, /UTF-8 limit/);
    assert.deepEqual(store.getResearch(p.id), human);
    const large = { expectedResearchRevision: human.researchRevision, summary: 'é'.repeat(RESEARCH_LIMITS.summaryBytes / 2), links: [{ id: 'human_link', url: 'https://example.com/complete' }] };
    const largeReply = await native.call('save_research', large); assert.equal(largeReply.failed, false);
    const complete = JSON.parse((await native.call('read_research')).text); assert.equal(Buffer.byteLength(complete.summary), RESEARCH_LIMITS.summaryBytes);
    assert.deepEqual(store.getResearch(other.id).links, []); assert.equal(store.getResearch(other.id).researchRevision, 1);
    const expiredTools = captured.tools;
    captured.onEvent({ method: 'turn/completed', params: { turn: { id: 'turn-fixture', status: 'completed' } } });
    await until(() => chat.get(p.id).state === 'idle');
    assert.equal((await native.call('save_research', { expectedResearchRevision: complete.researchRevision, summary: 'after completion', links: [] })).failed, true);
    captured = null; await chat.send(p.id, 'Another turn'); await until(() => captured);
    assert.throws(() => expiredTools.save_research({ expectedResearchRevision: complete.researchRevision, summary: 'old request', links: [] }), /no longer active/);
    const currentNative = await nativeFixture(t, harness, selectKindTools(mergeTools({ definitions: [], call() {} }, captured.tools), kind), root);
    await chat.interrupt(p.id);
    assert.equal((await currentNative.call('save_research', { expectedResearchRevision: complete.researchRevision, summary: 'after stop', links: [] })).failed, true);
    assert.deepEqual(store.getResearch(p.id), complete);
  });
});

test('bridge accepts fully escaped valid research messages and rejects oversized transport with useful errors', async t => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'sb-rwire-')), socketPath = path.join(root, 'bridge.sock'), token = 'w'.repeat(64);
  let received;
  const bridge = await startBridge({ socketPath, token, tools: { definitions: [], call: async (_name, args) => { received = args; return { text: JSON.stringify(args) }; } } });
  t.after(async () => { await bridge.close(); rmSync(root, { recursive: true, force: true }); });
  const rpc = wire => new Promise((resolve, reject) => {
    const socket = connect(socketPath); let reply = '';
    socket.on('connect', () => socket.write(wire + '\n')); socket.on('data', data => { reply += data; });
    socket.on('end', () => { try { resolve(JSON.parse(reply)); } catch (error) { reject(error); } }); socket.on('error', reject);
  });
  const args = { summary: 'a'.repeat(RESEARCH_LIMITS.summaryBytes), links: [] };
  const message = JSON.stringify({ token, op: 'tools/call', name: 'save_research', arguments: args }).replace(/a/g, '\\u0061');
  assert.ok(Buffer.byteLength(message) > 256 * 1024);
  const saved = await rpc(message); assert.equal(saved.ok, true); assert.deepEqual(received, args);
  const oversized = await rpc(JSON.stringify({ token, padding: 'x'.repeat(RESEARCH_TRANSPORT_BYTES + 1) }));
  assert.equal(oversized.ok, false); assert.match(oversized.error, /transport limit/);
});

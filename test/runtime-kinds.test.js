import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { connect } from 'node:net';
import { KIND_REGISTRY, resolveKind, selectKindTools } from '../src/runtime/kinds.js';
import { loadTemplates, renderEpisodeBoot } from '../src/runtime/boot.js';
import { mergeTools, defaultBootContextFor } from '../src/runtime/app-runtime.js';
import { TOOL_DEFINITIONS, createScopedTools } from '../src/runtime/tools.js';
import { STORYBENCH_TOOLS } from '../src/codex.js';
import { WorkerCodexConnection } from '../src/runtime/harnesses.js';
import { startBridge } from '../src/runtime/bridge.js';
import { claimEpisodeRenders, activeRenderHolder } from '../src/runtime/request.js';
import { bindInstructionContext, contextFingerprint } from '../src/runtime/instruction-context.js';

async function temp(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'sb-kind-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
const all = () => mergeTools({ definitions: TOOL_DEFINITIONS, call: async (name) => ({ text: name }) },
  Object.fromEntries(STORYBENCH_TOOLS.map(({ name }) => [name, () => name])));
const rpc = (socketPath, token, message) => new Promise((resolve, reject) => {
  const socket = connect(socketPath); let buffer = '';
  socket.on('connect', () => socket.write(JSON.stringify({ token, ...message }) + '\n'));
  socket.on('data', (data) => { buffer += data; });
  socket.on('end', () => resolve(JSON.parse(buffer)));
  socket.on('error', reject);
});

test('saved kind selects the explicit registry; legacy videos retain every existing operation', async () => {
  assert.equal(resolveKind({}), 'video');
  for (const kind of ['unknown', '', null, '__proto__']) assert.throws(() => resolveKind({ kind }), { code: 'UNSUPPORTED_KIND' });
  assert.deepEqual(selectKindTools(all(), 'video').definitions, all().definitions);
  const deck = selectKindTools(all(), 'deck');
  assert.ok(deck.definitions.some(({ name }) => name === 'get_context'));
  assert.ok(!deck.definitions.some(({ name }) => name === 'update_cards'));
  for (const name of KIND_REGISTRY.video.tools) await assert.rejects(deck.call(name, {}), { code: 'UNKNOWN_TOOL' });
  await assert.rejects(deck.call('reuse_project_item', { cardId: 'video-card' }), { code: 'INVALID_ARGUMENT' });
  assert.equal((await deck.call('search_project')).text, 'search_project');
});

test('fixture deck registration serves its own operation and refuses it for video', async () => {
  const definition = { name: 'edit_slide', description: 'Edit a slide', inputSchema: { type: 'object' } };
  const registry = { ...KIND_REGISTRY, deck: { templates: 'deck', tools: ['edit_slide'] } };
  const base = all(); const calls = [];
  const tools = { definitions: [...base.definitions, definition], call: async (name, args) => { calls.push([name, args]); return { text: name }; } };
  const deck = selectKindTools(tools, 'deck', { registry });
  assert.deepEqual(deck.definitions.at(-1), definition);
  await deck.call('edit_slide', { id: 'one' });
  await assert.rejects(selectKindTools(tools, 'video', { registry }).call('edit_slide'), { code: 'UNKNOWN_TOOL' });
  assert.deepEqual(calls, [['edit_slide', { id: 'one' }]]);
});

test('Codex dynamic definitions, Claude and OpenCode MCP lists share schemas and dispatch refusal', async (t) => {
  const dir = await temp(t);
  for (const kind of ['video', 'deck']) for (const supportsImages of [true, false]) {
    const tools = selectKindTools(all(), kind, { supportsImages });
    const codex = new WorkerCodexConnection({ child: {}, tools, dynamicTools: true });
    assert.deepEqual(codex.dynamicTools.map(({ type, ...spec }) => spec), tools.definitions);
    const socketPath = path.join(dir, 'bridge.sock'), token = 'k'.repeat(64);
    const bridge = await startBridge({ socketPath, token, tools });
    try {
      // Both stdio MCP adapters forward to this same request bridge.
      for (const harness of ['claude', 'opencode']) {
        assert.deepEqual((await rpc(socketPath, token, { op: 'tools/list' })).result.tools, tools.definitions, harness);
        const hidden = kind === 'deck' ? 'create_draft' : !supportsImages ? 'inspect_image' : 'edit_slide';
        assert.equal((await rpc(socketPath, token, { op: 'tools/call', name: hidden })).result.isError, true);
      }
    } finally { await bridge.close(); }
    assert.equal(tools.definitions.some(({ name }) => name === 'inspect_image'), supportsImages);
  }
});

test('kind templates isolate guidance, clean owned files in every native root, and retain unrelated files', async (t) => {
  const episodeDir = await temp(t);
  const store = { workspace: episodeDir, episodeLocation: () => ({ directory: episodeDir, legacy: true }),
    getEpisode: () => ({ title: 'Demo', revision: 1 }), episodeOutputDirectory: () => path.join(episodeDir, 'outputs/drafts') };
  const context = defaultBootContextFor(store, { episodeId: 'e', harness: 'opencode' })({ served: ['get_context'] });
  context.paths.episode = episodeDir; context.paths.work = path.join(episodeDir, 'work');
  const video = await loadTemplates(), deck = await loadTemplates(undefined, 'deck');
  assert.notEqual(video.version, deck.version);
  assert.ok(video.skills.some(({ name }) => name === 'storybench-finish-video'));
  assert.ok(deck.skills.every(({ name }) => !/finish|assemble|video|broll|graphics|cards/.test(name)));
  await renderEpisodeBoot({ episodeDir, context, templates: video });
  const user = path.join(episodeDir, '.agents/skills/user/SKILL.md');
  await mkdir(path.dirname(user), { recursive: true }); await writeFile(user, 'user');
  const result = await renderEpisodeBoot({ episodeDir, context, templates: deck, kind: 'deck' });
  assert.equal(result.kind, 'deck');
  assert.equal(await readFile(user, 'utf8'), 'user');
  for (const root of ['.agents', '.claude', '.opencode']) {
    assert.ok(result.removed.includes(`${root}/skills/storybench-finish-video/SKILL.md`));
    assert.equal(await readFile(path.join(episodeDir, root, 'skills/storybench-read-references/SKILL.md'), 'utf8'),
      await readFile(path.join(episodeDir, '.agents/skills/storybench-read-references/SKILL.md'), 'utf8'));
  }
  const boot = await readFile(path.join(episodeDir, 'AGENTS.md'), 'utf8');
  assert.match(boot, /tools served to this request: get_context/);
  assert.doesNotMatch(boot, /create_final|create_draft|update_cards|storybench-finish-video/);
});

test('duplicate shared/kind skills fail before renders change; active renders cannot be replaced', async (t) => {
  const dir = await temp(t);
  for (const branch of ['shared', 'deck']) {
    await mkdir(path.join(dir, branch, 'skills/one'), { recursive: true });
    await writeFile(path.join(dir, branch, 'BOOT.md'), branch);
    await writeFile(path.join(dir, branch, 'skills/one/SKILL.md'), '---\nname: same\ndescription: fixture\n---\n');
  }
  await assert.rejects(loadTemplates(dir, 'deck'), /Duplicate skill/);
  const release = claimEpisodeRenders(dir, 'r1');
  assert.throws(() => claimEpisodeRenders(dir, 'r2'), { code: 'EPISODE_BUSY' });
  assert.equal(activeRenderHolder(dir), 'r1'); release();
  claimEpisodeRenders(dir, 'r2')();
});

test('compatible context resumes; changed templates, tools, kind or missing fingerprint require a fresh session', async (t) => {
  const episodeDir = await temp(t), templates = await loadTemplates();
  const definitions = selectKindTools(all(), 'video').definitions;
  const version = contextFingerprint('video', templates, definitions);
  const calls = [];
  const fake = () => ({ async startThread() { calls.push('start'); return `new-${calls.length}`; }, async resumeThread(id) { calls.push('resume'); return id; } });
  const options = { episodeDir, segmentId: 'segment-one', version };
  const first = await bindInstructionContext(fake(), options); const id = await first.startThread();
  const next = await bindInstructionContext(fake(), options); assert.equal(await next.resumeThread(id), id);
  assert.equal(next.segmentTransition, undefined);
  const versions = [contextFingerprint('deck', templates, definitions), contextFingerprint('video', { ...templates, boot: templates.boot + 'changed' }, definitions),
    contextFingerprint('video', templates, definitions.slice(1))];
  for (const changed of versions) {
    const connection = await bindInstructionContext(fake(), { ...options, version: changed });
    assert.notEqual(await connection.resumeThread(id), id);
    assert.equal(connection.segmentTransition.reason, 'instruction-context-changed');
  }
  const legacy = await bindInstructionContext(fake(), { ...options, segmentId: 'unknown' });
  await legacy.resumeThread('old'); assert.equal(legacy.segmentTransition.previousThreadId, 'old');
  assert.equal(calls.filter((value) => value === 'resume').length, 1);
  assert.equal(contextFingerprint('video', { ...templates, version: 'irrelevant' }, definitions), version);
});

test('model selectors cannot change saved production kind', () => {
  const saved = { kind: 'deck', id: 'deck-one' };
  for (const selection of [{ harness: 'codex' }, { harness: 'claude', kind: 'video' }, { harness: 'opencode', model: 'remote' }]) {
    // Selection is an inference argument; registry resolution reads only saved state.
    const tools = selectKindTools(all(), resolveKind(saved), { supportsImages: selection.model !== 'text' });
    assert.ok(!tools.definitions.some(({ name }) => name === 'create_draft'));
    assert.equal(saved.kind, 'deck');
  }
});

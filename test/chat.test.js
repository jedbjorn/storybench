import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { Store } from '../src/store.js';
import { createChatService } from '../src/chat.js';
import { CodexConnection } from '../src/codex.js';

const delay = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, timeout = 1_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const value = check(); if (value) return value; await delay(5); }
  throw new Error('Timed out waiting for condition');
}
function workspace() { return mkdtempSync(path.join(tmpdir(), 'storybench-chat-')); }

test('chat persists deltas, resumes exact thread, and mutates through revisioned Store tool', async () => {
  const root = workspace();
  const store = new Store(root);
  const episode = store.createEpisode({ title: 'Pilot' });
  store.saveAsset({ name: 'clip.mp4', hash: 'safe-hash', kind: 'video', path: 'media/clip.mp4', duration: 4, width: 1280, height: 720, thumbnailPath: 'cache/thumb.jpg', metadata: { originPath: '/private/camera/secret.mp4', probeFile: '/tmp/probe.json', streams: [{ codec_type: 'audio' }] } });
  const calls = [];
  let projectedAssets;
  let turn = 0;
  const factory = async (options) => ({
    async startThread() { calls.push('start:t_exact'); return 't_exact'; },
    async resumeThread(id) { calls.push(`resume:${id}`); return id; },
    async startTurn(threadId) {
      turn += 1; const turnId = `turn_${turn}`; calls.push(`turn:${threadId}:${turnId}`);
      queueMicrotask(async () => {
        options.onEvent({ method: 'turn/started', params: { threadId, turn: { id: turnId } } });
        options.onEvent({ method: 'item/agentMessage/delta', params: { threadId, turnId, delta: 'Updated ' } });
        if (turn === 1) {
          const project = await options.tools.get_project({});
          projectedAssets = await options.tools.list_assets({});
          await options.tools.update_storyboard({ expectedRevision: project.revision, cards: [{ title: 'Opening', purpose: 'Hook', missing: 'B-roll' }] });
        }
        options.onEvent({ method: 'item/agentMessage/delta', params: { threadId, turnId, delta: 'the story.' } });
        options.onEvent({ method: 'turn/completed', params: { threadId, turn: { id: turnId, status: 'completed' } } });
      });
      return turnId;
    },
    close() {}
  });
  const chat = createChatService({ store, codexFactory: factory });
  assert.equal((await chat.send(episode.id, 'Improve the opening')).state, 'queued');
  await until(() => chat.get(episode.id).state === 'idle');
  assert.equal(store.getEpisode(episode.id).revision, 2);
  assert.equal(store.getEpisode(episode.id).cards[0].title, 'Opening');
  assert.deepEqual(projectedAssets, [{ id: projectedAssets[0].id, name: 'clip.mp4', kind: 'video', duration: 4, width: 1280, height: 720, hasAudio: true, mediaRef: 'media/clip.mp4', thumbnailRef: 'cache/thumb.jpg' }]);
  assert.doesNotMatch(JSON.stringify(projectedAssets), /origin|private|probe/i);
  assert.equal(chat.get(episode.id).messages.at(-1).text, 'Updated the story.');
  await chat.send(episode.id, 'What changed?');
  await until(() => chat.get(episode.id).state === 'idle' && chat.get(episode.id).messages.length === 4);
  assert.deepEqual(calls.slice(0, 4), ['start:t_exact', 'turn:t_exact:turn_1', 'resume:t_exact', 'turn:t_exact:turn_2']);
  await chat.close(); store.close(); rmSync(root, { recursive: true, force: true });
});

test('interrupt targets exact turn and restart never replays an active prompt', async () => {
  const root = workspace(); const store = new Store(root); const episode = store.createEpisode();
  let options; let interrupted;
  const factory = async (value) => { options = value; return {
    async startThread() { return 'thread_stop'; },
    async startTurn() { return 'turn_stop'; },
    async interrupt(threadId, turnId) {
      interrupted = [threadId, turnId];
      queueMicrotask(() => options.onEvent({ method: 'turn/completed', params: { threadId, turn: { id: turnId, status: 'interrupted' } } }));
    }, close() {}
  }; };
  let chat = createChatService({ store, codexFactory: factory });
  await chat.send(episode.id, 'Wait here');
  await until(() => chat.get(episode.id).messages[0]?.turnId === 'turn_stop');
  await chat.interrupt(episode.id);
  await until(() => chat.get(episode.id).state === 'interrupted');
  assert.deepEqual(interrupted, ['thread_stop', 'turn_stop']);
  store.db.prepare("UPDATE chats SET state='running',active_turn_id='lost_turn' WHERE episode_id=?").run(episode.id);
  chat = createChatService({ store, codexFactory: async () => { throw new Error('must not launch'); } });
  const recovered = chat.get(episode.id);
  assert.equal(recovered.state, 'error');
  assert.match(recovered.error, /not replayed/i);
  await chat.close(); store.close(); rmSync(root, { recursive: true, force: true });
});

test('queued interruption aborts startup and closes late storyboard mutation gate', async () => {
  const root = workspace(); const store = new Store(root); const episode = store.createEpisode();
  let release;
  let captured;
  const factory = (options) => new Promise((resolve) => { captured = options; release = () => resolve({ close() {}, startThread: async () => 'too_late' }); });
  const chat = createChatService({ store, codexFactory: factory });
  await chat.send(episode.id, 'Change it');
  await until(() => captured);
  const stopped = await chat.interrupt(episode.id);
  assert.equal(stopped.state, 'interrupted');
  assert.equal(captured.signal.aborted, true);
  assert.throws(() => captured.tools.update_storyboard({ expectedRevision: 1, cards: [] }), /no longer active/);
  release();
  await until(() => chat.get(episode.id).messages[0].state === 'interrupted');
  assert.equal(store.getEpisode(episode.id).revision, 1);
  await chat.close(); store.close(); rmSync(root, { recursive: true, force: true });
});

test('Codex JSONL client declares scoped tools and answers dynamic tool calls', async () => {
  const requests = []; const stdout = new PassThrough(); const stderr = new PassThrough();
  let connection;
  const child = new EventEmitter();
  child.stdout = stdout; child.stderr = stderr; child.exitCode = null;
  child.kill = () => { child.exitCode = 0; child.emit('exit', 0, null); };
  child.stdin = new Writable({ write(chunk, _encoding, callback) {
    for (const line of String(chunk).trim().split('\n')) {
      const request = JSON.parse(line); requests.push(request);
      if (request.id && request.method === 'initialize') stdout.write(`${JSON.stringify({ id: request.id, result: {} })}\n`);
      if (request.id && request.method === 'thread/start') stdout.write(`${JSON.stringify({ id: request.id, result: { thread: { id: 'thread_rpc' } } })}\n`);
      if (request.id && request.method === 'turn/start') stdout.write(`${JSON.stringify({ id: request.id, result: { turn: { id: 'turn_rpc' } } })}\n`);
    }
    callback();
  } });
  connection = await new CodexConnection({ cwd: '/tmp', tools: { get_project: () => ({ revision: 7 }) }, spawn: () => child }).open();
  const threadId = await connection.startThread();
  assert.equal(await connection.startTurn(threadId, 'hello'), 'turn_rpc');
  const start = requests.find((request) => request.method === 'thread/start');
  assert.equal(start.params.sandbox, 'read-only');
  assert.equal(start.params.approvalPolicy, 'never');
  assert.deepEqual(start.params.dynamicTools.map((tool) => tool.name), ['get_project', 'list_assets', 'update_storyboard']);
  stdout.write(`${JSON.stringify({ id: 99, method: 'item/tool/call', params: { threadId, turnId: 'turn_rpc', callId: 'call_1', tool: 'get_project', arguments: {} } })}\n`);
  await until(() => requests.some((request) => request.id === 99 && request.result));
  const response = requests.find((request) => request.id === 99);
  assert.equal(response.result.success, true);
  assert.match(response.result.contentItems[0].text, /"revision":7/);
  connection.close();
});

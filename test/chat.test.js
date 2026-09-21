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
  const asset = store.saveAsset({ name: 'clip.mp4', hash: 'safe-hash', kind: 'video', path: 'media/clip.mp4', duration: 4, width: 1280, height: 720, thumbnailPath: 'cache/thumb.jpg', metadata: { originPath: '/private/camera/secret.mp4', probeFile: '/tmp/probe.json', streams: [{ codec_type: 'audio' }] } });
  store.attachLibraryItem(episode.id, asset.id, { category: 'B-roll', label: 'clip' });
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
  store.db.prepare("UPDATE conversations SET state='running',active_turn_id='lost_turn' WHERE episode_id=?").run(episode.id);
  chat = createChatService({ store, codexFactory: async () => { throw new Error('must not launch'); } });
  const recovered = chat.get(episode.id);
  assert.equal(recovered.state, 'interrupted');
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
  connection = await new CodexConnection({ cwd: '/tmp', tools: { get_context: () => ({ revision: 7 }) }, spawn: () => child }).open();
  const threadId = await connection.startThread();
  assert.equal(await connection.startTurn(threadId, 'hello'), 'turn_rpc');
  const start = requests.find((request) => request.method === 'thread/start');
  assert.equal(start.params.sandbox, 'read-only');
  assert.equal(start.params.approvalPolicy, 'never');
  assert.deepEqual(start.params.dynamicTools.map((tool) => tool.name), ['get_context','get_operation_guide','read_conversation_history','read_reference_excerpt','update_story','update_cards','validate_render','create_draft','request_final','create_final','get_job','await_job','cancel_job','move_final_to_drafts','list_graphic_recipes','get_graphic_recipe','create_graphic_recipe','update_graphic_recipe','render_graphic','list_branding','promote_card','apply_branding']);
  stdout.write(`${JSON.stringify({ id: 99, method: 'item/tool/call', params: { threadId, turnId: 'turn_rpc', callId: 'call_1', tool: 'get_context', arguments: {} } })}\n`);
  await until(() => requests.some((request) => request.id === 99 && request.result));
  const response = requests.find((request) => request.id === 99);
  assert.equal(response.result.success, true);
  assert.match(response.result.contentItems[0].text, /"revision":7/);
  connection.close();
});

test('multiple conversations keep names and drafts while one turn per episode is enforced', async () => {
  const root = workspace(); const store = new Store(root); const episode = store.createEpisode();
  let options;
  const factory = async (value) => { options = value; return { startThread: async () => 'thread_one', startTurn: async () => 'turn_one', interrupt: async (threadId, turnId) => queueMicrotask(() => value.onEvent({ method: 'turn/completed', params: { threadId, turn: { id: turnId, status: 'interrupted' } } })), close() {} }; };
  const chat = createChatService({ store, codexFactory: factory, renders: {} });
  const one = chat.create(episode.id, { name: 'Outline' });
  const two = chat.create(episode.id, { name: 'Polish' });
  chat.update(episode.id, one.id, { draft: 'unsent outline' });
  chat.update(episode.id, two.id, { name: 'Final polish', draft: 'different draft' });
  assert.equal(chat.get(episode.id, one.id).draft, 'unsent outline');
  assert.equal(chat.get(episode.id, two.id).draft, 'different draft');
  await chat.send(episode.id, one.id, 'start');
  await until(() => options);
  await assert.rejects(chat.send(episode.id, two.id, 'must reject'), (cause) => cause.statusCode === 409);
  await assert.rejects(chat.interrupt(episode.id, two.id), (cause) => cause.statusCode === 409);
  await chat.interrupt(episode.id, one.id);
  await until(() => chat.get(episode.id, one.id).state === 'interrupted');
  assert.equal(chat.get(episode.id, two.id).draft, 'different draft');
  await chat.close(); store.close(); rmSync(root, { recursive: true, force: true });
});

test('legacy episode chat migrates once with exact thread and history', async () => {
  const root = workspace(); const store = new Store(root); const episode = store.createEpisode(); const stamp = new Date().toISOString();
  store.db.exec(`CREATE TABLE chats(episode_id TEXT PRIMARY KEY,state TEXT,thread_id TEXT,active_turn_id TEXT,error TEXT,created_at TEXT,updated_at TEXT,name TEXT);
    CREATE TABLE chat_messages(id INTEGER PRIMARY KEY AUTOINCREMENT,episode_id TEXT,role TEXT,text TEXT,state TEXT,turn_id TEXT,created_at TEXT,updated_at TEXT);
    CREATE TABLE chat_events(episode_id TEXT,sequence INTEGER,type TEXT,payload TEXT,created_at TEXT,PRIMARY KEY(episode_id,sequence));`);
  store.db.prepare("INSERT INTO chats VALUES(?,'idle','thread_legacy',NULL,NULL,?,?,?)").run(episode.id, stamp, stamp, 'Original chat');
  store.db.prepare("INSERT INTO chat_messages(episode_id,role,text,state,created_at,updated_at) VALUES(?,'user','hello','completed',?,?)").run(episode.id, stamp, stamp);
  const legacyMessageId = Number(store.db.prepare("SELECT id FROM chat_messages WHERE episode_id=?").get(episode.id).id);
  store.db.prepare("INSERT INTO chat_events VALUES(?,1,'assistant.delta',?,?)").run(episode.id, JSON.stringify({ messageId: legacyMessageId }), stamp);
  const chat = createChatService({ store, codexFactory: async () => { throw new Error('not used'); }, renders: {} });
  const migrated = chat.list(episode.id);
  assert.equal(migrated.length, 1); assert.equal(migrated[0].threadId, 'thread_legacy'); assert.equal(migrated[0].name, 'Original chat');
  assert.equal(chat.get(episode.id, migrated[0].id).messages[0].text, 'hello');
  assert.equal(chat.get(episode.id, migrated[0].id).messages[0].id, legacyMessageId);
  assert.equal(chat.get(episode.id, migrated[0].id).events[0].payload.messageId, legacyMessageId);
  assert.equal(createChatService({ store, renders: {} }).list(episode.id).length, 1);
  await chat.close(); store.close(); rmSync(root, { recursive: true, force: true });
});

test('agent final tool cannot mint grants and forwards exact conversation scope', async () => {
  const root = workspace(); const store = new Store(root); const episode = store.createEpisode(); let options; let enqueued;
  const renders = { validateRender: () => ({ renderRevision: 'render_exact' }), enqueueRender: (input) => { enqueued = input; return { id: 'job_final' }; } };
  const factory = async (value) => { options = value; return { startThread: async () => 'thread_final', startTurn: async () => 'turn_final', interrupt: async (threadId, turnId) => queueMicrotask(() => value.onEvent({ method: 'turn/completed', params: { threadId, turn: { id: turnId, status: 'interrupted' } } })), close() {} }; };
  const chat = createChatService({ store, renders, codexFactory: factory }); const conversation = chat.create(episode.id);
  await chat.send(episode.id, conversation.id, 'make final'); await until(() => options);
  assert.deepEqual(options.tools.request_final({}), { requiredAction: 'Use Create final in Storybench', conversationId: conversation.id, renderRevision: 'render_exact' });
  assert.equal(options.tools.mint_final_grant, undefined);
  assert.deepEqual(options.tools.create_final({ expectedRenderRevision: 'render_exact', finalGrantId: 'grant_human' }), { id: 'job_final' });
  assert.deepEqual(enqueued, { episodeId: episode.id, outputClass: 'final', expectedRenderRevision: 'render_exact', finalGrantId: 'grant_human', conversationId: conversation.id, requestId: options.requestId });
  await chat.interrupt(episode.id, conversation.id); await until(() => chat.get(episode.id, conversation.id).state === 'interrupted');
  await chat.close(); store.close(); rmSync(root, { recursive: true, force: true });
});

test('late provider resolution cannot start a stopped turn', async () => {
  const root = workspace(); const store = new Store(root); const episode = store.createEpisode(); let releaseResume, starts = 0;
  store.db.exec(`CREATE TABLE chats(episode_id TEXT PRIMARY KEY,state TEXT,thread_id TEXT,active_turn_id TEXT,error TEXT,created_at TEXT,updated_at TEXT,name TEXT);
    CREATE TABLE chat_messages(id INTEGER PRIMARY KEY AUTOINCREMENT,episode_id TEXT,role TEXT,text TEXT,state TEXT,turn_id TEXT,created_at TEXT,updated_at TEXT);
    CREATE TABLE chat_events(episode_id TEXT,sequence INTEGER,type TEXT,payload TEXT,created_at TEXT,PRIMARY KEY(episode_id,sequence));`);
  const stamp = new Date().toISOString(); store.db.prepare("INSERT INTO chats VALUES(?,'idle','saved-thread',NULL,NULL,?,?,?)").run(episode.id, stamp, stamp, 'Saved');
  const factory = async () => ({ resumeThread: () => new Promise((resolve) => { releaseResume = resolve; }), startTurn: async () => { starts++; return 'late'; }, close() {} });
  const chat = createChatService({ store, renders: {}, codexFactory: factory }); const conversation = chat.list(episode.id)[0];
  await chat.send(episode.id, conversation.id, 'do not dispatch'); await until(() => releaseResume);
  await chat.interrupt(episode.id, conversation.id); releaseResume('saved-thread');
  await until(() => chat.get(episode.id, conversation.id).messages[0].state === 'interrupted');
  assert.equal(starts, 0);
  await chat.close(); store.close(); rmSync(root, { recursive: true, force: true });
});

test('tool closures are bound to one turn and context omits private extraction data', async () => {
  const root = workspace(); const store = new Store(root); const episode = store.createEpisode();
  const asset = store.saveAsset({ name: 'reference.txt', hash: 'ref', kind: 'document', path: 'reference/private.txt', metadata: { originPath: '/private/secret' } });
  const item = store.attachLibraryItem(episode.id, asset.id, { category: 'Reference', label: 'Reference' });
  store.db.prepare("UPDATE library_items SET extracted_text='SECRET EXTRACTED TEXT',provenance=? WHERE id=?").run(JSON.stringify({ privatePath: '/tmp/private' }), item.id);
  const turns = [];
  const factory = async (options) => ({ startThread: async () => `thread_${turns.length}`, resumeThread: async (id) => id,
    startTurn: async (_thread, _text) => { const id = `turn_${turns.length + 1}`; turns.push({ id, options }); return id; },
    interrupt: async (threadId, turnId) => queueMicrotask(() => options.onEvent({ method: 'turn/completed', params: { threadId, turn: { id: turnId, status: 'interrupted' } } })), close() {} });
  const chat = createChatService({ store, renders: {}, codexFactory: factory }); const conversation = chat.create(episode.id);
  await chat.send(episode.id, conversation.id, 'first'); await until(() => turns.length === 1);
  const firstTools = turns[0].options.tools;
  assert.doesNotMatch(JSON.stringify(firstTools.get_context({})), /SECRET|privatePath|originPath/);
  await chat.interrupt(episode.id, conversation.id); await until(() => chat.get(episode.id, conversation.id).state === 'interrupted');
  await chat.send(episode.id, conversation.id, 'second'); await until(() => turns.length === 2);
  assert.throws(() => firstTools.update_cards({ expectedRevision: store.getEpisode(episode.id).revision, cards: [] }), /no longer active/);
  await chat.interrupt(episode.id, conversation.id); await until(() => chat.get(episode.id, conversation.id).state === 'interrupted');
  await chat.close(); store.close(); rmSync(root, { recursive: true, force: true });
});

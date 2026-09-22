import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { Store } from '../src/store.js';
import { createChatService } from '../src/chat.js';
import { CodexConnection } from '../src/codex.js';
import { WorkerCodexConnection, ClaudeStreamSession } from '../src/runtime/harnesses.js';
import { createV9ConversationPersistence } from '../src/runtime/conversation-persistence.js';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVQImWP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==', 'base64');
const until = async (check) => { for (let i = 0; i < 400; i++) { if (check()) return; await new Promise((resolve) => setTimeout(resolve, 10)); } throw new Error('Timed out'); };

test('chat images survive reopen, reach the adapter as PNG content, and remain on explicit retry', async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'sb-chat-images-')), store = new Store(root), episode = store.createEpisode();
  const file = path.join(store.episodeWorkDirectory(episode.id), 'reference.png'); writeFileSync(file, png);
  const asset = store.saveAsset({ channelId: episode.channelId, name: 'reference.png', hash: 'image-hash', kind: 'image', path: path.relative(root, file), width: 2, height: 2 });
  const item = store.attachLibraryItem(episode.id, asset.id, { category: 'Reference', label: 'Red reference' });
  const received = []; let fail = true;
  const factory = async (options) => ({
    startThread: async () => 'thread', resumeThread: async () => 'thread', close() {},
    async startTurn(_id, prompt, images) {
      received.push({ prompt, images });
      queueMicrotask(() => options.onEvent({ method: 'turn/completed', params: { turn: { id: 'turn', status: fail ? 'failed' : 'completed' } } }));
      return 'turn';
    },
  });
  const persistence = createV9ConversationPersistence(store);
  let chat = createChatService({ store, codexFactory: factory, requestPersistence: persistence });
  t.after(async () => { await chat.close(); store.close(); rmSync(root, { recursive: true, force: true }); });
  const conversation = chat.create(episode.id);
  chat.update(episode.id, conversation.id, { attachmentIds: [item.id] });
  await chat.close(); chat = createChatService({ store, codexFactory: factory, requestPersistence: persistence });
  assert.equal(chat.get(episode.id, conversation.id).draftAttachments[0].itemId, item.id);
  await chat.send(episode.id, conversation.id, '', [item.id]);
  await until(() => chat.get(episode.id, conversation.id).state === 'error');
  let current = chat.get(episode.id, conversation.id);
  assert.equal(current.messages[0].attachments[0].itemId, item.id);
  assert.equal(current.draftAttachments[0].itemId, item.id);
  assert.equal(received[0].images[0].mimeType, 'image/png');
  assert.deepEqual(Buffer.from(received[0].images[0].data, 'base64').subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  assert.match(received[0].prompt, /Red reference/);
  fail = false;
  await chat.retry(episode.id, conversation.id, current.runs[0].id, { clientRequestId: 'retry-image' });
  await until(() => chat.get(episode.id, conversation.id).state === 'idle');
  current = chat.get(episode.id, conversation.id);
  assert.equal(current.messages.at(-1).attachments[0].itemId, item.id);
  assert.deepEqual(received[1].images, received[0].images);
  const other = store.createEpisode(); const otherChat = chat.create(other.id);
  await assert.rejects(chat.send(other.id, otherChat.id, 'wrong episode', [item.id]), /this episode/);
  assert.throws(() => chat.update(episode.id, conversation.id, { attachmentIds: Array(9).fill(item.id) }), /eight/);
  const bad = store.saveAsset({ channelId: episode.channelId, name: 'clip', hash: 'video-hash', kind: 'video', path: 'media/clip.mp4' });
  const video = store.attachLibraryItem(episode.id, bad.id, { category: 'B-roll', label: 'Clip' });
  await assert.rejects(chat.send(episode.id, conversation.id, 'wrong kind', [video.id]), /must be an image/);
});

test('both Codex adapters and Claude stream serialize actual image input blocks', async () => {
  const images = [{ mimeType: 'image/png', data: png.toString('base64') }];
  for (const Connection of [CodexConnection, WorkerCodexConnection]) {
    let payload;
    const fake = { request: async (_method, params) => { payload = params; return { turn: { id: 'turn' } }; }, cwd: '/project', onEvent() {} };
    await Connection.prototype.startTurn.call(fake, 'thread', 'Inspect', images);
    assert.equal(payload.input[1].type, 'image');
    assert.equal(payload.input[1].url, `data:image/png;base64,${images[0].data}`);
  }
  const child = new EventEmitter(); child.stdin = new PassThrough(); child.stdout = new PassThrough();
  const session = new ClaudeStreamSession(child); let body = '';
  child.stdin.on('data', (chunk) => { body += chunk; });
  const done = session.send('Inspect', images);
  const message = JSON.parse(body).message;
  assert.deepEqual(message.content[1], { type: 'image', source: { type: 'base64', media_type: 'image/png', data: images[0].data } });
  child.stdout.write(JSON.stringify({ type: 'result' }) + '\n'); await done; child.stdout.end();
});

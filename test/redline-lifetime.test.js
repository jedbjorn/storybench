import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../src/server.js';

const until = async (check, label = 'condition') => {
  for (let i = 0; i < 500; i++) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 10)); }
  throw new Error(`Timed out waiting for ${label}`);
};
const colourPNG = (folder, colour) => {
  const file = path.join(folder, `${colour}.png`);
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', `color=c=${colour}:s=40x30`, '-frames:v', '1', '-y', file]);
  return readFile(file);
};

// A9: starting a new chat removes the production's redline images from disk and their records, with every Kept
// exception, no production side effects, the old-chat placeholder data, the refused Retry and the agent's view.
test('a new chat removes redline images with their records and keeps in-use, running-turn and shared-bytes cases', async t => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'sb-redline-life-'));
  const agent = { fail: false, hold: false, releases: [], history: null, prompts: [] };
  const codexFactory = async options => ({
    async startThread() { return `thread-${crypto.randomUUID()}`; }, async resumeThread(id) { return id; }, close() {},
    async startTurn(_id, prompt) {
      agent.prompts.push(prompt);
      if (prompt.includes('READ-HISTORY')) agent.history = options.tools.read_conversation_history({});
      const id = `turn-${agent.prompts.length}`, status = agent.fail ? 'failed' : 'completed';
      const complete = () => options.onEvent({ method: 'turn/completed', params: { turn: { id, status } } });
      if (agent.hold) agent.releases.push(complete); else queueMicrotask(complete);
      return id;
    },
  });
  const app = await createApp({ workspace, chatOptions: { codexFactory } });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await app.close(); await rm(workspace, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const folder = path.join(workspace, 'fixtures');
  await mkdir(folder, { recursive: true });
  const { store } = app;
  const episode = store.createEpisode({ title: 'Lifetime' });
  const other = store.createEpisode({ title: 'Other production', channelId: episode.channelId });
  const scope = `?channel=${episode.channelId}`;
  const api = async (url, init = {}) => fetch(`${base}${url}${url.includes('?') ? '&' : '?'}channel=${episode.channelId}`,
    { ...init, headers: { 'content-type': 'application/json', ...init.headers } });
  const upload = async (episodeId, name, body) => {
    const response = await fetch(`${base}/api/episodes/${episodeId}/library/files${scope}`, { method: 'POST', headers: { 'x-file-name': name, 'content-type': 'image/png' }, body });
    assert.equal(response.status, 201, await response.clone().text());
    return response.json();
  };
  const redline = async (episodeId, sourceId, body) => {
    const response = await fetch(`${base}/api/preview/library/${episodeId}/${sourceId}/redline${scope}`, { method: 'POST', headers: { 'content-type': 'image/png' }, body });
    assert.equal(response.status, 201, await response.clone().text());
    return response.json();
  };
  const item = (episodeId, id) => store.getLibraryItem(episodeId, id);
  const onDisk = entry => existsSync(path.join(workspace, entry.asset.path));
  const newChat = async () => {
    const response = await api(`/api/episodes/${episode.id}/chats`, { method: 'POST', body: JSON.stringify({ name: 'Fresh' }) });
    assert.equal(response.status, 201, await response.clone().text());
    return response.json();
  };

  const old = app.chat.create(episode.id, { name: 'Old' });
  const source = await upload(episode.id, 'white.png', await colourPNG(folder, 'white'));
  const pasted = await upload(episode.id, 'pasted.png', await colourPNG(folder, 'orange'));
  const otherSource = await upload(other.id, 'white.png', await colourPNG(folder, 'white'));
  const plain = await redline(episode.id, source.id, await colourPNG(folder, 'red'));
  const used = await redline(episode.id, source.id, await colourPNG(folder, 'lime'));
  const shared = await redline(episode.id, source.id, await readFile(path.join(folder, 'orange.png')));
  const running = await redline(episode.id, source.id, await colourPNG(folder, 'yellow'));
  const stuck = await redline(episode.id, source.id, await colourPNG(folder, 'cyan'));
  const elsewhere = await redline(other.id, otherSource.id, await colourPNG(folder, 'magenta'));
  assert.equal(shared.assetId, pasted.assetId, 'Identical bytes share the pasted image\'s asset');
  const current = store.getEpisode(episode.id);
  store.updateEpisode(episode.id, current.revision, { referenceItemIds: [used.id] });

  // An old chat: one redline message whose turn failed (Retry offered) and one turn still running.
  const chat = () => app.chat.get(episode.id, old.id);
  const send = (text, attachmentIds) => api(`/api/episodes/${episode.id}/chats/${old.id}/messages`, { method: 'POST', body: JSON.stringify({ text, attachmentIds }) });
  agent.fail = true;
  assert.equal((await send('Redline on library item “white.png”.\n\nMove this.', [plain.id])).status, 202);
  await until(() => chat().runs?.some(run => run.state === 'failed'), 'the failed redline turn');
  const failedRun = chat().runs.find(run => run.state === 'failed');
  assert.equal(chat().messages[0].attachments[0].redline, true, 'The attachment manifest marks the redline');
  agent.fail = false; agent.hold = true;
  assert.equal((await send('Redline on library item “white.png”.\n\nAnd this.', [running.id])).status, 202);
  await until(() => agent.releases.length === 1, 'the running turn');

  const stuckFile = path.join(workspace, stuck.asset.path);
  await rm(stuckFile); await mkdir(path.join(stuckFile, 'blocker'), { recursive: true });
  const before = store.getEpisode(episode.id);
  const history = () => store.db.prepare('SELECT COUNT(*) n FROM episode_history WHERE episode_id=?').get(episode.id).n;
  const historyBefore = history();
  const plainAsset = plain.asset;

  const created = await newChat();
  assert.equal(created.name, 'Fresh', 'An undeletable file never blocks the new chat');
  assert.equal(item(episode.id, plain.id), null, 'Plain redline record removed');
  assert.equal(existsSync(path.join(workspace, plainAsset.path)), false, 'Plain redline file removed from disk');
  assert.equal(store.db.prepare('SELECT 1 FROM assets WHERE id=?').get(plainAsset.id), undefined, 'Its unshared asset row goes with it');
  assert.equal(existsSync(path.join(workspace, plainAsset.thumbnailPath)), false, 'Its derived thumbnail goes too');
  assert.equal(item(episode.id, used.id).sourceKind, 'file', 'An in-use redline is kept as an ordinary item');
  assert.ok(onDisk(item(episode.id, used.id)));
  assert.equal(item(episode.id, shared.id), null, 'Shared-bytes redline record removed');
  assert.ok(onDisk(item(episode.id, pasted.id)), 'Bytes another item shares stay on disk');
  assert.deepEqual(item(episode.id, pasted.id), { ...pasted, asset: item(episode.id, pasted.id).asset }, 'The pasted image record is untouched');
  assert.equal(item(episode.id, running.id).sourceKind, 'redline', 'A running turn\'s redline is kept until the next removal');
  assert.ok(onDisk(item(episode.id, running.id)));
  assert.equal(item(episode.id, stuck.id).sourceKind, 'redline', 'An undeletable file keeps its record');
  assert.equal(item(other.id, elsewhere.id).sourceKind, 'redline', 'Other productions are untouched');
  assert.ok(onDisk(item(other.id, elsewhere.id)));
  const after = store.getEpisode(episode.id);
  assert.equal(after.revision, before.revision, 'No production revision change');
  assert.deepEqual(after.cards, before.cards);
  assert.deepEqual(after.referenceItemIds, before.referenceItemIds);
  assert.equal(history(), historyBefore, 'No Undo step');

  // The old chat keeps its text and reports the removed image; nothing in the projection points at the file.
  const message = chat().messages.find(entry => entry.attachments[0]?.itemId === plain.id);
  assert.match(message.text, /Move this/);
  assert.match(message.attachments[0].unavailable, /Redline image removed/);
  assert.equal((await fetch(`${base}/api/episodes/${episode.id}/library/${plain.id}/file${scope}`)).status, 404);
  agent.hold = false; for (const complete of agent.releases.splice(0)) complete();
  await until(() => chat().state === 'idle', 'the held turn to finish');
  const retry = await api(`/api/episodes/${episode.id}/chats/${old.id}/production-requests/${failedRun.id}/retry`, { method: 'POST', body: JSON.stringify({ clientRequestId: 'retry-removed' }) });
  assert.equal(retry.status, 409);
  assert.match((await retry.json()).error, /redline image was removed when a new chat started\. Send a new redline/);
  assert.equal(chat().messages.filter(entry => entry.role === 'user').length, 2, 'The refused Retry adds no message');

  // The agent's view of earlier messages reports the image unavailable.
  assert.equal((await send('READ-HISTORY', [])).status, 202);
  await until(() => agent.history, 'the history read');
  const seen = agent.history.messages.find(entry => entry.id === message.id);
  assert.match(seen.attachments[0].unavailable, /Redline image removed/);

  // Next removal: the finished turn's redline goes, and the once-stuck file is retried.
  await rm(stuckFile, { recursive: true });
  await until(() => chat().state === 'idle', 'the history turn to finish');
  await newChat();
  assert.equal(item(episode.id, running.id), null);
  assert.equal(item(episode.id, stuck.id), null);
  assert.equal(existsSync(stuckFile), false);
  assert.equal(item(episode.id, used.id).sourceKind, 'file', 'A released redline is never removed later');
  assert.ok(item(episode.id, pasted.id) && item(episode.id, source.id));
  assert.equal(item(other.id, elsewhere.id).sourceKind, 'redline');
});

test('library removal reaches open workspace tabs through the production event stream', async t => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'sb-redline-events-'));
  const app = await createApp({ workspace });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await app.close(); await rm(workspace, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const folder = path.join(workspace, 'fixtures');
  await mkdir(folder, { recursive: true });
  const episode = app.store.createEpisode({ title: 'Events' });
  const scope = `?channel=${episode.channelId}`;
  const source = await (await fetch(`${base}/api/episodes/${episode.id}/library/files${scope}`, { method: 'POST', headers: { 'x-file-name': 'white.png', 'content-type': 'image/png' }, body: await colourPNG(folder, 'white') })).json();
  const mark = await (await fetch(`${base}/api/preview/library/${episode.id}/${source.id}/redline${scope}`, { method: 'POST', headers: { 'content-type': 'image/png' }, body: await colourPNG(folder, 'red') })).json();
  const controller = new AbortController();
  t.after(() => controller.abort());
  const stream = await fetch(`${base}/api/episodes/${episode.id}/events${scope}`, { signal: controller.signal });
  const reader = stream.body.pipeThrough(new TextDecoderStream()).getReader();
  let text = '';
  const next = async () => { while (!text.includes('\n\n')) text += (await reader.read()).value; const [event, ...rest] = text.split('\n\n'); text = rest.join('\n\n'); return JSON.parse(event.replace(/^data: /, '')); };
  assert.deepEqual(await next(), { episodeId: episode.id });
  assert.equal((await fetch(`${base}/api/episodes/${episode.id}/chats${scope}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 201);
  let event;
  do event = await next(); while (!event.libraryRemoved);
  assert.deepEqual(event, { episodeId: episode.id, libraryRemoved: [mark.id] });
});

// STORYBENCH_EVIDENCE_DIR=<existing directory> node --test test/editable-shot-workflow.test.js
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { access, appendFile, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Resvg } from '@resvg/resvg-js';
import { Store } from '../src/store.js';
import { createChatService } from '../src/chat.js';
import { createRenderService } from '../src/render-service.js';
import { createScopedTools } from '../src/runtime/tools.js';
import { mergeTools } from '../src/runtime/app-runtime.js';
import { createV9ConversationPersistence } from '../src/runtime/conversation-persistence.js';
import { TOOL_DELIVERED } from '../src/tool-delivery.js';
import { renderZoomShot, renderForegroundDetail } from '../src/shot-helpers/index.js';
import { makeZoomFixtures } from '../test-support/zoom-shot-example.mjs';

test('editable shots retain their sources and render through revision-checked cards', { timeout: 120_000 }, async t => {
  const evidence = process.env.STORYBENCH_EVIDENCE_DIR;
  const workspace = await mkdtemp(join(evidence || tmpdir(), 'editable-shots-'));
  if (evidence) t.diagnostic(workspace);
  const store = new Store(workspace);
  const episode = store.createEpisode({ title: 'River observatory' });
  const work = store.episodeWorkDirectory(episode.id);
  const renders = createRenderService({ workspace, store });
  // Drive an active video turn deterministically. The media, scoped tools, store and render queue are real.
  const started = Promise.withResolvers();
  const chat = createChatService({ store, renders, requestPersistence: createV9ConversationPersistence(store), codexFactory: async request => ({
    startThread: async () => 'observatory',
    startTurn: async () => { started.resolve(request); return 'edit'; },
    close() {},
  }) });
  t.after(async () => {
    await chat.close();
    await renders.close();
    store.close();
    if (!evidence) await rm(workspace, { recursive: true, force: true });
  });
  const conversation = chat.create(episode.id);
  await chat.send(episode.id, conversation.id, 'Show the dashboard and station panel in a short draft.');
  const request = await started.promise;
  const scope = { requestId: request.requestId, conversationId: conversation.id, episodeId: episode.id,
    channelId: episode.channelId, dataRoot: workspace, episodeDir: store.episodeDirectory(episode.id), workDir: work, harness: 'fixture' };
  const scoped = createScopedTools(scope, { store, assertAuthoringContext: request.assertAuthoringContext });
  const tools = mergeTools(scoped, request.tools);
  async function call(name, args = {}) {
    const response = await tools.call(name, args);
    const result = JSON.parse(response.text);
    response[TOOL_DELIVERED]?.();
    if (evidence) await appendFile(join(workspace, 'calls.jsonl'), JSON.stringify({ name, args, result }) + '\n');
    return result;
  }
  await call('read_research');

  const { still } = await makeZoomFixtures(work);
  const panel = new Resvg(await readFile(new URL('../test-support/fixtures/observatory-panel.svg', import.meta.url))).render();
  await writeFile(join(work, 'panel.png'), panel.asPng());
  const register = (file, fields = {}) => call('register_work_file', { path: 'work/' + file, ...fields });
  const dashboard = await register('dashboard.png', { sourcePath: 'work/dashboard.svg' });
  const recording = await register('dashboard.mp4');
  const separatePanel = await register('panel.png');
  const story = await call('update_story', { expectedStoryRevision: store.getStory(episode.id).storyRevision, source: '# Sections\n\n## Gauge readings' });
  const readBoard = () => store.getEpisode(episode.id);
  await call('update_cards', { expectedRevision: readBoard().revision, cards: [
    { id: 'zoom', title: 'Read the chart', type: 'Video', order: 0, sectionId: story.sections[0].id },
    { id: 'panel', title: 'Station key', type: 'Video/Audio', order: 1, sectionId: story.sections[0].id },
  ] });

  async function saveRecipe(name, recipe) {
    const path = join(work, name + '.json');
    await writeFile(path, JSON.stringify(recipe, null, 2) + '\n', { flag: 'wx' });
    return JSON.parse(await readFile(path, 'utf8'));
  }
  async function zoom(name, recipe) {
    const saved = await saveRecipe(name, recipe);
    await renderZoomShot({ ...saved, source: join(work, saved.source) }, join(work, name + '.mp4'));
  }
  async function shot(name, cardId, inputIds, expectedRevision, previous) {
    const path = 'work/' + name + '.mp4';
    const { duration } = await call('inspect_media', { path });
    const sheet = await tools.call('inspect_contact_sheet', { path, startSeconds: 0, endSeconds: duration, count: 6 });
    assert.ok(sheet.images?.[0]?.data);
    if (evidence) await writeFile(join(work, name + '-samples.png'), Buffer.from(sheet.images[0].data, 'base64'));
    return register(name + '.mp4', { sourcePath: 'work/' + name + '.json', cardId, expectedRevision,
      assign: 'item', derivedFrom: inputIds.map(itemId => ({ itemId })), iterationOf: previous });
  }
  const detail = await saveRecipe('detail', {
    background: { path: 'dashboard.mp4' }, foreground: { path: 'panel.png' },
    destination: { x: 0.25, y: 0.25, width: 0.6, height: 0.6 }, width: 640, height: 360, fps: 8,
    duration: 1.5, entranceStart: 0.125, landAt: 0.5, holdUntil: 1.5, dim: 0.25,
  });
  const detailInputs = { ...detail, background: { ...detail.background, path: join(work, detail.background.path) },
    foreground: { ...detail.foreground, path: join(work, detail.foreground.path) } };
  await renderForegroundDetail({ ...detailInputs, outputPath: join(work, 'detail.mp4') });
  const panelShot = await shot('detail', 'panel', [recording.libraryItemId, separatePanel.libraryItemId], readBoard().revision);
  assert.equal(panelShot.appliedToCard, true);
  await zoom('zoom-v1', { ...still, endCrop: [0.1, 0.3, 0.4, 0.4] });
  const first = await shot('zoom-v1', 'zoom', [dashboard.libraryItemId], readBoard().revision);
  assert.equal(first.appliedToCard, true);

  const enqueue = async () => {
    const plan = await call('validate_render');
    return call('create_draft', { expectedRenderRevision: plan.renderRevision });
  };
  const wait = job => call('await_job', { jobId: job.id });
  const draft1 = await wait(await enqueue());
  assert.equal(draft1.state, 'completed', draft1.error);

  // The creator selects the backing recording while the revision is being made.
  const before = readBoard();
  const previous = JSON.parse(await readFile(join(scope.episodeDir, first.editableSource), 'utf8'));
  await zoom('zoom-v2', { ...previous, endCrop: [0.5, 0.3, 0.4, 0.4], hold: 1.5 });
  store.updateEpisode(episode.id, before.revision, { cards: before.cards.map(card =>
    card.id === 'zoom' ? { ...card, itemId: recording.libraryItemId } : card) });
  const revised = await shot('zoom-v2', 'zoom', [dashboard.libraryItemId], before.revision, first.libraryItemId);
  assert.equal(revised.registered, true);
  assert.equal(revised.appliedToCard, false);
  assert.equal(revised.conflict.currentRevision, readBoard().revision);
  const current = (await call('get_context')).episode;
  assert.equal(current.cards.find(card => card.id === 'zoom').itemId, recording.libraryItemId);
  await call('update_cards', { expectedRevision: current.revision, cards: current.cards.map(card =>
    card.id === 'zoom' ? { ...card, itemId: revised.libraryItemId } : card) });
  const draft2 = await wait(await enqueue());
  assert.equal(draft2.state, 'completed', draft2.error);
  assert.notEqual(draft1.outputPath, draft2.outputPath);
  assert.equal(revised.iterationGroup, first.iterationGroup);
  assert.equal(revised.iteration, first.iteration + 1);
  const versions = [first, revised, panelShot];
  const items = versions.map(v => store.getLibraryItem(episode.id, v.libraryItemId));
  for (const [i, item] of items.entries()) {
    assert.equal(item.provenance.editableSource, versions[i].editableSource);
    assert.deepEqual(item.provenance.derivedFrom.map(origin => origin.item.id),
      i === 2 ? [recording.libraryItemId, separatePanel.libraryItemId] : [dashboard.libraryItemId]);
  }

  // Decode the published drafts. The zoom lands at 1.25s. In v2 the dark legend
  // still fills the frame at 2.625s, after v1 has already cut to the second card.
  for (const [version, draft, held] of [['v1', draft1, 1.875], ['v2', draft2, 2.625]]) {
    const file = join(workspace, draft.outputPath);
    for (const [label, seconds] of Object.entries({ open: 0, move: 0.625, land: 1.25, held, panel: held + 1 })) {
      execFileSync('ffmpeg', ['-v', 'error', '-ss', String(seconds), '-i', file, '-frames:v', '1',
        '-vf', 'scale=640:360', join(work, version + '-' + label + '.png')]);
    }
    for (const label of ['land', 'held']) {
      const pixel = execFileSync('ffmpeg', ['-v', 'error', '-i', join(work, version + '-' + label + '.png'),
        '-vf', 'crop=1:1:322:112,format=rgb24', '-f', 'rawvideo', '-']);
      assert.ok(version === 'v1' ? pixel[0] > 180 : pixel[0] < 75, version + ' ' + label + ' chart/legend pixel ' + [...pixel]);
    }
  }

  const selected = readBoard();
  const invalidRecipe = { ...previous, source: join(work, 'dashboard.mp4'), sourceRange: [5, 7] };
  await assert.rejects(renderZoomShot(invalidRecipe, join(work, 'invalid.mp4')), error => {
    assert.match(error.message, /sourceRange/);
    t.diagnostic(error.message);
    return true;
  });
  await assert.rejects(access(join(work, 'invalid.mp4')), { code: 'ENOENT' });
  const cancelledShot = join(work, 'cancelled.mp4');
  await assert.rejects(renderForegroundDetail({ ...detailInputs, outputPath: cancelledShot, signal: AbortSignal.abort() }),
    { name: 'AbortError' });
  await assert.rejects(access(cancelledShot), { code: 'ENOENT' });
  const failedShot = join(work, 'absent-directory', 'failed.mp4');
  await assert.rejects(renderForegroundDetail({ ...detailInputs, outputPath: failedShot }), /ffmpeg/);
  await assert.rejects(access(failedShot), { code: 'ENOENT' });
  assert.deepEqual(readBoard(), selected);
  const cancelledJob = await enqueue();
  await call('cancel_job', { jobId: cancelledJob.id });
  const cancelled = await wait(cancelledJob);
  assert.equal(cancelled.state, 'cancelled');
  assert.equal(cancelled.outputPath, null);

  // Simulate an unavailable input only in this throwaway workspace.
  const media = join(workspace, items[1].asset.path);
  await rename(media, media + '.offline');
  try {
    const failed = await wait(await enqueue());
    assert.equal(failed.state, 'failed');
    assert.match(failed.error, new RegExp(revised.libraryItemId));
    assert.equal(failed.outputPath, null);
  } finally {
    await rename(media + '.offline', media);
  }
  assert.deepEqual(readBoard(), selected);
  assert.deepEqual(versions.map(v => store.getLibraryItem(episode.id, v.libraryItemId)), items);
  assert.equal((await call('get_job', { jobId: draft1.id })).state, 'completed');
  assert.equal((await call('get_job', { jobId: draft2.id })).state, 'completed');
  request.onEvent({ method: 'turn/completed', params: { turn: { id: 'edit', status: 'completed' } } });
});

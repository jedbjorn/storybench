import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { createApp } from '../src/server.js';
import { listenInRange } from '../test-support/loopback-port.js';
import { createVideoMoments } from '../src/video-moments.js';

test('save two marked intervals in preview, replay and manage pinned moments from another brief', { timeout: 70_000 }, async t => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'sb-moment-ui-'));
  const app = await createApp({ workspace });
  t.after(async () => { await app.close(); await rm(workspace, { recursive: true, force: true }); });
  const base = 'http://127.0.0.1:' + await listenInRange(app.server);
  const browser = await chromium.launch({ channel: 'chromium' });
  t.after(() => browser.close());
  const page = await browser.newPage();
  page.setDefaultTimeout(7000);
  const { store } = app;
  const episode = store.createEpisode({ title: 'Opening sequence', channelId: store.createChannel('Film studio').id });
  const { id: episodeId, channelId } = episode;
  const origin = { episodeId, channelId };
  const api = createVideoMoments(store);
  const list = () => api.list({ channelIds: [channelId] }).moments;
  const url = (id, tab) => base + '/?channel=' + channelId + '&episode=' + id + '#' + tab;
  const bytesPath = path.join(workspace, 'fixture.webm');
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=80x64:rate=10',
    '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '3', '-c:v', 'libvpx', '-c:a', 'libopus', bytesPath]);
  const bytes = await readFile(bytesPath);
  async function importOpening(target) {
    const upload = await fetch(base + '/api/episodes/' + target.id + '/library/files?channel=' + target.channelId, {
      method: 'POST', headers: { 'x-file-name': 'Opening.webm', 'content-type': 'video/webm' }, body: bytes,
    });
    assert.equal(upload.status, 201, await upload.clone().text());
    return upload.json();
  }
  const item = await importOpening(episode);
  const preview = page.frameLocator('[data-preview-frame]');
  const closePreview = () => page.click('#previewModal header [data-preview-close]');
  async function seekMark(seconds, mark) {
    await preview.locator('video').evaluate(async (video, time) => {
      const seeked = new Promise(resolve => video.addEventListener('seeked', resolve, { once: true }));
      video.currentTime = time;
      await seeked;
    }, seconds);
    await preview.getByRole('button', { name: mark, exact: true }).click();
  }
  async function save(controls) {
    const response = page.waitForResponse(r => r.request().method() === 'POST' && r.url().includes('/moments?'));
    await controls.getByRole('button', { name: 'Save moment', exact: true }).click();
    const result = await response;
    assert.equal(result.status(), 200, await result.text());
    return result.json();
  }
  await page.goto(url(episodeId, 'media'));
  await page.locator('[data-library-item="' + item.id + '"] .library-thumb').click();
  await preview.getByRole('button', { name: 'Save a moment' }).click();
  await seekMark(0.2, 'Mark in');
  await seekMark(0.8, 'Mark out');
  await preview.getByLabel('Creator note (optional)', { exact: true }).fill('Lift with sound');
  // Lose the first response after the real server commits. A retry must find that same bookmark.
  await page.route('**/moments?channel=*', async route => {
    const committed = await route.fetch();
    assert.equal(committed.status(), 200);
    await route.abort('failed');
  }, { times: 1 });
  await preview.getByRole('button', { name: 'Save moment', exact: true }).click();
  await preview.locator('.moment-editor [role=status]').filter({ hasText: /fetch/i }).waitFor();
  const first = await save(preview);
  assert.equal(list().length, 1);
  assert.deepEqual([first.startSeconds, first.endSeconds, first.note], [.2, .8, 'Lift with sound']);
  assert.equal(first.source.id, item.id);
  await seekMark(1.2, 'Mark in');
  await seekMark(1.9, 'Mark out');
  await preview.getByLabel('Creator note (optional)', { exact: true }).fill('');
  const second = await save(preview);
  assert.notEqual(first.id, second.id);
  assert.deepEqual([second.startSeconds, second.endSeconds, second.note], [1.2, 1.9, '']);
  await closePreview();

  let savedDraft;
  for (const kind of ['draft', 'final']) {
    const file = path.join(store.episodeOutputDirectory(episodeId, kind === 'draft' ? 'drafts' : 'final'), kind + '.webm');
    await writeFile(file, bytes);
    const job = store.saveJob({ id: 'pinned_' + kind, episodeId, state: 'completed', progress: 1, kind, outputClass: kind,
      revision: episode.revision, outputPath: path.relative(workspace, file), snapshot: {}, createdAt: new Date().toISOString() });
    await page.goto(url(episodeId, kind === 'draft' ? 'drafts' : 'final'));
    await page.locator('[data-job-id="' + job.id + '"] a').filter({ hasText: /^Open$/ }).click();
    await preview.getByRole('button', { name: 'Save a moment' }).click();
    await preview.getByLabel('Out (seconds)').fill('0.5');
    const saved = await save(preview);
    assert.deepEqual(saved.source, { type: 'output', id: job.id, assetId: null });
    if (kind === 'draft') savedDraft = saved;
    await closePreview();
  }

  const elsewhere = store.createEpisode({ title: 'Other channel opening', channelId: store.getDefaultChannel().id });
  assert.notEqual(elsewhere.channelId, channelId);
  const otherItem = await importOpening(elsewhere);
  const otherMoment = await api.create({ channelId: elsewhere.channelId, episodeId: elsewhere.id }, {
    requestId: 'other-opening', source: { type: 'library', id: otherItem.id },
    startSeconds: first.startSeconds, endSeconds: first.endSeconds, note: first.note,
  });
  const brief = store.createEpisode({ title: 'Next brief', channelId });
  await page.goto(url(brief.id, 'media'));
  await page.getByRole('button', { name: 'Saved moments', exact: true }).click();
  const collection = page.locator('#momentCollection');
  await collection.locator('[data-id="' + first.id + '"]').waitFor();
  assert.equal(await collection.locator('[data-id="' + otherMoment.id + '"]').count(), 0);
  async function replay(saved) {
    await collection.getByRole('button', { name: 'Replay range' }).click();
    await page.waitForFunction(end => {
      const player = document.querySelector('#momentCollection video');
      return player?.paused && Math.abs(player.currentTime - end) < .02;
    }, saved.endSeconds);
    assert.deepEqual(await collection.locator('video').evaluate(v =>
      [new URL(v.currentSrc).pathname, v.muted, v.webkitAudioDecodedByteCount > 0]),
      [new URL(saved.mediaUrl, base).pathname, false, true]);
  }
  await collection.locator('[data-id="' + savedDraft.id + '"]').click();
  await replay(savedDraft);
  await collection.getByRole('button', { name: 'Back to collection' }).click();
  await collection.getByLabel('Source or creator note').fill('Opening');
  await collection.getByRole('button', { name: 'Search moments' }).click();
  await collection.locator('[data-id="' + second.id + '"]').click();
  await replay(second);
  await collection.getByRole('button', { name: 'Back to collection' }).click();
  await collection.getByLabel('Source or creator note').fill('Lift');
  await collection.getByRole('button', { name: 'Search moments' }).click();
  const row = collection.locator('[data-id="' + first.id + '"]');
  await row.waitFor();
  assert.equal(await collection.locator('[data-id]').count(), 1);
  assert.match(await row.innerText(), /Opening sequence/);
  assert.match(await row.innerText(), /0.2–0.8 s/);
  await row.click();
  await replay(first);

  // A second writer saves while the creator still has the revision open.
  await api.update(origin, first.id, { ...first, expectedRevision: first.revision, note: 'Other edit' });
  await collection.getByLabel('Creator note (optional)', { exact: true }).fill('My revised lift');
  await collection.getByLabel('In (seconds)').fill('.3');
  await collection.getByRole('button', { name: 'Save changes' }).click();
  await collection.getByText(/Your edits are still here/).waitFor();
  assert.equal(await collection.getByLabel('Creator note (optional)', { exact: true }).inputValue(), 'My revised lift');
  await collection.getByRole('button', { name: 'Save changes' }).click();
  await collection.getByText('Changes saved.').waitFor();
  const edited = await api.get(origin, first.id);
  assert.deepEqual([edited.note, edited.startSeconds, edited.revision], ['My revised lift', .3, 3]);
  const secondSaved = await api.get(origin, second.id);
  assert.equal(secondSaved.note, '');
  await collection.getByRole('button', { name: 'Back to collection' }).click();
  store.deleteLibraryItem(episodeId, item.id, item.revision, store.getEpisode(episodeId).revision);
  await row.click();
  await collection.getByText(/Source unavailable/).waitFor();
  assert.equal(await collection.locator('video').count(), 0);
  assert.equal(await collection.getByLabel('Creator note (optional)', { exact: true }).inputValue(), 'My revised lift');
  page.once('dialog', d => d.accept());
  await collection.getByRole('button', { name: 'Remove moment' }).click();
  await collection.getByText('No saved moments found.').waitFor();
  assert.ok(list().some(m => m.id === second.id));
  assert.ok(list().some(m => m.source.id === 'pinned_final'));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { chromium, firefox } from 'playwright-core';
import { createApp } from '../src/server.js';
import { listenInRange } from '../test-support/loopback-port.js';
import { previewFixtures } from '../test-support/preview-fixtures.js';

for (const engine of [chromium, firefox]) test(`${engine.name()}: workspace Open shows Preview in the popup, reports new versions and isolates active content`, { timeout: 90_000 }, async t => {
  // Required seats: launch failure is a test failure, never a skip.
  const browser = await engine.launch(engine === chromium ? { channel: 'chromium' } : {});
  t.after(() => browser.close());
  const workspace = await mkdtemp(path.join(tmpdir(), 'sb-preview-browser-'));
  const app = await createApp({ workspace });
  t.after(async () => { await app.close(); await rm(workspace, { recursive: true, force: true }); });
  const port = await listenInRange(app.server);
  const base = `http://127.0.0.1:${port}`;
  const folder = path.join(workspace, 'fixtures');
  const cases = previewFixtures(folder);
  const context = await browser.newContext();
  const downloads = [];
  context.on('page', opened => opened.on('download', download => downloads.push(download.url())));
  const workspacePage = await context.newPage();
  const popup = workspacePage.locator('#previewModal');
  // The popup's frame, once the click that opens it has landed.
  const popupFrame = async () => { await popup.waitFor(); return (await workspacePage.locator('[data-preview-frame]').elementHandle()).contentFrame(); };
  const closePopup = async () => { await workspacePage.click('#previewModal header [data-preview-close]'); await popup.waitFor({ state: 'hidden' }); };
  let page;
  let last;
  for (const [name, type] of cases) {
    const channel = app.store.createChannel(`${name} ${type || 'empty type'}`);
    const episode = app.store.createEpisode({ title: 'Preview fixture', channelId: channel.id });
    const upload = await fetch(`${base}/api/episodes/${episode.id}/library/files?channel=${channel.id}`, {
      method: 'POST', headers: { 'x-file-name': name, 'content-type': type || 'application/octet-stream' }, body: await readFile(path.join(folder, name)),
    });
    assert.equal(upload.status, 201, await upload.clone().text());
    const item = await upload.json();
    const url = `${base}/preview/library/${episode.id}/${item.id}?channel=${channel.id}`;
    await workspacePage.goto(`${base}/?channel=${channel.id}&episode=${episode.id}#media`);
    await workspacePage.locator(`[data-library-item="${item.id}"] .library-thumb`).click();
    const frame = await popupFrame();
    await frame.waitForURL(url);
    assert.equal(context.pages().length, 1, 'Open stays in the workspace popup');
    await frame.waitForFunction(() => document.title.startsWith('Storybench Preview — '));
    assert.equal(await frame.locator('#production').textContent(), episode.title);
    await workspacePage.locator('[data-preview-title]').filter({ hasText: await frame.locator('#label').textContent() }).waitFor();
    assert.equal(await frame.locator('#label').isVisible(), false, 'The popup header carries the label');
    assert.equal(await frame.locator('#download').isVisible(), true);
    assert.equal(await workspacePage.locator('#libraryEditForm [name="label"]').inputValue(), item.label, 'Open shows the edit column');
    const isImage = name.startsWith('image');
    if (isImage) {
      await frame.waitForFunction(() => document.querySelector('#viewer img')?.naturalWidth > 0);
      await frame.click('#actual-size');
      assert.equal(await frame.locator('#actual-size').getAttribute('aria-pressed'), 'true');
      assert.match(await frame.locator('#viewer').getAttribute('class'), /actual/);
    } else {
      assert.equal(await frame.locator('#viewer video[controls]').count(), 1);
      // MOV container decoding varies by browser; the Preview page must still open.
      if (name.endsWith('.mp4')) await frame.waitForFunction(() => document.querySelector('video')?.duration > 0);
    }
    // Backdrop clicks leave edits open; Escape closes from either the edit column or framed preview.
    await workspacePage.mouse.click(4, 4);
    assert.equal(await popup.evaluate(dialog => dialog.open), true, 'Backdrop clicks leave the popup open');
    if (name === 'image.png') {
      await frame.click('#markup');
      await frame.locator('[data-redline-prompt]').focus();
      await workspacePage.keyboard.press('Escape');
      assert.equal(await frame.locator('.redline').isVisible(), true, 'Escape preserves open markup');
      assert.equal(await popup.evaluate(dialog => dialog.open), true, 'Open markup keeps the preview open');
      await frame.click('[data-redline-close]');
    }
    await frame.locator('#download').focus();
    await workspacePage.keyboard.press('Escape');
    await popup.waitFor({ state: 'hidden' });
    await workspacePage.locator(`[data-library-item="${item.id}"] .library-thumb`).click();
    await workspacePage.locator('#libraryEditForm [name="label"]').fill('Unsaved label');
    await workspacePage.keyboard.press('Escape');
    await popup.waitFor({ state: 'hidden' });
    assert.equal(app.store.getLibraryItem(episode.id, item.id).label, item.label, 'Escape does not save edits');
    last = { episode, item, url };
  }
  assert.deepEqual(downloads, []);
  // The Preview page still stands alone at its own address.
  page = await context.newPage();
  await page.goto(last.url);
  await page.waitForFunction(() => document.querySelector('#viewer video')?.duration > 0);
  assert.equal(await page.locator('#label').isVisible(), true);

  // A legacy/agent-written SVG can exist even though today's upload parser rejects scripts.
  const scriptFile = path.join(workspace, 'scripted.svg');
  await writeFile(scriptFile, '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="red"/><script>document.documentElement.setAttribute("data-script-ran","yes");localStorage.setItem("svg-ran","yes")</script></svg>');
  const asset = app.store.saveAsset({ channelId: last.episode.channelId, name: 'scripted.svg', hash: 'scripted-svg', kind: 'image', path: 'scripted.svg', metadata: { contentType: 'image/svg+xml' } });
  const item = app.store.attachLibraryItem(last.episode.id, asset.id, { category: 'Reference', label: 'Scripted SVG' });
  const scope = `?channel=${last.episode.channelId}`;
  const raw = await context.newPage();
  await raw.goto(`${base}/api/episodes/${last.episode.id}/library/${item.id}/file${scope}`);
  assert.equal(await raw.locator('svg').getAttribute('data-script-ran'), null);
  await raw.close();
  await page.goto(`${base}/preview/library/${last.episode.id}/${item.id}${scope}`);
  await page.waitForFunction(() => document.querySelector('#viewer img')?.naturalWidth === 80);
  assert.equal(await page.evaluate(() => localStorage.getItem('svg-ran')), null);

  const file = path.join(workspace, 'draft.mp4');
  await writeFile(file, await readFile(path.join(folder, 'video.mp4')));
  const story = app.store.saveStory(last.episode.id, 1, '# Sections\n\n## Main');
  app.store.updateEpisode(last.episode.id, app.store.getEpisode(last.episode.id).revision, { cards: [
    { id: 'visual', title: 'Visual', type: 'Video', sectionId: story.sections[0].id, itemId: last.item.id, in: 0, out: 1 },
  ] });
  for (const kind of ['draft', 'final']) {
    const job = app.store.saveJob({ id: `preview_${kind}`, episodeId: last.episode.id, kind, outputClass: kind,
      state: 'completed', progress: 1, revision: 1, outputPath: 'draft.mp4', snapshot: {}, createdAt: new Date().toISOString() });
    await workspacePage.goto(`${base}/?channel=${last.episode.channelId}&episode=${last.episode.id}#${kind === 'draft' ? 'drafts' : 'final'}`);
    await workspacePage.locator(`[data-job-id="${job.id}"] a`).filter({ hasText: /^Open$/ }).click();
    const frame = await popupFrame();
    const pinned = `${base}/preview/output/${job.id}${scope}`;
    await frame.waitForURL(pinned);
    assert.equal(await workspacePage.locator('[data-preview-aside]').isVisible(), false, 'Outputs have no edit column');
    await frame.waitForFunction(() => document.querySelector('#viewer video')?.duration > 0);
    const snapshot = app.renders.getRenderSnapshot(last.episode.id);
    const next = app.renders.enqueueRender({ episodeId: last.episode.id, outputClass: 'draft', expectedRenderRevision: snapshot.renderRevision });
    await frame.locator('#newer').waitFor({ state: 'visible' });
    assert.equal(frame.url(), pinned, 'A new output does not replace the pinned preview');
    assert.equal(app.store.getJob(next.id).state, 'completed');
    await frame.click('#latest');
    await frame.waitForURL(`${base}/preview/output/${next.id}${scope}`);
    assert.equal(context.pages().length, 2, 'Only the standalone page above is a tab');
    await closePopup();

  }
  const deck = app.store.createEpisode({ title: 'Preview deck', kind: 'deck', channelId: last.episode.channelId });
  app.store.saveDeck(deck.id, 1, [
    { id: 'one', title: 'First slide', body: 'First', layout: 'statement' },
    { id: 'two', title: 'Second slide', body: 'Second', layout: 'statement' },
  ]);
  const build = app.decks.enqueue({ episodeId: deck.id, expectedRevision: 2 });
  for (let attempt = 0; attempt < 400; attempt++) {
    if (!['queued', 'running'].includes(app.store.getJob(build.id).state)) break;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.equal(app.store.getJob(build.id).state, 'completed', app.store.getJob(build.id).error || 'Deck build did not finish');
  await workspacePage.goto(`${base}/?channel=${deck.channelId}&episode=${deck.id}`);
  assert.equal(await workspacePage.locator('#deckPreview').count(), 0);
  // The job poll must not rebuild an unchanged deck job list: the link survives a full poll cycle.
  const deckPreview = workspacePage.locator('#deckJobs a[title="Preview"]');
  const deckLink = await deckPreview.elementHandle();
  assert.equal(await deckPreview.getAttribute('target'), 'storybench-preview', 'A modified click can still open a tab');
  const isStatePoll = message => new URL(message.url()).pathname === '/api/state';
  await (await workspacePage.waitForResponse(isStatePoll)).finished();
  await workspacePage.waitForRequest(isStatePoll);
  assert.equal(await deckLink.evaluate(link => link.isConnected), true, 'An unchanged deck job list is not re-rendered');
  await deckPreview.click();
  let frame = await popupFrame();
  await frame.waitForURL(`${base}/preview/deck/${build.id}${scope}`);
  const deckFrame = frame.frameLocator('#viewer iframe');
  await deckFrame.locator('body').waitFor();
  assert.equal(await frame.locator('#viewer iframe').getAttribute('sandbox'), 'allow-scripts');
  // The standalone tab opened above took focus; keys reach a nested frame only in the focused tab. Press again
  // until the deck's script is listening (two slides, so a repeat stays on the second).
  await workspacePage.bringToFront();
  const second = deckFrame.locator('article.slide').filter({ hasText: 'Second slide' });
  for (let attempt = 0; attempt < 10 && !(await second.isVisible()); attempt++) {
    await deckFrame.locator('body').click();
    await workspacePage.keyboard.press('ArrowRight');
    await second.waitFor({ state: 'visible', timeout: 1000 }).catch(() => {});
  }
  await second.waitFor({ state: 'visible' });
  const pinned = frame.url();
  const secondBuild = await (await fetch(`${base}/api/episodes/${deck.id}/deck-build${scope}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedRevision: 2 }),
  })).json();
  await frame.locator('#newer').waitFor({ state: 'visible' });
  assert.equal(frame.url(), pinned);
  assert.equal(app.store.getJob(secondBuild.id).state, 'completed');
  await frame.click('#latest');
  await frame.waitForURL(`${base}/preview/deck/${secondBuild.id}${scope}`);
  await frame.frameLocator('#viewer iframe').locator('article.slide:not([hidden])').waitFor();
  assert.equal(context.pages().length, 2);
  await closePopup();
  // The newest build stays in view; the earlier one folds away until asked for.
  await workspacePage.locator('#deckJobs > .deck-build').filter({ hasText: `Revision ${app.store.getJob(secondBuild.id).revision}` }).waitFor();
  assert.equal(await workspacePage.locator('#deckJobs > .deck-build').count(), 1);
  const history = workspacePage.locator('#deckJobs .deck-history');
  assert.equal(await history.locator('summary').textContent(), 'Earlier builds (1)');
  assert.equal(await history.locator('a[title="Preview"]').isVisible(), false);
  await history.locator('summary').click();
  await history.locator('a[title="Preview"]').click();
  frame = await popupFrame();
  await frame.waitForURL(`${base}/preview/deck/${build.id}${scope}`);
  assert.equal(context.pages().length, 2);
  await frame.locator('#newer').waitFor({ state: 'visible' });
  await frame.frameLocator('#viewer iframe').locator('article.slide:not([hidden])').waitFor();
  if (process.env.STORYBENCH_EVIDENCE_DIR) {
    await mkdir(process.env.STORYBENCH_EVIDENCE_DIR, { recursive: true });
    await workspacePage.screenshot({ path: path.join(process.env.STORYBENCH_EVIDENCE_DIR, `preview-deck-${engine.name()}.png`) });
  }
  await closePopup();
  const wrongChannel = app.store.createChannel('Wrong channel');
  for (const url of [last.url.replace(last.episode.channelId, wrongChannel.id), `${base}/preview/output/missing${scope}`, `${base}/preview/deck/missing${scope}`]) {
    assert.equal((await page.goto(url)).status(), 404);
    await page.locator('#message').filter({ hasText: 'no longer available' }).waitFor();
    assert.equal(await page.locator('#viewer img, #viewer video, #viewer iframe').count(), 0);
  }
  await rm(file);
  assert.equal((await page.goto(`${base}/preview/output/preview_draft${scope}`)).status(), 404);
  await page.locator('#message').filter({ hasText: 'no longer available' }).waitFor();
  assert.deepEqual(downloads, []);

  const deletedFile = path.join(app.store.episodeOutputDirectory(last.episode.id, 'drafts'), 'deleted.mp4');
  await writeFile(deletedFile, await readFile(path.join(folder, 'video.mp4')));
  const deleted = app.store.saveJob({ id: 'preview_deleted', episodeId: last.episode.id, kind: 'draft', outputClass: 'draft',
    state: 'completed', progress: 1, revision: 1, outputPath: path.relative(workspace, deletedFile), snapshot: {}, createdAt: new Date().toISOString() });
  const deletion = await fetch(`${base}/api/episodes/${last.episode.id}/outputs/delete${scope}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ outputs: [{ id: deleted.id, expectedRevision: deleted.recordRevision }] }),
  });
  assert.equal(deletion.status, 200, await deletion.text());
  assert.equal((await page.goto(`${base}/preview/output/${deleted.id}${scope}`)).status(), 410);
  await page.locator('#message').filter({ hasText: 'no longer available' }).waitFor();
  assert.equal(await page.locator('#viewer video').count(), 0);
});

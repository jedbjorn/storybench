// Spec #29 task #87: Markup on deck previews. A1 for decks, A6 end to end, and the Preview page's
// side of the A11 deck boundary (state messages trusted only from its own frame for the pinned build).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import { chromium, firefox } from 'playwright-core';
import { createApp } from '../src/server.js';
import { createLibraryService } from '../src/library.js';
import { createDeckQa } from '../src/deck-qa.js';
import { CAPTURE_BUSY, CAPTURE_REBUILD } from '../src/deck-capture.js';
import { listenInRange } from '../test-support/loopback-port.js';

async function setup(t, engine) {
  const browser = await engine.launch(engine === chromium ? { channel: 'chromium' } : {});
  t.after(() => browser.close());
  const workspace = await mkdtemp(path.join(tmpdir(), `sb-redline-deck-${engine.name()}-`));
  const received = [];
  const codexFactory = async options => ({
    async startThread() { return `deck-thread-${crypto.randomUUID()}`; }, async resumeThread(id) { return id; }, close() {},
    async startTurn(_id, prompt, images) {
      received.push({ prompt, images });
      const id = `deck-turn-${received.length}`;
      queueMicrotask(() => options.onEvent({ method: 'turn/completed', params: { turn: { id, status: 'completed' } } }));
      return id;
    },
  });
  const app = await createApp({ workspace, chatOptions: { codexFactory } });
  t.after(async () => { await app.close(); await rm(workspace, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${await listenInRange(app.server)}`;
  const episode = app.store.createEpisode({ kind: 'deck', title: 'Deck redline' });
  app.store.ensureEpisodeDirectories(episode.id);
  const library = createLibraryService({ workspace, store: app.store });
  const source = await readFile(new URL('../src/runtime/fixtures/svg-illustration.svg', import.meta.url));
  const svg = await library.registerFile({ episodeId: episode.id, readable: Readable.from(source), fileName: 'diagram.svg', selectedCategory: 'Graphics' });
  app.store.saveDeck(episode.id, 1, [
    { id: 'opening', title: 'Opening title', body: 'Plain text body.', layout: 'statement', notes: 'Private presenter notes' },
    { id: 'stages', title: 'Observe, connect, plan', layout: 'process', vector: { itemId: svg.id }, notes: 'Three steps',
      stages: ['observe', 'connect', 'plan'].map(id => ({ id, title: id, svgGroupIds: [id], afterMs: 200 })) },
    { id: 'gallery', title: 'Compare views', layout: 'statement', subnav: [{ id: 'first', label: 'First', itemId: svg.id }, { id: 'second', label: 'Second' }] },
  ]);
  const build = async () => {
    const queued = app.decks.enqueue({ episodeId: episode.id, expectedRevision: app.store.getDeck(episode.id).revision });
    for (let i = 0; i < 400; i++) {
      const job = app.store.getJob(queued.id);
      if (!['queued', 'running'].includes(job.state)) { assert.equal(job.state, 'completed', job.error); return job; }
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    throw new Error('Deck build did not finish');
  };
  const scope = `?channel=${episode.channelId}`;
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  // Records every state message the Preview window receives, with whether it came from the deck frame.
  await context.addInitScript(() => {
    window.__deck = [];
    addEventListener('message', event => {
      if (event.data?.type === 'storybench-deck-state') window.__deck.push({ ...event.data, fromFrame: event.source === document.querySelector('#viewer iframe')?.contentWindow });
    });
  });
  return { app, base, episode, scope, build, context, received };
}

const genuine = page => page.evaluate(() => window.__deck.filter(state => state.fromFrame).map(({ fromFrame, ...state }) => state));
async function reported(page, expected) {
  const key = JSON.stringify({ type: 'storybench-deck-state', version: 1, ...expected });
  await page.waitForFunction(key => window.__deck.some(({ fromFrame, ...state }) => fromFrame && JSON.stringify(state) === key), key, { timeout: 10_000 });
}
const requestState = page => page.evaluate(() => document.querySelector('#viewer iframe').contentWindow.postMessage({ type: 'storybench-deck-state-request' }, '*'));

// Pixel comparison of two PNGs (base64), as the deck capture proof does.
const compare = (page, a, b) => page.evaluate(async ([left, right]) => {
  const pixels = async source => {
    const image = new Image(); image.src = `data:image/png;base64,${source}`; await image.decode();
    const canvas = Object.assign(document.createElement('canvas'), { width: image.width, height: image.height }), context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    return { width: image.width, height: image.height, data: context.getImageData(0, 0, image.width, image.height).data };
  };
  const [x, y] = [await pixels(left), await pixels(right)];
  if (x.width !== y.width || x.height !== y.height) return { size: [[x.width, x.height], [y.width, y.height]], differing: 1 };
  let differing = 0;
  for (let i = 0; i < x.data.length; i += 4) if (Math.max(...[0, 1, 2].map(c => Math.abs(x.data[i + c] - y.data[i + c]))) > 24) differing++;
  return { size: [[x.width, x.height]], differing: differing / (x.width * x.height) };
}, [a, b]);

for (const engine of [chromium, firefox]) test(`${engine.name()}: deck Markup captures the viewed slide, reveal and view, names them, and respects readiness and the frame boundary`, { timeout: 180_000 }, async t => {
  const { app, base, episode, scope, build, context, received } = await setup(t, engine);
  const job = await build();
  const page = await context.newPage();
  const captures = [];
  page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/capture')) captures.push(request.postDataJSON()); });

  // Older build: same bundle, manifest without the runtime's state-reporting marker.
  const { stateReporting, ...legacyManifest } = job.snapshot.manifest;
  const older = app.store.saveJob({ episodeId: episode.id, kind: 'deck', state: 'completed', progress: 1, outputClass: 'deck_bundle',
    revision: job.revision, outputPath: job.outputPath, snapshot: { ...job.snapshot, manifest: legacyManifest } });
  await page.goto(`${base}/preview/deck/${older.id}${scope}`);
  await page.locator('#markup').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#markup').isDisabled(), true, 'older build: Markup disabled');
  assert.equal(await page.locator('#markup').getAttribute('title'), CAPTURE_REBUILD);
  assert.equal(await page.locator('#message').textContent(), CAPTURE_REBUILD);
  // Saved after the real build, the fixture would otherwise count as its newer version.
  app.store.db.prepare("UPDATE jobs SET deletion_state='deleted' WHERE id=?").run(older.id);

  // Readiness not `ready`: disabled with the readiness reason.
  const notReady = 'Chromium is not installed in this runtime.';
  const metadataRoute = url => url.pathname === `/api/preview/deck/${job.id}`;
  await page.route(metadataRoute, async route => {
    const metadata = await (await route.fetch()).json();
    await route.fulfill({ json: { ...metadata, deck: { ...metadata.deck, capture: { available: false, reason: notReady } } } });
  });
  await page.goto(`${base}/preview/deck/${job.id}${scope}`);
  await page.locator('#markup').waitFor({ state: 'visible' });
  await reported(page, { slideId: 'opening', index: 0, stage: null, gallery: null });
  assert.equal(await page.locator('#markup').isDisabled(), true, 'unready browser: Markup disabled even once the frame reports');
  assert.equal(await page.locator('#markup').getAttribute('title'), notReady);
  assert.equal(await page.locator('#message').textContent(), notReady);
  await page.unroute(metadataRoute);

  // A1: offered for a deck preview once its frame reports where it is.
  await page.goto(`${base}/preview/deck/${job.id}${scope}`);
  await page.locator('#markup:not([disabled])').waitFor();
  assert.equal(await page.locator('#markup').getAttribute('title'), null);
  assert.equal(await page.locator('#message').textContent(), '');
  const iframe = page.locator('#viewer iframe');
  assert.equal(await iframe.getAttribute('sandbox'), 'allow-scripts', 'frame sandbox unchanged');
  const frame = page.frameLocator('#viewer iframe');

  // Navigate to the staged slide; its timed reveals run to the last stage, as in the agent's QA view.
  await frame.locator('[data-command="next"]').click();
  await reported(page, { slideId: 'stages', index: 1, stage: 2, gallery: null });

  // A11 (page side): forged state from the page itself, and frame messages naming another slide, a wrong
  // position or a stage the slide does not have, are all ignored.
  const seen = await page.evaluate(() => window.__deck.length);
  await page.evaluate(() => window.postMessage({ type: 'storybench-deck-state', version: 1, slideId: 'gallery', index: 2, stage: null, gallery: 1 }, '*'));
  const deckFrame = page.frames().find(candidate => candidate !== page.mainFrame());
  await deckFrame.evaluate(() => {
    for (const forged of [{ slideId: 'not-in-build', index: 0, stage: null, gallery: null }, { slideId: 'gallery', index: 0, stage: null, gallery: 1 },
      { slideId: 'stages', index: 1, stage: 7, gallery: null }, { slideId: 'gallery', index: 2, stage: null, gallery: 5 }, { slideId: 'gallery', index: 2, stage: null, gallery: null }])
      parent.postMessage({ type: 'storybench-deck-state', version: 1, ...forged }, '*');
    parent.postMessage({ type: 'storybench-deck-state', version: 2, slideId: 'gallery', index: 2, stage: null, gallery: 1 }, '*');
  });
  await page.waitForFunction(count => window.__deck.length >= count + 7, seen);

  // A6: Markup captures the trusted state at the frame's size and opens the popup on that image.
  const measure = () => iframe.evaluate(element => ({ width: element.clientWidth, height: element.clientHeight }));
  let frameBox = await measure();
  await page.locator('#markup').click();
  await page.locator('.redline').waitFor();
  assert.deepEqual(captures.at(-1), { slideId: 'stages', stage: 2, gallery: null, ...frameBox });
  await page.waitForFunction(width => document.querySelector('#redline-canvas canvas')?.width === width, frameBox.width);
  assert.equal(await page.locator('[data-redline-context]').textContent(),
    `Redline on deck build ${job.id} (revision ${job.revision}), slide 2 “Observe, connect, plan” (stages), reveal 3 of 3 “plan”.`);

  // The popup's base image (the server capture) matches the agent's QA screenshot of that state.
  const base64 = await page.evaluate(() => document.querySelector('#redline-canvas canvas').toDataURL('image/png').split(',')[1]);
  const qa = createDeckQa({ store: app.store, scope: { episodeId: episode.id, requestId: `qa-${engine.name()}`, conversationId: `qa-${engine.name()}`, harness: 'codex', model: 'automated-fixture' } });
  t.after(() => qa.close());
  const call = async (name, args) => JSON.parse((await qa.call(name, args)).text);
  const { sessionId } = await call('open_deck_qa', { jobId: job.id, viewport: frameBox });
  await call('act_deck_qa', { sessionId, action: 'key', key: 'ArrowDown' });
  await call('act_deck_qa', { sessionId, action: 'wait', milliseconds: 1500 });
  const inspected = await qa.call('inspect_deck_qa', { sessionId });
  const shot = JSON.parse(inspected.text).screenshots[0];
  assert.equal(shot.state.slideId, 'stages'); assert.deepEqual(shot.state.stage, ['2']);
  await call('close_deck_qa', { sessionId });
  const qaMatch = await compare(page, base64, inspected.images[0].data);
  assert.deepEqual(qaMatch.size, [[frameBox.width, frameBox.height]]);
  assert.ok(qaMatch.differing < 0.0005, `popup base differs from the QA screenshot on ${(qaMatch.differing * 100).toFixed(2)}% of pixels`);

  // After exit the preview is still on the same slide and reveal stage.
  await page.click('[data-redline-close]');
  await page.locator('.redline').waitFor({ state: 'detached' });
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'markup');
  await frame.locator('.slide#stages:not([hidden])').waitFor();
  const before = (await genuine(page)).length;
  await requestState(page);
  await page.waitForFunction(count => window.__deck.filter(state => state.fromFrame).length > count, before);
  assert.deepEqual((await genuine(page)).at(-1), { type: 'storybench-deck-state', version: 1, slideId: 'stages', index: 1, stage: 2, gallery: null });

  // Busy: a capture that cannot start in time reports busy, and the popup does not open.
  await page.route(url => url.pathname.endsWith('/capture'), route => route.fulfill({ status: 503, json: { error: CAPTURE_BUSY } }), { times: 1 });
  await page.locator('#markup').click();
  await page.locator('#message').filter({ hasText: CAPTURE_BUSY }).waitFor();
  assert.equal(await page.locator('.redline').count(), 0);
  assert.equal(await page.locator('#markup').isDisabled(), false, 'Markup can be tried again');

  // A gallery view, sent end to end: one creator message with the context line and the redline image.
  await frame.locator('[data-command="next"]').click();
  await frame.locator('.slide:not([hidden]) [data-gallery="1"]').click();
  await reported(page, { slideId: 'gallery', index: 2, stage: null, gallery: 1 });
  frameBox = await measure(); // The busy status line above made the frame shorter.
  await page.locator('#markup').click();
  await page.locator('.redline').waitFor();
  assert.deepEqual(captures.at(-1), { slideId: 'gallery', stage: null, gallery: 1, ...frameBox });
  const galleryLine = `Redline on deck build ${job.id} (revision ${job.revision}), slide 3 “Compare views” (gallery), view “Second”.`;
  assert.equal(await page.locator('[data-redline-context]').textContent(), galleryLine);
  await page.waitForFunction(() => document.querySelector('[data-redline-target] option'));
  await page.locator('[data-redline-prompt]').fill('Swap the two views');
  await page.click('[data-redline-send]');
  await page.locator('.redline').waitFor({ state: 'detached' });
  await page.locator('#message').filter({ hasText: 'Redline sent to' }).waitFor();
  await frame.locator('.slide#gallery:not([hidden]) [data-gallery-view="1"]:not([hidden])').waitFor();
  const [record] = app.store.listEpisodeLibrary(episode.id).filter(item => item.sourceKind === 'redline');
  assert.equal(record.label, `Redline — Deck — ${job.createdAt} slide 3`);
  const [conversation] = app.chat.list(episode.id);
  const [message] = app.chat.get(episode.id, conversation.id).messages.filter(item => item.role === 'user');
  assert.equal(message.text, `${galleryLine}\n\nSwap the two views`);
  assert.deepEqual(message.attachments.map(item => item.itemId), [record.id]);
  for (let attempt = 0; attempt < 200 && !received.length; attempt++) await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(received.length, 1, 'The turn started as for any typed message');

  // A newer build of the deck: the pinned build is still marked up, and the context line says a newer one exists.
  await build();
  await page.locator('#newer:not([hidden])').waitFor();
  await page.locator('#markup').click();
  await page.locator('.redline').waitFor();
  assert.equal(await page.locator('[data-redline-context]').textContent(), `${galleryLine} A newer version exists.`);
  assert.equal(new URL(page.url()).pathname, `/preview/deck/${job.id}`, 'Markup never switches versions');
  await page.click('[data-redline-close]');
});

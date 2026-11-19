// Spec #29 Deck Slide Capture (task #84): runtime state reporting, server capture and
// its boundaries. A6 server side and the deck-boundary parts of A11.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Readable } from 'node:stream';
import { chromium } from 'playwright-core';
import { listenInRange } from '../test-support/loopback-port.js';
import { createApp } from '../src/server.js';
import { createLibraryService } from '../src/library.js';
import { createDeckQa } from '../src/deck-qa.js';
import { extractBuild } from '../src/deck-qa-bundle.js';
import { createDeckCapture, validateCaptureState, validateCanvasState, CAPTURE_BUSY, CAPTURE_REBUILD } from '../src/deck-capture.js';

const DECK_CSP = "sandbox allow-scripts; default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; media-src 'self'; connect-src 'none'";

async function fixture(t) {
  // Dispose in reverse acquisition order, including after a failed setup or assertion.
  const cleanup = new AsyncDisposableStack();
  t.after(() => cleanup.disposeAsync(), { timeout: 60_000 });
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'sb-deck-capture-'));
  cleanup.defer(() => rm(workspace, { recursive: true, force: true }));
  const app = await createApp({ workspace });
  cleanup.defer(() => {
    const stopped = app.close();
    app.server.closeAllConnections();
    return stopped;
  });
  await listenInRange(app.server);
  const episode = app.store.createEpisode({ kind: 'deck', title: 'Capture proof' });
  app.store.ensureEpisodeDirectories(episode.id);
  const library = createLibraryService({ workspace, store: app.store });
  const source = await readFile(new URL('../src/runtime/fixtures/svg-illustration.svg', import.meta.url));
  const svg = await library.registerFile({ episodeId: episode.id, readable: Readable.from(source), fileName: 'diagram.svg', selectedCategory: 'Graphics' });
  const saved = app.store.saveDeck(episode.id, 1, [
    { id: 'opening', title: 'Opening title', body: 'Plain text body.', layout: 'statement', notes: 'Private presenter notes' },
    { id: 'stages', title: 'Observe, connect, plan', layout: 'process', vector: { itemId: svg.id }, notes: 'Three steps',
      stages: ['observe', 'connect', 'plan'].map(id => ({ id, title: id, svgGroupIds: [id], afterMs: 200 })) },
    { id: 'gallery', title: 'Compare views', layout: 'statement', subnav: [{ id: 'first', label: 'First', itemId: svg.id }, { id: 'second', label: 'Second' }] },
  ]);
  const build = async () => {
    const queued = app.decks.enqueue({ episodeId: episode.id, expectedRevision: app.store.getDeck(episode.id).revision });
    for (let i = 0; i < 200; i++) {
      const job = app.store.getJob(queued.id);
      if (!['queued', 'running'].includes(job.state)) { assert.equal(job.state, 'completed', job.error); return job; }
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    throw new Error('Deck build did not finish');
  };
  assert.ok(saved.revision);
  const base = `http://127.0.0.1:${app.server.address().port}`, channel = `?channel=${episode.channelId}`;
  const capture = (jobId, body, scope = channel) => fetch(`${base}/api/preview/deck/${jobId}/capture${scope}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { app, workspace, episode, build, base, channel, capture, cleanup };
}

async function launchOrSkip(t) {
  try { return await chromium.launch({ channel: 'chromium' }); }
  catch (error) { t.skip(`No launchable Chromium on this seat: ${error.message.split('\n')[0]}`); return null; }
}

test('builds record state reporting; Preview metadata and the server refuse older, foreign, deleted or invalid states', { timeout: 30000 }, async t => {
  const f = await fixture(t);
  const job = await f.build();
  assert.equal(job.snapshot.manifest.stateReporting, 1);
  const metadata = await (await fetch(`${f.base}/api/preview/deck/${job.id}${f.channel}`)).json();
  assert.equal(metadata.deck.revision, job.revision);
  assert.deepEqual(metadata.deck.slides, [
    { id: 'opening', title: 'Opening title', stages: [], views: [] },
    { id: 'stages', title: 'Observe, connect, plan', stages: ['observe', 'connect', 'plan'], views: [] },
    { id: 'gallery', title: 'Compare views', stages: [], views: ['First', 'Second'] },
  ]);
  assert.equal(typeof metadata.deck.capture.available, 'boolean');
  if (!metadata.deck.capture.available) assert.ok(metadata.deck.capture.reason);
  assert.equal(JSON.stringify(metadata.deck).includes('Private presenter notes'), false);

  // Older build: same bundle, manifest without the runtime's state-reporting marker.
  const { stateReporting, ...legacyManifest } = job.snapshot.manifest;
  assert.equal(stateReporting, 1);
  const older = f.app.store.saveJob({ episodeId: f.episode.id, kind: 'deck', state: 'completed', progress: 1, outputClass: 'deck_bundle',
    revision: job.revision, outputPath: job.outputPath, snapshot: { ...job.snapshot, manifest: legacyManifest } });
  const olderMetadata = await (await fetch(`${f.base}/api/preview/deck/${older.id}${f.channel}`)).json();
  assert.deepEqual(olderMetadata.deck.capture, { available: false, reason: CAPTURE_REBUILD });
  const refused = await f.capture(older.id, { slideId: 'opening', stage: null, gallery: null, width: 1280, height: 720 });
  assert.equal(refused.status, 409);
  assert.equal((await refused.json()).error, CAPTURE_REBUILD);

  const valid = { slideId: 'stages', stage: 1, gallery: null, width: 1280, height: 720 };
  const status = async (body, scope) => { const response = await f.capture(job.id, body, scope); await response.arrayBuffer(); return response.status; };
  assert.equal(await status(valid, ''), 404, 'capture requires an explicit channel');
  assert.equal(await status(valid, `?channel=${f.app.store.createChannel('Other').id}`), 404, 'foreign channel');
  assert.equal(await status({ ...valid, slideId: 'not-in-build' }), 400, 'forged slide');
  assert.equal(await status({ ...valid, slideId: undefined }), 400);
  assert.equal(await status({ ...valid, stage: 3 }), 400, 'stage beyond the slide');
  assert.equal(await status({ ...valid, stage: null }), 400, 'staged slide needs a stage');
  assert.equal(await status({ ...valid, stage: 1.5 }), 400);
  assert.equal(await status({ ...valid, slideId: 'opening', stage: 0 }), 400, 'slide without stages');
  assert.equal(await status({ ...valid, gallery: 0 }), 400, 'slide without gallery');
  assert.equal(await status({ slideId: 'gallery', stage: null, gallery: 2, width: 1280, height: 720 }), 400, 'gallery beyond the slide');
  assert.equal(await status({ ...valid, width: '1280' }), 400);
  assert.equal(await status({ ...valid, height: Number.NaN }), 400);

  // Viewport is the frame size bounded to 640x360..1920x1080.
  const stagesJob = f.app.store.getJob(job.id);
  assert.deepEqual(validateCaptureState(stagesJob, { ...valid, width: 100, height: 5000 }).viewport, { width: 640, height: 1080 });
  assert.deepEqual(validateCaptureState(stagesJob, { ...valid, width: 4000, height: 200.4 }).viewport, { width: 1920, height: 360 });
  assert.deepEqual(validateCaptureState(stagesJob, { ...valid, width: 1023.6, height: 575.2 }).viewport, { width: 1024, height: 575 });

  // Deck route headers are unchanged by this delivery.
  const index = await fetch(`${f.base}/api/jobs/${job.id}/deck/index.html${f.channel}`);
  assert.equal(index.headers.get('content-security-policy'), DECK_CSP);
  assert.equal(index.headers.get('x-content-type-options'), 'nosniff');
  assert.match(await index.text(), /audience\.js/);

  f.app.store.db.prepare("UPDATE jobs SET deletion_state='deleted' WHERE id=?").run(job.id);
  assert.equal(await status(valid), 410, 'deleted build');
});

test('one creator capture at a time; a capture that cannot start within its limit reports busy and leaves nothing behind', { timeout: 30000 }, async t => {
  const f = await fixture(t);
  const job = await f.build();
  let release, closed = 0;
  const started = new Promise(resolve => { release = resolve; });
  // A private temp root: other test files capturing at the same time use the shared one.
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), 'sb-capture-root-'));
  f.cleanup.defer(() => rm(tmpRoot, { recursive: true, force: true }));
  const slow = createDeckCapture({ store: f.app.store, limitMs: 300, launch: () => started, tmpRoot });
  const state = validateCaptureState(job, { slideId: 'opening', stage: null, gallery: null, width: 1280, height: 720 });
  const first = slow.capture(job, state);
  await assert.rejects(slow.capture(job, state), error => error.statusCode === 503 && error.message === CAPTURE_BUSY);
  await assert.rejects(first, error => error.statusCode === 503 && error.message === CAPTURE_BUSY);
  await assert.rejects(slow.capture(job, state), error => error.statusCode === 503, 'slot held until the late browser is cleaned up');
  release({ close: async () => { closed++; } });
  for (let i = 0; i < 100 && closed === 0; i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(closed, 1, 'a browser that starts after the limit is closed');
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.deepEqual(await readdir(tmpRoot), [], 'the capture removed its temp directory');
  const failing = createDeckCapture({ store: f.app.store, launch: async () => { throw new Error('no browser here'); } });
  await assert.rejects(failing.capture(job, state), error => error.statusCode === 500 && /no browser here/.test(error.message));
  await assert.rejects(failing.capture(job, state), /no browser here/, 'slot released after a failure');
});

test('framed runtime reports position only, on change and on request; standalone bundle posts nothing', { timeout: 60000 }, async t => {
  const f = await fixture(t);
  const browser = await launchOrSkip(t);
  if (!browser) return;
  f.cleanup.defer(() => browser.close());
  const job = await f.build();
  const page = await browser.newPage();
  await page.addInitScript(() => { window.__deck = []; addEventListener('message', event => { if (event.data?.type === 'storybench-deck-state') window.__deck.push(event.data); }); });
  await page.goto(`${f.base}/preview/deck/${job.id}${f.channel}`);
  const iframe = page.locator('#viewer iframe');
  assert.equal(await iframe.getAttribute('sandbox'), 'allow-scripts');
  const states = () => page.evaluate(() => window.__deck);
  const latest = async expected => {
    await page.waitForFunction(count => window.__deck.length > count, expected);
    return (await states()).at(-1);
  };
  await page.waitForFunction(() => window.__deck.length > 0);
  assert.deepEqual((await states()).at(-1), { type: 'storybench-deck-state', version: 1, slideId: 'opening', index: 0, stage: null, gallery: null });
  const frame = page.frameLocator('#viewer iframe');
  let count = (await states()).length;
  await frame.locator('[data-command="next"]').click();
  let state = await latest(count);
  assert.equal(state.slideId, 'stages'); assert.equal(state.index, 1); assert.equal(typeof state.stage, 'number');
  count = (await states()).length;
  await frame.locator('.slide:not([hidden]) .stage-nav [data-stage="2"]').click();
  for (let i = 0; i < 50 && (await states()).at(-1).stage !== 2; i++) await page.waitForTimeout(20);
  assert.equal((await states()).at(-1).stage, 2);
  count = (await states()).length;
  await page.evaluate(() => document.querySelector('#viewer iframe').contentWindow.postMessage({ type: 'storybench-deck-state-request' }, '*'));
  state = await latest(count);
  assert.deepEqual(state, { type: 'storybench-deck-state', version: 1, slideId: 'stages', index: 1, stage: 2, gallery: null }, 'request re-reports an unchanged state');
  count = (await states()).length;
  await frame.locator('[data-command="next"]').click();
  await frame.locator('.slide:not([hidden]) [data-gallery="1"]').click();
  for (let i = 0; i < 50 && (await states()).at(-1).gallery !== 1; i++) await page.waitForTimeout(20);
  assert.deepEqual((await states()).at(-1), { type: 'storybench-deck-state', version: 1, slideId: 'gallery', index: 2, stage: null, gallery: 1 });
  for (const message of await states()) {
    assert.deepEqual(Object.keys(message).sort(), ['gallery', 'index', 'slideId', 'stage', 'type', 'version']);
    assert.doesNotMatch(JSON.stringify(message), /Observe|Compare|Private|First|Second/);
  }

  // Exported ZIP opened from disk: no parent frame, so nothing is posted.
  const exported = path.join(f.workspace, 'exported');
  await extractBuild(f.app.store, f.episode.id, job.id, exported);
  const standalone = await browser.newPage();
  await standalone.addInitScript(() => {
    window.__posted = []; const post = window.postMessage.bind(window);
    window.postMessage = (message, ...rest) => { window.__posted.push(message); return post(message, ...rest); };
    addEventListener('message', event => window.__posted.push(event.data));
  });
  await standalone.goto(pathToFileURL(path.join(exported, 'index.html')).href);
  await standalone.locator('[data-command="next"]').click();
  await standalone.locator('.slide:not([hidden]) .stage-nav [data-stage="1"]').click();
  await standalone.evaluate(() => window.postMessage({ type: 'storybench-deck-state-request' }, '*'));
  await standalone.waitForTimeout(200);
  assert.deepEqual((await standalone.evaluate(() => window.__posted)).filter(message => message?.type === 'storybench-deck-state'), []);
});

test('server capture matches an agent QA screenshot of the same state and leaves the QA session working', { timeout: 90000 }, async t => {
  const f = await fixture(t);
  const browser = await launchOrSkip(t);
  if (!browser) return;
  f.cleanup.defer(() => browser.close());
  const job = await f.build();
  const qa = createDeckQa({ store: f.app.store, scope: { episodeId: f.episode.id, requestId: 'qa-capture', conversationId: 'qa-capture', harness: 'codex', model: 'automated-fixture' } });
  f.cleanup.defer(() => qa.close());
  const data = async (name, args) => JSON.parse((await qa.call(name, args)).text);
  const viewport = { width: 960, height: 540 };
  const { sessionId } = await data('open_deck_qa', { jobId: job.id, viewport });
  // Keyboard only (a pointer click would scroll and hover); timed reveals then run to the last stage.
  await data('act_deck_qa', { sessionId, action: 'key', key: 'ArrowDown' });
  await data('act_deck_qa', { sessionId, action: 'wait', milliseconds: 1500 });

  // Captures run while the agent's QA session is open.
  const capture = async body => {
    const response = await f.capture(job.id, { width: viewport.width, height: viewport.height, gallery: null, ...body });
    assert.equal(response.status, 200, response.status === 200 ? '' : await response.text());
    assert.equal(response.headers.get('content-type'), 'image/png');
    return Buffer.from(await response.arrayBuffer());
  };
  const same = await capture({ slideId: 'stages', stage: 2 });
  const other = await capture({ slideId: 'stages', stage: 1 });
  const gallery = await capture({ slideId: 'gallery', stage: null, gallery: 1 });

  const inspected = await qa.call('inspect_deck_qa', { sessionId });
  const shot = JSON.parse(inspected.text).screenshots[0];
  assert.equal(shot.state.slideId, 'stages'); assert.deepEqual(shot.state.stage, ['2']);
  const qaPng = Buffer.from(inspected.images[0].data, 'base64');

  const page = await browser.newPage();
  const compare = (a, b) => page.evaluate(async ([left, right]) => {
    const pixels = async source => {
      const image = new Image(); image.src = `data:image/png;base64,${source}`; await image.decode();
      const canvas = new OffscreenCanvas(image.width, image.height), context = canvas.getContext('2d');
      context.drawImage(image, 0, 0);
      return { width: image.width, height: image.height, data: context.getImageData(0, 0, image.width, image.height).data };
    };
    const [x, y] = [await pixels(left), await pixels(right)];
    if (x.width !== y.width || x.height !== y.height) return { size: [[x.width, x.height], [y.width, y.height]], differing: 1 };
    let differing = 0;
    for (let i = 0; i < x.data.length; i += 4) if (Math.max(...[0, 1, 2].map(c => Math.abs(x.data[i + c] - y.data[i + c]))) > 24) differing++;
    return { size: [[x.width, x.height]], differing: differing / (x.width * x.height) };
  }, [a.toString('base64'), b.toString('base64')]);
  if (process.env.STORYBENCH_DECK_EVIDENCE) for (const [name, bytes] of Object.entries({ same, other, gallery, qa: qaPng }))
    await writeFile(path.join(process.env.STORYBENCH_DECK_EVIDENCE, `capture-${name}.png`), bytes);
  const match = await compare(same, qaPng);
  assert.deepEqual(match.size, [[960, 540]]);
  assert.ok(match.differing < 0.0005, `capture differs from the QA screenshot on ${(match.differing * 100).toFixed(2)}% of pixels`);
  const otherStage = await compare(other, qaPng), otherSlide = await compare(gallery, qaPng);
  assert.ok(otherStage.differing > 0.001, 'a different reveal stage produces a different capture');
  assert.ok(otherSlide.differing > 0.05, 'a different slide produces a different capture');

  // The agent's session is undisturbed: same session, still operable.
  const after = await data('act_deck_qa', { sessionId, action: 'key', key: 'ArrowDown' });
  assert.equal(after.state.slideId, 'gallery');
  await data('close_deck_qa', { sessionId });
});

test('the slide editor capture accepts only a step the saved slide has, and clamps scroll (spec #46 Redlines)', () => {
  const slide = { id: 'plan', stages: [{ id: 'a' }, { id: 'b' }] };
  assert.deepEqual(validateCanvasState(slide, { stage: null }), { slideId: 'plan', stage: null, scroll: 0 });
  assert.deepEqual(validateCanvasState(slide, { stage: 1, scroll: 120.6 }), { slideId: 'plan', stage: 1, scroll: 121 });
  assert.deepEqual(validateCanvasState(slide, { scroll: -5 }), { slideId: 'plan', stage: null, scroll: 0 });
  for (const body of [{ stage: 2 }, { stage: -1 }, { stage: '1' }, { stage: 0.5 }, { scroll: 'top' }, { scroll: Infinity }])
    assert.throws(() => validateCanvasState(slide, body), error => error.statusCode === 400, JSON.stringify(body));
  assert.throws(() => validateCanvasState({ id: 'still' }, { stage: 0 }), error => error.statusCode === 400);
});

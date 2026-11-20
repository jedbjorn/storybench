// Spec #46 task #130, E10 (Chromium and Firefox, app on loopback, deck browser ready): Slide Markup and Send to
// chat in the slide editor capture the canvas at the shown step from the saved revision with no deck build, in
// the Feature #18 popup and send path; the note names the slide number and title, step, saved revision and the
// picked asset and iteration. Asset Markup's note names the asset, its iteration and the slides it is a
// candidate for. STORYBENCH_EVIDENCE_DIR saves screenshots.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import { chromium, firefox } from 'playwright-core';
import { createApp } from '../src/server.js';
import { createLibraryService } from '../src/library.js';
import { CAPTURE_BUSY } from '../src/deck-capture.js';
import { listenInRange } from '../test-support/loopback-port.js';

async function launch(type) {
  let browser = await type.launch().catch(() => null);
  if (!browser && type === chromium && existsSync('/usr/bin/chromium')) browser = await chromium.launch({ executablePath: '/usr/bin/chromium' }).catch(() => null);
  return browser;
}
const evidence = async (name, bytes) => {
  if (!process.env.STORYBENCH_EVIDENCE_DIR) return;
  await mkdir(process.env.STORYBENCH_EVIDENCE_DIR, { recursive: true });
  await writeFile(path.join(process.env.STORYBENCH_EVIDENCE_DIR, name), bytes);
};

async function setup(t, type) {
  const workspace = await mkdtemp(path.join(tmpdir(), `sb-slide-redline-${type.name()}-`));
  const received = [];
  const codexFactory = async options => ({
    async startThread() { return `slide-thread-${crypto.randomUUID()}`; }, async resumeThread(id) { return id; }, close() {},
    async startTurn(_id, prompt, images) {
      received.push({ prompt, images });
      const id = `slide-turn-${received.length}`;
      queueMicrotask(() => options.onEvent({ method: 'turn/completed', params: { turn: { id, status: 'completed' } } }));
      return id;
    },
  });
  const app = await createApp({ workspace, chatOptions: { codexFactory } });
  t.after(async () => { await app.close(); await rm(workspace, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${await listenInRange(app.server)}`;
  const episode = app.store.createEpisode({ kind: 'deck', title: 'Slide redlines' });
  app.store.ensureEpisodeDirectories(episode.id);
  const library = createLibraryService({ workspace, store: app.store });
  const svg = await readFile(new URL('../src/runtime/fixtures/svg-illustration.svg', import.meta.url), 'utf8');
  // The floor plan in two iterations: v2 is the pick on the plan slide, v1 a candidate there and on the photo slide's list.
  const plan = [];
  for (const n of [1, 2]) plan.push(await library.registerFile({ episodeId: episode.id, readable: Readable.from(Buffer.from(svg.replace('</svg>', `<!-- v${n} --></svg>`))), fileName: `plan-v${n}.svg`, selectedCategory: 'Graphics' }));
  for (const [item, n] of [[plan[0], 1], [plan[1], 2]]) app.store.db.prepare('UPDATE library_items SET iteration_group=?,iteration=?,label=? WHERE id=?').run(plan[0].id, n, 'Floor plan', item.id);
  const saved = app.store.saveDeck(episode.id, 1, [
    { id: 'opening', title: 'Opening title', body: 'Plain text body.', layout: 'statement' },
    { id: 'plan', title: 'Observe, connect, plan', body: 'Three steps to a plan.', layout: 'process', vector: { itemId: plan[1].id }, candidates: [{ itemId: plan[0].id, alt: '' }],
      stages: ['observe', 'connect', 'plan'].map(id => ({ id, title: id, svgGroupIds: [id] })) },
  ]);
  return { app, base, episode, plan, revision: saved.revision, received, url: `${base}/?channel=${episode.channelId}&episode=${episode.id}` };
}

// Pixel comparison of two PNG data sources in the page.
const compare = (page, a, b) => page.evaluate(async ([left, right]) => {
  const pixels = async source => {
    const image = new Image(); image.src = source; await image.decode();
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
const popupBase = page => page.evaluate(() => document.querySelector('#redline-canvas canvas').toDataURL('image/png'));

for (const type of [chromium, firefox]) test(`E10 ${type.name()}: slide Markup and Send to chat from the editor, without a build; asset Markup names iteration and slides`, { timeout: 180000 }, async t => {
  const browser = await launch(type);
  if (!browser) return t.skip(`No launchable ${type.name()} on this seat`);
  t.after(() => browser.close());
  const { app, episode, plan, revision, received, url, base } = await setup(t, type);
  // Wide enough that the editor shows the 1056 x 594 slide area at its own size.
  const page = await browser.newPage({ viewport: { width: 1640, height: 1100 } }); page.setDefaultTimeout(15000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const captures = [];
  page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/capture')) captures.push({ path: new URL(request.url()).pathname, body: request.postDataJSON() }); });
  const deckJobs = () => app.store.listJobs(episode.id).filter(job => job.kind === 'deck');
  const line = step => `Redline on slide 02 “Observe, connect, plan” (plan) in the slide editor, saved revision ${revision}, ${step}, showing “Floor plan” v2 of 2 (${plan[1].id}).`;

  await page.goto(url);
  const card = page.locator('#deckSlides [data-slide-index="1"]');
  await card.locator('.slide-card-summary').click();
  await card.locator('[data-slide-edit]').click();
  const editor = page.locator('#slideEditor');
  await editor.locator('.deck-slide[data-slide-index="1"]').waitFor();
  await page.waitForFunction(() => document.querySelector('.deck-canvas-viewport iframe:not(.is-loading)')?.src.includes('/plan/'));

  // Step 1 on the step bar (Start, 1, 2, All), then Markup: the server captures the canvas at that step.
  await editor.locator('[data-canvas-stages] button', { hasText: /^1$/ }).click();
  await page.waitForFunction(() => document.querySelector('[data-canvas-stages] button[aria-pressed="true"]')?.textContent === '1');
  await editor.locator('[data-editor-redline="markup"]').click();
  await editor.locator('.redline').waitFor();
  assert.equal(captures.length, 1);
  assert.equal(captures[0].path, `/api/episodes/${episode.id}/deck-canvas/${revision}/plan/capture`);
  assert.deepEqual(captures[0].body, { stage: 1, scroll: 0 });
  assert.equal(await page.locator('#redline-title').textContent(), 'Markup');
  assert.equal(await page.locator('[data-redline-context]').textContent(), line('step 1 of 2 “connect”'));
  assert.equal(deckJobs().length, 0, 'Markup needs no Build saved deck');
  await page.waitForFunction(() => document.querySelector('#redline-canvas canvas')?.width === 1056);
  const stepOne = await popupBase(page);
  await evidence(`e10-${type.name()}-markup-step1.png`, await page.screenshot());

  // The popup is within the editor and the editor is inert behind it; Escape closes neither.
  assert.equal(await page.evaluate(() => document.querySelector('.redline-backdrop').parentElement.id), 'slideEditor');
  assert.equal(await page.evaluate(() => document.querySelector('.slide-editor-shell').inert), true);
  await page.locator('[data-redline-prompt]').focus();
  await page.keyboard.press('Escape');
  assert.equal(await editor.evaluate(node => node.open), true);
  assert.equal(await page.locator('.redline').count(), 1);

  // The base image is the canvas as the editor shows it: closer to the editor at step 1 than at All, and
  // within text-rasterising differences of it (the capture's own browser hints glyphs slightly differently).
  await page.click('[data-redline-close]');
  await page.locator('.redline').waitFor({ state: 'detached' });
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.editorRedline), 'markup');
  assert.equal(await page.evaluate(() => document.querySelector('.slide-editor-shell').inert), false);
  const viewport = page.locator('.deck-canvas-viewport');
  const box = await viewport.boundingBox();
  assert.deepEqual([Math.round(box.width), Math.round(box.height)], [1056, 594], 'the editor shows the slide area at its own size');
  const editorShot = async () => `data:image/png;base64,${(await page.screenshot({ clip: { x: box.x, y: box.y, width: 1056, height: 594 } })).toString('base64')}`;
  const pressedStep = text => page.waitForFunction(text => document.querySelector('[data-canvas-stages] button[aria-pressed="true"]')?.textContent === text, text);
  const settle = () => page.waitForTimeout(400); // The frame seeks synchronously; one more paint.
  await settle();
  const editorStepOne = await editorShot();
  await editor.locator('[data-canvas-stages] button', { hasText: /^All$/ }).click();
  await pressedStep('All'); await settle();
  const editorAll = await editorShot();
  await evidence(`e10-${type.name()}-popup-base-step1.png`, Buffer.from(stepOne.split(',')[1], 'base64'));
  await evidence(`e10-${type.name()}-editor-step1.png`, Buffer.from(editorStepOne.split(',')[1], 'base64'));
  const same = await compare(page, stepOne, editorStepOne), other = await compare(page, stepOne, editorAll);
  assert.deepEqual(same.size, [[1056, 594]]);
  assert.ok(same.differing < other.differing, `the capture matches the shown step (${same.differing}) better than All (${other.differing})`);
  assert.ok(same.differing < 0.03, `popup base differs from the editor's canvas on ${(same.differing * 100).toFixed(2)}% of pixels`);
  await editor.locator('[data-canvas-stages] button', { hasText: /^1$/ }).click();
  await pressedStep('1');

  // Busy: the popup does not open, the editor says why, and Markup can be tried again.
  await page.route(target => target.pathname.endsWith('/capture'), route => route.fulfill({ status: 503, json: { error: CAPTURE_BUSY } }), { times: 1 });
  await editor.locator('[data-editor-redline="markup"]').click();
  await editor.locator('[data-editor-message]').filter({ hasText: CAPTURE_BUSY }).waitFor();
  assert.equal(await page.locator('.redline').count(), 0);
  assert.equal(await editor.locator('[data-editor-redline="markup"]').isDisabled(), false);

  // Markup end to end: one creator message with the note and the redline image; still no build.
  await editor.locator('[data-editor-redline="markup"]').click();
  await editor.locator('.redline').waitFor();
  await page.waitForFunction(() => document.querySelector('[data-redline-target] option'));
  await page.locator('[data-redline-prompt]').fill('Move the title above the drawing');
  await page.click('[data-redline-send]');
  await page.locator('.redline').waitFor({ state: 'detached' });
  await editor.locator('[data-editor-message]').filter({ hasText: 'Sent to' }).waitFor();
  assert.equal(await editor.evaluate(node => node.open), true, 'the editor stays open on the slide');
  const [record] = app.store.listEpisodeLibrary(episode.id).filter(item => item.sourceKind === 'redline');
  assert.equal(record.label, `Redline — Saved deck revision ${revision} slide 2`);
  const [conversation] = app.chat.list(episode.id);
  const userMessages = () => app.chat.get(episode.id, conversation.id).messages.filter(item => item.role === 'user');
  assert.equal(userMessages()[0].text, `${line('step 1 of 2 “connect”')}\n\nMove the title above the drawing`);
  assert.deepEqual(userMessages()[0].attachments.map(item => item.itemId), [record.id]);
  for (let attempt = 0; attempt < 200 && !received.length; attempt++) await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(received.length, 1, 'the turn started as for any typed message');

  // Send to chat at All: the same popup, sendable without marks or a prompt; the same note.
  await editor.locator('[data-canvas-stages] button', { hasText: /^All$/ }).click();
  await editor.locator('[data-editor-redline="send"]').click();
  await editor.locator('.redline').waitFor();
  assert.deepEqual(captures.at(-1).body, { stage: null, scroll: 0 });
  assert.equal(await page.locator('#redline-title').textContent(), 'Send to chat');
  assert.equal(await page.locator('[data-redline-context]').textContent(), line('all steps shown'));
  await page.locator('[data-redline-send]:not([disabled])').waitFor();
  const allSteps = await popupBase(page);
  const all = await compare(page, allSteps, editorAll), notAll = await compare(page, allSteps, editorStepOne);
  assert.ok(all.differing < notAll.differing && all.differing < 0.03, `the Send to chat frame is the canvas at All (${all.differing} vs ${notAll.differing})`);
  await evidence(`e10-${type.name()}-send-all.png`, await page.screenshot());
  await page.click('[data-redline-send]');
  await page.locator('.redline').waitFor({ state: 'detached' });
  for (let attempt = 0; attempt < 200 && userMessages().length < 2; attempt++) await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(userMessages()[1].text, `${line('all steps shown')}\n\nSee the attached image.`);
  assert.equal(userMessages()[1].attachments.length, 1);

  // A slide without steps and without a pick.
  await editor.locator('[data-editor-nav="-1"]').click();
  await editor.locator('.deck-slide[data-slide-index="0"]').waitFor();
  await page.waitForFunction(() => document.querySelector('.deck-canvas-viewport iframe:not(.is-loading)')?.src.includes('/opening/'));
  await page.waitForFunction(() => !document.querySelector('.deck-canvas-viewport iframe.is-loading'));
  await editor.locator('[data-editor-redline="markup"]').click();
  await editor.locator('.redline').waitFor();
  assert.equal(await page.locator('[data-redline-context]').textContent(),
    `Redline on slide 01 “Opening title” (opening) in the slide editor, saved revision ${revision}, no asset picked.`);
  await page.click('[data-redline-close]');
  assert.equal(deckJobs().length, 0, 'no deck build at any point');

  // The capture route refuses a step the saved slide does not have, and a stale revision.
  const capture = (rev, slide, body) => page.request.post(`${base}/api/episodes/${episode.id}/deck-canvas/${rev}/${slide}/capture?channel=${episode.channelId}`, { data: body });
  assert.equal((await capture(revision, 'plan', { stage: 3 })).status(), 400);
  assert.equal((await capture(revision, 'opening', { stage: 0 })).status(), 400);
  assert.equal((await capture(revision - 1, 'plan', { stage: null })).status(), 409);
  assert.equal((await capture(revision, 'missing', { stage: null })).status(), 404);

  // Asset Markup from the asset preview: the note names the asset, its iteration and its candidate slides.
  for (const [item, suffix] of [[plan[0], 'iteration v1 of 2, a candidate for slide 02 “Observe, connect, plan”'],
    [plan[1], 'iteration v2 of 2, a candidate for slide 02 “Observe, connect, plan” (starred)']]) {
    await page.goto(`${base}/preview/library/${episode.id}/${item.id}?channel=${episode.channelId}`);
    await page.locator('#markup:not([hidden])').click();
    await page.locator('.redline').waitFor();
    assert.equal(await page.locator('[data-redline-context]').textContent(), `Redline on library item “Floor plan” (${item.id}), ${suffix}.`);
    if (item === plan[0]) await evidence(`e10-${type.name()}-asset-markup.png`, await page.screenshot());
    await page.click('[data-redline-close]');
  }

  // The note's other steps and a gallery's several picks.
  const notes = await page.evaluate(async () => {
    const { contextLine } = await import('/redline.js');
    const metadata = { source: 'canvas', revision: 7, slide: { number: '03', id: 'views', title: 'Views', steps: ['Look', '', 'Decide'] },
      picks: [{ itemId: 'a', label: 'North', iteration: 1, of: 1 }, { itemId: 'b', label: 'South', iteration: 3, of: 3 }] };
    return [0, 1, 2].map(stage => contextLine(metadata, null, { stage }));
  });
  assert.deepEqual(notes, [
    'Redline on slide 03 “Views” (views) in the slide editor, saved revision 7, at Start “Look”, showing “North” v1 (a) and “South” v3 of 3 (b).',
    'Redline on slide 03 “Views” (views) in the slide editor, saved revision 7, step 1 of 2, showing “North” v1 (a) and “South” v3 of 3 (b).',
    'Redline on slide 03 “Views” (views) in the slide editor, saved revision 7, step 2 of 2 “Decide”, showing “North” v1 (a) and “South” v3 of 3 (b).']);
  assert.deepEqual(errors, []);
});

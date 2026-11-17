import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { chromium, firefox } from 'playwright-core';
import { createApp } from '../src/server.js';
import { listenInRange } from '../test-support/loopback-port.js';

const BUSY = /A turn is active for this production\. Let it finish or press Stop/;
const LOST = 'The chosen conversation no longer exists. Choose where to send.';
const SHOWN = ['line', 'arrow', 'rect', 'ellipse', 'brush', 'text', 'undo', 'redo'];
const HIDDEN = ['select', 'crop', 'pixelize', 'eraser', 'rotate', 'resize', 'settings', 'zoomin', 'zoomout', 'bucket', 'filters', 'clear', 'save', 'open', 'close'];
const ffmpeg = (...args) => execFileSync('ffmpeg', ['-v', 'error', ...args]);

function fixtures(folder) {
  ffmpeg('-f', 'lavfi', '-i', 'color=c=white:s=400x300', '-frames:v', '1', '-y', path.join(folder, 'white.png'));
  // First frame red, then blue: a GIF base must be the first frame whatever the animation shows.
  ffmpeg('-f', 'lavfi', '-i', 'color=c=red:s=80x60:r=1:d=1', '-f', 'lavfi', '-i', 'color=c=blue:s=80x60:r=1:d=1',
    '-filter_complex', '[0][1]concat=n=2:v=1', '-loop', '0', '-y', path.join(folder, 'first.gif'));
  // One distinct colour per second.
  ffmpeg('-f', 'lavfi', '-i', 'color=c=red:s=160x90:r=10:d=1', '-f', 'lavfi', '-i', 'color=c=lime:s=160x90:r=10:d=1', '-f', 'lavfi', '-i', 'color=c=blue:s=160x90:r=10:d=1',
    '-filter_complex', '[0][1][2]concat=n=3:v=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y', path.join(folder, 'seconds.mp4'));
}

async function setup(t, engine, name) {
  const browser = await engine.launch(engine === chromium ? { channel: 'chromium' } : {});
  t.after(() => browser.close());
  const workspace = await mkdtemp(path.join(tmpdir(), `sb-redline-${name}-`));
  const received = [];
  const agent = { hold: false, releases: [] };
  const codexFactory = async options => ({
    async startThread() { return `redline-thread-${crypto.randomUUID()}`; }, async resumeThread(id) { return id; }, close() {},
    async startTurn(_id, prompt, images) {
      if (prompt.includes('NO-IMAGE-MODEL')) throw new Error('This model has no image input. Remove images or choose another model.');
      received.push({ prompt, images });
      const id = `redline-turn-${received.length}`;
      const complete = () => options.onEvent({ method: 'turn/completed', params: { turn: { id, status: 'completed' } } });
      if (agent.hold) agent.releases.push(complete); else queueMicrotask(complete);
      return id;
    },
  });
  const app = await createApp({ workspace, chatOptions: { codexFactory } });
  t.after(async () => { await app.close(); await rm(workspace, { recursive: true, force: true }); });
  const port = await listenInRange(app.server);
  const base = `http://127.0.0.1:${port}`;
  const folder = path.join(workspace, 'fixtures');
  await mkdir(folder, { recursive: true });
  fixtures(folder);
  const episode = app.store.createEpisode({ title: `Redline ${name}` });
  const scope = `?channel=${episode.channelId}`;
  const upload = async (file, type, label = file) => {
    const response = await fetch(`${base}/api/episodes/${episode.id}/library/files${scope}`, {
      method: 'POST', headers: { 'x-file-name': file, 'x-library-label': label, 'content-type': type }, body: await readFile(path.join(folder, file)) });
    assert.equal(response.status, 201, await response.clone().text());
    const item = await response.json();
    return { item, url: `${base}/preview/library/${episode.id}/${item.id}${scope}` };
  };
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  // Test hook for "canvas capture refused": the next N pixel reads throw as a tainted canvas would.
  await context.addInitScript(() => {
    const read = CanvasRenderingContext2D.prototype.getImageData;
    CanvasRenderingContext2D.prototype.getImageData = function (...args) {
      if (window.refuseCanvasReads > 0) { window.refuseCanvasReads--; throw new DOMException('The canvas has been tainted', 'SecurityError'); }
      return read.apply(this, args);
    };
  });
  const redlines = () => app.store.listEpisodeLibrary(episode.id).filter(item => item.sourceKind === 'redline');
  const release = () => { agent.hold = false; for (const complete of agent.releases.splice(0)) complete(); };
  return { app, base, folder, episode, scope, upload, context, received, agent, release, redlines };
}

// Painterro's working canvas and its on-screen box, so marks are drawn at known image coordinates.
const canvasInfo = page => page.evaluate(() => {
  const canvas = document.querySelector('#redline-canvas canvas'), box = canvas.getBoundingClientRect();
  return { width: canvas.width, height: canvas.height, x: box.x, y: box.y, w: box.width, h: box.height };
});
async function drag(page, [x1, y1], [x2, y2]) {
  const info = await canvasInfo(page);
  const at = (x, y) => [info.x + x * info.w / info.width, info.y + y * info.h / info.height];
  await page.mouse.move(...at(x1, y1));
  await page.mouse.down();
  await page.mouse.move(...at(x2, y2), { steps: 8 });
  await page.mouse.up();
}
const tool = (page, name) => page.locator(`#redline-canvas .ptro-bar button[aria-label="${name}"]`);
const marks = async page => Number(await page.locator('.redline').getAttribute('data-marks'));
const expectMarks = (page, count) => page.waitForFunction(expected => document.querySelector('.redline')?.dataset.marks === String(expected), count, { timeout: 5000 });
const activeTool = page => page.locator('#redline-canvas .ptro-bar button.ptro-color-active-control').first().getAttribute('aria-label');
async function openMarkup(page, width, { click = true } = {}) {
  if (click) await page.locator('#markup').click();
  await page.locator('.redline').waitFor();
  await page.waitForFunction(expected => document.querySelector('#redline-canvas canvas')?.width === expected, width);
  await page.waitForFunction(() => document.querySelector('[data-redline-target] option'));
  const info = await canvasInfo(page);
  const holder = await page.locator('#redline-canvas').boundingBox();
  assert.ok(info.x >= holder.x - 1 && info.y >= holder.y - 1 && info.x + info.w <= holder.x + holder.width + 1 && info.y + info.h <= holder.y + holder.height + 1,
    `The whole base image is visible on entry: ${JSON.stringify({ info, holder })}`);
  return info;
}
// RGB triples around each point of the image at `source` (a URL, or the live Painterro canvas when null).
const sample = (page, source, points, radius = 3) => page.evaluate(async ({ source, points, radius }) => {
  let canvas = document.querySelector('#redline-canvas canvas');
  if (source) {
    const bitmap = await createImageBitmap(await (await fetch(source)).blob());
    canvas = Object.assign(document.createElement('canvas'), { width: bitmap.width, height: bitmap.height });
    canvas.getContext('2d').drawImage(bitmap, 0, 0);
  }
  const context = canvas.getContext('2d');
  return { width: canvas.width, height: canvas.height, points: points.map(([x, y]) => {
    const data = context.getImageData(x - radius, y - radius, radius * 2 + 1, radius * 2 + 1).data, pixels = [];
    for (let index = 0; index < data.length; index += 4) pixels.push([data[index], data[index + 1], data[index + 2]]);
    return pixels;
  }) };
}, { source, points, radius });
const blue = ([r, g, b]) => b > 170 && r < 90 && g < 90;
const white = ([r, g, b]) => r > 235 && g > 235 && b > 235;

for (const engine of [chromium, firefox]) test(`${engine.name()}: Markup captures each kind, keeps work until X or Send, and sends one redline message`, { timeout: 150_000 }, async t => {
  const { app, base, episode, scope, upload, context, received, agent, release, redlines } = await setup(t, engine, 'flow');
  const png = await upload('white.png', 'image/png');
  const gif = await upload('first.gif', 'image/gif');
  const svgFile = path.join(app.store.workspace, 'fixtures', 'green.svg');
  await writeFile(svgFile, '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#00ff00"/></svg>');
  const svg = await upload('green.svg', 'image/svg+xml');
  const video = await upload('seconds.mp4', 'video/mp4');
  const page = await context.newPage();
  const sent = [];
  const foreign = [];
  page.on('request', request => {
    if (request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/messages')) sent.push(request.url());
    if (!/^(data|blob):/.test(request.url()) && new URL(request.url()).origin !== base) foreign.push(request.url());
  });

  // A1: offered for each displayed kind, absent when unavailable or when the browser cannot show the media.
  for (const { url } of [png, gif, svg, video]) {
    await page.goto(url);
    await page.locator('#markup').waitFor({ state: 'visible' });
  }
  const wrong = app.store.createChannel('Elsewhere');
  await page.goto(png.url.replace(episode.channelId, wrong.id));
  await page.locator('#message').filter({ hasText: 'no longer available' }).waitFor();
  assert.equal(await page.locator('#markup').isVisible(), false);
  await writeFile(path.join(app.store.workspace, 'broken.png'), 'not an image');
  const brokenAsset = app.store.saveAsset({ channelId: episode.channelId, name: 'broken.png', hash: 'broken-png', kind: 'image', path: 'broken.png', metadata: { contentType: 'image/png' } });
  const broken = app.store.attachLibraryItem(episode.id, brokenAsset.id, { category: 'Reference', label: 'Broken' });
  await page.goto(`${base}/preview/library/${episode.id}/${broken.id}${scope}`);
  await page.locator('#message').filter({ hasText: 'cannot display' }).waitFor();
  assert.equal(await page.locator('#markup').isVisible(), false);

  // Base images: raster at natural size scaled to the 800 px floor, GIF first frame, SVG at 1920 px, video frame.
  await page.goto(gif.url);
  await page.locator('#markup').waitFor({ state: 'visible' });
  await page.waitForTimeout(1500); // the animation has moved on to blue
  await openMarkup(page, 800);
  let pixels = await sample(page, null, [[400, 300]], 0);
  assert.equal(pixels.height, 600);
  assert.ok(pixels.points[0].every(([r, g, b]) => r > 200 && g < 60 && b < 60), `GIF base is its first (red) frame: ${pixels.points[0]}`);
  await page.click('[data-redline-close]');
  await page.locator('.redline').waitFor({ state: 'detached' });
  await page.goto(svg.url);
  await openMarkup(page, 1920);
  pixels = await sample(page, null, [[960, 960]], 0);
  assert.ok(pixels.points[0].every(([r, g, b]) => g > 200 && r < 60 && b < 60), 'SVG raster at a 1920 px long edge');
  await page.click('[data-redline-close]');

  // A5: the paused frame at the seeked position, at native resolution scaled to the floor, with its timecode.
  await page.goto(video.url);
  await page.locator('#markup').waitFor({ state: 'visible' });
  await page.evaluate(() => new Promise(resolve => { const media = document.querySelector('video'); media.onseeked = resolve; media.currentTime = 1.5; }));
  await openMarkup(page, 800);
  pixels = await sample(page, null, [[400, 225]], 0);
  assert.equal(pixels.height, 450);
  assert.ok(pixels.points[0].every(([r, g, b]) => g > 150 && r < 100 && b < 100), `Frame at 1.5 s is the lime second: ${pixels.points[0]}`);
  assert.equal(await page.locator('[data-redline-context]').textContent(), `Redline on library item “seconds.mp4” (${video.item.id}) at 0:01.5.`);
  await page.click('[data-redline-close]');
  await page.locator('.redline').waitFor({ state: 'detached' });
  assert.deepEqual(await page.evaluate(() => { const media = document.querySelector('video'); return [media.paused, Math.round(media.currentTime * 10) / 10]; }), [true, 1.5],
    'The preview returns to the same playback position');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'markup');

  // The target defaults to the conversation selected in an open workspace tab.
  const older = app.chat.create(episode.id, { name: 'Older chat' });
  await new Promise(resolve => setTimeout(resolve, 5));
  app.chat.create(episode.id, { name: 'Newer chat' });
  const workspacePage = await context.newPage();
  await workspacePage.goto(`${base}/?channel=${episode.channelId}&episode=${episode.id}`);
  await workspacePage.locator('[data-chat-history-toggle]').click();
  await workspacePage.locator(`[data-chat-id="${older.id}"]`).click();
  await workspacePage.locator(`[data-chat-id="${older.id}"][aria-current="true"]`).waitFor({ state: 'attached' });

  await page.bringToFront();
  await page.goto(png.url);
  await openMarkup(page, 800);
  assert.equal(await page.locator('[data-redline-target]').inputValue(), older.id);
  assert.equal(await page.locator('[data-redline-target] option').count(), 2);
  assert.equal(await page.locator('[data-redline-context]').textContent(), `Redline on library item “white.png” (${png.item.id}).`);

  // A2: outside clicks and Escape do nothing; X without work closes at once.
  await page.mouse.click(4, 4);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.redline').count(), 1);
  assert.equal(await page.locator('[data-redline-send]').isDisabled(), true, 'Send needs a mark or a prompt');
  let dialogs = 0;
  page.on('dialog', () => dialogs++);
  await page.click('[data-redline-close]');
  await page.locator('.redline').waitFor({ state: 'detached' });
  assert.equal(dialogs, 0);
  await openMarkup(page, 800);

  // A3: tools shown and hidden; the colour starts on red and the chosen colour is used; undo and redo.
  for (const name of SHOWN) assert.equal(await tool(page, name).isVisible(), true, name);
  for (const name of HIDDEN) assert.equal(await tool(page, name).count(), 0, name);
  assert.equal(await activeTool(page), 'arrow');
  const colour = page.locator('#redline-canvas .ptro-bar .ptro-color-btn').first();
  assert.match(await colour.getAttribute('style'), /rgba\(255,\s*0,\s*0,\s*1\)/);
  await colour.click();
  await page.locator('#redline-canvas .ptro-color').fill('#0000ff');
  await page.locator('#redline-canvas .ptro-color').press('Enter');
  await page.locator('#redline-canvas .ptro-close-color-picker').click();
  assert.match(await colour.getAttribute('style'), /rgba?\(0,\s*0,\s*255(,\s*1)?\)/);
  await tool(page, 'line').click();
  await drag(page, [100, 100], [300, 100]);
  await expectMarks(page, 1);
  await tool(page, 'undo').click();
  await expectMarks(page, 0);
  await tool(page, 'redo').click();
  await expectMarks(page, 1);
  await tool(page, 'arrow').click();
  await drag(page, [100, 200], [300, 200]);
  await tool(page, 'rect').click();
  await drag(page, [400, 80], [600, 180]);
  await tool(page, 'ellipse').click();
  await drag(page, [400, 250], [600, 350]);
  await tool(page, 'brush').click();
  await drag(page, [100, 420], [300, 420]);
  await expectMarks(page, 5);
  await tool(page, 'text').click();
  const info = await canvasInfo(page);
  await page.mouse.click(info.x + 450 * info.w / info.width, info.y + 450 * info.h / info.height);
  await page.waitForFunction(() => document.activeElement?.matches('#redline-canvas .ptro-text-tool-input'));
  await page.keyboard.type('WW');
  await page.locator('#redline-canvas .ptro-text-tool-apply').click();
  await expectMarks(page, 6);

  // A4: prompt keys never reach the canvas, never undo a mark and never send.
  const toolBefore = await activeTool(page);
  await page.click('[data-redline-prompt]');
  await page.keyboard.press('Control+z');
  await page.keyboard.type('abc');
  await page.keyboard.press('Enter');
  await page.keyboard.type('lrebta');
  await page.keyboard.press('Delete');
  await page.keyboard.press('Control+z');
  await page.keyboard.type('Move the logo');
  assert.match(await page.locator('[data-redline-prompt]').inputValue(), /Move the logo$/);
  await expectMarks(page, 6);
  assert.equal(await activeTool(page), toolBefore);
  assert.deepEqual(sent, []);

  // Pasting or dropping an image never replaces or extends the base image.
  await page.evaluate(async () => {
    const bytes = await (await fetch(document.querySelector('#viewer img').src)).arrayBuffer();
    for (const type of ['paste', 'drop']) {
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], 'other.png', { type: 'image/png' }));
      const event = type === 'paste' ? new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true })
        : new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true });
      if (type === 'paste' && !event.clipboardData?.items.length) Object.defineProperty(event, 'clipboardData', { value: transfer });
      document.querySelector('#redline-canvas canvas').dispatchEvent(event);
    }
  });
  await page.waitForTimeout(300);
  assert.deepEqual(await canvasInfo(page).then(({ width, height }) => [width, height]), [800, 600]);
  await expectMarks(page, 6);

  // A2: X with work asks once and keeps the work when declined; leaving the tab raises the leave prompt.
  page.once('dialog', dialog => { assert.equal(dialog.type(), 'confirm'); dialog.dismiss(); });
  await page.click('[data-redline-close]');
  assert.equal(dialogs, 1);
  assert.equal(await page.locator('.redline').count(), 1);
  const leaving = page.waitForEvent('dialog');
  page.evaluate(() => location.reload()).catch(() => {});
  const leave = await leaving;
  assert.equal(leave.type(), 'beforeunload');
  await leave.dismiss();
  await expectMarks(page, 6);

  // A7: one creator message in the shown conversation with the context line, prompt and the PNG; turn started.
  const posted = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/messages'));
  await page.click('[data-redline-send]');
  assert.equal((await posted).status(), 202);
  await page.locator('.redline').waitFor({ state: 'detached' });
  await page.locator('#message').filter({ hasText: 'Redline sent to “Older chat”.' }).waitFor();
  const [record] = redlines();
  assert.equal(redlines().length, 1);
  assert.equal(record.label, 'Redline — white.png');
  for (let attempt = 0; attempt < 200 && !received.length; attempt++) await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(received.length, 1, 'The turn started as for any typed message');
  assert.equal(received[0].images.length, 1);
  const conversation = app.chat.get(episode.id, older.id);
  const userMessages = conversation.messages.filter(message => message.role === 'user');
  assert.equal(userMessages.length, 1);
  assert.ok(userMessages[0].text.startsWith(`Redline on library item “white.png” (${png.item.id}).\n\n`), userMessages[0].text);
  assert.match(userMessages[0].text, /Move the logo$/);
  assert.deepEqual(userMessages[0].attachments.map(item => item.itemId), [record.id]);
  assert.equal(app.chat.get(episode.id, app.chat.list(episode.id).find(item => item.name === 'Newer chat').id).messages.filter(message => message.role === 'user').length, 0);

  // A3: the stored PNG is the flattened markup at base resolution: marks in the chosen colour, base elsewhere.
  const stored = await sample(page, `/api/episodes/${episode.id}/library/${record.id}/file${scope}`,
    [[200, 100], [160, 200], [500, 80], [400, 300], [200, 420], [700, 560], [50, 560], [700, 250]], 3);
  assert.deepEqual([stored.width, stored.height], [800, 600]);
  for (const [index, name] of ['line', 'arrow', 'rect', 'ellipse', 'brush'].entries())
    assert.ok(stored.points[index].some(blue), `${name} drew in the chosen colour`);
  for (const index of [5, 6, 7]) assert.ok(stored.points[index].every(white), `base unchanged away from marks (${index})`);
  const text = await sample(page, `/api/episodes/${episode.id}/library/${record.id}/file${scope}`, [[480, 470]], 30);
  assert.ok(text.points[0].some(blue), 'text drew in the chosen colour');

  // The open workspace shows the message without a reload, and its thumbnail reopens the redline in Preview.
  const transcript = workspacePage.locator('[data-chat-messages]');
  await transcript.filter({ hasText: 'Move the logo' }).waitFor();
  const thumbnail = workspacePage.locator(`a.chat-image-link[href*="${record.id}"]`);
  await thumbnail.waitFor();
  await thumbnail.click();
  await workspacePage.locator('#previewModal').waitFor();
  const reopened = await (await workspacePage.locator('[data-preview-frame]').elementHandle()).contentFrame();
  await reopened.waitForURL(`${base}/preview/library/${episode.id}/${record.id}${scope}`);
  await workspacePage.locator('[data-preview-title]').filter({ hasText: 'Redline — white.png' }).waitFor();
  await reopened.locator('#markup').waitFor();
  await workspacePage.click('#previewModal header [data-preview-close]');

  // While a turn is active, Send is disabled with the existing explanation; it returns when the turn ends.
  agent.hold = true;
  await app.chat.send(episode.id, older.id, 'Hold this turn');
  await page.bringToFront();
  await openMarkup(page, 800);
  assert.match(await page.locator('#redline-canvas .ptro-bar .ptro-color-btn').first().getAttribute('style'), /rgba?\(255,\s*0,\s*0(,\s*1)?\)/,
    'Each popup starts on red, whatever colour the last one used');
  await tool(page, 'rect').click();
  await drag(page, [100, 100], [200, 200]);
  await page.locator('[data-redline-status]').filter({ hasText: BUSY }).waitFor();
  assert.equal(await page.locator('[data-redline-send]').isDisabled(), true);
  release();
  await page.waitForFunction(() => !document.querySelector('[data-redline-send]').disabled);
  await expectMarks(page, 1);
  assert.deepEqual(foreign, [], 'Markup and Painterro fetch nothing outside the app');
  if (process.env.STORYBENCH_EVIDENCE_DIR) {
    await mkdir(process.env.STORYBENCH_EVIDENCE_DIR, { recursive: true });
    await page.screenshot({ path: path.join(process.env.STORYBENCH_EVIDENCE_DIR, `redline-popup-${engine.name()}.png`) });
  }
});

for (const engine of [chromium, firefox]) test(`${engine.name()}: every failure keeps the marks and prompt, a retry never duplicates the redline, and outputs name their class`, { timeout: 150_000 }, async t => {
  const { app, base, episode, scope, upload, context, agent, release, redlines, folder } = await setup(t, engine, 'failures');
  const png = await upload('white.png', 'image/png');
  const conversation = app.chat.create(episode.id, { name: 'Review chat' });
  const page = await context.newPage();
  const draw = async () => { await tool(page, 'rect').click(); await drag(page, [100, 100], [300, 250]); };
  const keeps = async (count, text) => {
    assert.equal(await page.locator('.redline').count(), 1, 'The popup stays open');
    await expectMarks(page, count);
    assert.equal(await page.locator('[data-redline-prompt]').inputValue(), text);
  };
  await page.goto(png.url);
  await openMarkup(page, 800);
  await draw();
  await page.fill('[data-redline-prompt]', 'Tighten this area');

  // Upload fails, then the message fails after the upload stored the record: the retry reuses it.
  await page.route('**/redline?*', route => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Disk is full' }) }), { times: 1 });
  await page.click('[data-redline-send]');
  await page.locator('[data-redline-status]').filter({ hasText: 'Disk is full' }).waitFor();
  await keeps(1, 'Tighten this area');
  assert.equal(redlines().length, 0);
  await page.route('**/messages?*', route => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Chat is unavailable' }) }), { times: 1 });
  await page.click('[data-redline-send]');
  await page.locator('[data-redline-status]').filter({ hasText: 'Chat is unavailable' }).waitFor();
  await keeps(1, 'Tighten this area');
  assert.equal(redlines().length, 1);

  // The target conversation disappeared: the selector reloads and the creator chooses again. Send waits for that
  // explicit choice; no other conversation becomes the target by itself.
  const waitsForChoice = async () => {
    await page.locator('[data-redline-status]').filter({ hasText: LOST }).waitFor();
    await page.waitForTimeout(3200); // two selector refreshes
    assert.equal(await page.locator('[data-redline-target]').inputValue(), '');
    assert.equal(await page.locator('[data-redline-send]').isDisabled(), true);
    await keeps(1, 'Tighten this area');
  };
  await page.route('**/messages?*', route => route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'Conversation not found' }) }), { times: 1 });
  await page.click('[data-redline-send]');
  await waitsForChoice();
  const doomedChat = app.chat.create(episode.id, { name: 'Doomed chat' });
  await page.locator(`[data-redline-target] option[value="${doomedChat.id}"]`).waitFor({ state: 'attached' });
  await page.selectOption('[data-redline-target]', doomedChat.id);
  assert.equal(await page.locator('[data-redline-send]').isDisabled(), false);
  app.store.db.prepare('DELETE FROM conversations WHERE id=?').run(doomedChat.id);
  await waitsForChoice();
  assert.equal(await page.locator(`[data-redline-target] option[value="${doomedChat.id}"]`).count(), 0);

  // A new chat started while the popup is open: nothing is lost and the selector offers it.
  const fresh = await (await fetch(`${base}/api/episodes/${episode.id}/chats${scope}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Fresh chat' }) })).json();
  await page.locator(`[data-redline-target] option[value="${fresh.id}"]`).waitFor({ state: 'attached' });
  await keeps(1, 'Tighten this area');
  await page.selectOption('[data-redline-target]', conversation.id);

  // A turn starts between opening the popup and pressing Send.
  agent.hold = true;
  await app.chat.send(episode.id, fresh.id, 'A turn in another chat');
  await page.click('[data-redline-send]', { force: true }).catch(() => {});
  await page.locator('[data-redline-status]').filter({ hasText: BUSY }).waitFor();
  await keeps(1, 'Tighten this area');
  release();
  await page.waitForFunction(() => !document.querySelector('[data-redline-send]').disabled);

  // The retry succeeds with one record for the identical bytes.
  await page.click('[data-redline-send]');
  await page.locator('.redline').waitFor({ state: 'detached' });
  await page.locator('#message').filter({ hasText: 'Redline sent to “Review chat”.' }).waitFor();
  assert.equal(redlines().length, 1, 'A retry never creates a second record for identical bytes');
  const message = app.chat.get(episode.id, conversation.id).messages.find(item => item.role === 'user');
  assert.deepEqual(message.attachments.map(item => item.itemId), [redlines()[0].id]);
  assert.equal(message.text, `Redline on library item “white.png” (${png.item.id}).\n\nTighten this area`);

  // No prompt: the second paragraph is the fixed sentence. A model without image input fails the turn in chat;
  // the message and its image remain for a retry with another model.
  await page.goto(png.url);
  await openMarkup(page, 800);
  await tool(page, 'ellipse').click();
  await drag(page, [500, 300], [700, 500]);
  await page.selectOption('[data-redline-target]', conversation.id);
  await page.click('[data-redline-send]');
  await page.locator('.redline').waitFor({ state: 'detached' });
  let last = app.chat.get(episode.id, conversation.id).messages.filter(item => item.role === 'user').at(-1);
  assert.equal(last.text, `Redline on library item “white.png” (${png.item.id}).\n\nSee the marks on the attached image.`);
  await page.goto(png.url);
  await openMarkup(page, 800);
  await tool(page, 'line').click();
  await drag(page, [100, 500], [700, 500]);
  await page.fill('[data-redline-prompt]', 'NO-IMAGE-MODEL check');
  await page.selectOption('[data-redline-target]', conversation.id);
  await page.click('[data-redline-send]');
  await page.locator('.redline').waitFor({ state: 'detached' });
  for (let attempt = 0; attempt < 200 && !app.chat.get(episode.id, conversation.id).error; attempt++) await new Promise(resolve => setTimeout(resolve, 25));
  const failed = app.chat.get(episode.id, conversation.id);
  assert.match(failed.error, /no image input/);
  last = failed.messages.filter(item => item.role === 'user').at(-1);
  assert.match(last.text, /NO-IMAGE-MODEL check$/);
  assert.equal(last.attachments.length, 1);
  assert.equal(redlines().length, 3);

  // The pinned asset is deleted while marking up: Send is refused with the reason; only X closes the popup.
  const doomed = await upload('white.png', 'image/png', 'Doomed still');
  await page.goto(doomed.url);
  await openMarkup(page, 800);
  await draw();
  const item = app.store.getLibraryItem(episode.id, doomed.item.id);
  app.store.deleteLibraryItem(episode.id, item.id, item.revision, app.store.getEpisode(episode.id).revision);
  await page.click('[data-redline-send]');
  await page.locator('[data-redline-status]').filter({ hasText: 'no longer available' }).waitFor();
  await keeps(1, '');
  await page.mouse.click(4, 4);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.redline').count(), 1);
  page.once('dialog', dialog => dialog.accept());
  await page.click('[data-redline-close]');
  await page.locator('.redline').waitFor({ state: 'detached' });

  // Canvas capture refused: Markup reports it and opens nothing; an SVG falls back to the server raster.
  await page.goto(png.url);
  await page.locator('#markup').waitFor({ state: 'visible' });
  await page.evaluate(() => { window.refuseCanvasReads = 1; });
  await page.click('#markup');
  await page.locator('#message').filter({ hasText: 'This asset cannot be marked up.' }).waitFor();
  assert.equal(await page.locator('.redline').count(), 0);
  await writeFile(path.join(folder, 'mark.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="48"><rect width="64" height="48" fill="#0000ff"/></svg>');
  const svg = await upload('mark.svg', 'image/svg+xml');
  await page.goto(svg.url);
  await page.locator('#markup').waitFor({ state: 'visible' });
  await page.evaluate(() => { window.refuseCanvasReads = 1; });
  const raster = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/raster'));
  await page.click('#markup');
  assert.equal((await raster).status(), 200);
  await openMarkup(page, 800, { click: false });
  assert.equal((await canvasInfo(page)).height, 600, 'The 64 × 48 server raster is scaled to the 800 px floor');
  await page.click('[data-redline-close]');

  // Draft and Final outputs: the context line names the class, job and timecode, plus a newer version.
  const draftFile = path.join(app.store.workspace, 'draft.mp4');
  await writeFile(draftFile, await readFile(path.join(folder, 'seconds.mp4')));
  const jobs = {};
  for (const [kind, at] of [['final', '2026-01-01T00:00:00.000Z'], ['draft', '2026-01-02T00:00:00.000Z'], ['draft', '2026-01-03T00:00:00.000Z']])
    jobs[`${kind}-${at}`] = app.store.saveJob({ id: `redline_${kind}_${at.slice(8, 10)}`, episodeId: episode.id, kind, outputClass: kind,
      state: 'completed', progress: 1, revision: 1, outputPath: 'draft.mp4', snapshot: {}, createdAt: at });
  const [final, older] = Object.values(jobs);
  for (const [job, expected] of [[final, `Redline on Final output ${final.id} at 0:02.2. A newer version exists.`], [older, `Redline on Draft output ${older.id} at 0:02.2. A newer version exists.`]]) {
    await page.goto(`${base}/preview/output/${job.id}${scope}`);
    await page.locator('#markup').waitFor({ state: 'visible' });
    await page.locator('#newer').waitFor({ state: 'visible' });
    await page.evaluate(() => new Promise(resolve => { const media = document.querySelector('video'); media.onseeked = resolve; media.currentTime = 2.2; }));
    await openMarkup(page, 800);
    assert.equal(await page.locator('[data-redline-context]').textContent(), expected);
    const pixels = await sample(page, null, [[400, 225]], 0);
    assert.ok(pixels.points[0].every(([r, g, b]) => b > 150 && r < 100 && g < 100), 'Frame at 2.2 s is the blue second');
    await page.click('[data-redline-close]');
    await page.locator('.redline').waitFor({ state: 'detached' });
  }

  // The workspace selection is the default only while a workspace tab has the production open; once every
  // workspace tab has closed, or one ended without closing (its record expired), the most recent conversation is.
  const listed = async () => (await (await fetch(`${base}/api/episodes/${episode.id}/chats${scope}`)).json()).map(item => item.id);
  const [recent] = await listed();
  const picked = (await listed()).at(-1);
  assert.notEqual(picked, recent);
  const workspacePage = await context.newPage();
  await workspacePage.goto(`${base}/?channel=${episode.channelId}&episode=${episode.id}`);
  await workspacePage.locator('[data-chat-history-toggle]').click();
  await workspacePage.locator(`[data-chat-id="${picked}"]`).click();
  await workspacePage.locator(`[data-chat-id="${picked}"][aria-current="true"]`).waitFor({ state: 'attached' });
  await page.bringToFront();
  await page.goto(png.url);
  await openMarkup(page, 800);
  assert.equal(await page.locator('[data-redline-target]').inputValue(), picked, 'An open workspace tab sets the default');
  await page.click('[data-redline-close]');
  // Leaving the workspace page fires pagehide in a live process; a killed page is the expiry case below.
  await workspacePage.goto('about:blank');
  await workspacePage.close();
  await page.waitForFunction(prefix => !Object.keys(localStorage).some(key => key.startsWith(prefix)), `storybench.chat.selected.${episode.id}.`);
  assert.equal((await listed())[0], recent);
  await openMarkup(page, 800);
  assert.equal(await page.locator('[data-redline-target]').inputValue(), recent, 'With no workspace tab open the most recent conversation is the default');
  await page.click('[data-redline-close]');
  await page.evaluate(({ episodeId, picked }) => localStorage.setItem(`storybench.chat.selected.${episodeId}.crashed-tab`,
    JSON.stringify({ id: picked, selectedAt: Date.now(), seenAt: Date.now() - 600_000 })), { episodeId: episode.id, picked });
  await openMarkup(page, 800);
  assert.equal(await page.locator('[data-redline-target]').inputValue(), recent, 'A record whose tab stopped refreshing is ignored');
  await page.click('[data-redline-close]');
});

// Isolated app + controlled streaming adapter. No provider calls or operator profile.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { createApp } from '../src/server.js';
import { listenInRange } from '../test-support/loopback-port.js';

test('Chromium: atomic responses, sticky reading, image growth, jump and responsive geometry', { timeout: 60000 }, async t => {
  let browser;
  try { browser = await chromium.launch(); }
  catch (error) {
    if (!existsSync('/usr/bin/chromium')) return t.skip(`Chromium unavailable: ${error.message.split('\n')[0]}`);
    browser = await chromium.launch({ executablePath: '/usr/bin/chromium' });
  }
  const root = mkdtempSync(path.join(tmpdir(), 'sb-chat-scroll-'));
  let adapter, turn = 0;
  const app = await createApp({ workspace: root, chatOptions: { codexFactory: async options => {
    adapter = options;
    return { startThread: async () => `thread-${options.conversationId}`, resumeThread: async id => id, close() {},
      startTurn: async () => {
        const id = `turn-${++turn}`;
        queueMicrotask(() => options.onEvent({ method: 'turn/started', params: { turn: { id } } }));
        return id;
      },
      interrupt: async () => options.onEvent({ method: 'turn/completed', params: { turn: { id: `turn-${turn}`, status: 'interrupted' } } }),
    };
  } } });
  t.after(async () => { await browser.close(); await app.close(); rmSync(root, { recursive: true, force: true }); });
  const episode = app.store.createEpisode({ title: 'Chat response proof' });
  const other = app.chat.create(episode.id, { name: 'Other conversation' });
  const chat = app.chat.create(episode.id, { name: 'Response proof' });
  const history = [];
  for (let i = 0; i < 35; i++) history.push(app.store.addConversationMessage({ conversationId: chat.id, role: i % 2 ? 'assistant' : 'user', state: 'completed', text: `History ${i}. A saved story note.\nSecond line keeps the reading position measurable.` }));
  const port = await listenInRange(app.server);
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(8000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const chatPath = `/api/episodes/${episode.id}/chats/${chat.id}`;
  let imageMessageId, imageNumber = 0;
  await page.route(`**${chatPath}`, async route => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch(), body = await response.json();
    if (imageMessageId) body.messages.find(message => message.id === imageMessageId).attachments = [{ itemId: `delayed-${imageNumber}`, label: 'Delayed image' }];
    await route.fulfill({ response, json: body });
  });
  const imageRequests = new Map();
  await page.route('**/library/delayed-*/file', route => { imageRequests.set(route.request().url().match(/delayed-\d+/)[0], route); });
  const releaseImage = async number => {
    const deadline = Date.now() + 8000;
    while (!imageRequests.has(`delayed-${number}`) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
    assert.ok(imageRequests.has(`delayed-${number}`), 'Delayed image was requested');
    await imageRequests.get(`delayed-${number}`).fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400"><rect width="300" height="400" fill="#9bac99"/></svg>' });
    await page.waitForFunction(number => document.querySelector(`img[src*="delayed-${number}"]`)?.naturalWidth > 0, number);
    await settled();
  };
  const messages = page.locator('[data-chat-messages]'), jump = page.getByRole('button', { name: 'Jump to end', exact: true });
  const settled = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const poll = async () => { await page.waitForResponse(response => response.url().endsWith(chatPath) && response.request().method() === 'GET'); await settled(); };
  const metrics = () => messages.evaluate(el => ({ top: el.scrollTop, end: el.scrollHeight - el.clientHeight, width: el.clientWidth }));
  const atEnd = async () => { await page.waitForFunction(() => { const el = document.querySelector('[data-chat-messages]'); return Math.abs(el.scrollHeight - el.clientHeight - el.scrollTop) < 2; }); };
  const delta = text => adapter.onEvent({ method: 'item/agentMessage/delta', params: { turnId: `turn-${turn}`, delta: text } });
  const finish = status => adapter.onEvent({ method: 'turn/completed', params: { turn: { id: `turn-${turn}`, status } } });
  const send = async text => { await page.fill('[data-chat-draft]', text); await page.click('[data-chat-send]'); await page.locator('.chat-response-animation').waitFor(); };
  const evidence = process.env.STORYBENCH_CHAT_EVIDENCE;
  const shot = async name => { if (evidence) { mkdirSync(evidence, { recursive: true }); await page.screenshot({ path: path.join(evidence, `${name}.png`) }); } };
  await page.goto(`http://127.0.0.1:${port}/episodes?channel=${episode.channelId}&episode=${episode.id}`);
  await page.locator(`[data-message-id="${history.at(-1).id}"]`).waitFor(); await atEnd();
  assert.ok((await metrics()).end > 1000, 'Real transcript overflow');
  await send('Please produce the next response'); await atEnd();
  await page.evaluate(() => { window.retainedCanvas = document.querySelector('canvas'); window.retainedMessage = document.querySelector('.chat-transcript > p'); });
  delta('Hidden first chunk'); await poll();
  delta(' and second chunk'); await poll();
  assert.doesNotMatch(await messages.textContent(), /Hidden first chunk/);
  assert.equal(await page.evaluate(() => window.retainedCanvas === document.querySelector('.chat-response-animation canvas')), true);
  assert.equal(await page.evaluate(() => window.retainedMessage === document.querySelector('.chat-transcript > p')), true);
  await atEnd();
  // Late image load follows the end without replacing the image on each poll.
  imageMessageId = history.at(-1).id; imageNumber = 1; await poll();
  const beforeImage = await metrics(); await releaseImage(1); await atEnd();
  assert.ok((await metrics()).end > beforeImage.end + 50);
  // User wheel intent pauses; the button remains outside the scrolling content.
  await messages.hover(); await page.mouse.wheel(0, -900);
  await jump.waitFor(); await settled();
  const reading = await metrics(); assert.ok(reading.top < reading.end - 200);
  await poll(); await poll(); assert.ok(Math.abs((await metrics()).top - reading.top) < 2);
  finish('completed'); await page.locator('.chat-response-animation').waitFor({ state: 'detached' });
  assert.match(await messages.textContent(), /Hidden first chunk and second chunk/);
  assert.ok(Math.abs((await metrics()).top - reading.top) < 2, 'Completion preserves reading position');
  await send('Another request while reading');
  assert.ok(Math.abs((await metrics()).top - reading.top) < 2, 'Sending preserves reading position');
  // Grow an image immediately above the visible reading anchor.
  const anchor = await messages.evaluate(el => {
    const edge = el.getBoundingClientRect().top;
    const nodes = [...el.querySelectorAll('[data-message-id]')];
    const index = nodes.findIndex(node => node.getBoundingClientRect().bottom > edge);
    return { id: nodes[index].dataset.messageId, offset: nodes[index].getBoundingClientRect().top - edge, above: Number(nodes[index - 1].dataset.messageId) };
  });
  imageMessageId = anchor.above; imageNumber = 2; await poll(); await releaseImage(2);
  const offset = await page.locator(`[data-message-id="${anchor.id}"]`).evaluate(el => el.getBoundingClientRect().top - document.querySelector('[data-chat-messages]').getBoundingClientRect().top);
  assert.ok(Math.abs(offset - anchor.offset) < 2, 'Image growth above the reader preserves the visible anchor');
  assert.equal(await jump.textContent(), '');
  assert.equal(await jump.evaluate(el => document.querySelector('[data-chat-messages]').contains(el)), false);
  await shot('desktop-reading');
  // Reaching bottom by scrolling is deliberately not a follow-mode switch.
  await messages.evaluate(el => { el.scrollTop = el.scrollHeight; }); await settled();
  assert.equal(await jump.isVisible(), true);
  await jump.click(); await atEnd(); assert.equal(await jump.isVisible(), false);
  // Every responsive layout retains the 170px artwork above the composer.
  for (const width of [1440, 900, 600, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.locator('.chat').scrollIntoViewIfNeeded(); await settled(); await atEnd();
    const canvas = await page.locator('.chat-response-animation canvas').boundingBox();
    const composer = await page.locator('.chat-composer').boundingBox();
    const scroll = await messages.boundingBox();
    assert.ok(Math.abs(canvas.width - 170) < 1 && Math.abs(canvas.height - 170) < 1);
    assert.ok(canvas.y + canvas.height <= composer.y + 1 && canvas.x >= scroll.x && canvas.x + canvas.width <= scroll.x + scroll.width);
    assert.ok(composer.x >= 0 && composer.x + composer.width <= width);
    if (width === 1440 || width === 390) {
      await page.emulateMedia({ reducedMotion: 'reduce' }); await settled();
      await shot(`active-video-${width}`);
      await page.emulateMedia({ reducedMotion: 'no-preference' });
    }
  }
  delta('Stopped partial'); await poll();
  assert.doesNotMatch(await messages.textContent(), /Stopped partial/);
  await page.click('[data-chat-stop]');
  await page.locator('.chat-response-animation').waitFor({ state: 'detached' });
  assert.match(await messages.textContent(), /Stopped partial.*Interrupted · partial response/s);
  await send('Fail after a partial'); delta('Failed partial'); await poll();
  adapter.onError(new Error('Controlled transport failure'));
  await page.locator('.chat-response-animation').waitFor({ state: 'detached' });
  assert.match(await messages.textContent(), /Failed partial.*Failed · partial response/s);
  // A busy different conversation must not animate the selected history.
  await send('Remain active while navigating');
  await page.click('[data-chat-history-toggle]'); await page.click(`[data-chat-id="${other.id}"]`);
  await page.waitForFunction(() => document.querySelector('[data-chat-title]').textContent === 'Other conversation');
  assert.equal(await page.locator('.chat-response-animation').count(), 0);
  await page.click('[data-chat-history-toggle]'); await page.click(`[data-chat-id="${chat.id}"]`);
  await page.locator('.chat-response-animation').waitFor(); await atEnd();
  finish('completed');
  const deck = app.store.createEpisode({ title: 'Deck animation proof', kind: 'deck' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`http://127.0.0.1:${port}/episodes?channel=${deck.channelId}&episode=${deck.id}`);
  await page.locator('[data-chat-id][aria-current="true"]').waitFor({ state: 'attached' });
  await send('Build a presentation');
  await page.emulateMedia({ reducedMotion: 'reduce' }); await settled();
  assert.equal(await page.evaluate(async () => {
    const { drawHaloSun } = await import('/chat-halo.js');
    const expected = document.createElement('canvas'); expected.width = expected.height = 900;
    drawHaloSun(expected.getContext('2d'), .64, 'presentation');
    return expected.toDataURL() === document.querySelector('.chat-response-animation canvas').toDataURL();
  }), true, 'Deck selects the presentation artwork');
  await shot('active-deck-1440'); finish('completed');
  assert.deepEqual(errors, []);
});

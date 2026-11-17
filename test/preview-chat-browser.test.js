import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { chromium, firefox } from 'playwright-core';
import { createApp } from '../src/server.js';
import { listenInRange } from '../test-support/loopback-port.js';
import { previewPNG } from '../test-support/preview-fixtures.js';

for (const engine of [chromium, firefox]) test(`${engine.name()}: paste, drop and paperclip complete the video and deck chat image loop`, { timeout: 90_000 }, async t => {
  const browser = await engine.launch(engine === chromium ? { channel: 'chromium' } : {});
  t.after(() => browser.close());
  const workspace = await mkdtemp(path.join(tmpdir(), 'sb-preview-chat-'));
  const received = [];
  let stage = 'setup', lastEpisode;
  const codexFactory = async options => ({
    async startThread() { return `preview-thread-${crypto.randomUUID()}`; }, async resumeThread(id) { return id; }, close() {},
    async startTurn(_id, prompt, images) {
      received.push({ prompt, images });
      const id = `preview-turn-${received.length}`;
      queueMicrotask(() => options.onEvent({ method: 'turn/completed', params: { turn: { id, status: 'completed' } } }));
      return id;
    },
  });
  const app = await createApp({ workspace, chatOptions: { codexFactory } });
  t.after(async () => {
    if (lastEpisode) t.diagnostic(JSON.stringify({ stage, received: received.length,
      conversations: app.chat.list(lastEpisode.id).map(chat => {
        const value = app.chat.get(lastEpisode.id, chat.id);
        return { state: value.state, error: value.error, draftAttachments: value.draftAttachments?.map(item => item.itemId),
          messages: value.messages.map(message => ({ state: message.state, text: message.text, attachments: message.attachments?.map(item => item.itemId) })) };
      }) }));
    await app.close(); await rm(workspace, { recursive: true, force: true });
  });
  const port = await listenInRange(app.server);
  const base = `http://127.0.0.1:${port}`;
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const downloads = [];
  context.on('page', opened => opened.on('download', download => downloads.push(download)));
  const page = await context.newPage();
  for (const kind of ['video', 'deck']) {
    const episode = app.store.createEpisode({ title: `${kind} image loop`, kind });
    lastEpisode = episode;
    await page.goto(`${base}/?channel=${episode.channelId}&episode=${episode.id}`);
    await page.locator('[data-chat-messages]').filter({ hasText: `this ${kind === 'deck' ? 'deck' : 'episode'}` }).waitFor();
    let sent = 0;
    for (const method of ['paste', 'drop', 'paperclip']) {
      const name = `${kind}-${method}.png`;
      stage = name;
      await page.locator('[data-chat-attachments] .chat-attachment').waitFor({ state: 'detached' });
      if (method === 'paperclip') {
        const chooser = page.waitForEvent('filechooser');
        await page.click('[data-chat-attach]');
        await (await chooser).setFiles({ name, mimeType: 'image/png', buffer: previewPNG });
      } else {
        await page.evaluate(({ method, name, bytes }) => {
          const transfer = new DataTransfer();
          transfer.items.add(new File([new Uint8Array(bytes)], name, { type: 'image/png' }));
          const event = method === 'paste'
            ? new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true })
            : new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true });
          // Firefox drops synthetic ClipboardEvent data; match the existing workspace-chrome fixture.
          if (method === 'paste' && !event.clipboardData?.items.length) Object.defineProperty(event, 'clipboardData', { value: transfer });
          document.querySelector(method === 'paste' ? '[data-chat-draft]' : '.chat-composer').dispatchEvent(event);
        }, { method, name, bytes: [...previewPNG] });
      }
      await page.locator('[data-chat-attachments] .chat-attachment img').waitFor();
      await page.waitForFunction(() => document.querySelector('[data-chat-attachments] img')?.naturalWidth > 0);
      const attachmentId = await page.locator('[data-chat-remove-image]').getAttribute('data-chat-remove-image');
      const response = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/messages'));
      const request = page.waitForRequest(request => request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/messages'));
      await page.fill('[data-chat-draft]', `Inspect ${name}`);
      await page.click('[data-chat-send]');
      assert.deepEqual((await request).postDataJSON().attachmentIds, [attachmentId]);
      const posted = await response;
      assert.equal(posted.status(), 202, await posted.text());
      const conversation = await posted.json();
      for (let attempt = 0; attempt < 400; attempt++) {
        if (['idle', 'error', 'interrupted'].includes(app.chat.get(episode.id, conversation.id).state)) break;
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      const settled = app.chat.get(episode.id, conversation.id);
      assert.equal(settled.state, 'idle', settled.error || `Chat did not settle at ${stage}`);
      await page.locator('[data-chat-attachments] .chat-attachment').waitFor({ state: 'detached' });
      const link = page.locator('.chat-image-link').nth(sent++);
      await link.waitFor();
      assert.equal(await link.getAttribute('target'), 'storybench-preview');
      assert.equal(await link.getAttribute('rel'), null);
      await link.click();
      await page.locator('#previewModal').waitFor();
      const preview = await (await page.locator('[data-preview-frame]').elementHandle()).contentFrame();
      await preview.waitForURL(`${base}/preview/library/${episode.id}/${attachmentId}?channel=${episode.channelId}`);
      await preview.waitForFunction(() => document.querySelector('#viewer img')?.naturalWidth > 0);
      assert.match(await preview.title(), /^Storybench Preview — /);
      assert.equal(context.pages().length, 1, 'Transcript images open in the workspace popup');
      assert.equal(downloads.length, 0, 'Opening an image never downloads it');
      if (process.env.STORYBENCH_EVIDENCE_DIR) {
        await mkdir(process.env.STORYBENCH_EVIDENCE_DIR, { recursive: true });
        await page.screenshot({ path: path.join(process.env.STORYBENCH_EVIDENCE_DIR, `chat-preview-${kind}-${engine.name()}.png`) });
      }
      await page.click('#previewModal header [data-preview-close]');
      await page.locator('#previewModal').waitFor({ state: 'hidden' });
    }
    if (process.env.STORYBENCH_EVIDENCE_DIR) {
      await mkdir(process.env.STORYBENCH_EVIDENCE_DIR, { recursive: true });
      await page.screenshot({ path: path.join(process.env.STORYBENCH_EVIDENCE_DIR, `chat-${kind}-${engine.name()}.png`) });
    }
  }
  // The explicit action remains a download, unlike the transcript image itself.
  const download = page.waitForEvent('download');
  await page.locator('.chat-image-download').last().click();
  assert.match((await download).suggestedFilename(), /\.png$/);
  assert.equal(received.length, 6);
  for (const turn of received) {
    assert.equal(turn.images[0].mimeType, 'image/png');
    assert.deepEqual(Buffer.from(turn.images[0].data, 'base64').subarray(0, 8), previewPNG.subarray(0, 8));
  }
});

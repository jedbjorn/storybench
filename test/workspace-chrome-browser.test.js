import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { chromium, firefox, webkit } from 'playwright-core';
import { createApp } from '../src/server.js';
import { createLibraryService } from '../src/library.js';
import { listenInRange } from '../test-support/loopback-port.js';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAACXBIWXMAAAABAAAAAQBPJcTWAAAANklEQVR4nO3QwQkAMAwDsRS6/8aFjnCv/KQBbLjzZtdd3h8HSaIkUZIoSZQkShIliZJESaIpHwOEAXtEFT2UAAAAAElFTkSuQmCC', 'base64');
for (const engine of [chromium, firefox, webkit]) test(`${engine.name()}: shared chrome, outward history and chat image upload/paste/drop`, { timeout: 60000 }, async (t) => {
  let browser;
  try { browser = await engine.launch(); }
  catch { if (engine === chromium && existsSync('/usr/bin/chromium')) browser = await chromium.launch({ executablePath: '/usr/bin/chromium' }); }
  if (!browser) return t.skip(`No launchable ${engine.name()} on this seat`);
  t.after(() => browser.close());
  const root = mkdtempSync(path.join(tmpdir(), 'sb-chrome-browser-'));
  const received = [];
  const app = await createApp({ workspace: root, chatOptions: { codexFactory: async (options) => ({
    startThread: async () => 'thread', resumeThread: async () => 'thread', close() {},
    startTurn: async (_thread, text, images) => {
      received.push({ text, images });
      queueMicrotask(() => options.onEvent({ method: 'turn/completed', params: { turn: { id: 'turn', status: 'completed' } } })); return 'turn';
    },
  }) } });
  t.after(async () => { await app.close(); rmSync(root, { recursive: true, force: true }); });
  const episode = app.store.createEpisode({ title: 'Workspace chrome' });
  const library = createLibraryService({ workspace: root, store: app.store });
  const graphic = await library.registerFile({ episodeId: episode.id, readable: Readable.from([png]), fileName: 'opening.png', contentType: 'image/png', selectedCategory: 'Graphics' });
  app.store.updateEpisode(episode.id, episode.revision, { cards: [{ id: 'opening', title: 'Opening', type: 'Static Graphic', prompt: 'Introduce the story', itemId: graphic.id, referenceItemIds: [graphic.id] }] });
  await listenInRange(app.server);
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${app.server.address().port}/episodes?channel=${episode.channelId}`);
  await page.locator('#episodes [data-episode-select]').waitFor();
  const workspace = await page.locator('.workspace').boundingBox(), empty = await page.locator('#empty').boundingBox();
  assert.ok(Math.abs(workspace.x + workspace.width - 1600) < 1, 'Landing workspace uses the hidden chat column');
  assert.ok(Math.abs(empty.x + empty.width / 2 - workspace.x - workspace.width / 2) < 1, 'Landing message is centered in the available workspace');
  const kind = page.getByRole('combobox', { name: 'Create as', exact: true });
  const kindBox = await kind.boundingBox(), rail = await page.locator('.episode-rail').boundingBox();
  assert.ok(kindBox.width >= 170 && kindBox.x + kindBox.width <= rail.x + rail.width, 'Creation kind is readable within the rail');
  assert.equal(await page.getByRole('button', { name: 'Create a production', exact: true }).count(), 2);
  await page.goto(`http://127.0.0.1:${app.server.address().port}/episodes?channel=${episode.channelId}&episode=${episode.id}`);
  await page.locator('[data-chat-title]').waitFor();
  await page.click('[data-tab="media"]');
  const libraryItem = `[data-library-item="${graphic.id}"]`;
  await page.locator(libraryItem).waitFor();
  for (const width of [1600, 600, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const category of ['Reference', 'B-roll', 'Narration']) {
      const group = page.locator(`[data-library-category="${category}"]`);
      assert.ok((await group.boundingBox()).height <= (width === 1600 ? 64 : 84), `${category} stays compact at ${width}px`);
      assert.match(await group.textContent(), /0.*Drop library items/s);
    }
    assert.ok((await page.locator(libraryItem).boundingBox()).width >= 180, 'Populated library cards retain their usable size');
  }
  await page.setViewportSize({ width: 1600, height: 1000 });
  const graphicBox = await page.locator(libraryItem).boundingBox();
  assert.ok(graphicBox.y + 100 < 1000, 'Graphics preview is visible below three empty categories');
  await page.locator(libraryItem).dragTo(page.locator('[data-library-category="Narration"]'));
  await page.locator(`[data-library-category="Narration"] ${libraryItem}`).waitFor();
  await page.locator(libraryItem).dragTo(page.locator('[data-library-category="Graphics"]'));
  await page.locator(`[data-library-category="Graphics"] ${libraryItem}`).waitFor();
  await page.click('[data-tab="board"]');
  await page.getByRole('combobox', { name: 'Show', exact: true }).click();
  await page.keyboard.press('End'); await page.keyboard.press('Escape');
  assert.equal(await page.inputValue('#episodeFilter'), 'All');
  await page.getByRole('combobox', { name: 'Show', exact: true }).click();
  await page.keyboard.press('Home'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
  assert.equal(await page.inputValue('#episodeFilter'), 'Scaffold');
  assert.equal(await page.locator('[role=listbox]').count(), 0);
  await page.getByRole('button', { name: 'Collapse Productions', exact: true }).click();
  assert.ok((await page.locator('.episode-rail').boundingBox()).width < 45);
  await page.reload(); await page.locator('[data-chat-title]').waitFor();
  assert.equal(await page.getByRole('button', { name: 'Expand Productions', exact: true }).isVisible(), true);
  await page.getByRole('button', { name: 'Open chat history', exact: true }).click();
  const chat = await page.locator('.chat').boundingBox(), drawer = await page.locator('[data-chat-history-drawer]').boundingBox();
  assert.ok(chat.width <= 440); assert.ok(drawer.x + drawer.width <= chat.x + 1);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('[data-chat-history-toggle]').evaluate((el) => el === document.activeElement), true);
  await page.locator('[data-chat-files]').setInputFiles({ name: 'red.png', mimeType: 'image/png', buffer: png });
  await page.locator('.chat-attachment img').waitFor();
  await page.waitForFunction(() => !document.querySelector('[data-chat-send]').disabled);
  await page.reload(); await page.locator('.chat-attachment img').waitFor();
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await page.locator('.chat-image-link img').waitFor();
  await page.waitForFunction(() => document.querySelector('.chat-image-link img').naturalWidth > 0);
  await page.waitForFunction(() => document.querySelector('[data-chat-status]').textContent === 'idle');
  assert.equal(received[0].images[0].mimeType, 'image/png');
  // Exercise actual clipboard/drop handlers without depending on OS clipboard permissions.
  for (const kind of ['paste', 'drop']) {
    await page.evaluate(({ kind, base64 }) => {
      const data = new DataTransfer(); data.items.add(new File([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))], `${kind}.png`, { type: 'image/png' }));
      const event = kind === 'paste' ? new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }) : new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true });
      // Firefox discards synthetic ClipboardEvent data; supply the same clipboard payload explicitly.
      if (kind === 'paste' && !event.clipboardData?.items.length) Object.defineProperty(event, 'clipboardData', { value: data });
      document.querySelector(kind === 'paste' ? '[data-chat-draft]' : '.chat-composer').dispatchEvent(event);
    }, { kind, base64: png.toString('base64') });
    await page.locator('.chat-attachment img').waitFor();
    await page.waitForFunction(() => !document.querySelector('[data-chat-send]').disabled);
    await page.locator('[data-chat-remove-image]').click();
    await page.waitForFunction(() => !document.querySelector('.chat-attachment'));
  }
  for (const width of [900, 600, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    if (width <= 700) {
      for (const expanded of [false, true]) {
        if (expanded) await page.getByRole('button', { name: 'Expand Productions', exact: true }).click();
        await page.reload();
        await page.locator('.card-reference-panel img').waitFor();
        assert.equal(await page.locator('#episodeRailToggle').getAttribute('aria-expanded'), String(expanded), 'Explicit rail preference survives phone reload');
        for (const selector of ['.workspace', '.chat']) {
          assert.ok((await page.locator(selector).boundingBox()).width >= width - 16, `${selector} uses the phone width with rail ${expanded ? 'expanded' : 'collapsed'}`);
        }
        assert.ok((await page.locator('#cards [data-key="prompt"]').boundingBox()).width >= width * .7, 'Card editor has room to write');
        assert.ok((await page.locator('[data-chat-draft]').boundingBox()).width >= width - 70, 'Composer has room to write');
        for (const tile of await page.locator('.card-reference-panel .reference-item, .reference-add-tile').all()) {
          assert.ok((await tile.boundingBox()).width >= 200, 'Reference content and picker remain readable');
        }
        for (const control of await page.locator('.tabs button, .actions button, [data-promote], [data-delete], [data-chat-send]').all()) {
          const box = await control.boundingBox();
          assert.ok(box.x >= 0 && box.x + box.width <= width && box.width >= 30, 'Actions and tabs remain reachable');
        }
        if (expanded) {
          const nav = page.locator('#episodes [data-episode-select]').first();
          await nav.focus(); await page.keyboard.press('Enter');
          assert.equal(await page.inputValue('#episodeTitle'), 'Workspace chrome');
        }
        if (process.env.STORYBENCH_CHROME_EVIDENCE) {
          mkdirSync(process.env.STORYBENCH_CHROME_EVIDENCE, { recursive: true });
          await page.screenshot({ path: path.join(process.env.STORYBENCH_CHROME_EVIDENCE, `ui-polish-r2-${engine.name()}-${width}-${expanded ? 'expanded' : 'collapsed'}.png`), fullPage: true });
        }
        await page.click('[data-tab="final"]');
        assert.equal(await page.locator('#finalPanel').isVisible(), true);
        await page.click('[data-tab="board"]');
      }
      await page.getByRole('button', { name: 'Collapse Productions', exact: true }).click();
    }
    assert.equal(await page.locator('.chat').isVisible(), true);
    const card = await page.locator('.story-card').boundingBox();
    const section = await page.getByRole('combobox', { name: 'Story section', exact: true }).boundingBox();
    assert.ok(section.x + section.width <= card.x + card.width + 1, `Card controls fit at ${width}px`);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `No page overflow at ${width}px`);
    await page.getByRole('button', { name: 'Open chat history', exact: true }).click();
    const box = await page.locator('[data-chat-history-drawer]').boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= width + 1);
    await page.keyboard.press('Escape');
  }
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.getByRole('button', { name: 'Expand Productions', exact: true }).click();
  if (process.env.STORYBENCH_CHROME_EVIDENCE) {
    mkdirSync(process.env.STORYBENCH_CHROME_EVIDENCE, { recursive: true });
    await page.getByRole('combobox', { name: 'Show', exact: true }).click();
    await page.screenshot({ path: path.join(process.env.STORYBENCH_CHROME_EVIDENCE, `${engine.name()}-chrome.png`) });
  }
  assert.deepEqual(errors, []);
});

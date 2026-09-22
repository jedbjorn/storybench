import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";
import { createApp } from "../src/server.js";
import { listenInRange } from "../test-support/loopback-port.js";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZxXAAAAAASUVORK5CYII=", "base64");

test("cards collapse with move controls available and library deletion clears linked cards", { timeout: 60_000 }, async (t) => {
  let browser;
  try { browser = await chromium.launch(); }
  catch { if (existsSync("/usr/bin/chromium")) browser = await chromium.launch({ executablePath: "/usr/bin/chromium" }).catch(() => null); }
  if (!browser) return t.skip("No launchable Chromium on this seat");
  t.after(() => browser.close());
  const root = mkdtempSync(path.join(tmpdir(), "storybench-qol-browser-"));
  const app = await createApp({ workspace: root });
  t.after(async () => { await app.close(); rmSync(root, { recursive: true, force: true }); });
  const episode = app.store.createEpisode({ title: "QoL proof" });
  writeFileSync(path.join(root, "image.png"), png);
  const asset = app.store.saveAsset({ channelId: episode.channelId, name: "Image", hash: "qol-image", kind: "image", path: "image.png", metadata: { contentType: "image/png" } });
  const item = app.store.attachLibraryItem(episode.id, asset.id, { category: "Graphics", label: "Image" });
  app.store.updateEpisode(episode.id, episode.revision, { referenceItemIds: [item.id], cards: [
    { id: "first", title: "First", type: "Static Graphic", itemId: item.id, referenceItemIds: [item.id], order: 0 },
    { id: "second", title: "Second", type: "Video", order: 1 },
  ] });
  await listenInRange(app.server);
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto(`http://127.0.0.1:${app.server.address().port}/episodes?channel=${episode.channelId}&episode=${episode.id}`);
  const first = page.locator('[data-card-id="first"]');
  await first.waitFor();
  assert.equal(await first.locator('[data-duplicate]').count(), 0);
  await first.locator('[data-card-collapse]').click();
  assert.equal(await first.locator('[data-card-collapse]').getAttribute('aria-expanded'), 'false');
  assert.equal(await first.locator('[data-move="1"]').isVisible(), true);
  assert.equal(await first.locator('[data-promote]').isVisible(), false);
  assert.equal(await first.locator('[data-delete]').isVisible(), false);
  await first.locator('[data-move="1"]').click();
  await page.waitForFunction(() => document.querySelector('#cards .story-card')?.dataset.cardId === 'second');
  await page.waitForFunction(() => document.querySelector('[data-card-id="first"] [data-card-collapse]')?.getAttribute('aria-expanded') === 'false');
  await first.locator('[data-card-collapse]').click();
  assert.equal(await first.locator('[data-promote]').isVisible(), true);
  assert.equal(await first.locator('[data-delete]').isVisible(), true);
  await page.click('.tabs [data-tab="media"]');
  await page.locator(`[data-library-delete="${item.id}"]`).click();
  await page.waitForFunction((id) => !document.querySelector(`[data-library-item="${id}"]`), item.id);
  const updated = app.store.getEpisode(episode.id);
  assert.equal(updated.cards[0].itemId, null);
  assert.deepEqual(updated.cards[0].referenceItemIds, []);
  assert.deepEqual(updated.referenceItemIds, []);
  assert.equal(app.store.getLibraryItem(episode.id, item.id), null);
  assert.ok(existsSync(path.join(root, "image.png")), "shared source asset is retained");
  assert.deepEqual(errors, []);
});

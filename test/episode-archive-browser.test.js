import { listenInRange } from "../test-support/loopback-port.js";
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";
import { createApp } from "../src/server.js";

async function launch() {
  try { return await chromium.launch(); }
  catch { return existsSync("/usr/bin/chromium") ? chromium.launch({ executablePath: "/usr/bin/chromium" }).catch(() => null) : null; }
}

test("episodes can be archived without losing their stage, then restored", { timeout: 30000 }, async (t) => {
  const browser = await launch();
  if (!browser) return t.skip("No launchable Chromium on this seat");
  t.after(() => browser.close());
  const root = mkdtempSync(path.join(tmpdir(), "storybench-archive-browser-"));
  const app = await createApp({ workspace: root });
  t.after(async () => { await app.close(); rmSync(root, { recursive: true, force: true }); });
  let episode = app.store.createEpisode({ title: "Shelved cut" });
  episode = app.store.updateEpisode(episode.id, episode.revision, { state: "Draft" });
  await listenInRange(app.server);

  const base = `http://127.0.0.1:${app.server.address().port}`;
  const page = await browser.newPage();
  await page.goto(`${base}/episodes?channel=${episode.channelId}&episode=${episode.id}`);
  await page.locator(`[data-id="${episode.id}"] [data-episode-state-select]`).waitFor();
  await Promise.all([
    page.waitForResponse((response) => response.url().endsWith(`/api/episodes/${episode.id}`) && response.request().method() === "PUT"),
    page.selectOption(`[data-id="${episode.id}"] [data-episode-state-select]`, "Archived"),
  ]);

  assert.equal(app.store.getEpisode(episode.id).state, "Draft");
  assert.ok(app.store.getEpisode(episode.id).archivedAt);
  assert.doesNotMatch(await page.textContent("#episodes"), /Shelved cut/);
  assert.match(await page.textContent('[data-episode-state="Archived"]'), /Archived1[\s\S]*1 episode hidden/);
  assert.match(await page.textContent("#filteredEpisodeNotice"), /Current episode is in Archived/);

  await page.click("[data-reveal-episode]");
  assert.equal(await page.inputValue("#episodeFilter"), "Archived");
  await page.locator(`[data-id="${episode.id}"] [data-episode-state-select]`).waitFor();
  await Promise.all([
    page.waitForResponse((response) => response.url().endsWith(`/api/episodes/${episode.id}`) && response.request().method() === "PUT"),
    page.selectOption(`[data-id="${episode.id}"] [data-episode-state-select]`, "Draft"),
  ]);

  assert.equal(app.store.getEpisode(episode.id).archivedAt, null);
  assert.equal(app.store.getEpisode(episode.id).state, "Draft");
  assert.doesNotMatch(await page.textContent("#episodes"), /Shelved cut/);
  assert.match(await page.textContent("#filteredEpisodeNotice"), /Current episode is in Draft/);
  await page.click("[data-reveal-episode]");
  assert.equal(await page.inputValue("#episodeFilter"), "All");
  assert.match(await page.textContent("#episodes"), /Shelved cut/);
});

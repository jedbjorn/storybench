// Headless browser proof for episode/card reference panels (Playwright, loopback port in the 188xx range).
// Skips only when no Chromium can be launched on this seat. STORYBENCH_EVIDENCE_DIR saves screenshots.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { Readable } from "node:stream";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";
import { createApp } from "../src/server.js";
import { listenInRange } from "../test-support/loopback-port.js";
import { createLibraryService } from "../src/library.js";
import { initDataRoot, openDataRoot } from "../src/services/data-root.js";

const PREFERRED_PORT = Number(process.env.STORYBENCH_BROWSER_TEST_PORT || 18831);
async function launch() {
  try { return await chromium.launch(); }
  catch { return existsSync("/usr/bin/chromium") ? chromium.launch({ executablePath: "/usr/bin/chromium" }).catch(() => null) : null; }
}
function media(dir, name, args) {
  const file = path.join(dir, name);
  execFileSync("ffmpeg", ["-v", "error", ...args, "-y", file]);
  return file;
}

test("episode and card reference panels link, upload, unlink and report unavailable items in a real browser", { timeout: 180_000 }, async (t) => {
  const browser = await launch();
  if (!browser) return t.skip("No launchable Chromium on this seat");
  t.after(() => browser.close());
  const base = mkdtempSync(path.join(os.tmpdir(), "storybench-ref-browser-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = path.join(base, "data");
  initDataRoot(root);
  const setup = openDataRoot(root);
  const channel = setup.createChannel("Browser");
  const episode = setup.createEpisode({ title: "Reference proof", channelId: channel.id });
  const library = createLibraryService({ workspace: root, store: setup });
  const register = (file, category) => library.registerFile({ episodeId: episode.id, readable: Readable.from([readFileSync(file)]), fileName: path.basename(file), contentType: "application/octet-stream", selectedCategory: category });
  const logo = await register(media(base, "logo.png", ["-f", "lavfi", "-i", "color=c=orange:s=64x36", "-frames:v", "1"]), "Graphics");
  const clip = await register(media(base, "clip.mp4", ["-f", "lavfi", "-i", "color=c=teal:s=64x36:d=1", "-pix_fmt", "yuv420p"]), "B-roll");
  const moodFile = media(base, "mood.png", ["-f", "lavfi", "-i", "color=c=purple:s=64x36", "-frames:v", "1"]);
  setup.updateEpisode(episode.id, episode.revision, { cards: [{ id: "still-card", title: "Opening still", type: "Static Graphic", prompt: "Open on the logo",
    sectionId: null, itemId: logo.id, referenceItemIds: [], order: 0, enabled: true, duration: 2 }] });
  setup.close();

  const app = await createApp({ dataRoot: root });
  const PORT = await listenInRange(app.server, { preferred: PREFERRED_PORT });
  t.after(() => app.close());
  const store = app.store;
  const evidence = process.env.STORYBENCH_EVIDENCE_DIR;
  if (evidence) mkdirSync(evidence, { recursive: true });
  const shot = (page, name) => evidence ? page.screenshot({ path: path.join(evidence, `${name}.png`), fullPage: true }) : null;
  const until = async (check, message) => {
    for (let attempt = 0; attempt < 200; attempt++) { const value = check(); if (value) return value; await new Promise((resolve) => setTimeout(resolve, 25)); }
    assert.fail(message);
  };
  const page = await browser.newPage({ viewport: { width: 1920, height: 1000 } });
  page.setDefaultTimeout(60_000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const open = async () => {
    await page.goto(`http://127.0.0.1:${PORT}/?channel=${channel.id}`);
    await page.click(`#episodes [data-id="${episode.id}"] [data-episode-select]`);
    await page.waitForSelector("#episodeReferences [data-ref-add]:not([disabled])", { state: "attached" });
  };
  await open();
  assert.equal(await page.textContent("#channelName"), "Browser");

  // Episode references: prompt only, then an existing B-roll item (category does not limit the picker).
  await page.click("#episodeReferencesBox > summary");
  const episodeLayout = await page.evaluate(() => {
    const box = document.querySelector("#episodeReferencesBox");
    const titleColumn = document.querySelector(".title-row > div:first-child");
    const actions = document.querySelector("#episodeReferences .reference-actions");
    const drop = document.querySelector("#episodeReferences .reference-drop");
    return {
      parent: box.parentElement.id,
      panelWidth: box.getBoundingClientRect().width,
      titleWidth: titleColumn.getBoundingClientRect().width,
      actionsDisplay: getComputedStyle(actions).display,
      dropWhiteSpace: getComputedStyle(drop).whiteSpace,
    };
  });
  assert.equal(episodeLayout.parent, "editor", "episode references span the editor rather than the title column");
  assert.ok(episodeLayout.panelWidth > episodeLayout.titleWidth, "episode references are wider than the title column");
  assert.equal(episodeLayout.actionsDisplay, "flex", "episode reference controls share one desktop row");
  assert.equal(episodeLayout.dropWhiteSpace, "nowrap", "drop/upload copy stays on one line");
  await page.fill("#episodeReferences [data-ref-prompt]", "Warm, unhurried, late-afternoon light");
  await page.press("#episodeReferences [data-ref-prompt]", "Tab");
  await until(() => store.getEpisode(episode.id).referencePrompt === "Warm, unhurried, late-afternoon light", "episode prompt saved");
  const offered = await page.$$eval("#episodeReferences [data-ref-add] option", (options) => options.map((option) => option.value).filter(Boolean));
  assert.deepEqual(offered.sort(), [logo.id, clip.id].sort(), "any category is offered");
  await page.selectOption("#episodeReferences [data-ref-add]", clip.id);
  await until(() => store.getEpisode(episode.id).referenceItemIds.join() === clip.id, "episode reference linked");
  await page.waitForSelector(`#episodeReferences [data-ref-item="${clip.id}"] video`);
  assert.equal(await page.$eval("#episodeReferences .reference-list", (element) => getComputedStyle(element).display), "flex", "episode previews render in a tile row");
  await shot(page, "1-episode-references");

  // Card reference upload registers a new item and links it only to that card; output media is unchanged.
  const cardPanel = page.locator('[data-ref-card="still-card"]');
  assert.equal(await cardPanel.isVisible(), true, "card references are visible without expanding a disclosure");
  assert.equal(await cardPanel.locator('[data-ref-pick]').count(), 2, "an empty card offers two reference tiles");
  const previewBox = await page.locator('[data-card-id="still-card"] .card-preview').boundingBox();
  const referenceBox = await cardPanel.boundingBox();
  assert.ok(referenceBox.x >= previewBox.x + previewBox.width, "references sit beside the output on a wide card");
  await shot(page, "2-empty-card-references");
  await page.setInputFiles('[data-ref-card="still-card"] [data-ref-file]', moodFile);
  const linked = await until(() => { const card = store.getEpisode(episode.id).cards[0]; return card.referenceItemIds.length === 1 && card; }, "card reference uploaded");
  assert.equal(linked.itemId, logo.id, "card output media is not replaced");
  const uploaded = store.getLibraryItem(episode.id, linked.referenceItemIds[0]);
  assert.equal(uploaded.category, "Reference");
  assert.deepEqual(store.getEpisode(episode.id).referenceItemIds, [clip.id], "a card upload does not become episode-wide");
  await page.fill('[data-ref-card="still-card"] [data-ref-prompt]', "Borrow only the palette");
  await page.press('[data-ref-card="still-card"] [data-ref-prompt]', "Tab");
  await until(() => store.getEpisode(episode.id).cards[0].referencePrompt === "Borrow only the palette", "card prompt saved");
  await page.waitForSelector(`[data-ref-card="still-card"] [data-ref-item="${uploaded.id}"] img`);
  assert.match(await page.textContent('[data-card-id="still-card"] .card-media-controls'), /Output media \(footage\)/);
  await shot(page, "2-card-reference");

  // Existing media can also be linked from the remaining tile, without changing output or episode scope.
  await cardPanel.locator('[data-ref-add]').selectOption(clip.id);
  await until(() => store.getEpisode(episode.id).cards[0].referenceItemIds.length === 2, "existing card reference linked");
  await cardPanel.locator(`[data-ref-unlink="${clip.id}"]`).click();
  await until(() => store.getEpisode(episode.id).cards[0].referenceItemIds.length === 1, "card reference unlinked");
  assert.ok(store.getLibraryItem(episode.id, clip.id));
  await page.waitForFunction((revision) => document.querySelector('#saveState').textContent === `Saved · r${revision}`, store.getEpisode(episode.id).revision);
  await page.setViewportSize({ width: 1400, height: 1000 });
  const narrowPreview = await page.locator('[data-card-id="still-card"] .card-preview').boundingBox();
  const narrowReferences = await cardPanel.boundingBox();
  assert.ok(narrowReferences.y >= narrowPreview.y + narrowPreview.height, "references stack below the output on a narrow card");
  assert.ok(await cardPanel.evaluate((element) => element.scrollWidth <= element.clientWidth), "reference tiles stay within their panel");
  await shot(page, "2-narrow-card-references");
  await page.setViewportSize({ width: 1920, height: 1000 });

  // Unlink keeps the library item.
  await page.click(`#episodeReferences [data-ref-unlink="${clip.id}"]`);
  await until(() => store.getEpisode(episode.id).referenceItemIds.length === 0, "episode reference unlinked");
  assert.ok(store.getLibraryItem(episode.id, clip.id), "unlinked item remains in the library");

  // An unavailable link is shown honestly and can be unlinked.
  store.db.prepare("UPDATE episodes SET reference_item_ids=? WHERE id=?").run(JSON.stringify(["library_missing"]), episode.id);
  await open();
  await page.click("#episodeReferencesBox > summary");
  assert.match(await page.textContent('#episodeReferences [data-ref-item="library_missing"]'), /Unavailable reference/);
  await shot(page, "3-unavailable-reference");
  await page.click('#episodeReferences [data-ref-unlink="library_missing"]');
  await until(() => store.getEpisode(episode.id).referenceItemIds.length === 0, "unavailable reference unlinked");
  const final = store.getEpisode(episode.id);
  assert.deepEqual({ prompt: final.referencePrompt, cardRefs: final.cards[0].referenceItemIds, cardPrompt: final.cards[0].referencePrompt, itemId: final.cards[0].itemId },
    { prompt: "Warm, unhurried, late-afternoon light", cardRefs: [uploaded.id], cardPrompt: "Borrow only the palette", itemId: logo.id });
  assert.deepEqual(errors, []);
});

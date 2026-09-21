import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";
import { createApp } from "../src/server.js";
import { listenInRange } from "../test-support/loopback-port.js";
import { initDataRoot, openDataRoot } from "../src/services/data-root.js";

const PREFERRED_PORT = Number(process.env.STORYBENCH_BROWSER_TEST_PORT || 18847);
async function launch() {
  try { return await chromium.launch(); }
  catch { return existsSync("/usr/bin/chromium") ? chromium.launch({ executablePath: "/usr/bin/chromium" }).catch(() => null) : null; }
}

test("card, graphic, Draft and Final shortcuts ask the selected assistant and never render in the browser", { timeout: 120_000 }, async (t) => {
  const browser = await launch();
  if (!browser) return t.skip("No launchable Chromium on this seat");
  t.after(() => browser.close());
  const base = mkdtempSync(path.join(os.tmpdir(), "storybench-production-browser-")), root = path.join(base, "data");
  t.after(() => rmSync(base, { recursive: true, force: true }));
  initDataRoot(root);
  const setup = openDataRoot(root), channel = setup.createChannel("Routing"), episode = setup.createEpisode({ title: "Shortcut proof", channelId: channel.id });
  setup.updateEpisode(episode.id, episode.revision, { cards: [{ id: "opening", title: "Opening", type: "Video", prompt: "Build the opener" }] });
  setup.close();
  const provider = [];
  const codexFactory = async (options) => ({ startThread: async () => "thread", resumeThread: async (id) => id,
    startTurn: async () => { provider.push(options.request); queueMicrotask(() => options.onEvent({ method: "turn/completed", params: { turn: { id: `turn-${provider.length}`, status: "completed" } } })); return `turn-${provider.length}`; },
    interrupt: async () => {}, close() {} });
  const app = await createApp({ dataRoot: root, chatOptions: { codexFactory } });
  const port = await listenInRange(app.server, { preferred: PREFERRED_PORT });
  t.after(() => app.close());
  const evidence = process.env.STORYBENCH_EVIDENCE_DIR;
  if (evidence) mkdirSync(evidence, { recursive: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const renderRequests = [];
  page.on("request", (request) => { if (/\/api\/episodes\/[^/]+\/(?:render|graphics\/[^/]+\/render)$/.test(new URL(request.url()).pathname)) renderRequests.push(request.url()); });
  await page.goto(`http://127.0.0.1:${port}/?channel=${channel.id}`);
  await page.click(`#episodes [data-id="${episode.id}"] [data-episode-select]`);
  await page.waitForSelector("[data-chat-draft]");
  const waitMessages = (count) => page.waitForFunction((expected) => document.querySelectorAll(".chat-user").length === expected, count);

  await page.fill("[data-chat-draft]", "Unsent note stays here");
  await page.fill("[data-card-id=opening] .card-title", "Saved opening");
  await page.press("[data-card-id=opening] .card-title", "Tab");
  await page.click("[data-card-build]"); await waitMessages(1);
  assert.equal(await page.inputValue("[data-chat-draft]"), "Unsent note stays here");
  const saved = await page.evaluate(async (id) => (await fetch(`/api/episodes/${id}`)).json(), episode.id);
  assert.equal(saved.cards[0].title, "Saved opening");
  await page.click("#openGraphic"); await page.fill("#graphicForm textarea[name=prompt]", "A calm title card"); await page.click("#graphicForm button.primary"); await waitMessages(2);
  await page.click("#openGraphic"); await page.selectOption("#graphicForm select[name=kind]", "motion"); await page.fill("#graphicForm textarea[name=prompt]", "Animate the title"); await page.click("#graphicForm button.primary"); await waitMessages(3);
  await page.click("#preview"); await waitMessages(4);
  await page.click("#export"); await waitMessages(5);
  assert.deepEqual(provider.map((request) => [request.kind, request.cardId]), [
    ["card_build", "opening"], ["still_graphic", null], ["animated_graphic", null], ["draft", null], ["final", null],
  ]);
  assert.deepEqual(renderRequests, []);
  const visible = await page.$$eval(".chat-user", (items) => items.map((item) => item.textContent));
  assert.equal(visible.length, 5);
  if (evidence) await page.screenshot({ path: path.join(evidence, "production-shortcuts.png"), fullPage: true });
});

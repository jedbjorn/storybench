// Headless browser check of the conversation harness/model selector (Playwright, loopback
// port in the 188xx range). Controlled adapter and catalogue; no providers. Skips only when no
// Chromium can be launched. STORYBENCH_EVIDENCE_DIR saves screenshots.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";
import { createApp } from "../src/server.js";
import { listenInRange } from "../test-support/loopback-port.js";
import { initDataRoot, openDataRoot } from "../src/services/data-root.js";
import { createMemoryConversationPersistence } from "../src/runtime/conversation-runtime.js";

const PREFERRED_PORT = Number(process.env.STORYBENCH_BROWSER_TEST_PORT || 18836);
async function launch() {
  try { return await chromium.launch(); }
  catch { return existsSync("/usr/bin/chromium") ? chromium.launch({ executablePath: "/usr/bin/chromium" }).catch(() => null) : null; }
}
const catalog = [
  { harness: "codex", available: true, source: "native", exactModelIds: true, models: [
    { id: "gpt-6-astra", displayName: "GPT-6-Astra", isDefault: true, efforts: ["low", "medium", "high"], defaultEffort: "medium" },
    { id: "gpt-5.6-luna", displayName: "GPT-5.6-Luna", isDefault: false, efforts: ["low", "medium"], defaultEffort: "medium" } ] },
  { harness: "claude", available: false, reason: "No claude login found. Run `claude` on the host and sign in, then retry.", models: [] },
];

test("the chat selector shows availability, per-model efforts, applies a change and marks the boundary", { timeout: 120_000 }, async (t) => {
  const browser = await launch();
  if (!browser) return t.skip("No launchable Chromium on this seat");
  t.after(() => browser.close());
  const base = mkdtempSync(path.join(os.tmpdir(), "storybench-selector-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = path.join(base, "data");
  initDataRoot(root);
  const setup = openDataRoot(root);
  const channel = setup.createChannel("Selector");
  const episode = setup.createEpisode({ title: "Selector proof", channelId: channel.id });
  setup.close();
  const persistence = createMemoryConversationPersistence();
  const launches = [];
  const codexFactory = async (options) => {
    launches.push({ harness: options.harness, model: options.model, effort: options.effort });
    return { async startThread() { return "thread-1"; }, async resumeThread(id) { return id; },
      async startTurn() { queueMicrotask(() => options.onEvent({ method: "turn/completed", params: { turn: { id: "t", status: "completed" } } })); return "t"; }, async interrupt() {}, close() {} };
  };
  const app = await createApp({ dataRoot: root, chatOptions: { codexFactory, persistence, catalog: { list: async () => catalog } } });
  const PORT = await listenInRange(app.server, { preferred: PREFERRED_PORT });
  t.after(() => app.close());
  const evidence = process.env.STORYBENCH_EVIDENCE_DIR;
  if (evidence) mkdirSync(evidence, { recursive: true });
  const shot = (page, name) => evidence ? page.screenshot({ path: path.join(evidence, `${name}.png`), fullPage: false }) : null;
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  page.setDefaultTimeout(30_000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${PORT}/?channel=${channel.id}`);
  await page.click(`#episodes [data-id="${episode.id}"] [data-episode-select]`);
  await page.waitForSelector("[data-chat-selection]");
  assert.equal((await page.textContent("[data-chat-selection]")).trim(), "Codex · default model");

  await page.click("[data-chat-selection]");
  await page.waitForSelector("[data-settings-harness]");
  const options = await page.$$eval("[data-settings-harness] option", (items) => items.map((item) => ({ value: item.value, disabled: item.disabled, text: item.textContent })));
  assert.equal(options.find((option) => option.value === "claude").disabled, true);
  assert.match(options.find((option) => option.value === "claude").text, /unavailable: No claude login found/);
  // Effort options follow the chosen model's own contract.
  await page.fill("[data-settings-model]", "gpt-5.6-luna");
  const efforts = await page.$$eval("[data-settings-effort] option", (items) => items.map((item) => item.value));
  assert.deepEqual(efforts, ["", "low", "medium"]);
  const models = await page.$$eval("[data-settings-models] option", (items) => items.map((item) => item.value));
  assert.deepEqual(models, ["gpt-6-astra", "gpt-5.6-luna"]);
  await page.selectOption("[data-settings-effort]", "low");
  await shot(page, "selector-open");
  await page.click("[data-settings-apply]");
  await page.waitForFunction(() => document.querySelector("[data-chat-selection]")?.textContent.includes("gpt-5.6-luna"));
  assert.equal((await page.textContent("[data-chat-selection]")).trim(), "Codex · gpt-5.6-luna · low effort");
  await page.waitForSelector(".chat-boundary");
  assert.match(await page.textContent(".chat-boundary"), /Settings changed from Codex · default model to Codex · gpt-5.6-luna · low effort/);
  await shot(page, "selector-applied");
  // The selection is used by the next turn.
  await page.fill("[data-chat-draft]", "hello");
  await page.press("[data-chat-draft]", "Enter");
  const deadline = Date.now() + 10_000;
  while (!launches.length && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
  assert.deepEqual(launches[0], { harness: "codex", model: "gpt-5.6-luna", effort: "low" });
  assert.deepEqual(errors, []);
});

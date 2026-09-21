// Headless browser proof for Move to Drafts and draft cleanup (Playwright, loopback port in the 188xx range).
// Skips only when no Chromium can be launched on this seat. STORYBENCH_EVIDENCE_DIR saves screenshots.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";
import { createApp } from "../src/server.js";
import { initDataRoot, openDataRoot } from "../src/services/data-root.js";

const PORT = Number(process.env.STORYBENCH_OUTPUTS_BROWSER_PORT || 18832);
async function launch() {
  try { return await chromium.launch(); }
  catch { return existsSync("/usr/bin/chromium") ? chromium.launch({ executablePath: "/usr/bin/chromium" }).catch(() => null) : null; }
}

test("outputs UI moves a final to Drafts, deletes one draft and cleans up a selection in a real browser", { timeout: 180_000 }, async (t) => {
  const browser = await launch();
  if (!browser) return t.skip("No launchable Chromium on this seat");
  t.after(() => browser.close());
  const base = mkdtempSync(path.join(os.tmpdir(), "storybench-outputs-browser-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = path.join(base, "data");
  initDataRoot(root);
  const setup = openDataRoot(root);
  const channel = setup.createChannel("Outputs");
  const episode = setup.createEpisode({ title: "Output proof", channelId: channel.id });
  const video = (relative, color) => {
    const file = path.join(root, relative);
    mkdirSync(path.dirname(file), { recursive: true });
    execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", `color=c=${color}:s=160x90:d=1`, "-pix_fmt", "yuv420p", "-y", file]);
    return relative;
  };
  const dir = (...parts) => path.relative(root, path.join(setup.episodeDirectory(episode.id), ...parts));
  let second = 0;
  const output = (id, outputClass, relative) => setup.saveJob({ id, episodeId: episode.id, kind: outputClass, outputClass, state: "completed", progress: 1, revision: 1,
    outputPath: relative, snapshot: { renderRevision: id }, createdAt: new Date(Date.UTC(2026, 8, 20, 12, 0, second++)).toISOString() });
  output("job_draft_one", "draft", video(dir("outputs", "drafts", "one.mp4"), "red"));
  output("job_draft_two", "draft", video(dir("outputs", "drafts", "two.mp4"), "green"));
  output("job_legacy", "legacy_draft", video("exports/legacy.mp4", "blue"));
  output("job_registered", "draft", video(dir("outputs", "drafts", "registered.mp4"), "white"));
  setup.saveAsset({ channelId: channel.id, name: "registered.mp4", hash: "registered", kind: "video", path: dir("outputs", "drafts", "registered.mp4"), duration: 1, metadata: {} });
  const finalPath = video(dir("outputs", "final", "final.mp4"), "yellow");
  const registeredPath = dir("outputs", "drafts", "registered.mp4"), twoPath = dir("outputs", "drafts", "two.mp4");
  output("job_final", "final", finalPath);
  setup.close();

  const app = await createApp({ dataRoot: root });
  await new Promise((resolve, reject) => { app.server.once("error", reject); app.server.listen(PORT, "127.0.0.1", resolve); });
  t.after(() => app.close());
  const store = app.store;
  const evidence = process.env.STORYBENCH_EVIDENCE_DIR;
  if (evidence) mkdirSync(evidence, { recursive: true });
  const shot = (page, name) => evidence ? page.screenshot({ path: path.join(evidence, `${name}.png`), fullPage: true }) : null;
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  page.setDefaultTimeout(60_000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto(`http://127.0.0.1:${PORT}/?channel=${channel.id}`);
  await page.click(`#episodes [data-id="${episode.id}"] [data-episode-select]`);

  // Move to Drafts from the Final view.
  await page.click('.tabs [data-tab="final"]');
  await page.waitForSelector('#finalJobs [data-move-to-drafts="job_final"]');
  const finalBytes = statSync(path.join(root, finalPath)).size;
  await page.click('#finalJobs [data-move-to-drafts="job_final"]');
  await page.waitForSelector('#finalJobs [data-job-id="job_final"]', { state: "detached" });
  assert.equal(store.getJob("job_final").designation, "draft");
  assert.equal(statSync(path.join(root, finalPath)).size, finalBytes);
  await page.click('.tabs [data-tab="drafts"]');
  await page.waitForSelector('#draftJobs [data-job-id="job_final"] video[src="/api/jobs/job_final/file"]');
  assert.match(await page.textContent('#draftJobs [data-job-id="job_final"]'), /Draft \(rendered as Final\)/);
  await shot(page, "1-moved-final-in-drafts");

  // Individual Delete releases only that row's player; another player keeps working.
  await page.waitForFunction(() => document.querySelector('#draftJobs [data-job-id="job_draft_two"] video')?.readyState >= 1);
  await page.click('#draftJobs [data-delete-output="job_draft_one"]');
  await page.waitForFunction(() => /deleted/.test(document.querySelector('#draftJobs [data-job-id="job_draft_one"]')?.textContent || ""));
  assert.equal(await page.$('#draftJobs [data-job-id="job_draft_one"] video'), null, "the deleted draft has no player");
  assert.equal(await page.$eval('#draftJobs [data-job-id="job_draft_two"] video', (element) => element.isConnected && element.getAttribute("src")), "/api/jobs/job_draft_two/file");
  assert.equal(store.getJob("job_draft_one").deletionState, "deleted");
  await shot(page, "2-individual-delete");

  // Clean up drafts: starts with nothing selected, shows blockers, totals the selection and deletes it in one submit.
  await page.click("#openDraftCleanup");
  await page.waitForSelector("#draftCleanupModal[open] [data-cleanup-select]");
  assert.equal(await page.$$eval("#draftCleanupRows [data-cleanup-select]:checked", (items) => items.length), 0);
  assert.equal(await page.$eval('[data-cleanup-select="job_registered"]', (element) => element.disabled), true);
  assert.match(await page.textContent('[data-cleanup-row="job_registered"]'), /registered as library or branding media/);
  assert.equal(await page.$eval("#draftCleanupSubmit", (element) => element.disabled), true);
  await page.check('[data-cleanup-select="job_final"]');
  await page.check('[data-cleanup-select="job_legacy"]');
  const expected = statSync(path.join(root, finalPath)).size + statSync(path.join(root, "exports/legacy.mp4")).size;
  assert.match(await page.textContent("#draftCleanupTotal"), /2 selected/);
  await shot(page, "3-cleanup-selection");
  await page.click("#draftCleanupSubmit");
  await page.waitForFunction(() => /2 deleted/.test(document.querySelector("#draftCleanupSummary")?.textContent || ""));
  assert.equal(await page.$('[data-cleanup-row="job_final"]'), null);
  assert.equal(existsSync(path.join(root, finalPath)), false);
  assert.equal(existsSync(path.join(root, "exports/legacy.mp4")), false);
  assert.ok(existsSync(path.join(root, registeredPath)));
  assert.ok(existsSync(path.join(root, twoPath)));
  const reclaimed = store.getJob("job_final").deletedBytes + store.getJob("job_legacy").deletedBytes;
  assert.equal(reclaimed, expected);
  await shot(page, "4-cleanup-result");
  assert.equal((await fetch(`http://127.0.0.1:${PORT}/api/jobs/job_final/file`)).status, 410);
  assert.deepEqual(errors, []);
});

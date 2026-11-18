// Creator slide capture for Preview Markup. A previewed deck has an opaque origin, so
// the server renders the reported state from the exact pinned build instead. Each
// capture runs its own short-lived browser and temp copy: it never shares, counts
// against or waits on an agent's QA session (deck-qa.js).
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, rm } from 'node:fs/promises';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { extractBuild } from './deck-qa-bundle.js';
import { inspectPage } from './deck-qa.js';
import { DECK_STATE_REPORTING } from './deck-template/build.js';
import { StoreError } from './store.js';

export const CAPTURE_LIMIT_MS = 20_000;
export const CAPTURE_VIEWPORT = Object.freeze({ min: { width: 640, height: 360 }, max: { width: 1920, height: 1080 } });
export const CAPTURE_BUSY = 'Slide capture is busy. Try Markup again in a moment.';
export const CAPTURE_REBUILD = 'Rebuild this deck to mark up slides.';

export const reportsState = job => job?.snapshot?.manifest?.stateReporting === DECK_STATE_REPORTING;

// The page's state message is a claim; only values that exist in this build pass.
export function validateCaptureState(job, body) {
  const slides = job.snapshot.slides;
  const slide = typeof body?.slideId === 'string' ? slides.find(candidate => candidate.id === body.slideId) : null;
  if (!slide) throw new StoreError('That slide is not part of this deck build.', 400);
  const position = (value, count, name) => {
    if (!count && value === null) return null;
    if (!Number.isInteger(value) || value < 0 || value >= count) throw new StoreError(`Invalid ${name} for slide ${slide.id}.`, 400);
    return value;
  };
  const size = (value, name) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new StoreError(`Frame ${name} must be a number.`, 400);
    return Math.min(CAPTURE_VIEWPORT.max[name], Math.max(CAPTURE_VIEWPORT.min[name], Math.round(value)));
  };
  return { slideId: slide.id, stage: position(body.stage, slide.stages?.length ?? 0, 'reveal stage'),
    gallery: position(body.gallery, slide.subnav?.length ?? 0, 'gallery view'),
    viewport: { width: size(body.width, 'width'), height: size(body.height, 'height') } };
}

export function createDeckCapture({ store, launch = options => chromium.launch(options), limitMs = CAPTURE_LIMIT_MS }) {
  let running = false;
  async function render(job, state, work) {
    const temp = await mkdtemp(path.join(os.tmpdir(), 'storybench-capture-'));
    try {
      const bundle = path.join(temp, 'bundle');
      const build = await extractBuild(store, job.episodeId, job.id, bundle);
      if (work.stopped) throw new Error('Capture stopped');
      // Same whitelisted environment and pinned full Chromium as agent QA.
      work.browser = await launch({ channel: 'chromium', headless: true, timeout: limitMs,
        env: { PATH: '/usr/bin:/bin', HOME: temp, TMPDIR: temp, LANG: 'C.UTF-8' },
        args: ['--disable-background-networking', '--host-resolver-rules=MAP * ~NOTFOUND', '--disable-extensions', '--renderer-process-limit=2', '--js-flags=--max-old-space-size=128'] });
      if (work.stopped) throw new Error('Capture stopped');
      const context = await work.browser.newContext({ viewport: state.viewport, acceptDownloads: false, serviceWorkers: 'block' });
      context.setDefaultTimeout(5000); context.setDefaultNavigationTimeout(5000);
      const allowed = url => {
        try { const file = fileURLToPath(new URL(url)); return file.startsWith(`${bundle}${path.sep}`) && build.files.includes(path.relative(bundle, file)); } catch { return false; }
      };
      await context.route('**/*', route => allowed(route.request().url()) ? route.continue() : route.abort('blockedbyclient'));
      await context.routeWebSocket('**/*', ws => ws.close());
      const page = await context.newPage();
      page.on('dialog', dialog => dialog.dismiss());
      const entry = pathToFileURL(path.join(bundle, 'index.html'));
      entry.hash = state.slideId;
      await page.goto(entry.href);
      await page.evaluate(() => document.fonts.ready);
      // Programmatic clicks: no pointer, so no hover or focus styling the creator did not see.
      // Selecting a stage takes manual control, which holds timed reveals at that stage.
      if (state.stage !== null) await page.locator(`.slide:not([hidden]) [data-stage="${state.stage}"]`).dispatchEvent('click');
      if (state.gallery !== null) await page.locator(`.slide:not([hidden]) [data-gallery="${state.gallery}"]`).dispatchEvent('click');
      // An embedded video shows its opening frame (spec #29 Out of Scope: playing position).
      await page.evaluate(() => Promise.all([...document.querySelectorAll('video')].map(video => {
        video.pause(); video.currentTime = 0;
        return video.readyState >= 2 || video.error ? null : new Promise(resolve => {
          video.addEventListener('loadeddata', resolve, { once: true }); video.addEventListener('error', resolve, { once: true }); setTimeout(resolve, 2000);
        });
      })));
      const seen = await page.evaluate(inspectPage);
      const expected = [state.slideId, state.stage === null ? [] : [String(state.stage)], state.gallery === null ? [] : [String(state.gallery)]];
      if (JSON.stringify([seen.slideId, seen.stage, seen.gallery]) !== JSON.stringify(expected)) throw new Error('The deck did not reach the reported state');
      const png = await page.screenshot({ type: 'png', animations: 'disabled', timeout: 5000 });
      if (work.stopped) throw new Error('Capture stopped');
      return png;
    } finally {
      work.stopped = true;
      await work.browser?.close().catch(() => {});
      await rm(temp, { recursive: true, force: true });
    }
  }
  return {
    // One creator capture per app. A second request, or one that cannot finish within
    // the limit (for example because a browser cannot start), reports busy.
    async capture(job, state) {
      if (running) throw new StoreError(CAPTURE_BUSY, 503);
      running = true;
      const work = { stopped: false, browser: null };
      const rendering = render(job, state, work);
      rendering.catch(() => {}).finally(() => { running = false; });
      let timer;
      const expired = new Promise((_, reject) => {
        timer = setTimeout(() => { work.stopped = true; void work.browser?.close().catch(() => {}); reject(new StoreError(CAPTURE_BUSY, 503)); }, limitMs);
      });
      try { return await Promise.race([rendering, expired]); }
      catch (error) {
        if (error instanceof StoreError) throw error;
        throw new StoreError(`Slide capture failed: ${String(error.message).split('\n')[0].replaceAll(os.tmpdir(), '<tmp>')}`, 500);
      } finally { clearTimeout(timer); }
    },
  };
}

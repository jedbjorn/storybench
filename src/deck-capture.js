// Creator slide capture for Preview Markup. A previewed deck has an opaque origin, so
// the server renders the reported state from the exact pinned build instead. Each
// capture runs its own short-lived browser and temp copy: it never shares, counts
// against or waits on an agent's QA session (deck-qa.js).
// The slide editor's Markup (spec #46 'Redlines') captures its canvas the same way: the
// canvas build of the saved slide, framed as the editor frames it and held at the shown step.
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

// The editor's canvas frame is 1280 x 720, cropped to the slide area (public/deck-canvas.js).
export const CANVAS_VIEWPORT = Object.freeze({ width: 1280, height: 720 });
const CANVAS_HOST = 'storybench-capture-host.html', CANVAS_ORIGIN = 'http://canvas.storybench.invalid';

// The shown step is a claim too: null (the full reveal) or a step the saved slide has; scroll is clamped by the frame.
export function validateCanvasState(slide, body) {
  const count = slide.stages?.length ?? 0, stage = body?.stage ?? null;
  if (stage !== null && (!Number.isInteger(stage) || stage < 0 || stage >= count)) throw new StoreError(`Invalid step for slide ${slide.id}.`, 400);
  const scroll = body?.scroll ?? 0;
  if (typeof scroll !== 'number' || !Number.isFinite(scroll)) throw new StoreError('Scroll must be a number.', 400);
  return { slideId: slide.id, stage, scroll: Math.max(0, Math.min(100_000, Math.round(scroll))) };
}

export function createDeckCapture({ store, launch = options => chromium.launch(options), limitMs = CAPTURE_LIMIT_MS }) {
  let running = false;
  // One short-lived browser; `serve` routes the context to exactly the files it allows (everything else is
  // refused) and `shoot` drives the page to the state and returns its PNG.
  async function render({ viewport, serve, shoot }, work) {
    const temp = await mkdtemp(path.join(os.tmpdir(), 'storybench-capture-'));
    try {
      // Same whitelisted environment and pinned full Chromium as agent QA.
      work.browser = await launch({ channel: 'chromium', headless: true, timeout: limitMs,
        env: { PATH: '/usr/bin:/bin', HOME: temp, TMPDIR: temp, LANG: 'C.UTF-8' },
        args: ['--disable-background-networking', '--host-resolver-rules=MAP * ~NOTFOUND', '--disable-extensions', '--renderer-process-limit=2', '--js-flags=--max-old-space-size=128'] });
      if (work.stopped) throw new Error('Capture stopped');
      const context = await work.browser.newContext({ viewport, acceptDownloads: false, serviceWorkers: 'block' });
      context.setDefaultTimeout(5000); context.setDefaultNavigationTimeout(5000);
      await context.routeWebSocket('**/*', ws => ws.close());
      const entry = await serve(context, temp);
      if (work.stopped) throw new Error('Capture stopped');
      const page = await context.newPage();
      page.on('dialog', dialog => dialog.dismiss());
      const png = await shoot(page, entry);
      if (work.stopped) throw new Error('Capture stopped');
      return png;
    } finally {
      work.stopped = true;
      await work.browser?.close().catch(() => {});
      await rm(temp, { recursive: true, force: true });
    }
  }
  // An embedded video shows its opening frame (spec #29 Out of Scope: playing position).
  const openingFrames = target => target.evaluate(() => Promise.all([...document.querySelectorAll('video')].map(video => {
    video.pause(); video.currentTime = 0;
    return video.readyState >= 2 || video.error ? null : new Promise(resolve => {
      video.addEventListener('loadeddata', resolve, { once: true }); video.addEventListener('error', resolve, { once: true }); setTimeout(resolve, 2000);
    });
  })));
  // A pinned Preview build in the state its frame reported.
  const buildShot = (job, state) => ({
    viewport: state.viewport,
    async serve(context, temp) {
      const bundle = path.join(temp, 'bundle');
      const { files } = await extractBuild(store, job.episodeId, job.id, bundle);
      const allowed = url => {
        try { const file = fileURLToPath(new URL(url)); return file.startsWith(`${bundle}${path.sep}`) && files.includes(path.relative(bundle, file)); } catch { return false; }
      };
      await context.route('**/*', route => allowed(route.request().url()) ? route.continue() : route.abort('blockedbyclient'));
      return pathToFileURL(path.join(bundle, 'index.html'));
    },
    async shoot(page, entry) {
      entry.hash = state.slideId;
      await page.goto(entry.href);
      await page.evaluate(() => document.fonts.ready);
      // Programmatic clicks: no pointer, so no hover or focus styling the creator did not see.
      // Selecting a stage takes manual control, which holds timed reveals at that stage.
      if (state.stage !== null) await page.locator(`.slide:not([hidden]) [data-stage="${state.stage}"]`).dispatchEvent('click');
      if (state.gallery !== null) await page.locator(`.slide:not([hidden]) [data-gallery="${state.gallery}"]`).dispatchEvent('click');
      await openingFrames(page);
      const seen = await page.evaluate(inspectPage);
      const expected = [state.slideId, state.stage === null ? [] : [String(state.stage)], state.gallery === null ? [] : [String(state.gallery)]];
      if (JSON.stringify([seen.slideId, seen.stage, seen.gallery]) !== JSON.stringify(expected)) throw new Error('The deck did not reach the reported state');
      return page.screenshot({ type: 'png', animations: 'disabled', timeout: 5000 });
    },
  });
  // The editor's canvas: the saved slide's canvas build, served from memory with the headers the app serves
  // it with (`headers`: its sandbox and content policy), in a frame of the editor's size, so its own bridge
  // holds the shown step and scroll. Cropped to the slide area the bridge reports.
  const canvasShot = (files, state, headers) => ({
    viewport: CANVAS_VIEWPORT,
    async serve(context) {
      const query = new URLSearchParams({ ...(state.stage === null ? {} : { stage: state.stage }), scroll: state.scroll });
      const host = `<!doctype html><html><body style="margin:0"><script>
        addEventListener('message', event => { if (event.data?.type === 'storybench-canvas') window.canvasState = event.data; });
      </script><iframe src="index.html?${query}" style="position:fixed;left:0;top:0;width:${CANVAS_VIEWPORT.width}px;height:${CANVAS_VIEWPORT.height}px;border:0"></iframe></body></html>`;
      await context.route('**/*', route => {
        const url = new URL(route.request().url());
        const name = url.origin === CANVAS_ORIGIN ? decodeURIComponent(url.pathname.slice(1)) : null;
        if (name === CANVAS_HOST) return route.fulfill({ status: 200, contentType: 'text/html', body: host });
        if (name && files.has(name)) return route.fulfill({ status: 200, headers: headers(name), body: Buffer.from(files.get(name)) });
        return route.abort('blockedbyclient');
      });
      return `${CANVAS_ORIGIN}/${CANVAS_HOST}`;
    },
    async shoot(page, entry) {
      await page.goto(entry);
      const frame = page.frames().find(candidate => candidate !== page.mainFrame());
      if (!frame) throw new Error('The canvas frame did not load');
      await frame.evaluate(() => document.fonts.ready);
      await openingFrames(frame);
      // The bridge reports each time it settles; take the slide once it says it is at the shown step.
      const shown = await page.waitForFunction(({ slideId, stage }) => {
        const value = window.canvasState;
        return value?.slideId === slideId && value.stage === stage && !value.playing ? value : null;
      }, { slideId: state.slideId, stage: state.stage }, { timeout: 5000 }).then(handle => handle.jsonValue())
        .catch(() => { throw new Error('The canvas did not reach the shown step'); });
      const { left, top, width, height } = shown.area;
      const clip = { x: Math.max(0, left), y: Math.max(0, top), width: Math.min(width, CANVAS_VIEWPORT.width - Math.max(0, left)), height: Math.min(height, CANVAS_VIEWPORT.height - Math.max(0, top)) };
      return page.screenshot({ type: 'png', animations: 'disabled', clip, timeout: 5000 });
    },
  });
  return {
    // One creator capture per app. A second request, or one that cannot finish within
    // the limit (for example because a browser cannot start), reports busy.
    capture: (job, state) => run(buildShot(job, state)),
    // `files` is the canvas build of the saved slide (deck-service canvasFiles); `state` from validateCanvasState.
    // `headers(name)` are the response headers the app serves each canvas file with.
    captureCanvas: (files, state, headers) => run(canvasShot(files, state, headers)),
  };
  async function run(shot) {
    if (running) throw new StoreError(CAPTURE_BUSY, 503);
    running = true;
    const work = { stopped: false, browser: null };
    const rendering = render(shot, work);
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
  }
}

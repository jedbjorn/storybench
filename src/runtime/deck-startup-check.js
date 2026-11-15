// Small real renderer/browser check at startup; the release receipt holds the larger
// registration, ZIP, media and multi-harness proof. This child sees no app credentials.
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { buildDeck } from '../deck-template/build.js';
import { parseSvg } from '../svg.js';
import { renderSvg } from '../svg-render.js';
import { BROWSER_IDENTITY } from '../deck-qa.js';

export async function checkDeckStartup() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sb-deck-startup-'));
  let browser;
  const result = { vector: { state: 'unavailable', reason: 'Parser/renderer/template/font check failed; run doctor.' },
    browser: { state: 'unavailable', reason: 'Packaged browser launch/render/screenshot failed; run doctor.' } };
  try {
    const svg = await readFile(new URL('./fixtures/svg-illustration.svg', import.meta.url));
    parseSvg(svg);
    const png = await renderSvg(svg);
    if (png.length < 1000) return result;
    const files = buildDeck({ title: 'Readiness', slides: [{ id: 'ready', title: 'Ready', layout: 'full-media', media: { type: 'image', src: 'assets/proof.svg', alt: 'Synthetic readiness diagram' } }] }, { assets: { 'assets/proof.svg': svg } });
    for (const [name, bytes] of files) { await mkdir(path.dirname(path.join(root, name)), { recursive: true }); await writeFile(path.join(root, name), bytes); }
    result.vector = { state: 'ready', reason: 'Parsed SVG, native raster, template and bundled fonts loaded.' };
    browser = await chromium.launch({ channel: 'chromium', headless: true, timeout: 8000,
      env: { PATH: '/usr/bin:/bin', HOME: root, TMPDIR: root, LANG: 'C.UTF-8' },
      args: ['--disable-background-networking', '--host-resolver-rules=MAP * ~NOTFOUND', '--disable-extensions', '--renderer-process-limit=2'] });
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, serviceWorkers: 'block' });
    context.setDefaultTimeout(5000);
    await context.route('**/*', route => route.request().url().startsWith(pathToFileURL(root + path.sep).href) ? route.continue() : route.abort());
    const page = await context.newPage(), errors = [];
    page.on('pageerror', () => errors.push(true));
    await page.goto(pathToFileURL(path.join(root, 'index.html')).href, { timeout: 5000 });
    await page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.fonts].map(font => font.load())); });
    const loaded = await page.evaluate(() => [...document.fonts].length > 0 && [...document.fonts].every(f => f.status === 'loaded') && Boolean(document.querySelector('svg path')));
    const screenshot = await page.screenshot({ timeout: 5000 });
    if (!loaded || errors.length || screenshot.length < 5000 || screenshot.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') return result;
    result.browser = { state: 'ready', reason: 'Actual local-file render, fonts and PNG screenshot passed.',
      controller: BROWSER_IDENTITY.controller, revision: BROWSER_IDENTITY.revision, actualVersion: browser.version() };
    return result;
  } catch { return result; }
  finally { await browser?.close(); await rm(root, { recursive: true, force: true }); }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await checkDeckStartup(); console.log(JSON.stringify(result));
  if (process.argv.includes('--require-ready') && (result.vector.state !== 'ready' || result.browser.state !== 'ready')) process.exitCode = 1;
}

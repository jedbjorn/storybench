// Spec #46 task #125, E8 data and build half in the browser (Chromium and Firefox, app on loopback, saves and
// builds through the HTTP API): a deck saved before candidates existed loads on the Slides canvas, builds and
// renders in Preview identically once candidates are added beside its picks; starring a candidate switches
// the canvas and the next build's slide. STORYBENCH_EVIDENCE_DIR saves screenshots.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { chromium, firefox } from 'playwright-core';
import { createApp } from '../src/server.js';
import { listenInRange } from '../test-support/loopback-port.js';

const exec = promisify(execFile);
async function launch(type) {
  let browser = await type.launch().catch(() => null);
  if (!browser && type === chromium && existsSync('/usr/bin/chromium')) browser = await chromium.launch({ executablePath: '/usr/bin/chromium' }).catch(() => null);
  return browser;
}
const evidence = async (name, bytes) => {
  if (!process.env.STORYBENCH_EVIDENCE_DIR) return;
  await mkdir(process.env.STORYBENCH_EVIDENCE_DIR, { recursive: true });
  await writeFile(path.join(process.env.STORYBENCH_EVIDENCE_DIR, name), bytes);
};

for (const type of [chromium, firefox]) test(`E8 ${type.name()}: a pre-change deck loads, builds and previews identically beside candidates; starring switches the canvas and the next build`, { timeout: 180000 }, async t => {
  const browser = await launch(type);
  if (!browser) return t.skip(`No launchable ${type.name()} on this seat`);
  t.after(() => browser.close());
  const workspace = await mkdtemp(path.join(tmpdir(), 'sb-candidates-browser-'));
  const app = await createApp({ workspace });
  t.after(async () => { await app.close(); await rm(workspace, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${await listenInRange(app.server)}`;
  const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } }); page.setDefaultTimeout(15000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const api = async (method, url, body, headers = {}) => {
    const response = await page.request.fetch(`${base}${url}`, { method, data: body, headers });
    assert.ok(response.ok(), `${method} ${url}: ${response.status()} ${await response.text()}`);
    return response.json();
  };

  // Fixture through the HTTP API: a deck production and three registered images.
  const episode = await api('POST', '/api/episodes', { kind: 'deck', title: 'Candidates' });
  const scope = `?channel=${episode.channelId}`;
  const images = {};
  for (const [name, color] of [['red', 'red'], ['blue', 'blue'], ['green', 'green']]) {
    const file = path.join(workspace, `${name}.png`);
    await exec('ffmpeg', ['-v', 'error', '-nostdin', '-f', 'lavfi', '-i', `color=c=${color}:s=320x240:d=1`, '-frames:v', '1', file]);
    images[name] = await api('POST', `/api/episodes/${episode.id}/library/files${scope}`, await readFile(file),
      { 'content-type': 'image/png', 'x-file-name': `${name}.png`, 'x-library-label': name, 'x-library-category': 'Graphics' });
  }
  const { red, blue, green } = images;
  const src = item => `assets/media_${item.assetId.replace(/[^a-zA-Z0-9_-]/g, '_')}.png`;
  const hero = { id: 'hero', title: 'The floor plan', layout: 'text-media', body: 'Where the light falls.', media: { itemId: red.id, alt: 'Red plan' } };
  const gallery = { id: 'views', title: 'Three views', layout: 'full-media', subnav: [{ id: 'g1', label: 'Green', itemId: green.id }, { id: 'g2', label: 'Red', itemId: red.id }] };
  // Saved as this deck's slides were stored before candidates existed (the validated shape of that code).
  const legacy = [hero, gallery].map(slide => ({ body: '', notes: '', eyebrow: '', caption: '', targetMinutes: 0, sectionId: null,
    referenceItemIds: [], stages: [], subnav: [], columns: [], media: null, ...slide }));
  app.store.db.prepare('UPDATE episodes SET cards=?,revision=revision+1 WHERE id=?').run(JSON.stringify(legacy), episode.id);
  const deck = () => api('GET', `/api/episodes/${episode.id}/slides${scope}`);
  const save = async slides => api('PUT', `/api/episodes/${episode.id}/slides${scope}`, { expectedRevision: (await deck()).revision, slides });
  const build = async () => {
    const job = await api('POST', `/api/episodes/${episode.id}/deck-build${scope}`, { expectedRevision: (await deck()).revision });
    for (let i = 0; i < 400; i++) {
      const response = await page.request.get(`${base}/api/jobs/${job.id}/deck/index.html${scope}`);
      if (response.ok()) return { id: job.id, html: await response.text() };
      await page.waitForTimeout(25);
    }
    throw new Error('deck build did not finish');
  };
  // Preview of a build at one slide, full reveal: the deck frame's slide area as pixels.
  const preview = async (jobId, slideId) => {
    await page.goto(`${base}/preview/deck/${jobId}${scope}`);
    const frame = await (await page.waitForSelector('#viewer iframe')).contentFrame();
    await frame.waitForFunction(() => window.storybenchDeck?.timeline());
    await frame.evaluate(id => { location.hash = id; }, slideId);
    await frame.waitForFunction(id => window.storybenchDeck.timeline().slideId === id, slideId);
    await frame.evaluate(() => document.fonts.ready.then(() => Promise.all([...document.images].map(image => image.decode().catch(() => {})))));
    await frame.evaluate(() => window.storybenchDeck.seek(window.storybenchDeck.timeline().durationMs));
    await page.mouse.move(1, 1); await page.waitForTimeout(300);
    const shown = await frame.evaluate(id => [...document.getElementById(id).querySelectorAll('img')].map(image => image.getAttribute('src')), slideId);
    return { shot: await page.locator('#viewer iframe').screenshot(), shown, html: await frame.content() };
  };
  // The canvas is in the slide editor (spec #46 task #126): open the first slide's card, then the editor.
  const openCanvas = async () => {
    await page.locator('#deckSlides [data-slide-index="0"] .slide-card-summary').click();
    await page.locator('#deckSlides [data-slide-edit]').click();
    await page.waitForSelector('.deck-canvas-block');
  };
  const canvasShows = async (slideId, expected) => {
    for (let i = 0; i < 200; i++) {
      const frame = page.frames().find(item => item.url().includes('/deck-canvas/') && item.url().includes(`/${slideId}/`) && !item.isDetached());
      const sources = frame ? await frame.evaluate(() => [...document.images].map(image => image.getAttribute('src'))).catch(() => []) : [];
      if (expected.every(value => sources.includes(value)) && sources.length === expected.length) return sources;
      await page.waitForTimeout(50);
    }
    throw new Error(`the canvas for ${slideId} never showed ${expected}`);
  };

  // The pre-change deck loads: the Slides canvas shows its pick.
  await page.goto(`${base}/${scope}&episode=${episode.id}`);
  await openCanvas();
  await canvasShows('hero', [src(red)]);
  await evidence(`e8-${type.name()}-1-canvas-legacy.png`, await page.screenshot());
  const before = await build();
  const beforeHero = await preview(before.id, 'hero'), beforeViews = await preview(before.id, 'views');
  await evidence(`e8-${type.name()}-2-preview-legacy-hero.png`, beforeHero.shot);

  // Candidates added beside the picks (the creator's route); picks unchanged, so nothing the build reads changes.
  const current = (await deck()).slides;
  await save([{ ...current[0], candidates: [{ itemId: blue.id, alt: 'Blue plan' }, { itemId: green.id, alt: 'Green plan' }] },
    { ...current[1], candidates: [{ itemId: blue.id, alt: 'Blue view', label: 'Blue' }] }]);
  const saved = await deck();
  assert.deepEqual(saved.slides[0].candidates.map(c => c.itemId), [blue.id, green.id]);
  assert.equal(saved.slides[0].pickSetBy, undefined, 'adding candidates is not a pick change');
  const alongside = await build();
  assert.equal(alongside.html, before.html, 'the built slides are byte-identical');
  const afterHero = await preview(alongside.id, 'hero'), afterViews = await preview(alongside.id, 'views');
  assert.ok(afterHero.shot.equals(beforeHero.shot), 'Preview renders the hero slide identically');
  assert.ok(afterViews.shot.equals(beforeViews.shot), 'Preview renders the gallery slide identically');
  assert.deepEqual(afterHero.shown, [src(red)]);
  assert.ok(!afterViews.shown.includes(src(blue)) && afterViews.shown.includes(src(green)), 'the gallery shows only its starred views');
  await evidence(`e8-${type.name()}-3-preview-with-candidates-hero.png`, afterHero.shot);

  // Star blue on the hero slide: red moves to the candidates; the canvas and the next build switch.
  await save([{ ...saved.slides[0], media: { itemId: blue.id, alt: 'Blue plan' }, candidates: [{ itemId: red.id, alt: 'Red plan' }, { itemId: green.id, alt: 'Green plan' }] }, saved.slides[1]]);
  const starred = await deck();
  assert.equal(starred.slides[0].pickSetBy, 'creator', 'the pick change records the creator');
  // Removing the starred candidate is refused by the server.
  const refused = await page.request.put(`${base}/api/episodes/${episode.id}/slides${scope}`, { data: { expectedRevision: starred.revision, slides: [{ ...starred.slides[0], media: null, candidates: [{ itemId: red.id }] }, starred.slides[1]] } });
  assert.equal(refused.status(), 400);
  assert.match((await refused.json()).error, new RegExp(`${blue.id} is starred on this slide and cannot be removed`));
  await page.goto(`${base}/${scope}&episode=${episode.id}`);
  await openCanvas();
  await canvasShows('hero', [src(blue)]);
  await evidence(`e8-${type.name()}-4-canvas-starred.png`, await page.screenshot());
  const next = await build();
  const heroMarkup = html => html.slice(html.indexOf('id="hero"'), html.indexOf('id="views"'));
  assert.ok(heroMarkup(next.html).includes(src(blue)) && !heroMarkup(next.html).includes(src(red)), 'the next build\'s slide shows the star');
  const nextHero = await preview(next.id, 'hero');
  assert.deepEqual(nextHero.shown, [src(blue)], 'Preview shows the new pick');
  assert.ok(!nextHero.shot.equals(beforeHero.shot));
  await evidence(`e8-${type.name()}-5-preview-starred-hero.png`, nextHero.shot);
  assert.deepEqual(errors, []);
});

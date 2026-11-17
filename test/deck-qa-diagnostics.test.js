import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import { Store } from '../src/store.js';
import { HeavyJobQueue } from '../src/job-runner.js';
import { createDeckService, zipBundle } from '../src/deck-service.js';
import { createDeckQa } from '../src/deck-qa.js';
import { unpackDeckZip } from '../src/deck-qa-bundle.js';

async function fixture(t, slides, fonts = []) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sb-qa-diagnostics-'));
  const store = new Store(root), queue = new HeavyJobQueue();
  const decks = createDeckService({ store, queue });
  const sessions = [];
  t.after(async () => {
    await Promise.all(sessions.map(qa => qa.close()));
    await decks.close(); store.close();
    await rm(root, { recursive: true, force: true });
  });
  const episode = store.createEpisode({ kind: 'deck', title: 'QA diagnostic regression' });
  store.ensureEpisodeDirectories(episode.id);
  store.saveBrandStandards(episode.channelId, 1, { colors: [], fonts, stylePrompt: '' });
  const saved = store.saveDeck(episode.id, 1, slides);
  const pending = decks.enqueue({ episodeId: episode.id, expectedRevision: saved.revision });
  await queue.draining;
  let job = decks.getJob(episode.id, pending.id);
  assert.equal(job.state, 'completed', job.error);
  return {
    entry: pathToFileURL(path.join(path.dirname(path.join(root, job.outputPath)), 'index.html')).href,
    // Fault injection models an old exporter or a damaged bundled font. Rebind
    // the test build digest so QA reaches the behavior under test.
    async changeBundle(change) {
      const file = path.join(root, job.outputPath), files = unpackDeckZip(await readFile(file));
      change(files);
      const bytes = zipBundle(files);
      await writeFile(file, bytes);
      job = { ...job, snapshot: { ...job.snapshot, bundleSha256: createHash('sha256').update(bytes).digest('hex') } };
    },
    async open(viewport = { width: 1280, height: 720 }) {
      const bound = Object.create(store); bound.getJob = () => job;
      const qa = createDeckQa({ store: bound, scope: { episodeId: episode.id, requestId: 'diagnostics' } });
      sessions.push(qa);
      const call = async (name, args) => JSON.parse((await qa.call(name, args)).text);
      const opened = await call('open_deck_qa', { jobId: job.id, viewport });
      return { ...opened, close: () => qa.close(), call: (name, args = {}) => call(name, { sessionId: opened.sessionId, ...args }) };
    },
  };
}

test('print contact sheets select hidden controls and retain the requested image/state identity', { timeout: 15000 }, async t => {
  const f = await fixture(t, [
    { id: 'first', title: 'First slide', layout: 'statement' },
    { id: 'second', title: 'A distinct second slide', layout: 'section' },
  ]);
  const qa = await f.open();
  await qa.call('act_deck_qa', { action: 'emulate', media: 'print' });
  const sheet = await qa.call('inspect_deck_qa', { slideIds: ['second', 'first'] });
  assert.ok(sheet.contactSheet);
  assert.deepEqual(sheet.screenshots.map(s => s.state.slideId), ['second', 'first']);
  assert.ok(sheet.screenshots.every(s => s.state.emulation.media === 'print'));
  assert.notEqual(sheet.screenshots[0].sha256, sheet.screenshots[1].sha256);
  const single = await qa.call('inspect_deck_qa');
  assert.equal(single.screenshots[0].state.slideId, 'first');
  await qa.call('act_deck_qa', { action: 'emulate', media: 'screen' });
  const screen = await qa.call('inspect_deck_qa', { slideIds: ['first', 'second'] });
  assert.deepEqual(screen.screenshots.map(s => s.state.slideId), ['first', 'second']);
  await assert.rejects(qa.call('inspect_deck_qa', { slideIds: ['missing'] }), /not found/);
});

test('font integrity loads valid unused faces and reports corrupt faces with weight/style', { timeout: 15000 }, async t => {
  const f = await fixture(t, [{ id: 'first', title: 'A normal title', body: 'Regular body text', layout: 'statement' }], ['Alegreya Sans', null, 'DejaVu Sans Mono']);
  const qa = await f.open();
  assert.ok(qa.state.fonts.some(face => face.status === 'unloaded'), 'fixture includes a lazy face');
  const checked = await qa.call('check_deck_qa', { checks: ['fonts', 'resources', 'console'] });
  for (const result of Object.values(checked.results)) assert.equal(result.status, 'pass', JSON.stringify(result));
  assert.ok(checked.results.fonts.details.every(face => face.status === 'loaded' && face.weight && face.style));
  await qa.close();
  await f.changeBundle(files => files.set('assets/font-dejavu-mono-regular.ttf', Buffer.from('invalid font bytes')));
  const broken = await f.open();
  const failed = await broken.call('check_deck_qa', { checks: ['fonts'] });
  assert.equal(failed.results.fonts.status, 'fail');
  assert.ok(failed.results.fonts.details.some(face => face.family === 'DejaVu Sans Mono' && face.weight === '400' && face.style === 'normal' && face.status === 'error'));
});

test('layout accepts reachable rail content and detects inaccessible clipping and horizontal overflow', { timeout: 15000 }, async t => {
  const f = await fixture(t, Array.from({ length: 16 }, (_, i) => ({
    id: `slide${i}`, title: `Slide ${i + 1}: A sufficiently long navigation title that wraps`, body: 'A regular body.', layout: 'statement',
  })));
  const qa = await f.open();
  const checked = await qa.call('check_deck_qa', { checks: ['layout'] });
  assert.equal(checked.results.layout.status, 'pass', JSON.stringify(checked.results.layout));
  await qa.call('act_deck_qa', { action: 'click', selector: '[data-go="15"]' });
  assert.equal((await qa.call('inspect_deck_qa')).screenshots[0].state.slideId, 'slide15');
  await qa.close();
  await f.changeBundle(files => files.set('styles.css', `${files.get('styles.css')}\n.rail{overflow:hidden}.lede{width:2000px;max-width:none}`));
  const broken = await f.open();
  const failed = await broken.call('check_deck_qa', { checks: ['layout'] });
  assert.equal(failed.results.layout.status, 'fail');
  assert.ok(failed.results.layout.details.some(e => e.tag === 'button' && e.clipped));
  assert.ok(failed.results.layout.details.some(e => e.text === 'A regular body.' && e.outsideViewport));
});

test('desktop footer reserves space, long captions remain reachable and legacy overlap fails QA', { timeout: 15000 }, async t => {
  const f = await fixture(t, [
    { id: 'closing', title: 'A closing title that wraps over two lines', layout: 'statement', body: Array(10).fill('A short body line.').join('\n'), caption: 'A caption that should remain readable' },
    { id: 'next', title: 'Next slide', layout: 'statement' },
  ]);
  const browser = await chromium.launch({ channel: 'chromium' });
  t.after(() => browser.close());
  const page = await browser.newPage();
  for (const width of [1280, 960]) {
    await page.setViewportSize({ width, height: 720 });
    await page.goto(f.entry);
    await page.evaluate(() => document.fonts.ready);
    const geometry = await page.evaluate(() => {
      const main = document.querySelector('#presentation'), footer = document.querySelector('footer');
      main.scrollTop = main.scrollHeight;
      const caption = document.querySelector('.caption').getBoundingClientRect();
      return { mainBottom: main.getBoundingClientRect().bottom, footerTop: footer.getBoundingClientRect().top, captionBottom: caption.bottom,
        hit: document.elementFromPoint(caption.x + 10, caption.bottom - 2)?.className };
    });
    assert.ok(geometry.mainBottom <= geometry.footerTop, JSON.stringify(geometry));
    assert.ok(geometry.captionBottom <= geometry.footerTop, JSON.stringify(geometry));
    assert.equal(geometry.hit, 'caption');
    await page.locator('[data-command="next"]').click();
    assert.equal(await page.locator('#presentation').evaluate(e => e.scrollTop), 0, 'new slides start at the top');
  }
  // Legacy builds can still contain a fixed footer. Diagnose its actual overlap.
  await f.changeBundle(files => files.set('styles.css', `${files.get('styles.css')}\nbody:has(#presentation){display:block;height:auto}#presentation{overflow:visible;min-height:calc(100svh - var(--footer))}footer{position:fixed}`));
  const old = await f.open();
  const checked = await old.call('check_deck_qa', { checks: ['layout'] });
  assert.equal(checked.results.layout.status, 'fail');
  assert.ok(checked.results.layout.details.some(e => e.text === 'A caption that should remain readable' && e.occluded));
});

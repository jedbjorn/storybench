import test from 'node:test';
import { assertSameSlidePixels } from '../test-support/deck-pixels.js';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, firefox } from 'playwright-core';
import { buildDeck } from '../src/deck-template/build.js';
import { exampleDeck, exampleAssets } from '../src/deck-template/example.js';
import { demoSlides } from '../src/deck-demo.js';
import { motionDeck, motionAssets } from '../test-support/motion-deck.js';

// Spec #34 B2-B9. Runtime behaviour is proven by setting the timeline to exact times, so results
// do not depend on machine speed; only the B3 real-time run measures the clock.
async function launch(t, browserType) {
  let browser = await browserType.launch().catch(() => null);
  if (!browser && browserType === chromium && existsSync('/usr/bin/chromium')) browser = await chromium.launch({ executablePath: '/usr/bin/chromium' }).catch(() => null);
  if (!browser) { t.skip(`No launchable ${browserType.name()} on this seat`); return null; }
  t.after(() => browser.close());
  return browser;
}
async function open(t, browser, deck, assets, { slide = deck.slides[0].id, context = {} } = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'sb-motion-browser-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  for (const [name, bytes] of buildDeck(deck, { assets })) { await mkdir(path.dirname(path.join(dir, name)), { recursive: true }); await writeFile(path.join(dir, name), bytes); }
  const pages = await browser.newContext({ viewport: { width: 1280, height: 900 }, ...context });
  t.after(() => pages.close());
  const page = await pages.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${pathToFileURL(path.join(dir, 'index.html'))}#${slide}`);
  await page.waitForFunction(() => window.storybenchDeck);
  return { page, pages, errors, dir };
}
const timeline = page => page.evaluate(() => window.storybenchDeck.timeline());
const seek = (page, timeMs) => page.evaluate(ms => window.storybenchDeck.seek(ms), timeMs);
// What a viewer sees of one group: where it is, and the runtime's state for it.
const group = (page, id) => page.evaluate(name => {
  const el = document.querySelector(`.slide:not([hidden]) [data-vector-group="${name}"]`), box = el.getBoundingClientRect(), style = getComputedStyle(el);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, width: box.width, opacity: Number(style.opacity), visible: style.visibility === 'visible',
    pending: el.dataset.pending, transform: el.style.transform.replace('translate(360px)', 'translate(360px, 0px)'), inline: el.style.opacity };
}, id);
// The runtime's inline overrides on a shape; empty once it is back to the authored artwork.
const inline = (page, selector) => page.evaluate(name => document.querySelector(name).style.cssText, selector);
const art = page => page.locator('.slide:not([hidden]) .vector-media svg').screenshot();
const markup = page => page.evaluate(() => document.getElementById('presentation').innerHTML);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const still = async (page, ms = 350) => { const before = await markup(page); await pause(ms); assert.equal(await markup(page), before, 'nothing is still running'); };

// A drawn track, a dot that enters, travels along the track, then grows and recedes.
const moving = () => [
  { id: 'draw', title: 'Draw', svgGroupIds: ['track'], motion: 'draw', trigger: 'auto', afterMs: 300, durationMs: 1000, holdMs: 200, easing: 'linear' },
  { id: 'arrive', title: 'Arrive', svgGroupIds: ['dot'], motion: 'enter', from: { y: -40, opacity: 0 }, trigger: 'auto', afterMs: 0, durationMs: 400 },
  { id: 'travel', title: 'Travel', changes: [{ groupId: 'dot', to: { x: 360 } }], trigger: 'auto', afterMs: 0, durationMs: 2000, easing: 'linear' },
  { id: 'settle', title: 'Settle', changes: [{ groupId: 'dot', to: { scale: 2, opacity: 0.5 } }], trigger: 'auto', afterMs: 500, durationMs: 1000, holdMs: 250, easing: 'ease-in-out' },
];
const plan = [
  { id: 'draw', trigger: 'auto', startMs: 300, motionEndMs: 1300, holdEndMs: 1500 },
  { id: 'arrive', trigger: 'auto', startMs: 1500, motionEndMs: 1900, holdEndMs: 1900 },
  { id: 'travel', trigger: 'auto', startMs: 1900, motionEndMs: 3900, holdEndMs: 3900 },
  { id: 'settle', trigger: 'auto', startMs: 4400, motionEndMs: 5400, holdEndMs: 5650 },
];
const settled = 'translate(360px, 0px) rotate(0deg) scale(2)';

test('B2: older decks keep every stage start and their end-state appearance', { timeout: 60000 }, async t => {
  const browser = await launch(t, chromium); if (!browser) return;
  // The existing demo deck's staged diagram, mapped to builder input as a deck build does.
  const source = await readFile(new URL('../src/runtime/fixtures/svg-illustration.svg', import.meta.url));
  const process = demoSlides('image', 'video', 'vector').find(slide => slide.id === 'process');
  const demo = { title: 'Demo', slides: [{ ...process, vector: { type: 'image', src: 'assets/plan.svg', alt: process.vector.alt } }] };
  const { page, errors } = await open(t, browser, demo, { 'assets/plan.svg': source });
  assert.doesNotMatch(await markup(page), /data-motion/, 'a deck without the new fields builds without them');
  // Before this change: stage one is there at once; each later delay counts from the previous reveal.
  let state = await timeline(page);
  assert.deepEqual(state.stages.map(stage => [stage.id, stage.trigger, stage.startMs]), [['notice', 'manual', 0], ['frame', 'auto', 1800], ['try', 'auto', 3600], ['learn', 'auto', 5400]]);
  assert.equal(state.state, 'playing'); assert.equal(state.stage, 0);
  assert.equal((await seek(page, 1799)).stage, 0); assert.equal((await seek(page, 1800)).stage, 1);
  // End state: every group as authored, nothing left on it by the runtime.
  state = await seek(page, state.durationMs);
  assert.equal(state.stage, 3);
  for (const id of ['landscape', 'observe', 'connect', 'plan']) assert.deepEqual(await group(page, id).then(({ opacity, visible, pending, transform, inline }) => ({ opacity, visible, pending, transform, inline })), { opacity: 1, visible: true, pending: 'false', transform: '', inline: '' });
  const end = await art(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.deepEqual(await art(page), end, 'the end state is the complete artwork');
  // The template example's text stages: the first is delayed only when it asks to be.
  const example = await open(t, browser, structuredClone(exampleDeck), exampleAssets, { slide: 'steps' });
  state = await timeline(example.page);
  assert.deepEqual(state.stages.map(stage => [stage.trigger, stage.startMs]), [['manual', 0], ['auto', 1800], ['auto', 3600]]);
  await seek(example.page, state.durationMs);
  assert.deepEqual(await example.page.evaluate(() => [...document.querySelectorAll('#steps [data-step]')].map(el => [el.dataset.pending, getComputedStyle(el).opacity, getComputedStyle(el).transform, el.getAttribute('style') || ''])),
    Array(3).fill(['false', '1', 'none', '']));
  assert.deepEqual([...errors, ...example.errors], []);
});

test('B3: delay, duration and hold are distinct and honoured, computed and in real time', { timeout: 60000 }, async t => {
  const browser = await launch(t, chromium); if (!browser) return;
  const { page, errors } = await open(t, browser, motionDeck(moving()), motionAssets);
  const state = await timeline(page);
  assert.deepEqual(state.stages, plan); assert.equal(state.durationMs, 5650);
  // Real time: when each stage's geometry is first revealed after Replay.
  const observed = await page.evaluate(() => new Promise(resolve => {
    const stages = [...document.querySelectorAll('#moving .stages [data-step]')], seen = [];
    const zero = Date.now(); window.storybenchDeck.replay();
    new MutationObserver((_records, observer) => {
      stages.forEach((el, i) => { if (el.dataset.pending === 'false') seen[i] ??= Date.now() - zero; });
      if (stages.every((_el, i) => seen[i] !== undefined)) { observer.disconnect(); resolve(seen); }
    }).observe(document.querySelector('#moving .stages'), { attributes: true, subtree: true, attributeFilter: ['data-pending'] });
  }));
  observed.forEach((at, i) => assert.ok(Math.abs(at - plan[i].startMs) <= 150, `stage ${plan[i].id} began at ${at} ms, saved start ${plan[i].startMs} ms`));
  await page.waitForFunction(() => window.storybenchDeck.timeline().state === 'complete');
  assert.equal((await timeline(page)).timeMs, 5650);
  assert.deepEqual(errors, []);
});

test('B4: easing and state changes interpolate from the state the previous stage left', { timeout: 60000 }, async t => {
  const browser = await launch(t, chromium); if (!browser) return;
  const { page, errors } = await open(t, browser, motionDeck(moving()), motionAssets);
  await seek(page, 1900); const from = await group(page, 'dot');
  await seek(page, 3900); const to = await group(page, 'dot');
  await seek(page, 2900); const half = await group(page, 'dot');
  assert.ok(to.x - from.x > 300, 'the dot travels along the track');
  assert.ok(Math.abs(half.x - (from.x + to.x) / 2) <= 1, `linear move is at its midpoint at half time: ${half.x} between ${from.x} and ${to.x}`);
  assert.ok(Math.abs(half.y - from.y) <= 1);
  // ease-in-out is behind linear at quarter time and level with it at half time.
  const grown = async at => (await seek(page, at), (await group(page, 'dot')).width / to.width);
  const quarter = await grown(4650);
  assert.ok(quarter > 1.02 && quarter < 1.2, `ease-in-out at quarter time grew to ${quarter}; linear would be 1.25`);
  assert.ok(Math.abs(await grown(4900) - 1.5) < 0.02);
  // The end state equals `to`, on top of the earlier change.
  await seek(page, 5400);
  const end = await group(page, 'dot');
  assert.equal(end.transform, settled); assert.equal(end.inline, '0.5'); assert.equal(end.opacity, 0.5);
  assert.ok(Math.abs(end.x - to.x) <= 1 && Math.abs(end.width / to.width - 2) < 0.02);
  assert.deepEqual(errors, []);
});

test('B5: draw starts with no stroke, is partial at half time and ends at the authored artwork', { timeout: 60000 }, async t => {
  const browser = await launch(t, chromium); if (!browser) return;
  const drawn = [{ id: 'track', title: 'Track', svgGroupIds: ['track'], motion: 'draw', trigger: 'auto', afterMs: 0, durationMs: 1000, easing: 'linear' },
    { id: 'frame', title: 'Frame', svgGroupIds: ['frame'], motion: 'draw', trigger: 'auto', afterMs: 0, durationMs: 1000, easing: 'linear' }];
  const { page, errors } = await open(t, browser, motionDeck(drawn), motionAssets);
  const plain = await open(t, browser, motionDeck(drawn.map(({ id, title, svgGroupIds }) => ({ id, title, svgGroupIds }))), motionAssets);
  const stroke = selector => page.evaluate(name => { const el = document.querySelector(name), style = getComputedStyle(el); return { length: el.getTotalLength(), offset: parseFloat(style.strokeDashoffset), fill: Number(style.fillOpacity), style: el.style.cssText }; }, selector);
  // Nothing of either group at the start.
  await plain.page.click('footer [data-command="replay"]'); await seek(plain.page, 0);
  await seek(page, 0);
  const start = await art(page);
  assert.equal((await group(page, 'track')).opacity, 0);
  // Half time: half the track's length, and the frame not begun.
  await seek(page, 500);
  let track = await stroke('#moving [data-vector-group="track"] path');
  assert.ok(Math.abs(track.offset - track.length / 2) < 0.5, `half the stroke is drawn: offset ${track.offset} of ${track.length}`);
  const half = await art(page);
  assert.notDeepEqual(half, start);
  // The frame's fill arrives as its stroke completes.
  await seek(page, 1500);
  assert.equal((await stroke('#moving [data-vector-group="frame"] rect')).fill, 0);
  await seek(page, 1950);
  const late = await stroke('#moving [data-vector-group="frame"] rect');
  assert.ok(late.fill > 0.5 && late.fill < 1);
  // The end is the authored artwork: same image as the slide with no motion, and nothing left on the shapes.
  await seek(page, 2000);
  track = await stroke('#moving [data-vector-group="track"] path');
  assert.equal(track.style, ''); assert.equal((await stroke('#moving [data-vector-group="frame"] rect')).style, '');
  const end = await art(page);
  assert.notDeepEqual(end, half);
  await plain.page.click('#moving [data-stage="0"]'); await plain.page.click('#moving [data-stage="1"]');
  await plain.page.waitForFunction(() => window.storybenchDeck.timeline().state === 'complete');
  await assertSameSlidePixels(page, end, await art(plain.page), 'the drawn slide ends as the same slide without motion');
  assert.deepEqual([...errors, ...plain.errors], []);
});

test('B6: an automatic stage with no delay starts where and when the previous one ends', { timeout: 60000 }, async t => {
  const browser = await launch(t, chromium); if (!browser) return;
  const { page, errors } = await open(t, browser, motionDeck(moving()), motionAssets);
  const state = await timeline(page);
  assert.equal(state.stages[2].startMs, state.stages[1].motionEndMs);
  assert.equal(state.stages[1].startMs, state.stages[0].holdEndMs);
  // The end state of stage two, shown by selecting it, is exactly the state stage three starts from.
  await page.click('#moving [data-stage="1"]');
  const left = await group(page, 'dot');
  assert.equal(left.transform, ''); assert.equal(left.opacity, 1);
  assert.equal((await seek(page, 1900)).stage, 2);
  assert.deepEqual(await group(page, 'dot'), left);
  await seek(page, 1899); const before = await group(page, 'dot');
  await seek(page, 1901); const after = await group(page, 'dot');
  for (const key of ['x', 'y']) assert.ok(Math.abs(before[key] - left[key]) < 1 && Math.abs(after[key] - left[key]) < 1, `${key} does not jump at the boundary`);
  assert.ok(before.opacity > 0.99 && after.opacity === 1);
  assert.deepEqual(errors, []);
});

for (const browserType of [chromium, firefox]) test(`${browserType.name()} B7: navigation, Replay, manual takeover and a hidden tab`, { timeout: 60000 }, async t => {
  const browser = await launch(t, browserType); if (!browser) return;
  const { page, errors } = await open(t, browser, motionDeck(moving()), motionAssets);
  const playingPast = ms => page.waitForFunction(at => { const now = window.storybenchDeck.timeline(); return now.state === 'playing' && now.timeMs >= at; }, ms);
  // Leaving mid-motion cancels the timeline and whatever was moving.
  await playingPast(600);
  const first = await timeline(page);
  await page.keyboard.press('ArrowDown');
  assert.equal((await timeline(page)).slideId, 'end');
  await still(page);
  // Returning starts from the beginning.
  await page.keyboard.press('ArrowUp');
  let state = await timeline(page);
  assert.equal(state.slideId, 'moving'); assert.equal(state.visit, first.visit + 2);
  assert.equal(state.state, 'playing'); assert.ok(state.timeMs < 250, `re-entry starts at zero, was ${state.timeMs}`); assert.equal(state.stage, null);
  assert.equal((await group(page, 'track')).pending, 'true');
  // Replay starts from the beginning, wherever the timeline was.
  await seek(page, 3000);
  await page.click('footer [data-command="replay"]');
  state = await timeline(page);
  assert.equal(state.state, 'playing'); assert.ok(state.timeMs < 250); assert.equal(state.stage, null);
  // Selecting a stage stops automatic progression and shows its end state at once.
  await page.click('#moving [data-stage="2"]');
  state = await timeline(page);
  assert.equal(state.state, 'waiting'); assert.equal(state.stage, 2); assert.equal(state.timeMs, 3900);
  assert.equal((await group(page, 'dot')).transform, 'translate(360px, 0px) rotate(0deg) scale(1)');
  assert.equal(await inline(page, '#moving [data-vector-group="track"] path'), '');
  await still(page);
  assert.equal((await timeline(page)).stage, 2, 'no automatic stage follows a selection');
  // Stepping forward by one stage plays that stage's motion once, then rests.
  await page.keyboard.press('ArrowRight');
  state = await timeline(page);
  assert.equal(state.stage, 3); assert.equal(state.state, 'playing'); assert.ok(state.timeMs >= 4400 && state.timeMs < 5400);
  await page.waitForFunction(() => window.storybenchDeck.timeline().state === 'complete');
  assert.equal((await timeline(page)).timeMs, 5400);
  assert.equal((await group(page, 'dot')).transform, settled);
  // Any other selection, here backwards, shows that stage's end state immediately.
  await page.keyboard.press('ArrowLeft');
  state = await timeline(page);
  assert.equal(state.stage, 2); assert.equal(state.state, 'waiting');
  assert.equal((await group(page, 'dot')).transform, 'translate(360px, 0px) rotate(0deg) scale(1)');
  // A hidden tab pauses motion and timing; they resume from the same point.
  const hide = hidden => page.evaluate(value => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => value }); document.dispatchEvent(new Event('visibilitychange')); }, hidden);
  await page.click('footer [data-command="replay"]');
  await playingPast(700);
  await hide(true);
  const held = await timeline(page);
  assert.equal(held.state, 'paused'); assert.ok(held.timeMs >= 700 && held.timeMs < 1300);
  await still(page);
  assert.equal((await timeline(page)).timeMs, held.timeMs);
  await hide(false);
  state = await timeline(page);
  assert.equal(state.state, 'playing'); assert.ok(state.timeMs >= held.timeMs && state.timeMs < held.timeMs + 250, `resumed at ${state.timeMs} from ${held.timeMs}`);
  // The same pause and resume through the timeline surface.
  const paused = await page.evaluate(() => window.storybenchDeck.pause());
  assert.equal(paused.state, 'paused');
  await still(page);
  assert.equal((await timeline(page)).timeMs, paused.timeMs);
  state = await page.evaluate(() => window.storybenchDeck.resume());
  assert.equal(state.state, 'playing'); assert.ok(state.timeMs >= paused.timeMs && state.timeMs < paused.timeMs + 250);
  // Seeking pauses at an exact time without waiting; resume plays on from there to the end.
  state = await seek(page, 5000);
  assert.equal(state.state, 'paused'); assert.equal(state.timeMs, 5000); assert.equal(state.stage, 3);
  await page.evaluate(() => window.storybenchDeck.resume());
  await page.waitForFunction(() => window.storybenchDeck.timeline().state === 'complete');
  assert.equal((await timeline(page)).timeMs, 5650);
  assert.deepEqual(errors, []);
});

test('B7: a manual stage holds the timeline until someone steps into it', { timeout: 60000 }, async t => {
  const browser = await launch(t, chromium); if (!browser) return;
  const stages = moving(); stages[2].trigger = 'manual';
  const { page, errors } = await open(t, browser, motionDeck(stages), motionAssets);
  let state = await timeline(page);
  assert.deepEqual(state.stages.map(stage => [stage.trigger, stage.startMs]), [['auto', 300], ['auto', 1500], ['manual', 1900], ['auto', 4400]]);
  await page.waitForFunction(() => window.storybenchDeck.timeline().state === 'waiting');
  state = await timeline(page);
  assert.equal(state.stage, 1); assert.equal(state.timeMs, 1900);
  await still(page);
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => window.storybenchDeck.timeline().state === 'waiting');
  state = await timeline(page);
  assert.equal(state.stage, 2); assert.equal(state.timeMs, 3900);
  assert.deepEqual(errors, []);
});

test('B8: Presenter drives the audience timeline and shows the stage the audience is on', { timeout: 60000 }, async t => {
  const browser = await launch(t, chromium); if (!browser) return;
  const { page, pages, errors } = await open(t, browser, motionDeck(moving()), motionAssets);
  const [presenter] = await Promise.all([pages.waitForEvent('page'), page.click('#presenter-open')]);
  await presenter.waitForFunction(() => document.getElementById('connection').textContent.startsWith('Connected'));
  const shown = () => presenter.evaluate(() => Number(document.getElementById('stage-select').value));
  const follows = stage => presenter.waitForFunction(value => Number(document.getElementById('stage-select').value) === value, stage);
  // At each stage boundary Presenter shows the audience's stage.
  for (const [i, stage] of plan.entries()) {
    assert.equal((await seek(page, stage.startMs)).stage, i);
    await follows(i);
  }
  // While the timeline plays, Presenter follows it.
  await presenter.click('[data-command="replay"]');
  await page.waitForFunction(() => { const now = window.storybenchDeck.timeline(); return now.state === 'playing' && now.stage === 0; });
  await follows(0);
  await page.waitForFunction(() => window.storybenchDeck.timeline().stage === 1);
  await follows(1);
  // Selecting a stage from Presenter shows its end state on the audience and stops progression.
  await presenter.selectOption('#stage-select', '0');
  await page.waitForFunction(() => window.storybenchDeck.timeline().state === 'waiting');
  let state = await timeline(page);
  assert.equal(state.stage, 0); assert.equal(state.timeMs, 1300);
  assert.equal((await group(page, 'dot')).pending, 'true');
  await still(page);
  // Next stage from Presenter plays that stage's motion once.
  await presenter.click('[data-command="sub-next"]');
  await page.waitForFunction(() => window.storybenchDeck.timeline().stage === 1);
  assert.equal((await timeline(page)).state, 'playing');
  await page.waitForFunction(() => window.storybenchDeck.timeline().state === 'waiting');
  assert.equal((await timeline(page)).timeMs, 1900);
  await follows(1);
  // Previous stage shows the earlier end state; Replay restarts the audience timeline.
  await presenter.click('[data-command="sub-previous"]');
  await page.waitForFunction(() => window.storybenchDeck.timeline().stage === 0);
  assert.equal((await timeline(page)).state, 'waiting');
  await presenter.click('[data-command="replay"]');
  await page.waitForFunction(() => { const now = window.storybenchDeck.timeline(); return now.state === 'playing' && now.stage === null; });
  assert.equal(await shown(), 0);
  assert.deepEqual(errors, []);
});

test('B9: reduced motion and print show every group in its final state with nothing running', { timeout: 60000 }, async t => {
  const browser = await launch(t, chromium); if (!browser) return;
  const final = async page => {
    for (const id of ['track', 'dot']) { const now = await group(page, id); assert.equal(now.pending, 'false'); assert.equal(now.visible, true); }
    const dot = await group(page, 'dot');
    assert.equal(dot.transform, settled); assert.equal(dot.opacity, 0.5);
    assert.equal(await inline(page, '#moving [data-vector-group="track"] path'), '');
    await still(page);
  };
  const reduced = await open(t, browser, motionDeck(moving()), motionAssets, { context: { reducedMotion: 'reduce' } });
  assert.equal((await timeline(reduced.page)).state, 'complete');
  await final(reduced.page);
  await reduced.page.click('footer [data-command="replay"]');
  await final(reduced.page);
  // Print, entered mid-motion: every slide shows its final state; the clock holds and resumes.
  const { page, errors } = await open(t, browser, motionDeck(moving()), motionAssets, { slide: 'end' });
  await page.keyboard.press('ArrowUp');
  await page.waitForFunction(() => window.storybenchDeck.timeline().timeMs >= 500);
  await page.emulateMedia({ media: 'print' });
  const held = await timeline(page);
  assert.equal(held.state, 'paused');
  await final(page);
  assert.equal((await timeline(page)).timeMs, held.timeMs);
  await page.emulateMedia({ media: 'screen' });
  assert.equal((await timeline(page)).state, 'playing');
  // Print while another slide is current still shows this slide complete.
  await page.keyboard.press('ArrowDown');
  await page.emulateMedia({ media: 'print' });
  assert.equal((await timeline(page)).state, 'paused');
  assert.deepEqual(await page.evaluate(() => { const el = document.querySelector('#moving [data-vector-group="dot"]'); return [el.dataset.pending, el.style.transform, getComputedStyle(el).visibility]; }), ['false', settled, 'visible']);
  // Without any call into the timeline, the media change itself brings the final state within a frame.
  await page.emulateMedia({ media: 'screen' }); await page.keyboard.press('ArrowUp');
  await page.waitForFunction(() => document.querySelector('#moving [data-vector-group="dot"]').dataset.pending === 'true');
  await page.emulateMedia({ media: 'print' });
  await page.waitForFunction(() => document.querySelector('#moving [data-vector-group="dot"]').dataset.pending === 'false');
  assert.equal(await page.evaluate(() => document.querySelector('#moving [data-vector-group="dot"]').style.transform), settled);
  assert.deepEqual([...errors, ...reduced.errors], []);
});

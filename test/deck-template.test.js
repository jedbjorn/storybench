import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { buildDeck } from '../src/deck-template/build.js';
import { exampleDeck, exampleAssets } from '../src/deck-template/example.js';
import { fontCatalog, fontForFamily } from '../src/fonts.js';

const bundle = () => buildDeck(structuredClone(exampleDeck), { assets: exampleAssets });
function page(files, name = 'index.html', { opener = null, hash = '', reduced = false } = {}) {
  const dom = new JSDOM(String(files.get(name)), { url: `file:///export/${name}${hash}`, runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window, timeouts = new Map(), intervals = new Map();
  let id = 0, hidden = false;
  Object.defineProperty(w.document, 'hidden', { get: () => hidden });
  const motion = { matches: reduced, addEventListener: (_event, callback) => { motion.change = callback; } };
  w.matchMedia = () => motion;
  w.setTimeout = (fn) => { timeouts.set(++id, fn); return id; };
  w.clearTimeout = (key) => timeouts.delete(key);
  w.setInterval = (fn) => { intervals.set(++id, fn); return id; };
  w.clearInterval = (key) => intervals.delete(key);
  w.HTMLMediaElement.prototype.pause = function () { this.wasPaused = true; };
  w.HTMLMediaElement.prototype.play = function () { this.wasPlayed = true; return Promise.resolve(); };
  w.opener = opener;
  w.eval(String(files.get(name === 'index.html' ? 'audience.js' : 'presenter.js')));
  return { w, d: w.document, close: () => dom.window.close(), timeouts, intervals,
    tick() { const tasks = [...timeouts.values()]; timeouts.clear(); tasks.forEach((fn) => fn()); },
    visibility(value) { hidden = value; w.document.dispatchEvent(new w.Event('visibilitychange')); }, motion,
    key(key, target = w.document.body) { target.dispatchEvent(new w.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })); },
    message(source, data) { w.dispatchEvent(new w.MessageEvent('message', { source, data })); },
  };
}
const current = (p) => p.d.querySelector('.slide:not([hidden])').id;
const click = (p, selector) => p.d.querySelector(selector).click();

test('every catalogue family exports both actual weights, notices and local CSS without bundling unused families', () => {
  for (const font of fontCatalog()) {
    const files = buildDeck({ ...exampleDeck, fonts: [null, font.family] }, { assets: exampleAssets });
    const css = String(files.get('styles.css'));
    assert.match(css, new RegExp(`--font-accent:"${font.family}"`));
    assert.doesNotMatch(css, /--font-base:|--font-alternate:/);
    for (const weight of ['regular', 'bold']) {
      assert.deepEqual(files.get(`assets/font-${font.id}-${weight}.ttf`), readFileSync(font.files[weight]));
    }
    assert.deepEqual(files.get(`assets/font-${font.id}-LICENSE.txt`), readFileSync(fontForFamily(font.family).license));
    assert.equal([...files.keys()].filter(name => name.startsWith('assets/font-')).length, 3);
    for (const [, ref] of css.matchAll(/url\(['"]?([^'"\)]+)/g)) assert.ok(files.has(ref), ref);
  }
  const files = buildDeck({ ...exampleDeck, fonts: ['Kalam', 'Crimson Text', 'Space Mono'] }, { assets: exampleAssets });
  assert.equal([...files.keys()].filter(name => name.startsWith('assets/font-')).length, 9);
  const css = String(files.get('styles.css'));
  assert.match(css, /--font-base:"Kalam";--font-accent:"Crimson Text";--font-alternate:"Space Mono"/);
  assert.match(css, /h1,h2\{font-family:var\(--font-accent,Manrope\)/);
  assert.match(css, /\.slide header,\.caption,\.gallery figcaption\{font-family:var\(--font-alternate,Manrope\)/);
  assert.deepEqual(buildDeck({ ...exampleDeck, fonts: [null, null, null] }, { assets: exampleAssets }), bundle());
});

test('unknown, malformed and missing deck fonts fail before returning a bundle', () => {
  for (const fonts of [null, 'Kalam', ['Kalam', null, null, null], ['missing'], ['../secret'], ['Kalam";src:url(https://remote)'], [''], [42], [{}]]) {
    assert.throws(() => buildDeck({ ...exampleDeck, fonts }, { assets: exampleAssets }), /Deck fonts|Unsupported deck font/);
  }
  const font = fontForFamily('Kalam'), stems = font.stems;
  try {
    font.stems = ['/missing-storybench-fonts/'];
    assert.throws(() => buildDeck({ ...exampleDeck, fonts: ['Kalam'] }, { assets: exampleAssets }), /Deck font unavailable: Kalam regular/);
  } finally { font.stems = stems; }
});

test('deterministic data-driven layouts, safe text and licensed offline closure', () => {
  const files = bundle();
  assert.deepEqual(files, bundle());
  const allowed = ['index.html', 'presenter.html', 'audience.js', 'presenter.js', 'styles.css', 'assets/manrope-variable.ttf', 'assets/Manrope-OFL.txt', 'assets/example.png'];
  assert.deepEqual([...files.keys()].sort(), allowed.sort());
  for (const name of ['index.html', 'presenter.html']) {
    const doc = new JSDOM(String(files.get(name))).window.document;
    for (const node of doc.querySelectorAll('[src],[href],[poster]')) {
      const ref = node.getAttribute('src') || node.getAttribute('href') || node.getAttribute('poster');
      if (!ref.startsWith('#')) assert.ok(files.has(ref), `${name}: ${ref}`);
      assert.ok(!/^(https?:|\/\/|data:)/i.test(ref));
    }
  }
  const css = String(files.get('styles.css'));
  for (const [, ref] of css.matchAll(/url\(['"]?([^'"\)]+)/g)) assert.ok(files.has(ref));
  for (const name of ['audience.js', 'presenter.js']) assert.doesNotMatch(String(files.get(name)), /\b(fetch|XMLHttpRequest|WebSocket|importScripts)\s*\(|\bimport\s/);
  assert.match(String(files.get('assets/Manrope-OFL.txt')), /SIL OPEN FONT LICENSE/);
  const doc = new JSDOM(String(files.get('index.html'))).window.document;
  assert.equal(doc.querySelectorAll('.slide').length, 7);
  for (const layout of ['title', 'section', 'statement', 'columns', 'process', 'text-media', 'full-media']) assert.ok(doc.querySelector(`.layout-${layout}`));
  assert.match(css, /@media print/); assert.match(css, /\.slide\[hidden\],\.slide/);
  assert.match(css, /prefers-reduced-motion/); assert.match(css, /visibility:visible!important/);
  const input = structuredClone(exampleDeck);
  input.title = '<script>bad</script>'; input.slides[0].notes = '<img src=x onerror=bad>&"';
  const safe = new JSDOM(String(buildDeck(input, { assets: exampleAssets }).get('index.html'))).window.document;
  assert.equal(safe.querySelector('.speaker-notes').textContent, input.slides[0].notes);
  assert.equal(safe.querySelectorAll('script').length, 1);
  assert.equal(safe.querySelector('[onerror]'), null);
});

test('invalid content and paths fail before producing a bundle', () => {
  for (const path of ['../secret.png', 'assets/../secret.png', 'https://site/image.png', 'assets/%2e%2e.png', 'assets/x.png?remote', 'assets/sub/x.png', 'assets/\\x.png']) {
    const input = structuredClone(exampleDeck); input.slides[5].media.src = path;
    assert.throws(() => buildDeck(input, { assets: exampleAssets }), /Invalid local/);
  }
  for (const mutate of [
    (d) => { d.slides = []; }, (d) => { d.slides[0].id = d.slides[1].id; },
    (d) => { d.slides[0].title = {}; }, (d) => { d.slides[0].targetMinutes = -1; },
    (d) => { d.slides[0].layout = 'unknown'; }, (d) => { d.slides[4].subnav = []; },
    (d) => { d.slides[4].stages[1].afterMs = Infinity; }, (d) => { d.slides[3].columns = []; },
  ]) { const input = structuredClone(exampleDeck); mutate(input); assert.throws(() => buildDeck(input, { assets: exampleAssets })); }
  assert.throws(() => buildDeck(exampleDeck), /Missing media/);
});

test('bounded slide controls, keyboard and editable input behavior', () => {
  const p = page(bundle());
  assert.equal(current(p), 'welcome');
  p.key('ArrowUp'); assert.equal(current(p), 'welcome');
  p.key('ArrowDown'); assert.equal(current(p), 'chapter');
  p.key('End'); assert.equal(current(p), 'demo');
  assert.equal(p.d.querySelector('[data-command="next"]').disabled, true);
  p.key('Home');
  const input = p.d.createElement('input'); p.d.body.append(input);
  p.key('End', input); assert.equal(current(p), 'welcome');
  const editable = p.d.createElement('div'); editable.setAttribute('contenteditable', ''); p.d.body.append(editable);
  p.key('End', editable); assert.equal(current(p), 'welcome');
  click(p, '[data-go="3"]'); assert.equal(current(p), 'options');
  assert.equal(p.d.querySelector('[aria-current]').dataset.go, '3');
  p.close();
});

test('reveal timing, manual takeover, visibility pause, reduced motion', () => {
  const p = page(bundle()); click(p, '[data-go="4"]');
  assert.equal(p.timeouts.size, 1);
  assert.equal(p.d.querySelectorAll('#steps [data-pending="true"]').length, 2);
  p.visibility(true); assert.equal(p.timeouts.size, 0);
  p.visibility(false); p.tick();
  assert.equal(p.d.querySelectorAll('#steps [data-pending="true"]').length, 1);
  p.key('ArrowRight'); assert.equal(p.timeouts.size, 0);
  p.key('ArrowLeft'); assert.equal(p.timeouts.size, 0);
  click(p, '#steps [data-stage="0"]'); assert.equal(p.timeouts.size, 0);
  click(p, '[data-go="3"]'); assert.equal(p.timeouts.size, 0);
  click(p, '[data-go="4"]'); assert.equal(p.timeouts.size, 1);
  p.motion.matches = true; p.motion.change();
  assert.equal(p.timeouts.size, 0);
  assert.equal(p.d.querySelectorAll('#steps [data-pending="true"]').length, 0);
  p.close();
  const reduced = page(bundle(), 'index.html', { reduced: true });
  click(reduced, '[data-go="4"]'); assert.equal(reduced.timeouts.size, 0); reduced.close();
});

test('presenter source/channel and command bounds; fresh per-opening tokens; popup recovery', () => {
  const p = page(bundle()), sent = [];
  let url;
  const popup = { closed: false, postMessage: (data) => sent.push(data), focus() {}, close() { this.closed = true; } };
  p.w.open = (value) => { url = value; return popup; };
  p.key('n'); const channel = new URL(url).hash.slice(1);
  assert.match(channel, /^[a-f0-9]{32}$/);
  const message = { type: 'deck-command', channel, command: 'last' };
  p.message({}, message); assert.equal(current(p), 'welcome');
  p.message(popup, { ...message, channel: 'wrong' }); assert.equal(current(p), 'welcome');
  p.message(popup, message); assert.equal(current(p), 'demo');
  for (const index of [-1, 100, 0.5, '0', null]) p.message(popup, { ...message, command: 'goto', index });
  assert.equal(current(p), 'demo');
  p.message(popup, { type: 'deck-ready', channel }); assert.equal(sent.at(-1).state.index, 6);
  popup.closed = true; [...p.intervals.values()].forEach((fn) => fn());
  assert.match(p.d.getElementById('status').textContent, /disconnected/);
  p.w.open = (value) => { url = value; return null; }; p.key('n');
  assert.notEqual(new URL(url).hash.slice(1), channel);
  assert.match(p.d.getElementById('status').textContent, /Popup blocked/);
  p.close();
});

test('paired presenter renders safe notes and sends slide/stage/video commands; disconnects', () => {
  const a = page(bundle()); let popup, presenter;
  const audience = { closed: false, postMessage: (data) => a.message(popup, data) };
  a.w.open = (url) => {
    popup = { closed: false, postMessage: (data) => presenter?.message(audience, data), focus() {} };
    presenter = page(bundle(), 'presenter.html', { opener: audience, hash: new URL(url).hash });
    return popup;
  };
  a.key('n'); const channel = [...a.d.querySelectorAll('.slide')].length; assert.equal(channel, 7);
  // The startup ready message can precede window.open returning; heartbeat retries it.
  [...presenter.intervals.values()].forEach((fn) => fn());
  assert.match(presenter.d.getElementById('connection').textContent, /Connected/);
  click(presenter, '[data-command="next"]'); assert.equal(current(a), 'chapter');
  presenter.d.getElementById('slide-select').value = '4';
  presenter.d.getElementById('slide-select').dispatchEvent(new presenter.w.Event('change'));
  assert.equal(current(a), 'steps');
  presenter.d.getElementById('stage-select').value = '2';
  presenter.d.getElementById('stage-select').dispatchEvent(new presenter.w.Event('change'));
  assert.equal(a.d.querySelector('#steps [data-stage="2"]').getAttribute('aria-pressed'), 'true');
  assert.match(presenter.d.getElementById('notes').textContent, /Use left and right/);
  presenter.message({}, { type: 'deck-state', state: {} });
  audience.closed = true; [...presenter.intervals.values()].forEach((fn) => fn());
  assert.match(presenter.d.getElementById('connection').textContent, /disconnected/);
  assert.equal(presenter.d.querySelector('[data-command="next"]').disabled, true);
  a.close(); presenter.close();
});

test('presenter ignores malformed states even from bound window; escapes notes', () => {
  const channel = 'a'.repeat(32), audience = { closed: false, postMessage() {} };
  const p = page(bundle(), 'presenter.html', { opener: audience, hash: `#${channel}` });
  const state = { index: 0, stage: 0, titles: ['<b>Title</b>'], notes: '<img src=x onerror=bad>', stages: [], targetMinutes: 1, video: null };
  for (const bad of [{ ...state, index: 1 }, { ...state, titles: [1] }, { ...state, stage: -1 }, { ...state, notes: {} }, { ...state, video: {} }]) {
    p.message(audience, { type: 'deck-state', channel, state: bad });
    assert.equal(p.d.getElementById('notes').textContent, '');
  }
  p.message(audience, { type: 'deck-state', channel, state });
  assert.equal(p.d.getElementById('notes').textContent, state.notes);
  assert.equal(p.d.querySelector('#notes img'), null); p.close();
});

test('media rejection, leaving slide, hidden playback, fullscreen failure are recoverable', async () => {
  const input = structuredClone(exampleDeck);
  input.slides[6].media = { type: 'video', src: 'assets/demo.mp4', alt: 'Synthetic demo', autoplay: true };
  const files = buildDeck(input, { assets: { ...exampleAssets, 'assets/demo.mp4': Buffer.from('fake video for mocked media API') } });
  const p = page(files); const video = p.d.querySelector('video');
  video.play = () => Promise.reject(new Error('blocked'));
  p.key('End'); await new Promise(setImmediate);
  assert.match(p.d.getElementById('status').textContent, /Playback was blocked/);
  assert.equal(video.controls, true);
  p.key('Home'); assert.equal(video.wasPaused, true);
  let resolve; video.wasPaused = false; video.play = () => new Promise((done) => { resolve = done; });
  p.key('End'); await Promise.resolve(); p.visibility(true); resolve(); await new Promise(setImmediate);
  assert.equal(video.wasPaused, true);
  click(p, '#fullscreen'); await new Promise(setImmediate);
  assert.match(p.d.getElementById('status').textContent, /Fullscreen unavailable/);
  p.close();
});

test('all changed JavaScript parses without relying on the shared lint allowlist', () => {
  for (const name of ['audience.js', 'presenter.js']) assert.doesNotThrow(() => new Function(readFileSync(new URL(`../src/deck-template/${name}`, import.meta.url), 'utf8')));
});

test('presenter video commands control only active media and manual takeover stops reveals', async () => {
  const input = structuredClone(exampleDeck);
  input.slides[6].media = { type: 'video', src: 'assets/demo.webm', alt: 'Synthetic clip', autoplay: false };
  input.slides[6].stages = [{ title: 'Opening' }, { title: 'Result', afterMs: 100 }];
  const p = page(buildDeck(input, { assets: { ...exampleAssets, 'assets/demo.webm': Buffer.from('mocked clip') } }));
  const video = p.d.querySelector('video'); let playing = false;
  Object.defineProperty(video, 'paused', { get: () => !playing });
  video.play = () => { playing = true; return Promise.resolve(); };
  video.pause = () => { playing = false; };
  let channel; const sent = [];
  const popup = { closed: false, postMessage: (data) => sent.push(data), focus() {} };
  p.w.open = (url) => { channel = new URL(url).hash.slice(1); return popup; };
  p.key('n'); p.key('End'); assert.equal(p.timeouts.size, 1);
  const command = (name) => p.message(popup, { type: 'deck-command', channel, command: name });
  command('video-toggle'); await new Promise(setImmediate);
  assert.equal(playing, true); assert.equal(p.timeouts.size, 0);
  assert.equal(sent.at(-1).state.video.paused, false);
  command('video-toggle'); assert.equal(playing, false);
  video.currentTime = 12; command('video-restart'); await new Promise(setImmediate);
  assert.equal(video.currentTime, 0); assert.equal(playing, true);
  p.key('Home'); assert.equal(playing, false);
  command('video-toggle'); await new Promise(setImmediate); assert.equal(playing, false);
  p.close();
});

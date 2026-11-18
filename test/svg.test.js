import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm, readdir, open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { JSDOM } from 'jsdom';
import { parseSvg, SVG_LIMITS, SVG_PROFILE } from '../src/svg.js';
import { renderSvg } from '../src/svg-render.js';
import { importMedia, probeMedia } from '../src/media.js';
import { frameAt } from '../src/runtime/media-inspect.js';
import { buildDeck } from '../src/deck-template/build.js';
import { createDeckService } from '../src/deck-service.js';
import { HeavyJobQueue } from '../src/job-runner.js';
import { illustrationURL, smokeSvg, assertPng } from '../src/runtime/svg-check.js';
import { initDataRoot, openDataRoot } from '../src/services/data-root.js';
import { createChannel } from '../src/services/channels.js';
import { createLibraryService } from '../src/library.js';
const source = await readFile(illustrationURL);
const svg = body => `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="520">${body}</svg>`;

test('shared profile preserves useful geometry, semantics and isolated local definitions/styles', () => {
  const parsed = parseSvg(source, { namespace: 'instance' });
  assert.equal(parsed.profile, SVG_PROFILE);
  assert.deepEqual(parsed.fonts, ['Manrope']);
  assert.ok(parsed.groupIds.includes('observe'));
  assert.match(parsed.svg, /id="instance-title"/);
  assert.match(parsed.svg, /aria-labelledby="instance-title instance-description"/);
  assert.match(parsed.svg, /url\(#instance-sky\)/);
  assert.match(parsed.svg, /href="#instance-tree"/);
  assert.match(parsed.svg, /\.instance-label\{/);
  assert.match(parsed.svg, /<path[^>]*d="M180 330C300 320 290 230 430 280S530 340 640 290"/);
  const files = buildDeck({ title: 'Vectors', slides: [1, 2].map(i => ({ id: `slide${i}`, title: 'Plan', layout: 'full-media', media: { type: 'image', src: 'assets/plan.svg', alt: 'Plan' } })) }, { assets: { 'assets/plan.svg': source } });
  assert.deepEqual(files.get('assets/plan.svg'), source);
  const dom = new JSDOM(files.get('index.html'));
  try {
    const ids = [...dom.window.document.querySelectorAll('[id]')].map(n => n.id);
    assert.equal(ids.length, new Set(ids).size);
    assert.equal(dom.window.document.querySelectorAll('svg').length, 2);
    assert.equal(dom.window.document.querySelectorAll('svg path').length, 16);
    for (const el of dom.window.document.querySelectorAll('svg [href]')) assert.ok(dom.window.document.getElementById(el.getAttribute('href').slice(1)));
  } finally { dom.window.close(); }
});

test('active, unsupported, malformed and excessive SVG fail explicitly at the parsed boundary', () => {
  const bad = [
    svg('<script>alert(1)</script>'), svg('<g onclick="alert(1)"/>'), svg('<foreignObject/>'),
    svg('<image href="https://example.com/x.png"/>'), svg('<use href="file:///secret"/>'),
    svg('<rect fill="url(https://example.com/a.svg#x)"/>'), svg('<rect style="fill:url(//example.com/x)"/>'),
    svg('<style>@import "https://example.com/x";</style>'), svg('<style>.a{animation:x 1s}</style>'),
    svg('<style>body{fill:red}</style>'), svg('<style>.a{fill:var(--secret)}</style>'), svg('<style>.a{fill:r\\65 d}</style>'),
    svg('<style>.a{font-family:Remote Font}</style>'), svg('<rect unknown="x"/>'), svg('<animate/>'),
    svg('<g id="a"/><g id="a"/>'), svg('<use href="#missing"/>'), svg('<g id="a"><use href="#a"/></g>'),
    svg('<defs><linearGradient id="a" href="#b"/><linearGradient id="b" href="#a"/></defs>'),
    svg('<g id="a" style="clip-path:url(#clip)"/><clipPath id="clip"><use href="#a"/></clipPath>'),
    svg('<text id="a"><use href="#a"/></text>'), svg('<filter id="blur"><feGaussianBlur stdDeviation="500"/></filter>'),
    svg('<filter width="99999%"/>'), svg('<path d="M0 0LNaN 1"/>'), svg('<path d="M0 0L1e999 0"/>'),
    svg('<path d="M0 0L4"/>'), svg('<path d="M0 0A1 1 0 3 0 4 4"/>'), svg('<rect transform="matrix(1 2)"/>'),
    svg('<g>'.repeat(33) + '</g>'.repeat(33)), svg('<rect/>'.repeat(SVG_LIMITS.elements)),
    svg('<g>'), '<svg xmlns="http://www.w3.org/2000/svg" width="Infinity" height="20"/>',
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 0 0"/>',
    '<!DOCTYPE svg [<!ENTITY x "boom">]>' + svg('<text>&x;</text>'),
    '<?xml-stylesheet href="https://example.com/x"?>' + svg(''),
  ];
  for (const input of bad) assert.throws(() => parseSvg(Buffer.from(input)), { code: 'INVALID_SVG' }, input.slice(0, 180));
  assert.throws(() => parseSvg(Buffer.alloc(SVG_LIMITS.bytes + 1)), /source exceeds/);
  const assets = { 'assets/bad.svg': Buffer.from(svg('<script/>')) };
  assert.throws(() => buildDeck({ title: 'Bad', slides: [{ id: 'bad', title: 'Bad', layout: 'full-media', media: { type: 'image', src: 'assets/bad.svg', alt: 'Bad' } }] }, { assets }), /Asset assets\/bad.svg: SVG.*script/);
});

test('native rendering, import and descriptor inspection retain source without an SVG FFmpeg decoder', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sb-svg-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const input = path.join(root, 'misnamed.png');
  await writeFile(input, source);
  const imported = await importMedia({ workspace: root, sourcePath: input });
  assert.equal(imported.metadata.contentType, 'image/svg+xml');
  assert.equal(imported.kind, 'image');
  assert.deepEqual(await readFile(path.join(root, imported.path)), source);
  assertPng(await readFile(path.join(root, imported.thumbnailPath)));
  assert.equal((await probeMedia(path.join(root, imported.path))).format.format_name, 'svg');
  const descriptor = await open(input);
  try { assertPng(await frameAt(descriptor)); await assert.rejects(frameAt(descriptor, 2), /still image/); }
  finally { await descriptor.close(); }
  const png = await renderSvg(source, { maxWidth: 400 });
  assert.equal(png.readUInt32BE(16), 400); assert.equal(png.readUInt32BE(20), 260);
  await assert.rejects(renderSvg(source, { timeoutMs: 1 }), /timed out/);
  const invalid = path.join(root, 'bad.svg'); await writeFile(invalid, svg('<script/>'));
  const before = await readdir(path.join(root, 'media'));
  await assert.rejects(importMedia({ workspace: root, sourcePath: invalid }), /unsupported element script/);
  assert.deepEqual(await readdir(path.join(root, 'media')), before, 'failed import leaves no managed source');
});

test('app image smoke exercises ordinary registration, inspection, saved gallery and ZIP paths', async () => {
  const result = await smokeSvg('app');
  assert.equal(result.retainedZipSource, true); assert.equal(result.imageTool, true);
});

test('cross-channel SVG reuse and reopen preserve ownership; invalid builds retain previous output', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sb-svg-channels-'));
  initDataRoot(root); const a = createChannel(root, 'Source'), b = createChannel(root, 'Destination');
  let store = openDataRoot(root), decks;
  t.after(async () => { await decks?.close(); store.close(); await rm(root, { recursive: true, force: true }); });
  const first = store.createEpisode({ kind: 'deck', channelId: a.id, title: 'Source' }), second = store.createEpisode({ kind: 'deck', channelId: b.id, title: 'Destination' });
  let library = createLibraryService({ workspace: root, store });
  const item = await library.registerFile({ episodeId: first.id, readable: Readable.from(source), fileName: 'opaque.data', contentType: 'text/plain', selectedCategory: 'Graphics' });
  assert.equal(item.asset.metadata.contentType, 'image/svg+xml');
  const reused = await library.reuseItem({ source: { episodeId: first.id, itemId: item.id }, destination: { episodeId: second.id } });
  assert.equal(reused.item.asset.channelId, b.id); assert.equal(item.asset.channelId, a.id);
  assert.notEqual(reused.item.asset.path, item.asset.path);
  assert.equal(reused.item.asset.hash, item.asset.hash);
  assert.deepEqual(await readFile(path.join(root, item.asset.path)), source);
  store.saveDeck(second.id, 1, [{ id: 'art', title: 'Art', layout: 'full-media', media: { itemId: reused.item.id, alt: 'Art' } }]);
  store.close(); store = openDataRoot(root); library = createLibraryService({ workspace: root, store });
  const queue = new HeavyJobQueue(); decks = createDeckService({ store, queue });
  const run = async () => { const j = decks.enqueue({ episodeId: second.id, expectedRevision: store.getDeck(second.id).revision }); await queue.draining; return decks.getJob(second.id, j.id); };
  const good = await run(); assert.equal(good.state, 'completed', good.error);
  const zip = await readFile(path.join(root, good.outputPath));
  store.saveDeck(second.id, store.getDeck(second.id).revision, [{ id: 'art', title: 'Art', layout: 'process',
    vector: { itemId: reused.item.id, alt: 'Art' }, stages: [{ id: 'tree-stage', title: 'Tree', svgGroupIds: ['tree'] }] }]);
  const badMapping = await run(); assert.equal(badMapping.state, 'failed');
  assert.match(badMapping.error, /Slide art.*stage group tree.*not a definition/);
  assert.equal(badMapping.outputPath, null);
  assert.deepEqual(await readFile(path.join(root, good.outputPath)), zip);
  await writeFile(path.join(root, reused.item.asset.path), svg('<script/>'));
  const broken = await run(); assert.equal(broken.state, 'failed'); assert.match(broken.error, /Slide art.*differs from its registered source/);
  assert.deepEqual(await readFile(path.join(root, good.outputPath)), zip);
  // Even a previously stored unsupported SVG with a matching hash fails validation.
  const badBytes = Buffer.from(svg('<script/>'));
  const bad = store.saveAsset({ channelId: b.id, name: 'bad.svg', kind: 'image', path: reused.item.asset.path, hash: createHash('sha256').update(badBytes).digest('hex') });
  const badItem = store.attachLibraryItem(second.id, bad.id, { category: 'Graphics' });
  store.saveDeck(second.id, store.getDeck(second.id).revision, [{ id: 'bad', title: 'Bad', layout: 'full-media', media: { itemId: badItem.id, alt: 'Bad' } }]);
  const rejected = await run(); assert.equal(rejected.state, 'failed'); assert.match(rejected.error, /Slide bad, asset .*unsupported element script/);
  await assert.rejects(library.reuseItem({ source: { episodeId: second.id, itemId: reused.item.id }, destination: { episodeId: first.id } }), /unsupported element script/);
});

test('staged SVG export keeps internal definitions and uses inside the same visibility wrapper', () => {
  const input = Buffer.from(svg('<g id="art"><defs><path id="shape" d="M0 0L20 0L10 20Z"/></defs><use href="#shape"/></g>'));
  const files = buildDeck({ title: 'Local definitions', slides: [{ id: 'local', title: 'Local geometry', layout: 'process',
    vector: { type: 'image', src: 'assets/local.svg', alt: 'Triangle' },
    stages: [{ id: 'reveal', title: 'Reveal', svgGroupIds: ['art'] }] }] }, { assets: { 'assets/local.svg': input } });
  assert.deepEqual(files.get('assets/local.svg'), input);
  const dom = new JSDOM(files.get('index.html'));
  try {
    const doc = dom.window.document, wrapper = doc.querySelector('[data-vector-step="0"]');
    assert.ok(wrapper);
    const use = wrapper.querySelector('use'), target = doc.getElementById(use.getAttribute('href').slice(1));
    assert.ok(wrapper.contains(target));
    assert.equal(target.parentElement.localName, 'defs');
    assert.equal(target.getAttribute('d'), 'M0 0L20 0L10 20Z');
    assert.notEqual(target.id, 'shape', 'local references are namespaced with their target');
    assert.equal(doc.querySelectorAll('[data-vector-step]').length, 1);
  } finally { dom.window.close(); }
});

test('staged SVG export preserves geometry and rejects ambiguous or definition-only mappings', () => {
  const stages = [{ id: 'reveal', title: 'Reveal', svgGroupIds: ['art'] }];
  const input = svg('<g id="art" transform="translate(10 20)" opacity="0.6"><path d="M0 0L20 0L10 20Z"/></g>');
  const parsed = parseSvg(Buffer.from(input), { namespace: 'a', stages });
  assert.match(parsed.svg, /<g data-vector-step="0" data-vector-group="art"><g id="a-art" transform="translate\(10 20\)" opacity="0.6">/);
  assert.equal(parsed.source, input);
  for (const [body, mapping, error] of [
    ['<g id="outer"><g id="art"/></g>', [{ id: 'a', svgGroupIds: ['outer'] }, ...stages], /cannot nest/],
    ['<defs><g id="art"/></defs><use href="#art"/>', stages, /not a definition/],
    ['<g id="art"/><use href="#art"/>', stages, /cannot be reused/],
    ['<g id="art"><path id="child" d="M0 0L10 10"/></g><use href="#child"/>', stages, /cannot be reused/],
    ['<g id="outer"><g id="art"/></g><use href="#outer"/>', stages, /cannot be reused/],
    ['<g id="art"/>', [{ id: 'a', svgGroupIds: ['missing'] }], /missing SVG group/],
  ]) assert.throws(() => parseSvg(Buffer.from(svg(body)), { namespace: 'test', stages: mapping }), error);
  assert.throws(() => parseSvg(Buffer.from(svg('<g data-vector-step="0"/>'))), /unsupported attribute/);
});

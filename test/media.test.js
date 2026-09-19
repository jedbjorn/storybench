import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, mkdtemp, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { importMedia, probeMedia, renderEpisode, validateRenderPlan } from '../src/media.js';

function ffmpeg(args) {
  const result = spawnSync('ffmpeg', ['-v', 'error', '-threads', '1', ...args], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}

async function fixtureWorkspace() {
  const workspace = await mkdtemp(join(tmpdir(), 'storybench-media-'));
  const fixtures = join(workspace, 'fixtures');
  await mkdir(fixtures);
  return { workspace, fixtures };
}

async function digest(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

test('import preserves its source, publishes a managed copy, thumbnail, and deduplicates', async () => {
  const { workspace, fixtures } = await fixtureWorkspace();
  const source = join(fixtures, 'odd source.mp4');
  ffmpeg(['-f', 'lavfi', '-i', 'color=c=red:s=320x182:r=30:d=0.5', '-pix_fmt', 'yuv420p', source]);
  const before = await digest(source);
  const first = await importMedia({ workspace, sourcePath: source });
  const second = await importMedia({ workspace, sourcePath: source });

  assert.equal(await digest(source), before);
  assert.equal(first.hash, second.hash);
  assert.equal(first.path, second.path);
  assert.equal(first.kind, 'video');
  assert.equal(first.width, 320);
  assert.ok(first.thumbnailPath);
  assert.equal(await digest(join(workspace, first.path)), first.hash);
  await readFile(join(workspace, first.thumbnailPath));

  // A syntactically valid but semantically invalid analysis cache is never trusted.
  const probeCache = join(workspace, 'cache', `${first.hash}-probe-v1.json`);
  await writeFile(probeCache, JSON.stringify({ kind: 'video' }));
  const repaired = await importMedia({ workspace, sourcePath: source });
  assert.equal(repaired.width, 320);
  assert.equal(JSON.parse(await readFile(probeCache, 'utf8')).hash, first.hash);
});

test('renderer performs decoded cuts, card order, and delayed narration mix', async () => {
  const { workspace, fixtures } = await fixtureWorkspace();
  const redPath = join(fixtures, 'red.mp4');
  const bluePath = join(fixtures, 'blue.mp4');
  const narrationPath = join(fixtures, 'voice.wav');
  ffmpeg(['-f', 'lavfi', '-i', 'color=c=red:s=160x90:r=30:d=1', '-pix_fmt', 'yuv420p', redPath]);
  ffmpeg(['-f', 'lavfi', '-i', 'color=c=blue:s=160x90:r=30:d=1', '-pix_fmt', 'yuv420p', bluePath]);
  ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=1000:sample_rate=48000:duration=0.4', narrationPath]);
  const importedRed = await importMedia({ workspace, sourcePath: redPath });
  const importedBlue = await importMedia({ workspace, sourcePath: bluePath });
  const importedNarration = await importMedia({ workspace, sourcePath: narrationPath });
  const assets = [
    { ...importedRed, id: 'red' }, { ...importedBlue, id: 'blue' },
    { ...importedNarration, id: 'voice' },
  ];
  const episode = { cards: [
    { visual: { assetId: 'red', in: .1, out: .6, offset: 0, gain: 0 }, duration: .5,
      narration: { assetId: 'voice', in: 0, out: .3, offset: .2, gain: .5 } },
    { visual: { assetId: 'blue', in: .2, out: .7, offset: 0, gain: 1 }, duration: .5, narration: null },
  ] };
  const outputPath = join(workspace, 'exports', 'episode.mp4');
  const progress = [];
  const result = await renderEpisode({ workspace, episode, assets, outputPath, preview: true,
    onProgress: value => progress.push(value) });
  const rendered = await probeMedia(outputPath);
  assert.equal(result.path, outputPath);
  assert.equal(result.width, 1280);
  assert.equal(result.height, 720);
  assert.ok(Math.abs(rendered.duration - 1) <= 1 / 30);
  assert.ok(progress.at(-1) === 1);

  // Sample the centre pixel in each half. This also proves concat order and decoded trimming.
  const sampled = spawnSync('ffmpeg', ['-v', 'error', '-i', outputPath, '-vf',
    "select='eq(n,6)+eq(n,21)',scale=1:1,format=rgb24", '-fps_mode', 'vfr', '-f', 'rawvideo', '-']);
  assert.equal(sampled.status, 0, sampled.stderr?.toString());
  const pixels = sampled.stdout;
  assert.equal(pixels.length, 6);
  assert.ok(pixels[0] > pixels[2] * 2, `first sample should be red: ${[...pixels.subarray(0, 3)]}`);
  assert.ok(pixels[5] > pixels[3] * 2, `second sample should be blue: ${[...pixels.subarray(3, 6)]}`);

  const silence = spawnSync('ffmpeg', ['-v', 'info', '-i', outputPath, '-af',
    'silencedetect=noise=-35dB:d=0.1', '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
  assert.match(silence, /silence_end: 0\.2/);
});

test('validation rejects traversal, missing visuals, invalid ranges, and narration overflow', async () => {
  const { workspace } = await fixtureWorkspace();
  const video = { id: 'v', kind: 'video', path: 'media/v.mp4', duration: 2, metadata: { hasAudio: false } };
  const audio = { id: 'a', kind: 'audio', path: 'media/a.wav', duration: 2, metadata: { hasAudio: true } };
  const base = { workspace, assets: [video, audio], outputPath: 'exports/out.mp4' };
  assert.throws(() => validateRenderPlan({ ...base, episode: { cards: [{}] } }), /no visual/);
  assert.throws(() => validateRenderPlan({ ...base, episode: { cards: [{ visual: { assetId: 'v', in: 1, out: 3 } }] } }), /exceeds/);
  assert.throws(() => validateRenderPlan({ ...base, episode: { cards: [{ visual: { assetId: 'v', in: 0, out: 1 }, narration: { assetId: 'a', in: 0, out: 1, offset: .5 } }] } }), /beyond/);
  assert.throws(() => validateRenderPlan({ ...base, outputPath: '../escape.mp4', episode: { cards: [{ visual: { assetId: 'v', in: 0, out: 1 } }] } }), /inside/);
  assert.throws(() => validateRenderPlan({ ...base, episode: { cards: [{ visual: { assetId: 'v', in: 0.001, out: 0.01 } }] } }), /shorter than one 30fps frame/);
  await writeFile(join(workspace, 'unchanged'), 'ok');
});

test('omitted duration derives from quantized endpoints for arbitrary fractional cuts', async () => {
  const { workspace } = await fixtureWorkspace();
  const video = { id: 'v', kind: 'video', path: 'media/v.mp4', duration: 2, metadata: { hasAudio: false } };
  const base = { workspace, assets: [video], outputPath: 'exports/out.mp4' };
  const short = validateRenderPlan({ ...base, episode: { cards: [{ visual: { assetId: 'v', in: 0.02, out: 0.08 } }] } });
  assert.equal(short.cards[0].vin, 1 / 30);
  assert.equal(short.cards[0].vout, 2 / 30);
  assert.equal(short.cards[0].duration, 1 / 30);

  const arbitrary = validateRenderPlan({ ...base, episode: { cards: [{ visual: { assetId: 'v', in: 0.101, out: 0.284 } }] } });
  assert.equal(arbitrary.cards[0].vin, 3 / 30);
  assert.equal(arbitrary.cards[0].vout, 9 / 30);
  assert.equal(arbitrary.cards[0].duration, 6 / 30);

  assert.throws(() => validateRenderPlan({ ...base, episode: { cards: [{
    visual: { assetId: 'v', in: 0.02, out: 0.08 }, duration: 0.08,
  }] } }), /range must equal its duration/);
});

test('decoded trims select intended source frames and preserve the card boundary', async () => {
  const { workspace, fixtures } = await fixtureWorkspace();
  const source = join(fixtures, 'timeline.mp4');
  ffmpeg([
    '-f', 'lavfi', '-i', 'color=c=red:s=160x90:r=30:d=0.4',
    '-f', 'lavfi', '-i', 'color=c=green:s=160x90:r=30:d=0.4',
    '-f', 'lavfi', '-i', 'color=c=blue:s=160x90:r=30:d=0.4',
    '-filter_complex', '[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]', '-map', '[v]',
    '-c:v', 'libx264', '-g', '30', '-pix_fmt', 'yuv420p', source,
  ]);
  const imported = await importMedia({ workspace, sourcePath: source });
  const assets = [{ ...imported, id: 'timeline' }];
  const episode = { cards: [
    { visual: { assetId: 'timeline', in: 0.4, out: 0.8, offset: 0, gain: 0 }, duration: 0.4 },
    { visual: { assetId: 'timeline', in: 0.8, out: 1.2, offset: 0, gain: 0 }, duration: 0.4 },
  ] };
  const outputPath = join(workspace, 'exports', 'precise.mp4');
  await renderEpisode({ workspace, episode, assets, outputPath, preview: true });
  const sampled = spawnSync('ffmpeg', ['-v', 'error', '-i', outputPath, '-vf',
    "select='eq(n,0)+eq(n,11)+eq(n,12)+eq(n,23)',scale=1:1,format=rgb24",
    '-fps_mode', 'vfr', '-f', 'rawvideo', '-']);
  assert.equal(sampled.status, 0, sampled.stderr?.toString());
  assert.equal(sampled.stdout.length, 12);
  const samples = Array.from({ length: 4 }, (_, index) => [...sampled.stdout.subarray(index * 3, index * 3 + 3)]);
  for (const [red, green, blue] of samples.slice(0, 2)) {
    assert.ok(green > red * 1.5 && green > blue * 1.5, `expected green source segment, got ${[red, green, blue]}`);
  }
  for (const [red, green, blue] of samples.slice(2)) {
    assert.ok(blue > red * 1.5 && blue > green * 1.5, `expected blue source segment, got ${[red, green, blue]}`);
  }
});

test('cancellation leaves no completed output and output aliases cannot replace originals', async () => {
  const { workspace, fixtures } = await fixtureWorkspace();
  const source = join(fixtures, 'source.mp4');
  ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=s=160x90:r=30:d=1', '-pix_fmt', 'yuv420p', source]);
  const imported = await importMedia({ workspace, sourcePath: source });
  const asset = { ...imported, id: 'v' };
  const episode = { cards: [{ visual: { assetId: 'v', in: 0, out: 1, offset: 0, gain: 0 } }] };
  const outputPath = join(workspace, 'exports', 'cancelled.mp4');
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(renderEpisode({ workspace, episode, assets: [asset], outputPath, preview: true,
    signal: controller.signal }), { name: 'AbortError' });
  await assert.rejects(access(outputPath));

  const alias = join(workspace, 'exports', 'source-alias.mp4');
  await symlink(join(workspace, imported.path), alias);
  const before = await digest(source);
  await assert.rejects(renderEpisode({ workspace, episode, assets: [asset], outputPath: alias, preview: true }), /overwrite/);
  assert.equal(await digest(source), before);
});

test('export path produces a short 1920x1080 artifact', async () => {
  const { workspace, fixtures } = await fixtureWorkspace();
  const source = join(fixtures, 'export-source.mp4');
  ffmpeg(['-f', 'lavfi', '-i', 'color=c=purple:s=160x90:r=30:d=0.2', '-pix_fmt', 'yuv420p', source]);
  const imported = await importMedia({ workspace, sourcePath: source });
  const asset = { ...imported, id: 'v' };
  const outputPath = join(workspace, 'exports', 'full.mp4');
  const result = await renderEpisode({ workspace, assets: [asset], outputPath, preview: false,
    episode: { cards: [{ visual: { assetId: 'v', in: 0, out: 0.2, offset: 0, gain: 0 } }] } });
  assert.deepEqual([result.width, result.height], [1920, 1080]);
  const probed = await probeMedia(outputPath);
  assert.deepEqual([probed.width, probed.height], [1920, 1080]);
  assert.ok(Math.abs(probed.duration - 0.2) <= 1 / 30);
});

test('optional real VP9 footage renders odd and ultrawide sources without mutation', {
  skip: !process.env.STORYBENCH_REAL_MEDIA_DIR,
}, async () => {
  const { workspace } = await fixtureWorkspace();
  const directory = process.env.STORYBENCH_REAL_MEDIA_DIR;
  const sources = [
    join(directory, 'Screencast_20260911_001824.webm'),
    join(directory, 'Screencast_20260911_002734.webm'),
  ];
  const before = await Promise.all(sources.map(digest));
  const imports = await Promise.all(sources.map(sourcePath => importMedia({ workspace, sourcePath })));
  const assets = imports.map((asset, index) => ({ ...asset, id: `real-${index}` }));
  const episode = { cards: assets.map(asset => ({
    visual: { assetId: asset.id, in: 0.1, out: 0.6, offset: 0, gain: 0 }, duration: 0.5,
  })) };
  const outputPath = join(workspace, 'exports', 'real-preview.mp4');
  await renderEpisode({ workspace, episode, assets, outputPath, preview: true });
  const rendered = await probeMedia(outputPath);
  assert.equal(rendered.width, 1280);
  assert.equal(rendered.height, 720);
  assert.ok(Math.abs(rendered.duration - 1) <= 1 / 30);
  assert.deepEqual(await Promise.all(sources.map(digest)), before);
});

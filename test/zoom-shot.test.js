import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderZoomShot } from '../src/runtime/worker/zoom-shot.mjs';
import { makeZoomFixtures } from '../test-support/zoom-shot-example.mjs';

const cli = fileURLToPath(new URL('../src/runtime/worker/zoom-shot.mjs', import.meta.url));
const dir = await mkdtemp(join(tmpdir(), 'zoom-shot-'));
let recipes;
before(async () => { recipes = await makeZoomFixtures(dir); });
after(() => rm(dir, { recursive: true, force: true }));

function rgb(path, extra = []) {
  return execFileSync('ffmpeg', ['-v', 'error', '-threads', '1', '-i', path, ...extra, '-an', '-threads', '1',
    '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 32 * 1024 * 1024 });
}

function streams(path) {
  return JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', path])).streams;
}

// Independent nearest-neighbor reference. Real encoding and subpixel filtering differ
// near glyph edges, so compare mean RGB error separately inside and outside the frame.
function checkFrame({ actual, source, index, srcIndex, progress, recipe }) {
  const { width, height, frame, startCrop, endCrop } = recipe;
  const [x, y, w, h] = frame;
  const crop = startCrop.map((v, i) => v + (endCrop[i] - v) * progress);
  const totals = [0, 0], counts = [0, 0];
  for (let j = 1; j < height; j += 2) {
    for (let i = 1; i < width; i += 2) {
      const u = (i + 0.5) / width, v = (j + 0.5) / height;
      const inside = Number(u >= x && u < x + w && v >= y && v < y + h);
      const sx = Math.floor(640 * (inside ? crop[0] + (u - x) / w * crop[2] : u));
      const sy = Math.floor(360 * (inside ? crop[1] + (v - y) / h * crop[3] : v));
      const a = 3 * ((index * height + j) * width + i);
      const b = 3 * ((srcIndex * 360 + sy) * 640 + sx);
      for (let c = 0; c < 3; c++) totals[inside] += Math.abs(actual[a + c] - source[b + c]);
      counts[inside] += 3;
    }
  }
  for (const [k, region] of ['context', 'detail'].entries()) {
    const diff = totals[k] / counts[k];
    assert.ok(diff < (k ? 12 : 6), `frame ${index} at progress ${progress}: ${region} mean RGB error ${diff}`);
  }
}

function checkColor(buffer, frame, x, y, expected) {
  const offset = 3 * ((frame * 360 + y) * 640 + x);
  for (let c = 0; c < 3; c++) assert.ok(Math.abs(buffer[offset + c] - expected[c]) < 12);
}

for (const name of ['still', 'moving']) {
  test(`${name}: fixed exterior, eased motion, early landing and hold on the shot clock`, async () => {
    const recipe = recipes[name];
    const path = join(dir, name + '.mp4');
    execFileSync(process.execPath, [cli, join(dir, name + '.json'), path]);
    const [video, audio] = streams(path);
    assert.equal(Number(video.nb_frames), 16);
    assert.equal(video.width, 640);
    assert.equal(video.height, 360);
    assert.equal(Number(video.duration), 2);
    assert.equal(audio?.codec_type, name === 'moving' ? 'audio' : undefined);
    if (audio) assert.ok(Math.abs(Number(audio.duration) - 2) < 0.025);
    const actual = rgb(path), source = rgb(join(dir, recipe.source));
    for (const [index, progress] of [[0, 0], [2, 0], [4, 0.15625], [6, 0.5], [8, 0.84375], [10, 1], [15, 1]]) {
      checkFrame({ actual, source, index, srcIndex: name === 'moving' ? index + 4 : 0, progress, recipe });
    }
    // The top-right counter and its enlarged legend marker both keep playing in the hold.
    for (const index of [10, 11, 12, 13, 14, 15]) {
      const srcIndex = name === 'moving' ? index + 4 : 0;
      const marker = 3 * ((srcIndex * 360 + 16) * 640 + 624);
      const expected = source.subarray(marker, marker + 3);
      checkColor(actual, index, 624, 16, expected);
      checkColor(actual, index, 498, 266, expected);
    }
  });
}

test('a range beginning between source frames samples the frame on screen, including its last fraction', async () => {
  const recipe = { ...recipes.moving, source: join(dir, 'dashboard.mp4'), sourceRange: [2.8125, 3],
    startCrop: recipes.moving.endCrop, moveStart: 0, land: 0, hold: 0.1875 };
  const out = join(dir, 'tail.mp4');
  await renderZoomShot(recipe, out);
  const actual = rgb(out), source = rgb(recipe.source);
  assert.equal(streams(out)[0].nb_frames, '2');
  for (const index of [0, 1]) {
    const marker = 3 * (((22 + index) * 360 + 16) * 640 + 624);
    checkColor(actual, index, 624, 16, source.subarray(marker, marker + 3));
  }
});

test('saved normalized crops reverse at half resolution, or stay still', async () => {
  const base = recipes.still;
  const source = rgb(join(dir, base.source));
  for (const reverse of [true, false]) {
    const recipe = { ...base, source: join(dir, base.source), width: 320, height: 180, easing: 'linear',
      startCrop: base.endCrop, endCrop: reverse ? base.startCrop : base.endCrop,
      moveStart: 0, land: reverse ? 1 : 0, hold: reverse ? 0.5 : 1.5 };
    const path = join(dir, reverse ? 'reverse.mp4' : 'static.mp4');
    await renderZoomShot(recipe, path);
    const actual = rgb(path);
    for (const [index, progress] of [[0, 0], [2, 0.25], [8, 1], [11, 1]]) {
      checkFrame({ actual, source, index, srcIndex: 0, progress, recipe });
    }
  }
});

test('crops use displayed coordinates of an EXIF still and a display-matrix clip', async () => {
  // Store the dashboard sideways, then restore it with a clockwise display rotation.
  execFileSync('ffmpeg', ['-v', 'error', '-i', join(dir, 'dashboard.png'), '-vf', 'transpose=cclock',
    '-frames:v', '1', '-q:v', '2', join(dir, 'sideways.jpg')]);
  const jpeg = await readFile(join(dir, 'sideways.jpg'));
  const orientation6 = Buffer.from('ffe1002245786966000049492a0008000000010012010300010000000600000000000000', 'hex');
  await writeFile(join(dir, 'oriented.jpg'), Buffer.concat([jpeg.subarray(0, 2), orientation6, jpeg.subarray(2)]));
  execFileSync('ffmpeg', ['-v', 'error', '-i', join(dir, 'dashboard.mp4'), '-vf', 'transpose=cclock', '-crf', '0',
    '-threads', '2', join(dir, 'sideways.mp4')]);
  execFileSync('ffmpeg', ['-v', 'error', '-display_rotation', '-90', '-i', join(dir, 'sideways.mp4'), '-c', 'copy', join(dir, 'oriented.mp4')]);
  for (const [name, file] of [['still', 'oriented.jpg'], ['moving', 'oriented.mp4']]) {
    const recipe = { ...recipes[name], source: join(dir, file) };
    const out = join(dir, name + '-oriented.mp4');
    await renderZoomShot(recipe, out);
    const actual = rgb(out), source = rgb(join(dir, recipes[name].source));
    checkFrame({ actual, source, index: 10, srcIndex: name === 'moving' ? 14 : 0, progress: 1, recipe });
  }
});

test('incompatible crops, ranges and timing identify the field and preserve the prior output', async () => {
  const recipe = { ...recipes.moving, source: join(dir, recipes.moving.source) };
  const path = join(dir, 'previous.mp4');
  await writeFile(path, 'previous output');
  for (const [field, bad] of [
    ['frame', [-0.1, 0, 1, 1]], ['startCrop', [0, 0, 0.5, 1]], ['endCrop', [0.8, 0.3, 0.4, 0.4]],
    ['sourceRange', [-1, 1]], ['sourceRange', [2, 4]], ['sourceRange', [0, 1]],
    ['moveStart', -1], ['land', 0], ['hold', -1], ['easing', 'unknown'],
  ]) {
    await assert.rejects(renderZoomShot({ ...recipe, [field]: bad }, path), new RegExp('^Error: ' + field + ':'));
  }
  assert.equal(await readFile(path, 'utf8'), 'previous output');
});

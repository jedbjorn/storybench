import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DEFAULT_GRAPHIC_FONT, GraphicValidationError, renderGraphic, validateGraphicRecipe } from '../src/graphics.js';

async function workspace(t) {
  const root = await mkdtemp(join(tmpdir(), 'storybench-graphics-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
function ffprobe(path) {
  const result = spawnSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,width,height,avg_frame_rate,nb_read_frames:format=duration', '-of', 'json', path], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr); return JSON.parse(result.stdout);
}
function frameMd5(path, select) {
  const result = spawnSync('ffmpeg', ['-v', 'error', '-i', path, '-vf', `select='eq(n,${select})'`, '-frames:v', '1', '-f', 'md5', '-'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr); return result.stdout.trim();
}

test('renders and decodes a composed PNG with registered bitmap input', async t => {
  const root = await workspace(t);
  const seed = join(root, 'seed.png');
  await renderGraphic({ workspace: root, outputPath: seed, recipe: { kind: 'still', width: 40, height: 40, background: 'blue', layers: [{ kind: 'ellipse', x: 20, y: 20, rx: 15, ry: 15, fill: 'yellow' }] } });
  const output = join(root, 'still.png');
  const result = await renderGraphic({
    workspace: root, outputPath: output, resolveImage: id => id === 'logo' ? seed : null,
    recipe: { kind: 'still', width: 320, height: 180, background: '#112233', layers: [
      { kind: 'rectangle', x: 10, y: 10, width: 100, height: 60, fill: 'red', z: 1 },
      { kind: 'ellipse', x: 170, y: 50, rx: 30, ry: 20, fill: 'green', z: 2 },
      { kind: 'line', x: 0, y: 100, x2: 200, y2: 100, stroke: 'white', strokeWidth: 4 },
      { kind: 'path', x: 220, y: 80, d: 'M 0 40 L 30 0 L 60 40 Z', fill: 'purple' },
      { kind: 'image', itemId: 'logo', x: 260, y: 10, width: 40, height: 40 },
      { kind: 'text', x: 15, y: 160, text: 'Storybench', fontSize: 28, fontFamily: 'Unavailable Face', fill: 'white' },
    ] },
  });
  assert.equal(result.kind, 'image'); assert.equal(result.metadata.fontFallback, 'DejaVu Sans');
  const bytes = await readFile(output); assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const probe = ffprobe(output); assert.equal(probe.streams[0].width, 320); assert.equal(probe.streams[0].height, 180);
});

test('uses only the supported deterministic DejaVu Sans locations', () => assert.deepEqual(DEFAULT_GRAPHIC_FONT, {
  family: 'DejaVu Sans',
  paths: ['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '/usr/share/fonts/TTF/DejaVuSans.ttf'],
}));

test('renders a decoded 2-second 60-frame motion clip with distinct keyframes', async t => {
  const root = await workspace(t); const output = join(root, 'motion.mp4');
  const result = await renderGraphic({ workspace: root, outputPath: output, recipe: { kind: 'motion', width: 320, height: 180, duration: 2, fps: 30, background: 'black', layers: [{ kind: 'rectangle', x: 10, y: 50, width: 60, height: 60, fill: 'orange', keyframes: { x: [{ time: 0, value: 10 }, { time: 2, value: 240 }], opacity: [{ time: 0, value: 0.2, easing: 'hold' }, { time: 1, value: 1 }, { time: 2, value: 0.5 }] } }] } });
  assert.equal(result.metadata.frames, 60);
  const probe = ffprobe(output); assert.equal(probe.streams[0].codec_name, 'h264'); assert.equal(probe.streams[0].nb_read_frames, '60'); assert.equal(Number(probe.format.duration), 2);
  const hashes = [frameMd5(output, 0), frameMd5(output, 30), frameMd5(output, 59)]; assert.equal(new Set(hashes).size, 3);
});

test('rejects limits and injection-shaped or unregistered resources with stable errors', async t => {
  const base = { kind: 'still', width: 100, height: 100, layers: [] };
  assert.throws(() => validateGraphicRecipe({ ...base, width: 1921 }), error => error instanceof GraphicValidationError && error.code === 'INVALID_NUMBER' && error.path === 'width');
  assert.throws(() => validateGraphicRecipe({ ...base, layers: Array.from({ length: 101 }, () => ({ kind: 'text', text: 'x' })) }), error => error.code === 'LAYER_LIMIT');
  assert.throws(() => validateGraphicRecipe({ ...base, layers: [{ kind: 'rectangle', width: 10, height: 10, fill: 'url(https://example.test/a)' }] }), error => error.code === 'INVALID_COLOR');
  assert.throws(() => validateGraphicRecipe({ ...base, background: 'url(file:///etc/passwd)' }), error => error.code === 'INVALID_COLOR');
  const normalized = validateGraphicRecipe({ ...base, layers: [{ kind: 'rectangle', width: 10, height: 10 }] });
  assert.deepEqual(validateGraphicRecipe(normalized), normalized);
  assert.throws(() => validateGraphicRecipe({ ...base, layers: [{ kind: 'path', d: 'M0 0 url(file:///etc/passwd)' }] }), error => error.code === 'INVALID_PATH');
  const root = await workspace(t);
  await assert.rejects(renderGraphic({ workspace: root, outputPath: join(root, 'bad.png'), resolveImage: () => '/etc/passwd', recipe: { ...base, layers: [{ kind: 'image', itemId: 'bad' }] } }), error => error.code === 'IMAGE_PATH_ESCAPE');
  await writeFile(join(root, 'fake.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  await assert.rejects(renderGraphic({ workspace: root, outputPath: join(root, 'svg.png'), resolveImage: () => join(root, 'fake.svg'), recipe: { ...base, layers: [{ kind: 'image', itemId: 'svg' }] } }), error => error.code === 'INVALID_IMAGE');
  assert.throws(() => validateGraphicRecipe({ kind: 'motion', width: 321, height: 180, duration: 1, fps: 30, layers: [] }), error => error.code === 'MOTION_DIMENSIONS' && error.path === 'width');
  const fallback = validateGraphicRecipe({ ...base, layers: [{ kind: 'text', text: 'Fallback', fontFamily: 'Unavailable Face' }] });
  assert.equal(fallback.layers[0].fontFamily, 'DejaVu Sans');
});

test('rejects excessive decoded image dimensions and aggregate resources before rasterization', async t => {
  const root = await workspace(t); const oversized = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(oversized); oversized.writeUInt32BE(10000, 16); oversized.writeUInt32BE(10000, 20);
  await assert.rejects(renderGraphic({ workspace: root, outputPath: join(root, 'huge.png'), resolveImage: () => ({ data: oversized, mimeType: 'image/png' }), recipe: { kind: 'still', width: 100, height: 100, layers: [{ kind: 'image', itemId: 'huge' }] } }), error => error.code === 'IMAGE_PIXEL_LIMIT');
  const seed = join(root, 'seed.png');
  await renderGraphic({ workspace: root, outputPath: seed, recipe: { kind: 'still', width: 1920, height: 1080, layers: [] } });
  const layers = Array.from({ length: 17 }, (_, index) => ({ kind: 'image', itemId: `image-${index}` }));
  await assert.rejects(renderGraphic({ workspace: root, outputPath: join(root, 'aggregate.png'), resolveImage: () => seed, recipe: { kind: 'still', width: 100, height: 100, layers } }), error => error.code === 'IMAGE_TOTAL_LIMIT');
});

test('cancellation removes output and module temporary files while preserving sources', async t => {
  const root = await workspace(t); const source = join(root, 'source.png');
  await renderGraphic({ workspace: root, outputPath: source, recipe: { kind: 'still', width: 80, height: 80, background: 'red', layers: [] } });
  const sourceBefore = await readFile(source); const output = join(root, 'cancelled.mp4'); const controller = new AbortController();
  await assert.rejects(renderGraphic({ workspace: root, outputPath: output, resolveImage: () => source, signal: controller.signal, onProgress: value => { if (value > 0) controller.abort(); }, recipe: { kind: 'motion', width: 1920, height: 1080, duration: 30, fps: 30, background: 'black', layers: [{ kind: 'image', itemId: 'source', width: 80, height: 80, keyframes: { x: [{ time: 0, value: 0 }, { time: 30, value: 1000 }] } }] } }), error => error.name === 'AbortError');
  assert.deepEqual(await readFile(source), sourceBefore); assert.deepEqual((await readdir(root)).sort(), ['source.png']);
});

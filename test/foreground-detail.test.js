import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { renderForegroundDetail } from '../src/shot-helpers/foreground-detail.js';

function ffmpeg(...args) {
  return execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-filter_threads', '1', '-threads', '1', ...args]);
}

async function workspace(t) {
  const parent = process.env.STORYBENCH_EVIDENCE_DIR || tmpdir();
  await mkdir(parent, { recursive: true });
  const dir = await mkdtemp(join(parent, 'foreground-detail-'));
  if (process.env.STORYBENCH_EVIDENCE_DIR) t.diagnostic(dir);
  else t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

function dashboard(dir) {
  const path = join(dir, 'counter.mp4');
  // The human-readable counter has a four-bit companion for direct frame checks.
  const bits = Array.from({ length: 4 }, (_, i) =>
    `drawbox=x=${2 + 8 * i}:y=2:w=6:h=6:c=white:t=fill:enable='mod(floor(n/${2 ** i}),2)'`);
  ffmpeg('-f', 'lavfi', '-i', 'color=c=0x408060:s=160x96:r=8:d=2',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=2',
    '-vf', ['drawbox=x=0:y=0:w=40:h=24:c=black:t=fill', ...bits,
      "drawtext=text='%{n}':x=2:y=10:fontsize=12:fontcolor=white",
      "drawtext=text='COUNTER':x=2:y=28:fontsize=10:fontcolor=white"].join(','),
    '-af', "volume=0.25:enable='lt(t,0.75)'", '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', path);
  return path;
}

function recipe(dir, background) {
  return { background: { path: background, start: 0.25 },
    foreground: { crop: { x: 0, y: 0, width: 0.25, height: 0.25 } },
    width: 160, height: 96, fps: 8, duration: 1.5,
    destination: { x: 0.5, y: 0.5, width: 0.5, height: 0.5 },
    entranceStart: 0.25, landAt: 0.5, holdUntil: 1.25, dim: 0.25,
    outputPath: join(dir, 'detail.mp4') };
}

async function renderSaved(options) {
  const params = options.outputPath + '.json';
  await writeFile(params, JSON.stringify(options, null, 2));
  return renderForegroundDetail(JSON.parse(await readFile(params, 'utf8')));
}

function sample(path, n, width) {
  const ppm = ffmpeg('-i', path, '-vf', `select=eq(n\\,${n})`, '-frames:v', '1', '-c:v', 'ppm', '-f', 'image2pipe', '-');
  const header = /^P6\s+(\d+)\s+(\d+)\s+255\s/.exec(ppm.subarray(0, 64).toString('latin1'));
  assert.equal(Number(header?.[1]), width);
  const rgb = ppm.subarray(header[0].length);
  return { ppm, pixel(x, y) {
    const i = 3 * (y * width + x);
    return [...rgb.subarray(i, i + 3)];
  } };
}

function counter(frame, x, y, scale) {
  let value = 0;
  for (let bit = 0; bit < 4; bit++) {
    const [red] = frame.pixel(x + scale * (4 + 8 * bit), y + scale * 4);
    if (red > 140) value += 2 ** bit;
  }
  return value;
}

function pcm(path) {
  return ffmpeg('-i', path, '-map', '0:a:0', '-ac', '1', '-ar', '48000', '-f', 'f32le', '-');
}

function checkBackingAudio(output, backing, start) {
  const streams = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', output])).streams;
  assert.equal(streams.filter(stream => stream.codec_type === 'audio').length, 1);
  const got = pcm(output), source = pcm(backing);
  // Compare waveform and level at sample-aligned windows across the gain change.
  for (const time of [0.15, 0.7, 1.1]) {
    let energy = 0, squaredError = 0;
    for (let i = 0; i < 2400; i++) {
      const a = got.readFloatLE(4 * (Math.round(time * 48000) + i));
      const b = source.readFloatLE(4 * (Math.round((start + time) * 48000) + i));
      squaredError += (a - b) ** 2;
      energy += b ** 2;
    }
    assert.ok(squaredError / energy < 0.03, `backing audio at ${time}s: relative error ${squaredError / energy}`);
  }
}

test('the enlarged source counter agrees with its backing throughout the hold', async t => {
  const dir = await workspace(t);
  const input = dashboard(dir);
  const shot = { ...recipe(dir, input), background: { path: input, start: 0.33 } };
  await renderSaved(shot);
  const { outputPath } = shot;
  const opening = sample(outputPath, 0, 160);
  const entering = sample(outputPath, 3, 160);
  assert.equal(counter(opening, 0, 0, 1), 2);
  assert.ok(opening.pixel(85, 55)[1] > 110, 'context visible before entrance');
  // This bit is on for source frame 5. At mid-entrance its enlarged copy is translucent.
  const mid = entering.pixel(88, 56)[0];
  assert.ok(mid > 125 && mid < 190, `half-faded detail: ${mid}`);
  for (let n = 4; n < 10; n++) {
    const frame = sample(outputPath, n, 160);
    assert.equal(counter(frame, 0, 0, 1), n + 2);
    assert.equal(counter(frame, 80, 48, 2), n + 2);
    const context = frame.pixel(70, 70)[1] / opening.pixel(70, 70)[1];
    assert.ok(context > 0.69 && context < 0.82, `background dim: ${context}`);
    if (n === 4 || n === 9) await writeFile(join(dir, `hold-${n}.ppm`), frame.ppm);
  }
  const after = sample(outputPath, 10, 160);
  assert.ok(after.pixel(85, 55)[1] > 110, 'the full context returns after the hold');
  await writeFile(join(dir, 'opening.ppm'), opening.ppm);
  await writeFile(join(dir, 'entrance.ppm'), entering.ppm);
  checkBackingAudio(outputPath, input, shot.background.start);
  await assert.rejects(renderForegroundDetail(shot), { code: 'EEXIST' });
});

test('an oriented separate panel fits its moved bounds and preserves the explicit crop', async t => {
  const dir = await workspace(t);
  const input = dashboard(dir);
  const encoded = join(dir, 'landscape.mp4'), panel = join(dir, 'rotated-panel.mp4');
  ffmpeg('-f', 'lavfi', '-i', 'color=c=red:s=48x24:r=8:d=1', '-f', 'lavfi', '-i', 'sine=frequency=900:duration=1',
    '-vf', "drawbox=y=12:w=iw:h=12:c=blue:t=fill,drawbox=x=0:w=12:h=ih:c=magenta:t=fill,drawbox=x=12:y=0:w=36:h=12:c=lime:t=fill:enable='gte(n,4)',setsar=2/1",
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', encoded);
  ffmpeg('-display_rotation:v:0', '90', '-i', encoded, '-c', 'copy', panel);
  const shot = { ...recipe(dir, input), width: 192, height: 192, dim: 0,
    foreground: { path: panel, start: 0.16, crop: { x: 0, y: 0, width: 1, height: 0.75 } },
    destination: { x: 0.125, y: 0.25, width: 0.5, height: 0.375 },
    entranceStart: 0.46, landAt: 0.46, holdUntil: 1.25 };
  await renderSaved(shot);
  // Background 160:96 fits 192x115. Rotated 24x36 crop with 1:2 pixel aspect fits 24x72
  // centered in the 96x72 destination, with its magenta end discarded.
  for (const n of [4, 6, 7, 9]) {
    const frame = sample(shot.outputPath, n, 192);
    const [r, g] = frame.pixel(65, 88);
    assert.ok(n < 7 ? r > 215 && g < 30 : g > 210 && r < 30, `separate panel in-point at frame ${n}: ${r},${g}`);
    for (const y of [50, 117]) {
      const [red, , blue] = frame.pixel(78, y);
      assert.ok(red < 35 && blue > 210, `cropped blue edge at y=${y}`);
    }
    for (const [x, y] of [[57, 100], [86, 100], [66, 122]]) {
      assert.ok(Math.abs(frame.pixel(x, y)[1] - 128) < 10, 'backing visible just outside panel');
    }
    assert.ok(frame.pixel(170, 34)[1] < 15 && frame.pixel(170, 40)[1] > 110, 'aspect-correct backing letterbox');
    await writeFile(join(dir, `panel-${n}.ppm`), frame.ppm);
  }
  checkBackingAudio(shot.outputPath, input, shot.background.start);
});

test('still backing holds silently and invalid fields leave no shot behind', async t => {
  const dir = await workspace(t);
  const video = dashboard(dir), still = join(dir, 'dashboard.png');
  ffmpeg('-i', video, '-frames:v', '1', still);
  const shot = { ...recipe(dir, still), background: { path: still } };
  await renderSaved(shot);
  const streams = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', shot.outputPath])).streams;
  assert.deepEqual(streams.map(stream => stream.codec_type), ['video']);
  assert.equal(Number(streams[0].nb_frames), 12);
  const longAudio = join(dir, 'long-audio.mkv');
  ffmpeg('-i', video, '-f', 'lavfi', '-i', 'sine=duration=4', '-map', '0:v', '-map', '1:a', '-c:v', 'copy', longAudio);
  const before = await readdir(dir);
  for (const [changes, error] of [
    [{ foreground: { crop: { x: 0.8, y: 0, width: 0.5, height: 1 } } }, /foreground.crop/],
    [{ destination: { x: 0, y: 0, width: 0.0001, height: 1 } }, /destination/],
    [{ background: { path: video, start: 1 } }, /background.start/],
    [{ foreground: { path: video, start: 1.75 } }, /foreground.start/],
    [{ background: { path: longAudio, start: 1 } }, /background.start/],
    [{ duration: 0.001 }, /duration/],
    [{ landAt: 0.125 }, /landAt/],
    [{ holdUntil: 0.4 }, /holdUntil/],
  ]) {
    await assert.rejects(renderForegroundDetail({ ...shot, ...changes, outputPath: join(dir, 'invalid.mp4') }), error);
  }
  assert.deepEqual(await readdir(dir), before);
});

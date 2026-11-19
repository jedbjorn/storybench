// node zoom-shot.mjs recipe.json shot.mp4
// Or await renderZoomShot(recipe, outputPath) from a longer worker script.
// CLI source paths are relative to the recipe. Imported calls use the caller's cwd.
// Rectangles are normalized [left, top, width, height]. frame is in output space,
// crops in displayed source space. moveStart and land are seconds from shot start.
// land + hold sets the duration. Clips supply a matching [in, out] sourceRange;
// stills omit it. The context fits the canvas with centered letterboxing.
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile, realpath, rename, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const invalid = (field, message) => { throw new Error(`${field}: ${message}`); };
const ffmpeg = ['-nostdin', '-v', 'error', '-threads', '2', '-filter_complex_threads', '2'];

function rectangle(value, field) {
  if (!Array.isArray(value) || value.length !== 4 || !value.every(Number.isFinite)) {
    invalid(field, 'expected normalized [left, top, width, height]');
  }
  const [x, y, w, h] = value;
  if (x < 0 || y < 0 || w <= 0 || h <= 0 || x + w > 1 + 1e-12 || y + h > 1 + 1e-12) {
    invalid(field, 'must have positive area and fit within the image');
  }
  return [x, y, x + w, y + h];
}

async function inspect(source) {
  const entries = 'format=format_name,start_time:stream=index,width,height,sample_aspect_ratio,start_time,duration:' +
    'stream_side_data=rotation:frame=width,height:frame_side_data=rotation';
  const { stdout } = await run('ffprobe', ['-v', 'error', '-select_streams', 'V:0', '-read_intervals', '%+#1',
    '-show_entries', entries, '-of', 'json', source]).catch(error => invalid('source', error.stderr || error.message));
  const { streams, frames, format } = JSON.parse(stdout);
  const stream = streams[0];
  if (!stream?.width || !stream.height) invalid('source', 'no visual stream');
  const rotation = [...(frames?.[0]?.side_data_list ?? []), ...(stream.side_data_list ?? [])]
    .find(data => Number.isFinite(data.rotation))?.rotation ?? 0;
  if (rotation % 90 !== 0) invalid('source', 'requires a right-angle display orientation');
  const [sw, sh] = (stream.sample_aspect_ratio ?? '').split(':').map(Number);
  const aspect = stream.width / stream.height * (sw && sh ? sw / sh : 1);
  // FFmpeg's input -ss is relative to the container's start timestamp.
  const pictureStart = Number(stream.start_time ?? format.start_time ?? 0) - Number(format.start_time ?? 0);
  return {
    index: stream.index, aspect: rotation % 180 ? 1 / aspect : aspect,
    still: format.format_name === 'image2' || format.format_name.endsWith('_pipe'),
    pictureStart,
    pictureEnd: stream.duration == null ? undefined : pictureStart + Number(stream.duration),
  };
}

// Some containers omit per-stream duration. Look for one video packet whose
// presentation interval reaches the out-point, without decoding or buffering the clip.
async function pictureReaches(source, index, end, signal) {
  const { stdout } = await run('ffmpeg', [...ffmpeg, '-i', source, '-map', `0:${index}`, '-c', 'copy',
    '-bsf:v', `noise=drop='lt((pts+duration)*tb+0.000001,${end})'`, '-frames:v', '1', '-f', 'framecrc', '-'], { signal });
  return /^0,/m.test(stdout);
}

function zoomFilter(start, end, { fps, moveStart, land, easing }) {
  // perspective maps the four source corners to the output corners. Its "in" counter starts at one.
  const phase = land === moveStart ? '0' : `clip(((in-1)/${fps}-${moveStart})/(${land}-${moveStart}),0,1)`;
  const progress = easing === 'smoothstep' ? `st(0,${phase});ld(0)*ld(0)*(3-2*ld(0))` : phase;
  const coord = i => {
    const dimension = i % 2 ? 'H' : 'W';
    if (start[i] === end[i]) return String(start[i]) + '*' + dimension;
    return `(${start[i]}+(${end[i]}-${start[i]})*(${progress}))*${dimension}`;
  };
  return 'perspective=eval=frame:interpolation=cubic:' +
    [[0, 1], [2, 1], [0, 3], [2, 3]].map(([x, y], i) => `x${i}='${coord(x)}':y${i}='${coord(y)}'`).join(':');
}

export async function renderZoomShot(recipe, outputPath, { signal } = {}) {
  const { width, height, fps, moveStart, land, hold, sourceRange, easing = 'linear' } = recipe;
  for (const [field, n] of Object.entries({ width, height })) {
    if (!Number.isInteger(n) || n < 2 || n % 2) invalid(field, 'expected a positive even pixel count');
  }
  if (!Number.isFinite(fps) || fps <= 0) invalid('fps', 'expected a positive frame rate');
  for (const [field, t] of Object.entries({ moveStart, land, hold })) {
    if (!Number.isFinite(t) || t < 0) invalid(field, 'expected nonnegative seconds');
  }
  if (land < moveStart) invalid('land', 'must be at or after moveStart');
  const duration = land + hold;
  if (duration <= 0) invalid('hold', 'land + hold must be positive');
  if (!['linear', 'smoothstep'].includes(easing)) invalid('easing', 'use linear or smoothstep');
  const frame = rectangle(recipe.frame, 'frame');
  const start = rectangle(recipe.startCrop, 'startCrop'), end = rectangle(recipe.endCrop, 'endCrop');
  if (land === moveStart && start.some((v, i) => v !== end[i])) invalid('land', 'a moving crop needs time to travel');
  if (typeof recipe.source !== 'string' || !recipe.source) invalid('source', 'expected a file path');
  const source = await realpath(recipe.source).catch(error => invalid('source', error.message));
  const output = resolve(outputPath);
  if (await realpath(output).catch(() => null) === source) invalid('output', 'would overwrite source');
  const media = await inspect(source);
  if (media.still && sourceRange !== undefined) invalid('sourceRange', 'omit for a still');
  if (!media.still) {
    if (!Array.isArray(sourceRange) || sourceRange.length !== 2 || !sourceRange.every(Number.isFinite)
        || sourceRange[0] < 0 || sourceRange[1] <= sourceRange[0]
        || Math.abs(sourceRange[1] - sourceRange[0] - duration) > 1e-6) {
      invalid('sourceRange', 'expected [in, out] spanning land + hold seconds');
    }
    if (sourceRange[0] < media.pictureStart - 1e-6) invalid('sourceRange', 'video starts after the requested in-point');
    const covered = media.pictureEnd == null
      ? await pictureReaches(source, media.index, sourceRange[1], signal)
      : sourceRange[1] <= media.pictureEnd + 1e-6;
    if (!covered) invalid('sourceRange', 'video ends before the requested out-point');
  }

  const pixels = frame.map((v, i) => Math.round(v * (i % 2 ? height : width)));
  const [left, top, right, bottom] = pixels;
  const w = right - left, h = bottom - top;
  if (!w || !h) invalid('frame', 'too small for this output resolution');
  const frameAspect = recipe.frame[2] * width / (recipe.frame[3] * height);
  for (const [field, crop] of Object.entries({ startCrop: recipe.startCrop, endCrop: recipe.endCrop })) {
    if (Math.abs(media.aspect * crop[2] / crop[3] / frameAspect - 1) > 1e-5) {
      invalid(field, 'displayed crop aspect must match frame');
    }
  }
  const baseW = Math.max(1, Math.min(width, Math.round(height * media.aspect)));
  const baseH = Math.max(1, Math.min(height, Math.round(width / media.aspect)));
  const filter = [
    `[0:${media.index}]fps=${fps}:start_time=0:round=up:eof_action=pass,format=yuv444p,split[base][detail]`,
    `[base]scale=${baseW}:${baseH},setsar=1,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2[context]`,
    `[detail]${zoomFilter(start, end, { fps, moveStart, land, easing })},scale=${w}:${h},setsar=1[view]`,
    `[context][view]overlay=${left}:${top}:format=yuv444,format=yuv420p[out]`,
  ].join(';');
  const input = media.still ? ['-loop', '1', '-framerate', String(fps)] : ['-noaccurate_seek', '-ss', String(sourceRange[0])];
  // Keep preroll from the preceding keyframe: fps picks the frame already on
  // screen at the in-point. Trim audio to the same source interval.
  const frames = Math.ceil(duration * fps - 1e-9) || 1;
  const tmp = `${output}.${randomUUID()}.tmp.mp4`;
  try {
    await run('ffmpeg', [...ffmpeg, ...input, '-i', source, '-filter_complex', filter, '-map', '[out]',
      '-map', '0:a:0?', '-af', `atrim=start=0:end=${duration}`, '-t', String(frames / fps), '-c:v', 'libx264', '-threads:v', '2', '-crf', '17',
      '-c:a', 'aac', '-movflags', '+faststart', tmp], { signal });
    const { stdout } = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries',
      'stream=nb_frames', '-of', 'csv=p=0', tmp], { signal });
    if (Number(stdout.trim()) !== frames) invalid('sourceRange', 'decoded video does not cover the shot');
    await rename(tmp, output);
  } finally {
    await rm(tmp, { force: true });
  }
  return output;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const [path, output] = process.argv.slice(2);
    if (!path || !output) throw new Error('Usage: node zoom-shot.mjs recipe.json output.mp4');
    const recipe = JSON.parse(await readFile(path, 'utf8'));
    if (typeof recipe.source === 'string' && recipe.source) recipe.source = resolve(dirname(path), recipe.source);
    await renderZoomShot(recipe, output);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { link, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';
import { probeMedia } from '../media.js';

const run = promisify(execFile);
const fullFrame = { x: 0, y: 0, width: 1, height: 1 };

function number(value, field, min, max = Infinity) {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${field} is outside its allowed range`);
  }
  return value;
}

function pixels(rect, width, height, field) {
  const x = number(rect?.x, `${field}.x`, 0, 1);
  const y = number(rect?.y, `${field}.y`, 0, 1);
  const w = number(rect?.width, `${field}.width`, 0, 1);
  const h = number(rect?.height, `${field}.height`, 0, 1);
  if (x + w > 1 + Number.EPSILON || y + h > 1 + Number.EPSILON) {
    throw new Error(`${field} extends beyond the frame`);
  }
  const left = Math.round(x * width), top = Math.round(y * height);
  const right = Math.round((x + w) * width), bottom = Math.round((y + h) * height);
  if (right <= left || bottom <= top) throw new Error(`${field} must cover at least one pixel`);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

async function pictureInterval(path, video, signal) {
  const start = Number(video.start_time), duration = Number(video.duration);
  if (Number.isFinite(start)) {
    if (Number.isFinite(duration)) return [start, start + duration];
    // Matroska DURATION tags contain the end timestamp, including any offset.
    const tag = video.tags?.DURATION?.split(':').map(Number);
    if (tag?.length === 3 && tag.every(Number.isFinite)) {
      return [start, tag[0] * 3600 + tag[1] * 60 + tag[2]];
    }
  }

  // Some containers have no per-stream timing metadata. Read just the video
  // packet timestamps so trailing audio cannot extend the picture interval.
  const probe = spawn('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries',
    'packet=pts_time,duration_time', '-of', 'csv=p=0', path], { signal, stdio: ['ignore', 'pipe', 'inherit'] });
  let first = Infinity, end = -Infinity;
  createInterface({ input: probe.stdout }).on('line', line => {
    const [pts, duration] = line.split(',').map(parseFloat);
    if (!Number.isFinite(pts)) return;
    first = Math.min(first, pts);
    end = Math.max(end, pts + (Number.isFinite(duration) ? duration : 0));
  });
  const [code] = await once(probe, 'close');
  if (code !== 0) throw new Error('Unable to read video packet timestamps');
  return [first, end];
}

async function source(input, field, length, signal) {
  if (typeof input?.path !== 'string' || !input.path) throw new Error(`${field}.path is required`);
  const path = resolve(input.path);
  const info = await probeMedia(path, { signal });
  const video = info.streams.find(stream => stream.codec_type === 'video');
  if (!video) throw new Error(`${field}.path needs a visual stream`);
  const start = number(input.start ?? 0, `${field}.start`, 0);
  const still = info.kind === 'image';
  if (still && start !== 0) throw new Error(`${field}.start must be zero for a still`);
  if (!still) {
    // Input -ss is relative to the container start, including when audio leads.
    const [first, end] = await pictureInterval(path, video, signal);
    const inPoint = Math.round((Number(info.format.start_time ?? 0) + start) * 1e6) / 1e6;
    if (!(inPoint >= first && inPoint + length <= end + 1e-6)) {
      throw new Error(`${field}.start and shot range exceed the source picture`);
    }
  }
  // FFmpeg autorotates before the filter graph. Crop in that raster and fit
  // with its display aspect (including non-square source pixels).
  const rotation = video.side_data_list?.find(side => 'rotation' in side)?.rotation ?? 0;
  if (rotation % 90 !== 0) throw new Error(`${field}.path needs a right-angle display rotation`);
  const transpose = Math.abs(rotation % 180) === 90;
  const [n, d] = String(video.sample_aspect_ratio).split(':').map(Number);
  const sar = n > 0 && d > 0 ? n / d : 1;
  return { path, start, still, width: transpose ? video.height : video.width,
    height: transpose ? video.width : video.height, sar: transpose ? 1 / sar : sar };
}

function fit(width, height, sar, box) {
  const scale = Math.min(box.width / (width * sar), box.height / height);
  return { width: Math.max(1, Math.round(width * sar * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/**
 * Render a new MP4 from editable shot parameters. All times are seconds.
 * background/foreground.path and .start select local media and its in-point.
 * Omit foreground.path to crop the playing background. Separate media starts
 * playing at entranceStart. crop and destination are normalized x/y/width/height
 * rectangles in oriented foreground and output coordinates respectively.
 * The detail fades in until landAt, holds until holdUntil, then disappears.
 * Supply a fresh outputPath in the work area for each revision.
 */
export async function renderForegroundDetail({
  background, foreground = {}, destination, width, height, fps = 30, duration,
  entranceStart = 0, landAt = entranceStart, holdUntil = duration, dim = 0,
  outputPath, signal,
}) {
  for (const [field, value] of Object.entries({ width, height })) {
    if (!Number.isSafeInteger(value) || value < 2 || value % 2) throw new Error(`${field} must be a positive even size`);
  }
  number(fps, 'fps', Number.MIN_VALUE);
  number(duration, 'duration', Number.MIN_VALUE);
  if (duration * fps < 1) throw new Error('duration must cover at least one output frame');
  number(entranceStart, 'entranceStart', 0, duration);
  number(landAt, 'landAt', entranceStart, duration);
  number(holdUntil, 'holdUntil', landAt, duration);
  if (holdUntil <= entranceStart) throw new Error('holdUntil must follow entranceStart');
  number(dim, 'dim', 0, 1);
  if (!outputPath) throw new Error('outputPath is required');
  const box = pixels(destination, width, height, 'destination');
  const back = await source(background, 'background', duration, signal);
  const separate = foreground.path !== undefined;
  if (!separate && foreground.start !== undefined) throw new Error('foreground.start requires a separate foreground.path');
  const front = separate ? await source(foreground, 'foreground', holdUntil - entranceStart, signal) : back;
  const crop = pixels(foreground.crop ?? fullFrame, front.width, front.height, 'foreground.crop');
  const bg = fit(back.width, back.height, back.sar, { width, height });
  const fg = fit(crop.width, crop.height, front.sar, box);
  const x = box.x + Math.floor((box.width - fg.width) / 2);
  const y = box.y + Math.floor((box.height - fg.height) / 2);
  const args = ['-nostdin', '-v', 'error', '-filter_complex_threads', '2'];
  const filters = [];
  for (const [i, media] of (separate ? [back, front] : [back]).entries()) {
    // Keep frames from the preceding keyframe. The picture spanning an
    // off-grid in-point is still on screen at shot time zero.
    if (media.start) args.push('-noaccurate_seek', '-ss', String(media.start));
    args.push('-threads', '2', '-i', media.path);
    const extend = media.still ? `tpad=stop_mode=clone:stop_duration=${duration},` : '';
    const clock = i === 1 ? `settb=AVTB,setpts=PTS+${entranceStart}/TB,` : '';
    const label = i === 1 ? '[detail]' : '[context]';
    const branch = separate ? label : ',split[context][detail]';
    // Drop preroll after sampling. fps with start_time=0 would also pad a
    // late first frame backwards, inventing picture before it was available.
    filters.push(`[${i}:v:0]${extend}${clock}fps=${fps}:round=up,trim=start_pts=0${branch}`);
  }

  const active = `gte(t,${entranceStart})*lt(t,${holdUntil})`;
  const darken = dim ? `,drawbox=c=black@${dim}:t=fill:enable='${active}'` : '';
  filters.push(`[context]format=yuv444p,scale=${bg.width}:${bg.height},setsar=1,` +
    `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2${darken}[base]`);
  const fade = landAt > entranceStart ? `,fade=t=in:st=${entranceStart}:d=${landAt - entranceStart}:alpha=1` : '';
  filters.push(`[detail]crop=${crop.width}:${crop.height}:${crop.x}:${crop.y}:exact=1,` +
    `scale=${fg.width}:${fg.height},setsar=1,format=yuva444p${fade}[panel]`);
  filters.push(`[base][panel]overlay=x=${x}:y=${y}:format=yuv444:enable='${active}',format=yuv420p[v]`);

  const temporary = `${outputPath}.${randomUUID()}.tmp.mp4`;
  try {
    await run('ffmpeg', [...args, '-filter_complex', filters.join(';'), '-map', '[v]', '-map', '0:a:0?',
      '-af', 'atrim=start=0', '-fps_mode:v', 'passthrough', '-t', String(duration), '-c:v', 'libx264', '-threads', '2', '-crf', '18', '-c:a', 'aac',
      '-b:a', '192k', '-movflags', '+faststart', temporary], { signal });
    signal?.throwIfAborted();
    // Publish atomically without overwriting a source or an earlier revision.
    await link(temporary, outputPath);
    return { path: outputPath, width, height, duration, fps };
  } finally {
    await rm(temporary, { force: true });
  }
}

import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { access, mkdir, readFile, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { spawn } from 'node:child_process';

const FPS = 30;
const EPSILON = 1 / FPS / 2;
const frameTime = value => Math.round(value * FPS) / FPS;

function mediaError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function within(root, candidate) {
  const rel = relative(root, candidate);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function workspacePath(workspace, value, label = 'path') {
  const root = resolve(workspace);
  const candidate = resolve(root, value);
  if (!within(root, candidate)) throw mediaError(`${label} must be inside the workspace`);
  return candidate;
}

function number(value, label, { min = -Infinity, positive = false } = {}) {
  if (!Number.isFinite(value) || value < min || (positive && value <= 0)) {
    throw mediaError(`${label} must be a finite ${positive ? 'positive' : `number >= ${min}`}`);
  }
  return value;
}

function run(command, args, { signal, onProgress, duration } = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe', 'pipe'], windowsHide: true });
    let stderr = '';
    let progressBuffer = '';
    let killTimer;
    const abort = () => {
      child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), 1500);
      killTimer.unref?.();
    };
    if (signal?.aborted) abort();
    signal?.addEventListener('abort', abort, { once: true });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-16000); });
    child.stdio[3].setEncoding('utf8');
    child.stdio[3].on('data', chunk => {
      progressBuffer += chunk;
      const lines = progressBuffer.split('\n');
      progressBuffer = lines.pop();
      for (const line of lines) {
        const [key, raw] = line.trim().split('=', 2);
        if (key === 'out_time_us' && onProgress && duration) {
          const ratio = Math.min(1, Math.max(0, Number(raw) / 1e6 / duration));
          onProgress(ratio);
        }
      }
    });
    child.on('error', rejectRun);
    child.on('close', code => {
      clearTimeout(killTimer);
      signal?.removeEventListener('abort', abort);
      if (signal?.aborted) return rejectRun(Object.assign(new Error('Media operation cancelled'), { name: 'AbortError' }));
      if (code === 0) return resolveRun();
      rejectRun(new Error(`${command} exited with code ${code}: ${stderr.trim() || 'no diagnostic output'}`));
    });
  });
}

async function capture(command, args, { signal } = {}) {
  return new Promise((resolveCapture, rejectCapture) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let stderr = '';
    const abort = () => child.kill('SIGTERM');
    if (signal?.aborted) abort();
    signal?.addEventListener('abort', abort, { once: true });
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-16000); });
    child.on('error', rejectCapture);
    child.on('close', code => {
      signal?.removeEventListener('abort', abort);
      if (signal?.aborted) return rejectCapture(Object.assign(new Error('Media operation cancelled'), { name: 'AbortError' }));
      if (code === 0) return resolveCapture(stdout);
      rejectCapture(new Error(`${command} exited with code ${code}: ${stderr.trim() || 'no diagnostic output'}`));
    });
  });
}

export async function probeMedia(filePath, { signal } = {}) {
  const info = await stat(filePath).catch(() => null);
  if (!info?.isFile()) throw mediaError(`Media source is not a regular file: ${filePath}`);
  let parsed;
  try {
    const output = await capture('ffprobe', [
      '-v', 'error', '-show_format', '-show_streams', '-of', 'json', filePath,
    ], { signal });
    parsed = JSON.parse(output);
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw mediaError(`Unable to read media: ${error.message}`);
  }
  const streams = Array.isArray(parsed.streams) ? parsed.streams : [];
  const video = streams.find(stream => stream.codec_type === 'video');
  const audio = streams.find(stream => stream.codec_type === 'audio');
  if (!video && !audio) throw mediaError('File contains no supported audio or video streams');
  const durationValues = [parsed.format?.duration, ...streams.map(stream => stream.duration)]
    .map(Number).filter(Number.isFinite);
  const duration = durationValues.length ? Math.max(...durationValues) : null;
  const still = video && (!duration || video.avg_frame_rate === '0/0') && !audio;
  return {
    kind: video ? (still ? 'image' : 'video') : 'audio',
    duration,
    width: video?.width ?? null,
    height: video?.height ?? null,
    hasAudio: Boolean(audio),
    streams,
    format: parsed.format ?? {},
  };
}

async function hashAndCopy(sourcePath, stagingPath) {
  const hash = createHash('sha256');
  const input = createReadStream(sourcePath);
  input.on('data', chunk => hash.update(chunk));
  await pipeline(input, createWriteStream(stagingPath, { flags: 'wx', mode: 0o600 }));
  return hash.digest('hex');
}

async function fileExists(path) {
  return access(path).then(() => true, () => false);
}

function validProbe(value) {
  return value && ['video', 'audio', 'image'].includes(value.kind)
    && Array.isArray(value.streams)
    && typeof value.hasAudio === 'boolean'
    && (value.duration === null || Number.isFinite(value.duration));
}

// mediaDirectory selects the owning channel's managed media folder; it defaults to the prototype's <root>/media.
export async function importMedia({ workspace, sourcePath, mediaDirectory = null }) {
  const root = resolve(workspace);
  const source = resolve(sourcePath);
  const mediaRoot = mediaDirectory ? workspacePath(root, mediaDirectory, 'mediaDirectory') : join(root, 'media');
  const before = await stat(source).catch(() => null);
  if (!before?.isFile()) throw mediaError('Import source must be an existing regular file');
  await mkdir(mediaRoot, { recursive: true });
  await mkdir(join(root, 'cache'), { recursive: true });
  if (!within(await realpath(root), await realpath(mediaRoot))) throw mediaError('mediaDirectory must be inside the workspace');
  const staging = join(mediaRoot, `.import-${randomUUID()}.tmp`);
  let published;
  let createdFile = false;
  try {
    const hash = await hashAndCopy(source, staging);
    const after = await stat(source);
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ino !== after.ino) {
      throw mediaError('Import source changed while it was being copied');
    }
    // Content identity, not a user-controlled name or extension, is the managed key.
    published = join(mediaRoot, hash);
    if (await fileExists(published)) {
      const managed = await stat(published);
      if (!managed.isFile() || managed.size !== after.size) throw mediaError('Managed media does not match its content identity');
      await unlink(staging);
    } else { await rename(staging, published); createdFile = true; }
    const probeCache = join(root, 'cache', `${hash}-probe-v1.json`);
    let probe;
    try {
      const cached = JSON.parse(await readFile(probeCache, 'utf8'));
      if (cached.version !== 1 || cached.hash !== hash || cached.size !== after.size || !validProbe(cached.probe)) throw new Error('invalid cache');
      probe = cached.probe;
    } catch {
      probe = await probeMedia(published);
      const cacheTemp = `${probeCache}.${randomUUID()}.tmp`;
      await writeFile(cacheTemp, JSON.stringify({ version: 1, hash, size: after.size, probe }), { mode: 0o600 });
      await rename(cacheTemp, probeCache);
    }
    let thumbnailPath;
    if (probe.kind !== 'audio') {
      const thumb = join(root, 'cache', `${hash}-thumb.jpg`);
      if (!(await fileExists(thumb))) {
        const thumbTemp = `${thumb}.${randomUUID()}.tmp`;
        try {
          const seek = probe.kind === 'video' && probe.duration ? Math.min(1, probe.duration / 2) : 0;
          await run('ffmpeg', ['-v', 'error', '-threads', '1', '-ss', String(seek), '-i', published,
            '-frames:v', '1', '-vf', "scale='min(640,iw)':-2", '-q:v', '3', '-f', 'image2', '-y', thumbTemp]);
          await rename(thumbTemp, thumb);
        } finally {
          await unlink(thumbTemp).catch(() => {});
        }
      }
      thumbnailPath = relative(root, thumb);
    }
    return {
      name: basename(source), hash, kind: probe.kind,
      path: relative(root, published), duration: probe.duration,
      width: probe.width, height: probe.height,
      metadata: { ...probe, originPath: source, importedSize: after.size },
      ...(thumbnailPath ? { thumbnailPath } : {}),
      createdAt: new Date().toISOString(),
      createdFile,
    };
  } finally {
    await unlink(staging).catch(() => {});
  }
}

function assetMap(assets) {
  const map = new Map();
  for (const asset of assets ?? []) {
    if (!asset?.id || map.has(asset.id)) throw mediaError('Every asset must have a unique id');
    map.set(asset.id, asset);
  }
  return map;
}

export function validateRenderPlan({ workspace, episode, assets, outputPath, preview = false }) {
  if (!episode || !Array.isArray(episode.cards) || episode.cards.length === 0) {
    throw mediaError('Episode must contain at least one card');
  }
  const root = resolve(workspace);
  const output = workspacePath(root, outputPath, 'outputPath');
  const byId = assetMap(assets);
  const width = preview ? 1280 : 1920;
  const height = preview ? 720 : 1080;
  const cards = episode.cards.map((card, index) => {
    if (!card?.visual) throw mediaError(`Card ${index + 1} has no visual`);
    const visual = byId.get(card.visual.assetId);
    if (!visual) throw mediaError(`Card ${index + 1} references a missing visual asset`);
    if (!['video', 'image'].includes(visual.kind)) throw mediaError(`Card ${index + 1} visual must be video or image`);
    const rawVin = number(card.visual.in ?? 0, `Card ${index + 1} visual in`, { min: 0 });
    const defaultOut = visual.kind === 'image' ? null : visual.duration;
    const rawVout = card.visual.out ?? defaultOut;
    const explicitDuration = card.duration != null && card.duration !== '';
    const vin = frameTime(rawVin);
    const vout = rawVout == null ? null : frameTime(rawVout);
    let duration;
    if (explicitDuration) duration = frameTime(number(Number(card.duration), `Card ${index + 1} duration`, { positive: true }));
    else if (vout != null) duration = frameTime(vout - vin);
    else throw mediaError(`Card ${index + 1} duration is required for an image without an out point`);
    if (duration <= 0) throw mediaError(`Card ${index + 1} visual range is shorter than one ${FPS}fps frame after quantization`);
    if (Math.abs(Number(card.visual.offset ?? 0)) > EPSILON) throw mediaError(`Card ${index + 1} visual offset must be zero`);
    if (visual.kind === 'video') {
      number(rawVout, `Card ${index + 1} visual out`, { positive: true });
      if (vout <= vin) throw mediaError(`Card ${index + 1} visual range is shorter than one ${FPS}fps frame after quantization`);
      if (explicitDuration && Math.abs((vout - vin) - duration) > EPSILON) throw mediaError(`Card ${index + 1} visual range must equal its duration`);
      if (!Number.isFinite(visual.duration) || vout > visual.duration + EPSILON) throw mediaError(`Card ${index + 1} visual range exceeds the asset`);
    }
    const visualGain = number(card.visual.gain ?? 1, `Card ${index + 1} visual gain`, { min: 0 });
    let narration = null;
    if (card.narration) {
      const asset = byId.get(card.narration.assetId);
      if (!asset) throw mediaError(`Card ${index + 1} references a missing narration asset`);
      if (!asset.metadata?.hasAudio) throw mediaError(`Card ${index + 1} narration asset has no audio stream`);
      const start = frameTime(number(card.narration.in ?? 0, `Card ${index + 1} narration in`, { min: 0 }));
      const end = frameTime(number(card.narration.out, `Card ${index + 1} narration out`, { positive: true }));
      const offset = frameTime(number(card.narration.offset ?? 0, `Card ${index + 1} narration offset`, { min: 0 }));
      if (end <= start) throw mediaError(`Card ${index + 1} narration out must be after in`);
      if (!Number.isFinite(asset.duration) || end > asset.duration + EPSILON) throw mediaError(`Card ${index + 1} narration range exceeds the asset`);
      if (offset + end - start > duration + EPSILON) throw mediaError(`Card ${index + 1} narration extends beyond the card boundary`);
      narration = { asset, start, end, offset, gain: number(card.narration.gain ?? 1, `Card ${index + 1} narration gain`, { min: 0 }) };
    }
    return { visual, vin, vout, visualGain, duration, narration };
  });
  for (const card of cards) workspacePath(root, card.visual.path, 'asset path');
  for (const card of cards) if (card.narration) workspacePath(root, card.narration.asset.path, 'asset path');
  return { root, output, cards, width, height, duration: cards.reduce((sum, card) => sum + card.duration, 0) };
}

export async function renderEpisode(options) {
  const { signal, onProgress } = options;
  const plan = validateRenderPlan(options);
  const canonicalRoot = await realpath(plan.root);
  const sourcePaths = new Set();
  for (const card of plan.cards) {
    for (const asset of [card.visual, card.narration?.asset].filter(Boolean)) {
      const canonical = await realpath(workspacePath(plan.root, asset.path)).catch(() => null);
      if (!canonical || !within(canonicalRoot, canonical)) throw mediaError(`Asset path is missing or escapes the workspace: ${asset.path}`);
      sourcePaths.add(canonical);
    }
  }
  await mkdir(resolve(plan.output, '..'), { recursive: true });
  const canonicalOutputParent = await realpath(resolve(plan.output, '..'));
  if (!within(canonicalRoot, canonicalOutputParent)) throw mediaError('outputPath escapes the workspace');
  if (sourcePaths.has(await realpath(plan.output).catch(() => ''))) throw mediaError('Output cannot overwrite a source asset');
  const temporary = `${plan.output}.${randomUUID()}.tmp.mp4`;
  const args = ['-v', 'error', '-threads', '2', '-filter_threads', '2', '-filter_complex_threads', '2'];
  const filters = [];
  const concatInputs = [];
  let inputIndex = 0;
  for (let i = 0; i < plan.cards.length; i++) {
    const card = plan.cards[i];
    const visualInput = inputIndex++;
    if (card.visual.kind === 'image') args.push('-threads', '1', '-loop', '1', '-i', workspacePath(plan.root, card.visual.path));
    else args.push('-threads', '1', '-i', workspacePath(plan.root, card.visual.path));
    let narrationInput = null;
    if (card.narration) {
      narrationInput = inputIndex++;
      args.push('-threads', '1', '-i', workspacePath(plan.root, card.narration.asset.path));
    }
    const trim = card.visual.kind === 'image'
      ? `trim=duration=${card.duration}`
      : `trim=start=${card.vin}:end=${card.vout}`;
    filters.push(`[${visualInput}:v:0]${trim},setpts=PTS-STARTPTS,scale=${plan.width}:${plan.height}:force_original_aspect_ratio=decrease,pad=${plan.width}:${plan.height}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=${FPS},format=yuv420p[v${i}]`);
    const sourceAudio = card.visual.metadata?.hasAudio
      ? `[${visualInput}:a:0]atrim=start=${card.vin}:end=${card.vout},asetpts=PTS-STARTPTS,volume=${card.visualGain},aformat=sample_rates=48000:channel_layouts=stereo,apad,atrim=duration=${card.duration}[base${i}]`
      : `anullsrc=r=48000:cl=stereo,atrim=duration=${card.duration}[base${i}]`;
    filters.push(sourceAudio);
    if (card.narration) {
      const delay = Math.round(card.narration.offset * 1000);
      filters.push(`[${narrationInput}:a:0]atrim=start=${card.narration.start}:end=${card.narration.end},asetpts=PTS-STARTPTS,volume=${card.narration.gain},aformat=sample_rates=48000:channel_layouts=stereo,adelay=${delay}:all=1,apad,atrim=duration=${card.duration}[nar${i}]`);
      filters.push(`[base${i}][nar${i}]amix=inputs=2:duration=first:normalize=0[a${i}]`);
    } else {
      filters.push(`[base${i}]anull[a${i}]`);
    }
    concatInputs.push(`[v${i}][a${i}]`);
  }
  filters.push(`${concatInputs.join('')}concat=n=${plan.cards.length}:v=1:a=1[vout][aout]`);
  args.push('-filter_complex', filters.join(';'), '-map', '[vout]', '-map', '[aout]',
    '-r', String(FPS), '-c:v', 'libx264', '-preset', options.preview ? 'veryfast' : 'medium',
    '-crf', options.preview ? '25' : '20', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
    '-movflags', '+faststart', '-progress', 'pipe:3', '-y', temporary);
  try {
    await run('ffmpeg', args, { signal, onProgress, duration: plan.duration });
    if (signal?.aborted) throw Object.assign(new Error('Media operation cancelled'), { name: 'AbortError' });
    await rename(temporary, plan.output);
    onProgress?.(1);
    return { path: plan.output, duration: plan.duration, width: plan.width, height: plan.height };
  } finally {
    await unlink(temporary).catch(() => {});
  }
}

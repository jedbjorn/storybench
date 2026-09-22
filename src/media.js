import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { access, mkdir, readFile, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { spawn } from 'node:child_process';

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

function run(command, args, { signal } = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    let stderr = '';
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

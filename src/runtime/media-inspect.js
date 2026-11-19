// Media inspection primitives for the scoped tools: a still or a frame at a timestamp, a
// labelled contact sheet of timestamped frames, and an ffprobe metadata summary. Output
// images are PNG bytes that the tool layer delivers as real image content.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { RuntimeError } from "./validate.js";
import { readSvgSource, parseSvg, svgProbe } from '../svg.js';
import { renderSvg } from '../svg-render.js';

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MEDIA_TIMEOUT_MS = 30_000;
const FONT = ["/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf", "/usr/share/fonts/TTF/DejaVuSans.ttf"].find((file) => existsSync(file)) ?? null;
export const CONTACT_SHEET_LIMITS = Object.freeze({ minFrames: 2, maxFrames: 16 });

// Media sources are open descriptors (from openProjectFile), passed to the child as fd 3 and
// read through /proc/self/fd/3, so a path swapped after validation is never read. A plain
// path string is accepted for app-owned temporary files only.
const INPUT_FD = "/proc/self/fd/3";

function runMedia(command, args, { source = null, capture = false, timeoutMs = MEDIA_TIMEOUT_MS, empty = "No frame exists at that timestamp", failure = "Could not decode an image from this file" } = {}) {
  return new Promise((resolve, reject) => {
    const stdio = ["ignore", capture ? "pipe" : "ignore", "pipe", ...(source != null ? [source] : [])];
    const child = spawn(command, command === "ffmpeg" ? ["-v", "error", "-nostdin", ...args] : args, { stdio });
    const chunks = [];
    let size = 0, timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, timeoutMs);
    child.stdout?.on("data", (chunk) => { size += chunk.length; if (size <= MAX_IMAGE_BYTES) chunks.push(chunk); });
    // Tool stderr can quote file contents (e.g. a non-media file's header): never returned to the model.
    child.stderr.on("data", () => {});
    child.on("error", (error) => { clearTimeout(timer); reject(new RuntimeError("FRAME_FAILED", `${command} is unavailable (${error.code})`)); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) return reject(new RuntimeError("FRAME_TIMEOUT", `${command} did not finish within ${Math.round(timeoutMs / 1000)} s`));
      if (code !== 0) return reject(new RuntimeError("FRAME_FAILED", failure));
      if (capture && !size) return reject(new RuntimeError("FRAME_FAILED", empty));
      if (size > MAX_IMAGE_BYTES) return reject(new RuntimeError("FRAME_TOO_LARGE", "Decoded image is too large"));
      resolve(capture ? Buffer.concat(chunks) : null);
    });
  });
}
const inputOf = (source) => (typeof source === "string" ? { input: source, fd: null } : { input: INPUT_FD, fd: source.fd });
const ffmpeg = (args, options = {}) => runMedia("ffmpeg", args, options);

export function assertTimestamp(value, field = "atSeconds") {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 86_400)
    throw new RuntimeError("INVALID_TIMESTAMP", `${field} must be a number of seconds between 0 and 86400`);
  return value;
}

// A still, or one video frame at an explicit timestamp, as PNG.
// `source`: an open FileHandle (project media) or an app-owned path.
export async function frameAt(source, atSeconds = null, { maxWidth = 1024, timeoutMs } = {}) {
  const vector = await readSvgSource(source);
  if (vector) {
    if (atSeconds != null && assertTimestamp(atSeconds) !== 0) throw new RuntimeError('INVALID_TIMESTAMP', 'SVG is a still image; omit atSeconds');
    return renderSvg(vector, { maxWidth, timeoutMs });
  }
  const { input, fd } = inputOf(source);
  const args = [];
  if (atSeconds != null) args.push("-ss", String(assertTimestamp(atSeconds)));
  args.push("-i", input, "-frames:v", "1", "-vf", `scale='min(${maxWidth},iw)':-2`, "-f", "image2pipe", "-vcodec", "png", "-");
  return ffmpeg(args, { capture: true, source: fd, timeoutMs });
}

// Analyze stereo PCM in 20 ms windows. Keeping both channels avoids cancelling
// out-of-phase stereo onsets. Summarize the level every half second for the agent.
export const MAX_AUDIO_SECONDS = 30;
const AUDIO_RATE = 24000;
const WINDOW_FRAMES = AUDIO_RATE / 50;
const LEVEL_FRAMES = AUDIO_RATE / 2;
const FLOOR_DBFS = -96;
const dbfs = (energy, frames) => Math.max(FLOOR_DBFS, 10 * Math.log10(energy / (2 * frames)));
const tenth = (value) => Math.round(value * 10) / 10;

export async function inspectAudio(handle, startSeconds, endSeconds) {
  assertTimestamp(startSeconds, "startSeconds");
  assertTimestamp(endSeconds, "endSeconds");
  const duration = endSeconds - startSeconds;
  if (duration <= 0 || duration > MAX_AUDIO_SECONDS)
    throw new RuntimeError("INVALID_RANGE", `Inspect a positive range of at most ${MAX_AUDIO_SECONDS} seconds`);

  // Give the demuxer only the scoped descriptor, including for nested media inputs.
  const pcm = await ffmpeg([
    "-ss", String(startSeconds), "-protocol_whitelist", "fd", "-fd", "3", "-i", "fd:",
    "-map", "0:a:0", "-t", String(duration), "-af", `aresample=${AUDIO_RATE}:async=1:first_pts=0`,
    "-ac", "2", "-c:a", "pcm_s16le", "-f", "s16le", "-",
  ], { source: handle.fd, capture: true, failure: "Could not decode the first audio stream in this source",
    empty: "The requested range contains no audio samples" });

  const frames = pcm.length / 4;
  const timeAt = (frame) => Math.min(endSeconds, startSeconds + frame / AUDIO_RATE);
  const levels = [];
  const candidateAccents = [];
  let previousDb = null;
  let levelEnergy = 0;
  let levelStart = 0;
  for (let start = 0; start < frames; start += WINDOW_FRAMES) {
    const end = Math.min(frames, start + WINDOW_FRAMES);
    let energy = 0;
    for (let offset = start * 4; offset < end * 4; offset += 2) {
      const sample = pcm.readInt16LE(offset) / 32768;
      energy += sample * sample;
    }
    const rms = dbfs(energy, end - start);
    // The first window establishes the baseline, even if the selection opens mid-note.
    if (previousDb !== null && rms >= -30 && rms - previousDb >= 8) {
      const atSeconds = timeAt(start);
      if (!candidateAccents.length || atSeconds - candidateAccents.at(-1).atSeconds >= 0.08)
        candidateAccents.push({ atSeconds, rmsDbfs: tenth(rms), riseDb: tenth(rms - previousDb) });
    }
    previousDb = rms;
    levelEnergy += energy;
    if (end - levelStart === LEVEL_FRAMES || end === frames) {
      const rmsDbfs = tenth(dbfs(levelEnergy, end - levelStart));
      const previousLevel = levels.at(-1);
      levels.push({ startSeconds: timeAt(levelStart), endSeconds: timeAt(end), rmsDbfs,
        changeDb: previousLevel ? tenth(rmsDbfs - previousLevel.rmsDbfs) : null });
      levelStart = end;
      levelEnergy = 0;
    }
  }
  return { startSeconds, endSeconds: timeAt(frames), measurements: { mix: "stereo", floorDbfs: FLOOR_DBFS, levels },
    candidateAccents, interpretation: "Candidates mark abrupt measured rises on the source clock. Review candidates in the mix to choose an editorial cue." };
}

// Evenly spaced sample times within [start, end]: the centre of each of `count` spans.
export function sheetTimestamps(start, end, count) {
  assertTimestamp(start, "startSeconds");
  assertTimestamp(end, "endSeconds");
  if (!(end > start)) throw new RuntimeError("INVALID_RANGE", "endSeconds must be greater than startSeconds");
  if (!Number.isInteger(count) || count < CONTACT_SHEET_LIMITS.minFrames || count > CONTACT_SHEET_LIMITS.maxFrames)
    throw new RuntimeError("INVALID_COUNT", `count must be an integer from ${CONTACT_SHEET_LIMITS.minFrames} to ${CONTACT_SHEET_LIMITS.maxFrames}`);
  const step = (end - start) / count;
  return Array.from({ length: count }, (_, index) => Math.round((start + step * (index + 0.5)) * 1000) / 1000);
}

// One tiled PNG of `timestamps.length` frames, each labelled with its timestamp,
// read left-to-right, top-to-bottom.
export async function contactSheet(source, timestamps, { columns = Math.min(4, timestamps.length), tileWidth = 320, timeoutMs } = {}) {
  const { input, fd } = inputOf(source);
  const rows = Math.ceil(timestamps.length / columns);
  const dir = await mkdtemp(path.join(os.tmpdir(), "sb-sheet-"));
  try {
    for (const [index, at] of timestamps.entries()) {
      const label = FONT ? `,drawtext=fontfile=${FONT}:text='t=${at.toFixed(2)}s':x=6:y=6:fontsize=18:fontcolor=white:box=1:boxcolor=black@0.7:boxborderw=4` : "";
      await ffmpeg(["-ss", String(at), "-i", input, "-frames:v", "1", "-vf", `scale=${tileWidth}:-2${label}`, "-y", path.join(dir, `f${String(index).padStart(3, "0")}.png`)], { source: fd, timeoutMs });
    }
    const out = path.join(dir, "sheet.png");
    await ffmpeg(["-framerate", "1", "-i", path.join(dir, "f%03d.png"), "-vf", `tile=${columns}x${rows}:padding=4:margin=4:color=0x202020`, "-frames:v", "1", "-y", out], { timeoutMs });
    const png = await readFile(out);
    if (png.length > MAX_IMAGE_BYTES) throw new RuntimeError("FRAME_TOO_LARGE", "Contact sheet is too large; use fewer frames");
    return { png, columns, rows, labelled: Boolean(FONT) };
  } finally { await rm(dir, { recursive: true, force: true }); }
}

// ffprobe summary (no raw tags, no paths), read through the same descriptor.
export async function mediaSummary(source, { timeoutMs } = {}) {
  const vector = await readSvgSource(source);
  if (vector) return { ...svgProbe(parseSvg(vector)), container: 'svg', sizeBytes: vector.length, bitRate: null };
  const { input, fd } = inputOf(source);
  const raw = await runMedia("ffprobe", ["-v", "error", "-show_format", "-show_streams", "-of", "json", input], { source: fd, capture: true, timeoutMs, failure: "Could not read media metadata from this file" });
  let parsed;
  try { parsed = JSON.parse(raw.toString("utf8")); } catch { throw new RuntimeError("FRAME_FAILED", "Could not read media metadata from this file"); }
  const streams = Array.isArray(parsed.streams) ? parsed.streams : [];
  const video = streams.find((stream) => stream.codec_type === "video"), audio = streams.find((stream) => stream.codec_type === "audio");
  if (!video && !audio) throw new RuntimeError("FRAME_FAILED", "This file contains no audio or video streams");
  const durations = [parsed.format?.duration, ...streams.map((stream) => stream.duration)].map(Number).filter(Number.isFinite);
  const duration = durations.length ? Math.max(...durations) : null;
  const still = video && (!duration || video.avg_frame_rate === "0/0") && !audio;
  const fps = (rate) => { const [n, d] = String(rate || "").split("/").map(Number); return n && d ? Math.round((n / d) * 1000) / 1000 : null; };
  return {
    kind: video ? (still ? "image" : "video") : "audio", duration, width: video?.width ?? null, height: video?.height ?? null, hasAudio: Boolean(audio),
    container: parsed.format?.format_name ?? null, sizeBytes: Number(parsed.format?.size) || null, bitRate: Number(parsed.format?.bit_rate) || null,
    streams: streams.map((stream) => ({
      index: stream.index, type: stream.codec_type, codec: stream.codec_name,
      ...(stream.codec_type === "video" ? { width: stream.width, height: stream.height, fps: fps(stream.avg_frame_rate), pixelFormat: stream.pix_fmt, frames: Number(stream.nb_frames) || null } : {}),
      ...(stream.codec_type === "audio" ? { sampleRate: Number(stream.sample_rate) || null, channels: stream.channels } : {}),
      duration: Number(stream.duration) || null,
    })),
  };
}

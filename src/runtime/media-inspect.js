// Media inspection primitives for the scoped tools: a still or a frame at a timestamp, a
// labelled contact sheet of timestamped frames, and an ffprobe metadata summary. Output
// images are PNG bytes that the tool layer delivers as real image content.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { RuntimeError } from "./validate.js";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MEDIA_TIMEOUT_MS = 30_000;
const FONT = ["/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf", "/usr/share/fonts/TTF/DejaVuSans.ttf"].find((file) => existsSync(file)) ?? null;
export const CONTACT_SHEET_LIMITS = Object.freeze({ minFrames: 2, maxFrames: 16 });

// Media sources are open descriptors (from openProjectFile), passed to the child as fd 3 and
// read through /proc/self/fd/3, so a path swapped after validation is never read. A plain
// path string is accepted for app-owned temporary files only.
const INPUT_FD = "/proc/self/fd/3";

function runMedia(command, args, { source = null, capture = false, timeoutMs = MEDIA_TIMEOUT_MS, failure = "Could not decode an image from this file" } = {}) {
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
      if (capture && !size) return reject(new RuntimeError("FRAME_FAILED", "No frame exists at that timestamp"));
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
export function frameAt(source, atSeconds = null, { maxWidth = 1024, timeoutMs } = {}) {
  const { input, fd } = inputOf(source);
  const args = [];
  if (atSeconds != null) args.push("-ss", String(assertTimestamp(atSeconds)));
  args.push("-i", input, "-frames:v", "1", "-vf", `scale='min(${maxWidth},iw)':-2`, "-f", "image2pipe", "-vcodec", "png", "-");
  return ffmpeg(args, { capture: true, source: fd, timeoutMs });
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

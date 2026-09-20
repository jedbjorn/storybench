import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { access, mkdir, realpath, rename, stat, unlink } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

const error = (message) => Object.assign(new Error(message), { statusCode: 400 });
const within = (root, candidate) => {
  const value = relative(root, candidate);
  return value === "" || (!value.startsWith("..") && !isAbsolute(value));
};
const seconds = (frames, fps) => frames / fps;

function run(args, { signal, onProgress, duration }) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe", "pipe"], windowsHide: true });
    let stderr = "", progress = "", killTimer;
    const abort = () => {
      child.kill("SIGTERM");
      killTimer = setTimeout(() => child.kill("SIGKILL"), 1500);
      killTimer.unref?.();
    };
    if (signal?.aborted) abort();
    signal?.addEventListener("abort", abort, { once: true });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-16000); });
    child.stdio[3].setEncoding("utf8");
    child.stdio[3].on("data", (chunk) => {
      progress += chunk;
      const lines = progress.split("\n");
      progress = lines.pop();
      for (const line of lines) {
        const [key, value] = line.split("=", 2);
        if (key === "out_time_us") onProgress?.(Math.min(1, Number(value) / 1e6 / duration));
      }
    });
    child.on("error", rejectRun);
    child.on("close", (code) => {
      clearTimeout(killTimer);
      signal?.removeEventListener("abort", abort);
      if (signal?.aborted) return rejectRun(Object.assign(new Error("Composition render cancelled"), { name: "AbortError" }));
      if (code === 0) return resolveRun();
      rejectRun(new Error(`ffmpeg exited with code ${code}: ${stderr.trim() || "no diagnostic output"}`));
    });
  });
}

export async function renderComposition({ workspace, plan, libraryItems, outputPath, preview = false, signal, onProgress }) {
  if (!plan?.fps || !plan?.durationFrames || !plan.visualSpine?.length) throw error("A validated render plan with a visual spine is required");
  const root = await realpath(resolve(workspace));
  const output = resolve(root, outputPath);
  if (!within(root, output)) throw error("outputPath must be inside the workspace");
  const byId = new Map((libraryItems || []).map((item) => [item.id, item]));
  if (byId.size !== (libraryItems || []).length) throw error("Library item ids must be unique");
  const needed = [...plan.visualSpine, ...plan.audioPlacements];
  const resolved = new Map();
  for (const placement of needed) {
    const item = byId.get(placement.itemId);
    if (!item || item.assetId !== placement.assetId || !item.asset?.path) throw error(`Plan item ${placement.itemId} is unresolved`);
    const candidate = await realpath(resolve(root, item.asset.path)).catch(() => null);
    if (!candidate || !within(root, candidate)) throw error(`Plan item ${placement.itemId} escapes the workspace`);
    resolved.set(placement.itemId, { item, path: candidate });
  }
  await mkdir(dirname(output), { recursive: true });
  const parent = await realpath(dirname(output));
  if (!within(root, parent)) throw error("outputPath parent escapes the workspace");
  const outputReal = await realpath(output).catch(() => null);
  if (outputReal && [...resolved.values()].some((entry) => entry.path === outputReal)) throw error("Output cannot overwrite a source asset");

  const width = preview ? 1280 : 1920, height = preview ? 720 : 1080;
  const duration = seconds(plan.durationFrames, plan.fps);
  const args = ["-v", "error", "-threads", "2", "-filter_threads", "2", "-filter_complex_threads", "2"];
  const filters = [], videoLabels = [], audioLabels = [];
  let input = 0;
  for (const visual of plan.visualSpine) {
    const { item, path } = resolved.get(visual.itemId);
    const index = input++;
    if (item.asset.kind === "image") args.push("-loop", "1", "-i", path);
    else args.push("-i", path);
    const length = seconds(visual.durationFrames, plan.fps);
    const trim = item.asset.kind === "image"
      ? `trim=duration=${length}`
      : `trim=start=${seconds(visual.sourceInFrame, plan.fps)}:end=${seconds(visual.sourceOutFrame, plan.fps)}`;
    filters.push(`[${index}:v:0]${trim},setpts=PTS-STARTPTS,scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=${plan.fps},format=yuv420p[v${index}]`);
    videoLabels.push(`[v${index}]`);
    if (visual.includeSourceAudio) {
      if (!item.asset.metadata?.hasAudio) throw error(`Visual card ${visual.cardId} requires source audio that is unavailable`);
      const delay = Math.round(seconds(visual.startFrame, plan.fps) * 1000);
      filters.push(`[${index}:a:0]atrim=start=${seconds(visual.sourceInFrame, plan.fps)}:end=${seconds(visual.sourceOutFrame, plan.fps)},asetpts=PTS-STARTPTS,volume=${visual.gain},aformat=sample_rates=48000:channel_layouts=stereo,adelay=${delay}:all=1[src${index}]`);
      audioLabels.push(`[src${index}]`);
    }
  }
  for (const placement of plan.audioPlacements) {
    const { path } = resolved.get(placement.itemId);
    const index = input++;
    args.push("-i", path);
    const length = seconds(placement.endFrame - placement.startFrame, plan.fps);
    const fadeIn = seconds(placement.fadeInFrames, plan.fps);
    const fadeOut = seconds(placement.fadeOutFrames, plan.fps);
    const fades = `${fadeIn ? `,afade=t=in:st=0:d=${fadeIn}` : ""}${fadeOut ? `,afade=t=out:st=${Math.max(0, length - fadeOut)}:d=${fadeOut}` : ""}`;
    const delay = Math.round(seconds(placement.startFrame, plan.fps) * 1000);
    filters.push(`[${index}:a:0]atrim=start=${seconds(placement.sourceInFrame, plan.fps)}:end=${seconds(placement.sourceOutFrame, plan.fps)},asetpts=PTS-STARTPTS,volume=${placement.gain},aformat=sample_rates=48000:channel_layouts=stereo${fades},adelay=${delay}:all=1[a${index}]`);
    audioLabels.push(`[a${index}]`);
  }
  filters.push(`${videoLabels.join("")}concat=n=${videoLabels.length}:v=1:a=0[vout]`);
  if (audioLabels.length) filters.push(`${audioLabels.join("")}amix=inputs=${audioLabels.length}:duration=longest:normalize=0,apad,atrim=duration=${duration}[aout]`);
  else filters.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${duration}[aout]`);
  const temporary = `${output}.${randomUUID()}.tmp.mp4`;
  args.push("-filter_complex", filters.join(";"), "-map", "[vout]", "-map", "[aout]", "-t", String(duration), "-r", String(plan.fps), "-c:v", "libx264", "-preset", preview ? "veryfast" : "medium", "-crf", preview ? "25" : "20", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2", "-movflags", "+faststart", "-progress", "pipe:3", "-y", temporary);
  try {
    await run(args, { signal, onProgress, duration });
    if (signal?.aborted) throw Object.assign(new Error("Composition render cancelled"), { name: "AbortError" });
    await rename(temporary, output);
    onProgress?.(1);
    return { path: output, duration, width, height };
  } finally {
    await unlink(temporary).catch(() => {});
  }
}

import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { createHash } from "node:crypto";
import { renderComposition } from "../src/composition-renderer.js";

const ffmpeg = (args) => {
  const result = spawnSync("ffmpeg", ["-v", "error", "-threads", "1", ...args], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
};
const digest = async (path) => createHash("sha256").update(await readFile(path)).digest("hex");

async function fixture() {
  const workspace = await mkdtemp(join(tmpdir(), "storybench-composition-"));
  const media = join(workspace, "media");
  await mkdir(media);
  const red = join(media, "red.mp4"), blue = join(media, "blue.mp4"), voice = join(media, "voice.wav");
  ffmpeg(["-f", "lavfi", "-i", "color=c=red:s=160x90:r=30:d=0.3", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=0.3", "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", red]);
  ffmpeg(["-f", "lavfi", "-i", "color=c=blue:s=160x90:r=30:d=0.3", "-f", "lavfi", "-i", "sine=frequency=880:sample_rate=48000:duration=0.3", "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", blue]);
  ffmpeg(["-f", "lavfi", "-i", "sine=frequency=1200:sample_rate=48000:duration=0.3", voice]);
  const libraryItems = [
    { id: "red-item", assetId: "red", asset: { id: "red", kind: "video", path: "media/red.mp4", metadata: { hasAudio: true } } },
    { id: "blue-item", assetId: "blue", asset: { id: "blue", kind: "video", path: "media/blue.mp4", metadata: { hasAudio: true } } },
    { id: "voice-item", assetId: "voice", asset: { id: "voice", kind: "audio", path: "media/voice.wav", metadata: { hasAudio: true } } },
  ];
  const plan = { fps: 30, durationFrames: 18, visualSpine: [
    { cardId: "red-card", itemId: "red-item", assetId: "red", startFrame: 0, durationFrames: 9, sourceInFrame: 0, sourceOutFrame: 9, includeSourceAudio: true, gain: .25 },
    { cardId: "blue-card", itemId: "blue-item", assetId: "blue", startFrame: 9, durationFrames: 9, sourceInFrame: 0, sourceOutFrame: 9, includeSourceAudio: false, gain: 0 },
  ], audioPlacements: [
    { cardId: "voice-card", itemId: "voice-item", assetId: "voice", startFrame: 7, endFrame: 14, sourceInFrame: 0, sourceOutFrame: 7, gain: .5, fadeInFrames: 1, fadeOutFrames: 1 },
  ] };
  return { workspace, red, blue, voice, libraryItems, plan };
}

test("composition renderer decodes ordered visuals and cross-boundary anchored audio", async () => {
  const value = await fixture();
  const before = await Promise.all([value.red, value.blue, value.voice].map(digest));
  const outputPath = join(value.workspace, "exports", "composition.mp4");
  const result = await renderComposition({ ...value, outputPath, preview: true });
  assert.deepEqual([result.duration, result.width, result.height], [.6, 1280, 720]);
  const sampled = spawnSync("ffmpeg", ["-v", "error", "-i", outputPath, "-vf", "select='eq(n,3)+eq(n,13)',scale=1:1,format=rgb24", "-fps_mode", "vfr", "-f", "rawvideo", "-"]);
  assert.equal(sampled.status, 0, sampled.stderr?.toString());
  assert.equal(sampled.stdout.length, 6);
  assert.ok(sampled.stdout[0] > sampled.stdout[2] * 2);
  assert.ok(sampled.stdout[5] > sampled.stdout[3] * 2);
  const silence = spawnSync("ffmpeg", ["-v", "info", "-i", outputPath, "-af", "silencedetect=noise=-45dB:d=0.08", "-f", "null", "-"], { encoding: "utf8" }).stderr;
  assert.match(silence, /silence_start: 0\.4[56]/); // muted blue tail after voice ends at frame 14
  assert.deepEqual(await Promise.all([value.red, value.blue, value.voice].map(digest)), before);
});

test("composition renderer rejects unresolved plans, traversal, aliases and cleans cancellation", async () => {
  const value = await fixture();
  const outputPath = join(value.workspace, "exports", "cancelled.mp4");
  await assert.rejects(renderComposition({ ...value, plan: { ...value.plan, visualSpine: [{ ...value.plan.visualSpine[0], itemId: "missing" }] }, outputPath }), /unresolved/);
  await assert.rejects(renderComposition({ ...value, outputPath: "../escape.mp4" }), /inside/);
  await assert.rejects(renderComposition({ ...value, outputPath: value.red }), /overwrite/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(renderComposition({ ...value, outputPath, signal: controller.signal }), { name: "AbortError" });
  await assert.rejects(access(outputPath));
});

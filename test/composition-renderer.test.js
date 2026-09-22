import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { createHash } from "node:crypto";
import { renderComposition } from "../src/composition-renderer.js";
import { importMedia, probeMedia } from "../src/media.js";
import { createApp } from "../src/server.js";

const ffmpeg = (args) => {
  const result = spawnSync("ffmpeg", ["-v", "error", "-threads", "1", ...args], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
};
const digest = async (path) => createHash("sha256").update(await readFile(path)).digest("hex");
function pcm(path) {
  const decoded = spawnSync("ffmpeg", ["-v", "error", "-i", path, "-ac", "1", "-ar", "48000", "-f", "f32le", "-"]);
  assert.equal(decoded.status, 0, decoded.stderr?.toString());
  return decoded.stdout;
}
function rms(buffer, start, end) {
  let sum = 0, count = 0;
  for (let offset = Math.floor(start * 48000) * 4; offset < Math.min(buffer.length, Math.floor(end * 48000) * 4); offset += 4) {
    const value = buffer.readFloatLE(offset); sum += value * value; count += 1;
  }
  return Math.sqrt(sum / count);
}

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

test("composition renderer decodes ordered visuals and cross-boundary anchored audio", async (t) => {
  const value = await fixture();
  t.after(() => rm(value.workspace, { recursive: true, force: true }));
  const before = await Promise.all([value.red, value.blue, value.voice].map(digest));
  const outputPath = join(value.workspace, "exports", "composition.mp4");
  const progress = [];
  const result = await renderComposition({ ...value, outputPath, preview: true,
    onProgress: (fraction) => progress.push(fraction) });
  assert.deepEqual([result.duration, result.width, result.height], [.6, 1280, 720]);
  assert.equal(progress.at(-1), 1);
  const sampled = spawnSync("ffmpeg", ["-v", "error", "-i", outputPath, "-vf", "select='eq(n,3)+eq(n,13)',scale=1:1,format=rgb24", "-fps_mode", "vfr", "-f", "rawvideo", "-"]);
  assert.equal(sampled.status, 0, sampled.stderr?.toString());
  assert.equal(sampled.stdout.length, 6);
  assert.ok(sampled.stdout[0] > sampled.stdout[2] * 2);
  assert.ok(sampled.stdout[5] > sampled.stdout[3] * 2);
  const frames = spawnSync("ffprobe", ["-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries", "stream=nb_read_frames", "-of", "default=nw=1:nk=1", outputPath], { encoding: "utf8" });
  assert.equal(Number(frames.stdout.trim()), 18);
  const outputPcm = pcm(outputPath), redPcm = pcm(value.red), voicePcm = pcm(value.voice);
  const redRatio = rms(outputPcm, .04, .18) / rms(redPcm, .04, .18);
  const voiceRatio = rms(outputPcm, .34, .42) / rms(voicePcm, .11, .19);
  assert.ok(redRatio > .15 && redRatio < .4, `included red source gain ratio ${redRatio}`);
  assert.ok(voiceRatio > .3 && voiceRatio < .75, `anchored voice gain ratio ${voiceRatio}`);
  assert.ok(rms(outputPcm, .5, .58) < .0002, "blue source is muted and the tail is silent after voice ends");
  assert.deepEqual(await Promise.all([value.red, value.blue, value.voice].map(digest)), before);
});

test("composition renderer rejects unresolved plans, traversal, aliases and cleans cancellation", async (t) => {
  const value = await fixture();
  t.after(() => rm(value.workspace, { recursive: true, force: true }));
  const outputPath = join(value.workspace, "exports", "cancelled.mp4");
  await assert.rejects(renderComposition({ ...value, plan: { ...value.plan, visualSpine: [{ ...value.plan.visualSpine[0], itemId: "missing" }] }, outputPath }), /unresolved/);
  await assert.rejects(renderComposition({ ...value, outputPath: "../escape.mp4" }), /inside/);
  await assert.rejects(renderComposition({ ...value, outputPath: value.red }), /overwrite/);
  const alias = join(value.workspace, "red-alias.mp4");
  await symlink(value.red, alias);
  const before = await digest(value.red);
  await assert.rejects(renderComposition({ ...value, outputPath: alias }), /overwrite/);
  assert.equal(await digest(value.red), before);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(renderComposition({ ...value, outputPath, signal: controller.signal }), { name: "AbortError" });
  await assert.rejects(access(outputPath));
});

test("composition renderer decodes fractional source cuts at the card boundary", async (t) => {
  const value = await fixture();
  t.after(() => rm(value.workspace, { recursive: true, force: true }));
  const source = join(value.workspace, "media", "timeline.mp4");
  ffmpeg([
    "-f", "lavfi", "-i", "color=c=red:s=160x90:r=30:d=0.4",
    "-f", "lavfi", "-i", "color=c=green:s=160x90:r=30:d=0.4",
    "-f", "lavfi", "-i", "color=c=blue:s=160x90:r=30:d=0.4",
    "-filter_complex", "[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]", "-map", "[v]",
    "-c:v", "libx264", "-g", "30", "-pix_fmt", "yuv420p", source,
  ]);
  const libraryItems = [{ id: "timeline", assetId: "timeline", asset: { kind: "video", path: "media/timeline.mp4" } }];
  const plan = { fps: 30, durationFrames: 24, visualSpine: [
    { cardId: "green", itemId: "timeline", assetId: "timeline", sourceInFrame: 12, sourceOutFrame: 24, startFrame: 0, durationFrames: 12 },
    { cardId: "blue", itemId: "timeline", assetId: "timeline", sourceInFrame: 24, sourceOutFrame: 36, startFrame: 12, durationFrames: 12 },
  ], audioPlacements: [] };
  const outputPath = join(value.workspace, "exports", "precise.mp4");
  await renderComposition({ workspace: value.workspace, plan, libraryItems, outputPath, preview: true });
  const sampled = spawnSync("ffmpeg", ["-v", "error", "-i", outputPath, "-vf",
    "select='eq(n,0)+eq(n,11)+eq(n,12)+eq(n,23)',scale=1:1,format=rgb24",
    "-fps_mode", "vfr", "-f", "rawvideo", "-"]);
  assert.equal(sampled.status, 0, sampled.stderr?.toString());
  assert.equal(sampled.stdout.length, 12);
  const samples = Array.from({ length: 4 }, (_, index) => [...sampled.stdout.subarray(index * 3, index * 3 + 3)]);
  for (const [red, green, blue] of samples.slice(0, 2))
    assert.ok(green > red * 1.5 && green > blue * 1.5, `expected green source segment, got ${[red, green, blue]}`);
  for (const [red, green, blue] of samples.slice(2))
    assert.ok(blue > red * 1.5 && blue > green * 1.5, `expected blue source segment, got ${[red, green, blue]}`);
});

test("composition export produces a 1920x1080 artifact", async (t) => {
  const value = await fixture();
  t.after(() => rm(value.workspace, { recursive: true, force: true }));
  const outputPath = join(value.workspace, "exports", "full.mp4");
  const result = await renderComposition({ ...value, outputPath, preview: false });
  const rendered = await probeMedia(outputPath);
  assert.deepEqual([result.width, result.height, rendered.width, rendered.height], [1920, 1080, 1920, 1080]);
  assert.ok(Math.abs(rendered.duration - result.duration) <= 1 / 30);
});

test("optional real VP9 footage renders odd and ultrawide sources without mutation", {
  skip: !process.env.STORYBENCH_REAL_MEDIA_DIR,
}, async (t) => {
  const value = await fixture();
  t.after(() => rm(value.workspace, { recursive: true, force: true }));
  const sources = ["Screencast_20260911_001824.webm", "Screencast_20260911_002734.webm"]
    .map((name) => join(process.env.STORYBENCH_REAL_MEDIA_DIR, name));
  const before = await Promise.all(sources.map(digest));
  const imported = await Promise.all(sources.map((sourcePath) => importMedia({ workspace: value.workspace, sourcePath })));
  const libraryItems = imported.map((asset, index) => ({ id: `real-${index}`, assetId: `real-${index}`, asset }));
  const plan = { fps: 30, durationFrames: 30, visualSpine: libraryItems.map((item, index) => ({
    cardId: `real-${index}`, itemId: item.id, assetId: item.assetId,
    startFrame: index * 15, durationFrames: 15, sourceInFrame: 3, sourceOutFrame: 18,
  })), audioPlacements: [] };
  const outputPath = join(value.workspace, "exports", "real-preview.mp4");
  await renderComposition({ workspace: value.workspace, plan, libraryItems, outputPath, preview: true });
  const rendered = await probeMedia(outputPath);
  assert.deepEqual([rendered.width, rendered.height], [1280, 720]);
  assert.ok(Math.abs(rendered.duration - 1) <= 1 / 30);
  assert.deepEqual(await Promise.all(sources.map(digest)), before);
});

test("typed render enqueue snapshots story, board, library and executes the composition renderer", async (t) => {
  const value = await fixture();
  const app = await createApp({ workspace: value.workspace });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { await app.close(); await rm(value.workspace, { recursive: true, force: true }); });
  let episode = app.store.createEpisode({ title: "Typed render" });
  const story = app.store.saveStory(episode.id, 1, "# Sections\n\n## Body");
  const assets = [
    app.store.saveAsset({ id: "red", name: "red", hash: "red-job", kind: "video", path: "media/red.mp4", duration: .3, metadata: { hasAudio: true } }),
    app.store.saveAsset({ id: "blue", name: "blue", hash: "blue-job", kind: "video", path: "media/blue.mp4", duration: .3, metadata: { hasAudio: true } }),
    app.store.saveAsset({ id: "voice", name: "voice", hash: "voice-job", kind: "audio", path: "media/voice.wav", duration: .3, metadata: { hasAudio: true } }),
  ];
  const items = assets.map((asset, index) => app.store.attachLibraryItem(episode.id, asset.id, { category: index === 2 ? "Narration" : "B-roll", label: asset.name }));
  episode = app.store.updateEpisode(episode.id, episode.revision, { cards: [
    { id: "red-card", title: "Red", type: "Video/Audio", prompt: "", sectionId: story.sections[0].id, itemId: items[0].id, referenceItemIds: [], order: 0, in: 0, out: .3, gain: .25 },
    { id: "blue-card", title: "Blue", type: "Video", prompt: "", sectionId: story.sections[0].id, itemId: items[1].id, referenceItemIds: [], order: 1, in: 0, out: .3 },
    { id: "voice-card", title: "Voice", type: "Audio", prompt: "", sectionId: story.sections[0].id, itemId: items[2].id, referenceItemIds: [], order: 2, role: "voiceover", anchorVisualCardId: "red-card", offset: 7 / 30, in: 0, out: 7 / 30, gain: .5 },
  ] });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const response = await fetch(`${base}/api/episodes/${episode.id}/render`, { method: "POST", headers: { origin: base, "content-type": "application/json" }, body: JSON.stringify({ kind: "preview" }) });
  assert.equal(response.status, 202);
  const job = await response.json();
  assert.equal(job.snapshot.story.storyRevision, story.storyRevision);
  assert.equal(job.snapshot.story.source, story.source);
  assert.equal(job.snapshot.episode.revision, episode.revision);
  assert.deepEqual(job.snapshot.libraryItems.map((item) => [item.id, item.revision]).sort(), items.map((item) => [item.id, item.revision]).sort());
  assert.equal(job.snapshot.composition.durationFrames, 18);
  let completed;
  for (let attempt = 0; attempt < 60; attempt++) {
    completed = app.store.getJob(job.id);
    if (["completed", "failed"].includes(completed.state)) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(completed.state, "completed", completed.error);
  await access(join(value.workspace, completed.outputPath));
});

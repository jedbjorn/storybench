// On Halo: npm run build && node scripts/scored-draft-proof.mjs <new evidence directory> [spoken-line.wav]
// Repeat from a clean worktree with FFmpeg and Playwright Chromium. All productions here are disposable.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, open, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright-core";
import { Resvg } from "@resvg/resvg-js";
import { importMedia } from "../src/media.js";
import { inspectAudio } from "../src/runtime/media-inspect.js";
import { createApp } from "../src/server.js";
import { initDataRoot } from "../src/services/data-root.js";
import { listenInRange } from "../test-support/loopback-port.js";

assert.ok(process.argv[2], "Supply a new directory for retained evidence");
const evidence = path.resolve(process.argv[2]);
await mkdir(evidence);
const file = name => path.join(evidence, name);
const json = (name, value) => writeFile(file(name), JSON.stringify(value, null, 2) + "\n");
const digest = async filename => createHash("sha256").update(await readFile(filename)).digest("hex");
const ffmpeg = args => execFileSync("ffmpeg", ["-nostdin", "-v", "error", ...args], { maxBuffer: 8 * 1024 * 1024 });
const fps = 30;

// A little original plucked phrase over a held A. The prominent chord at source 8 s is the creator mark.
const notes = [[5.5, 220, 0.26], [6.5, 329.63, 0.28], [7.2, 392, 0.38], [8, 440, 0.45], [8, 554.37, 0.24]];
const plucks = notes.map(([at, hz, gain]) => {
  const age = '(t-' + at + ')', phase = '2*PI*' + hz + '*' + age;
  return 'if(gte(t,' + at + '),' + gain + '*exp(-3*' + age + ')*(sin(' + phase + ')+0.25*sin(2*' + phase + ')),0)';
});
const held = "0.018*sin(2*PI*110*t)*clip(t-4,0,1)";
ffmpeg(["-f", "lavfi", "-i", "aevalsrc='" + [held, ...plucks].join("+") + "':s=48000:d=10", file("stage-score.wav")]);
const voiceSource = process.argv[3] || "/usr/share/sounds/alsa/Front_Center.wav";
await copyFile(voiceSource, file("voice.wav"));

for (const [name, backdrop, lamp] of [
  ["wings", "#0c1426", "#273348"], ["hold", "#263349", "#556478"], ["reveal", "#e8b774", "#fff2bd"],
]) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360">
    <rect width="640" height="360" fill="${backdrop}"/>
    <path d="M120 310 L273 60 H367 L520 310 Z" fill="${lamp}" opacity="0.55"/>
    <ellipse cx="320" cy="306" rx="200" ry="17" fill="${lamp}"/>
    <path d="M285 306 L294 222 Q320 194 346 222 L355 306Z" fill="#192233"/>
    <circle cx="320" cy="187" r="25" fill="#192233"/>
  </svg>`;
  await writeFile(file(name + ".png"), new Resvg(svg).render().asPng());
}

async function measure(filename, start, end) {
  const handle = await open(filename);
  try { return await inspectAudio(handle, start, end); }
  finally { await handle.close(); }
}

function pcm(filename) {
  const bytes = ffmpeg(["-i", filename, "-map", "0:a:0", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", "-f", "s16le", "-"]);
  return new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
}

// Compare the spoken line to the supplied speech after AAC encoding and volume adjustment.
function voiceCorrelation(mix, voice, startSeconds) {
  const start = Math.round(startSeconds * 16000);
  let xy = 0, xx = 0, yy = 0;
  for (let i = 0; i < Math.min(voice.length, 16000); i++) {
    xy += mix[start + i] * voice[i];
    xx += mix[start + i] ** 2;
    yy += voice[i] ** 2;
  }
  return xy / Math.sqrt(xx * yy);
}

async function observe(filename, placement, beats, voice, voiceStart) {
  const stream = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_entries",
    "stream=codec_type,start_time,avg_frame_rate", "-of", "json", filename])).streams;
  const video = stream.find(s => s.codec_type === "video");
  assert.equal(video.avg_frame_rate, fps + "/1");
  for (const s of stream) assert.equal(Number(s.start_time), 0, "compare streams on their shared presentation clock");

  // Decode every picture. The bright stage is distinct from both preceding shots.
  const pictures = ffmpeg(["-i", filename, "-map", "0:v:0", "-vf", "scale=16:9,format=gray", "-fps_mode", "passthrough", "-f", "rawvideo", "-"]);
  const pixels = 16 * 9;
  const frames = [];
  for (let i = 0; i < pictures.length; i += pixels) frames.push(pictures.subarray(i, i + pixels));
  const reveal = frames.findIndex(frame => frame[8] > 140);
  assert.ok(reveal >= 0, "bright stage appears");

  // Measure the encoded mix on either side of each expected note, including the two crossed by the hold.
  const hits = [];
  for (const seconds of [...beats, placement.cutSeconds]) {
    const { candidateAccents } = await measure(filename, seconds - 0.2, seconds + 0.2);
    assert.equal(candidateAccents.length, 1, 'one decoded attack near ' + seconds + ' s: ' + JSON.stringify(candidateAccents));
    const [hit] = candidateAccents;
    assert.ok(Math.abs(hit.atSeconds - seconds) <= 1 / fps, JSON.stringify(hit));
    hits.push(hit);
  }
  const audioFrame = hits.at(-1).atSeconds * fps;
  assert.ok(Math.abs(reveal - audioFrame) <= 1 && Math.abs(reveal - placement.cutFrame) <= 1,
    JSON.stringify({ reveal, audioFrame, placement }));
  const first = Math.floor(hits[0].atSeconds * fps) - 1;
  const last = Math.ceil(hits[1].atSeconds * fps) + 1;
  assert.ok(last < reveal);
  let maxPixelDelta = 0;
  for (const frame of frames.slice(first, last + 1)) {
    for (let i = 0; i < pixels; i++) maxPixelDelta = Math.max(maxPixelDelta, Math.abs(frame[i] - frames[first][i]));
  }
  assert.ok(maxPixelDelta <= 3, 'hold changed by ' + maxPixelDelta);
  const narrationCorrelation = voiceCorrelation(pcm(filename), voice, voiceStart);
  assert.ok(narrationCorrelation > 0.9, 'decoded speech correlation ' + narrationCorrelation);
  return { stream, revealFrame: reveal, beforeLuma: frames[reveal - 1][8], revealLuma: frames[reveal][8],
    decodedAttacks: hits, frameDifference: Math.abs(reveal - audioFrame),
    hold: { firstFrame: first, lastFrame: last, maxPixelDelta }, voiceStart, narrationCorrelation };
}

async function play(page, draft, revealSeconds) {
  const selector = '#draftJobs [data-job-id="' + draft.id + '"] video';
  const player = page.locator(selector);
  await player.waitFor();
  const result = await player.evaluate(async (video, seconds) => {
    video.currentTime = seconds;
    video.muted = false;
    await video.play();
    return { src: video.getAttribute("src"), muted: video.muted, volume: video.volume, start: seconds };
  }, 0);
  await page.waitForFunction(({ selector, seconds }) => document.querySelector(selector)?.currentTime > seconds + 0.1,
    { selector, seconds: revealSeconds }, { timeout: 10000 });
  result.end = await player.evaluate(video => { video.pause(); return video.currentTime; });
  await player.screenshot({ path: file(draft.name + "-player.png") });
  return result;
}

const workspace = await mkdtemp(path.join(os.tmpdir(), "storybench-score-"));
let app, browser;
try {
  initDataRoot(workspace);
  app = await createApp({ dataRoot: workspace });
  const { store, renders } = app;
  const channel = store.createChannel("Scored draft check");
  const episode = store.createEpisode({ title: "Front and center", channelId: channel.id });
  const sectionId = store.saveStory(episode.id, 1, "# Sections\n\n## Lights up").sections[0].id;
  const items = {};
  for (const name of ["wings.png", "hold.png", "reveal.png", "stage-score.wav", "voice.wav"]) {
    const imported = await importMedia({ workspace, sourcePath: file(name), mediaDirectory: store.channelMediaDirectory(channel.id) });
    const asset = store.saveAsset({ ...imported, channelId: channel.id });
    items[name] = store.attachLibraryItem(episode.id, asset.id, { category: name.endsWith(".png") ? "Graphics" : "Narration" });
  }
  const score = items["stage-score.wav"];
  const quiet = await measure(file("stage-score.wav"), 1, 2);
  assert.deepEqual(quiet.candidateAccents, []);
  const phrase = await measure(file("stage-score.wav"), 5, 9);
  const replacement = phrase.candidateAccents.find(hit => Math.abs(hit.atSeconds - 7.2) < 1 / fps);
  assert.ok(replacement, "measured alternative for the revision");
  const mark = { assetId: score.assetId, sourceSeconds: 8, label: "Resolution", visualMoment: "Stage lights up" };
  const save = cards => store.updateEpisode(episode.id, store.getEpisode(episode.id).revision, { cards });
  const edit = (id, changes) => save(store.getEpisode(episode.id).cards.map(card => card.id === id ? { ...card, ...changes } : card));
  const validate = () => renders.validateRender(episode.id);
  const still = (id, order, duration) => ({ id, sectionId, order, title: id, type: "Static Graphic", itemId: items[id + ".png"].id, duration });
  save([still("wings", 0, 1.5), still("hold", 1, 3.5), still("reveal", 2, 2),
    { id: "score", sectionId, type: "Audio", role: "music", itemId: score.id, anchorVisualCardId: "hold",
      offset: 0.5, in: 5, out: 9.5, gain: 0.8, fadeOut: 0.25, cues: [mark] },
    { id: "voice", sectionId, type: "Audio", role: "voiceover", itemId: items["voice.wav"].id,
      anchorVisualCardId: "wings", offset: 1, in: 0, out: 1.4, gain: 0.75 }]);
  const render = async (name, plan) => {
    const { id } = renders.enqueueRender({ episodeId: episode.id, outputClass: "draft", expectedRenderRevision: plan.renderRevision });
    const deadline = Date.now() + 90000;
    let job = store.getJob(id);
    while (["queued", "running"].includes(job.state) && Date.now() < deadline) {
      await delay(100);
      job = store.getJob(id);
    }
    assert.equal(job.state, "completed", job.error || "draft timeout");
    const filename = file(name + ".mp4");
    await copyFile(path.join(workspace, job.outputPath), filename);
    await json(name + "-plan.json", plan);
    return { id, name, outputPath: job.outputPath, sha256: await digest(filename) };
  };

  const original = validate();
  assert.equal(original.cuePlacements[0].cutFrame, 150);
  const first = await render("first", original);
  const voice = pcm(file("voice.wav"));
  first.observations = await observe(file("first.mp4"), original.cuePlacements[0], [2.5, 3.5], voice, 1);
  edit("wings", { duration: 2.5 });
  const moved = validate().cuePlacements;
  assert.equal(moved[0].cutFrame, 180);
  edit("score", { out: 7.9 });
  const trimmed = validate().cuePlacements;
  assert.equal(trimmed[0].status, "trimmed-away");
  assert.ok(!("cutFrame" in trimmed[0]));
  edit("score", { cues: [{ ...mark, sourceSeconds: replacement.atSeconds, label: "Earlier entrance" }] });
  edit("hold", { duration: 2.7 });
  edit("voice", { offset: 2 });
  const revised = validate();
  assert.equal(revised.cuePlacements[0].cutFrame, 156);
  const second = await render("revised", revised);
  second.observations = await observe(file("revised.mp4"), revised.cuePlacements[0], [3.5, 4.5], voice, 2);

  save(store.getEpisode(episode.id).cards.filter(card => card.type !== "Audio"));
  const silent = validate();
  assert.deepEqual(silent.composition.audioPlacements, []);
  const third = await render("silent", silent);
  const samples = pcm(file("silent.mp4"));
  assert.ok(samples.length > 0 && samples.every(sample => sample === 0), "decoded mix is silent");
  third.silentSamples = samples.length;

  const port = await listenInRange(app.server);
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:' + port + '/?channel=' + channel.id + '&episode=' + episode.id + '#drafts');
  for (const [draft, seconds] of [[second, 5.2], [first, 5], [third, 5.2]]) {
    draft.playback = await play(page, draft, seconds);
    assert.equal(await digest(path.join(workspace, draft.outputPath)), draft.sha256);
  }
  await json("observations.json", { episodeId: episode.id, channelId: channel.id, fps, mark, phrase, quiet, moved, trimmed,
    voiceSource, voiceSha256: await digest(file("voice.wav")), first, second, third });
  console.log('Passed scored, revised and silent drafts. Evidence in ' + evidence);
} finally {
  await browser?.close();
  await app?.close();
  await rm(workspace, { recursive: true, force: true });
}

#!/usr/bin/env node
// Media tools proof (spec #11 task #24). Repeatable.
//
//   node scripts/media-tools-proof.mjs --evidence <dir> [--work <dir>] [--port 18857] [--harness codex,claude]
//        [--codex-model gpt-5.6-terra] [--claude-model sonnet]
//
// Drives both real harnesses through the existing worker path (openWorkerRequest; Claude at
// slice level) inside the app container. Disposable data only; real credential files are
// only read through per-request staging.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const arg = (name, fallback) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : fallback; };
const flag = (name) => argv.includes(`--${name}`);
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "").replace("T", "-");
const evidence = path.resolve(arg("evidence", path.join(repo, "media-tools-evidence")));
const work = path.resolve(arg("work", path.join(os.tmpdir(), `storybench-media-${stamp}`)));
const port = Number(arg("port", "18857"));
const harnesses = arg("harness", "codex,claude").split(",").filter(Boolean);
const models = { codex: arg("codex-model", "gpt-5.6-terra"), claude: arg("claude-model", "sonnet") };
const installId = `media${stamp.replace("-", "")}`;
const unit = `storybench-slice-test-${stamp}-media`;
const runtimeRoot = path.join(process.env.XDG_RUNTIME_DIR || os.tmpdir(), `sb-media-${stamp}`);
const dataRoot = path.join(work, "data"), stateRoot = path.join(work, "state");
const home = os.homedir();
const credentials = { codex: path.join(home, ".codex/auth.json"), claude: path.join(home, ".claude/.credentials.json") };
const DRIVER = path.join(repo, "src/runtime/slice-proof-driver.js");
const results = [];
const log = (...parts) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...parts);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function run(command, args, { allowFail = false, timeout = 900_000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout, maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error && !allowFail) reject(Object.assign(new Error(`${command} ${args.slice(0, 3).join(" ")} failed: ${stderr || error.message}`), { stdout, stderr }));
      else resolve({ code: error ? (error.code ?? 1) : 0, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}
const save = (name, content) => writeFile(path.join(evidence, name), typeof content === "string" ? content : JSON.stringify(content, null, 2) + "\n");
const record = (area, check, pass, detail, file) => { results.push({ area, check, pass: Boolean(pass), detail, evidence: file }); log(pass ? "PASS" : "FAIL", area, check, "-", detail); };
const sha = async (file) => createHash("sha256").update(await readFile(file)).digest("hex");
const appName = `storybench-${installId}-app`;
let driverCopied = null;
async function driver(spec, { timeout = 900_000 } = {}) {
  const appId = (await run("docker", ["inspect", appName, "--format", "{{.Id}}"], { allowFail: true })).stdout.trim();
  if (appId && driverCopied !== appId) { await run("docker", ["cp", DRIVER, `${appName}:/opt/storybench/app/src/runtime/slice-proof-driver.js`]); driverCopied = appId; }
  const out = await run("docker", ["exec", appName, "node", "src/runtime/slice-proof-driver.js", JSON.stringify(spec)], { allowFail: true, timeout });
  try { return JSON.parse(out.stdout.trim().split("\n").pop()); } catch { return { fatal: `${out.stdout.slice(-1500)} ${out.stderr.slice(-1500)}` }; }
}
const offline = async (image, spec) => JSON.parse((await run("docker", ["run", "--rm", "--network", "none", "--user", "0:0", "--cap-drop", "ALL",
  "--mount", `type=bind,source=${dataRoot},target=/storybench/data`, "--mount", `type=bind,source=${DRIVER},target=/opt/storybench/app/src/runtime/slice-proof-driver.js,readonly`,
  image, "node", "src/runtime/slice-proof-driver.js", JSON.stringify(spec)])).stdout.trim().split("\n").pop());

async function fixtures() {
  const dir = path.join(dataRoot, "imports/fixtures");
  await mkdir(dir, { recursive: true });
  // Still: orange five-pointed star on teal. Clip: 0-2 s purple + white square, 2-4 s yellow +
  // black circle, 4-6 s red + white triangle. Ordinary: green badge. Reference: blue stripes.
  await run("python3", ["-c", `
from PIL import Image, ImageDraw
import math
d='${dir}'
im = Image.new('RGB', (640, 480), (0, 128, 128)); g = ImageDraw.Draw(im)
pts = [(320 + (200 if i % 2 == 0 else 80) * math.cos(-math.pi/2 + i*math.pi/5), 240 + (200 if i % 2 == 0 else 80) * math.sin(-math.pi/2 + i*math.pi/5)) for i in range(10)]
g.polygon(pts, fill=(255, 140, 0)); im.save(d + '/fixture-a.png')
for name, bg, shape in [('s1', (128, 0, 160), 'square'), ('s2', (255, 230, 0), 'circle'), ('s3', (220, 0, 0), 'triangle')]:
    im = Image.new('RGB', (640, 480), bg); g = ImageDraw.Draw(im)
    if shape == 'square': g.rectangle((220, 140, 420, 340), fill=(255, 255, 255))
    if shape == 'circle': g.ellipse((220, 140, 420, 340), fill=(0, 0, 0))
    if shape == 'triangle': g.polygon([(320, 120), (440, 360), (200, 360)], fill=(255, 255, 255))
    im.save('${work}/' + name + '.png')
im = Image.new('RGB', (320, 240), (20, 160, 60)); g = ImageDraw.Draw(im); g.ellipse((100, 60, 220, 180), fill=(255, 255, 255)); im.save(d + '/ordinary.png')
im = Image.new('RGB', (320, 240), (30, 60, 220)); g = ImageDraw.Draw(im)
for y in range(0, 240, 40): g.rectangle((0, y, 320, y + 18), fill=(200, 220, 255))
im.save(d + '/reference.png')
`]);
  await run("ffmpeg", ["-v", "error", "-y", ...["s1", "s2", "s3"].flatMap((name) => ["-loop", "1", "-t", "2", "-framerate", "24", "-i", path.join(work, `${name}.png`)]),
    "-filter_complex", "[0][1][2]concat=n=3:v=1:a=0,format=yuv420p[v]", "-map", "[v]", "-r", "24", path.join(dir, "clip-b.mp4")]);
}

async function startHost(manifestPath) {
  const configPath = path.join(work, "host.json");
  await writeFile(configPath, JSON.stringify({ installId, dataRoot, stateRoot, runtimeRoot, port, manifestPath, credentials, healthTimeoutMs: 90_000 }, null, 2));
  await run("systemd-run", ["--user", `--unit=${unit}`, "--collect", "--property=KillMode=mixed", "--property=TimeoutStopSec=120",
    `--setenv=PATH=${process.env.PATH}`, `--setenv=HOME=${home}`, `--working-directory=${repo}`, process.execPath, path.join(repo, "src/runtime/host.js"), "--config", configPath]);
  for (let i = 0; i < 150; i++) {
    const own = /"event":"app\.healthy"/.test((await run("journalctl", ["--user", "-u", unit, "--no-pager", "-o", "cat"], { allowFail: true })).stdout);
    if (own) return true;
    await sleep(1000);
  }
  return false;
}

const lower = (value) => String(value ?? "").toLowerCase();
function commandsOf(turn) {
  return (turn.events ?? []).flatMap((event) => event.type === "commandExecution" ? [event.command ?? ""]
    : event.type === "assistant" ? (event.blocks ?? []).filter((block) => block.tool_use === "Bash").map((block) => block.input) : []).join("\n");
}

async function harnessRun(harness, seed, seedA, seedB, sourceHashBefore) {
  const conversation = seed.conversations[harness];
  const common = { harness, model: models[harness], conversationId: conversation.id, segmentId: `seg-media-${harness}`, episodeId: seedA.id,
    bootContext: { channel: { id: seedA.channelId }, episode: { id: seedA.id }, paths: { projects: "/storybench/data/channels" }, runtime: { harness, model: models[harness], bootPhrase: "(none)", skillPhrase: "(none)" } } };
  const clipFile = `/storybench/data/${seed.assetPaths.clip}`;
  // Turn 1: inspection, catalogue, capabilities.
  const prompt1 = [
    "Storybench media-tools check. Use only the Storybench tools for looking at media; do not analyze image or video files with shell commands.",
    "1. Call get_capabilities and list the Storybench tool names you have and how images reach you.",
    "2. Call search_project with no query and list every item with its channel name, episode title and label.",
    `3. Call inspect_image with itemId ${seed.items.still} and describe the main shape, its color and the background color.`,
    `4. Call inspect_image with itemId ${seed.items.clip} and atSeconds 3, then inspect_contact_sheet with itemId ${seed.items.clip}, startSeconds 0, endSeconds 6, count 6. Report which background color and shape occupy which time range.`,
    `5. Call inspect_media with itemId ${seed.items.clip} and report its duration and resolution.`,
    "Keep the answer brief.",
  ].join("\n");
  log(harness, "turn 1 (inspect)");
  const t1 = await driver({ ...common, phase: "inspect", requestId: `req-${harness}-inspect`, prompt: prompt1, timeoutMs: 480_000 });
  await save(`${harness}-1-inspect.json`, t1);
  const text1 = lower(t1.finalText);
  const tools1 = t1.toolCalls ?? [];
  const imageCalls = tools1.filter((call) => call.output?.images?.length);
  const analyzed = [seed.assetPaths.still, seed.assetPaths.clip].some((asset) => commandsOf(t1).includes(asset.split("/").pop())) || /ffprobe|PIL|Image\.open/.test(commandsOf(t1));
  record(harness, "capabilities reported from served tools", tools1.some((call) => call.tool === "get_capabilities" && !call.error) && /inspect_contact_sheet/.test(text1) && /register_work_file/.test(text1), "get_capabilities called; tool names reported", `${harness}-1-inspect.json`);
  record(harness, "catalogue lists other channel's items with origin", tools1.some((call) => call.tool === "search_project" && !call.error) && /beta/.test(text1) && /beta badge/.test(text1), "search_project results named Beta channel items", `${harness}-1-inspect.json`);
  record(harness, "still image received (orange star on teal)", imageCalls.some((call) => call.tool === "inspect_image" && call.args.itemId === seed.items.still) && /star/.test(text1) && /orange/.test(text1) && /teal|turquoise|cyan|blue-green/.test(text1) && !analyzed, `image results ${imageCalls.length}; shell analysis ${analyzed}`, `${harness}-1-inspect.json`);
  record(harness, "frame at 3 s and contact sheet distinguish scenes", imageCalls.some((call) => call.tool === "inspect_image" && call.args.atSeconds === 3) && imageCalls.some((call) => call.tool === "inspect_contact_sheet")
    && /yellow/.test(text1) && /(purple|violet|magenta)/.test(text1) && /red/.test(text1) && /circle/.test(text1), "yellow+circle at 2-4 s, purple 0-2 s, red 4-6 s", `${harness}-1-inspect.json`);
  record(harness, "ffprobe metadata read", tools1.some((call) => call.tool === "inspect_media" && !call.error) && /6(\.0+)?\s*(s|sec)/.test(text1) && /640\s*[x×]\s*480/.test(text1), "6 s, 640x480", `${harness}-1-inspect.json`);

  // Turn 2: produce, register (one card assignment, one stale-revision conflict), reuse.
  const state = await driver({ phase: "episode-state", episodeId: seedA.id });
  const current = state.revision, staleRevision = state.revision - 1;
  const size = harness === "codex" ? "320x240" : "352x240";
  const prompt2 = [
    "Storybench production-tools check. Do each step and report each tool result briefly.",
    `1. With ffmpeg, cut seconds 4 to 6 of the scene clip (file ${clipFile}) into a ${size} MP4 at work/${harness}-cut.mp4 (e.g. ffmpeg -y -ss 4 -t 2 -i ${clipFile} -vf scale=${size.replace("x", ":")} -an work/${harness}-cut.mp4). Register it with register_work_file: category B-roll, cardId card_broll, expectedRevision ${current}.`,
    `2. Write a Python script work/${harness}-title.py that uses Pillow to draw a 640x360 still graphic (a white circle on dark green, plus the text ${harness.toUpperCase()}) saved as work/${harness}-title.png, and run it. Register the PNG with register_work_file: category Graphics, sourcePath work/${harness}-title.py, cardId card_title, expectedRevision ${staleRevision}. Use exactly that revision and do not retry if the card is not updated; report what happened to the card and the item.`,
    `3. Reuse item ${seed.items.ordinary} from episode ${seedB.id} (another channel) into this episode with reuse_project_item, and report its origin.`,
    `4. Call reuse_project_item for the reference item ${seed.items.reference} from episode ${seedB.id} WITHOUT a direction and report the result. Then call it again with direction { messageId: ${conversation.directionMessageId}, use: "direct-use" } — that message is the creator's instruction — and report the result.`,
  ].join("\n");
  log(harness, "turn 2 (produce/reuse)");
  const t2 = await driver({ ...common, phase: "produce", requestId: `req-${harness}-produce`, prompt: prompt2, resume: t1.sessionId, timeoutMs: 600_000 });
  await save(`${harness}-2-produce.json`, t2);
  const after = await driver({ phase: "episode-state", episodeId: seedA.id });
  await save(`${harness}-2-episode-state.json`, after);
  const mine = after.library.filter((item) => item.provenance?.requestId === `req-${harness}-produce`);
  const cut = mine.find((item) => /-cut\.mp4$/.test(item.provenance?.workPath ?? ""));
  const title = mine.find((item) => /-title\.png$/.test(item.provenance?.workPath ?? ""));
  const cards = Object.fromEntries(after.cards.map((card) => [card.id, card]));
  const tools2 = t2.toolCalls ?? [];
  const registerResults = tools2.filter((call) => call.tool === "register_work_file" && call.output).map((call) => { try { return JSON.parse(call.output.text); } catch { return {}; } });
  record(harness, "command-made derivative registered and assigned to a card", cut && cut.category === "B-roll" && cut.kind === "video" && cards.card_broll.itemId === cut.id, `item ${cut?.id}; card_broll.itemId ${cards.card_broll.itemId}`, `${harness}-2-episode-state.json`);
  record(harness, "still graphic registered with editable source; stale-revision card conflict keeps the asset", title && title.category === "Graphics" && title.provenance.editableSource === `work/${harness}-title.py`
    && registerResults.some((result) => result.libraryItemId === title.id && result.appliedToCard === false && /board changed/.test(result.conflict?.reason ?? "")) && cards.card_title.itemId !== title.id,
    `item ${title?.id}; card_title.itemId ${cards.card_title.itemId}`, `${harness}-2-produce.json`);
  const reusedOrdinary = after.library.find((item) => item.provenance?.reusedFrom?.itemId === seed.items.ordinary);
  const sourceHashAfter = await sha(path.join(dataRoot, seed.sourcePaths.ordinary));
  record(harness, "cross-channel reuse with provenance; source bytes unchanged", reusedOrdinary && reusedOrdinary.provenance.reusedFrom.channelId === seedB.channelId && sourceHashAfter === sourceHashBefore.ordinary
    && tools2.some((call) => call.tool === "reuse_project_item" && call.args.sourceItemId === seed.items.ordinary && !call.error),
    `item ${reusedOrdinary?.id} from ${reusedOrdinary?.provenance?.reusedFrom?.channelName}; source sha unchanged ${sourceHashAfter === sourceHashBefore.ordinary}`, `${harness}-2-episode-state.json`);
  const refCalls = tools2.filter((call) => call.tool === "reuse_project_item" && call.args.sourceItemId === seed.items.reference);
  const noDirection = refCalls.find((call) => !call.args.direction && !call.error);
  const directed = refCalls.find((call) => call.args.direction?.messageId === conversation.directionMessageId && !call.error);
  const direction = after.directions.find((entry) => entry.messageId === conversation.directionMessageId && entry.requestId === `req-${harness}-produce`);
  record(harness, "no-direction reuse of a reference succeeds; a supplied creator direction citation is validated and recorded",
    noDirection && directed && direction, `no-direction call succeeded: ${Boolean(noDirection)}; direction ${direction?.id}`, `${harness}-2-produce.json`);
}

async function main() {
  await mkdir(evidence, { recursive: true });
  await rm(work, { recursive: true, force: true });
  await mkdir(dataRoot, { recursive: true }); await mkdir(stateRoot, { recursive: true });
  const manifestPath = path.join(work, "manifest.json");
  log("release");
  await run(process.execPath, [path.join(repo, "src/runtime/release.js"), "build", "--out", manifestPath, "--tag", "storybench-media"], { timeout: 1_200_000 });
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  await save("release-manifest.json", manifest);
  const seed0 = await offline(manifest.images.app.id, { phase: "seed" });
  const [seedA, seedB] = seed0.episodes;
  await fixtures();
  const seed = await offline(manifest.images.app.id, { phase: "seed-media", episodes: seedA && [seedA, seedB], harnesses });
  const beforeState = await offline(manifest.images.app.id, { phase: "episode-state", episodeId: seedB.id });
  seed.sourcePaths = { ordinary: seed.assetPaths.ordinary };
  const sourceHashBefore = { ordinary: await sha(path.join(dataRoot, seed.sourcePaths.ordinary)) };
  await save("seed.json", { seed0, seed, sourceHashBefore, betaLibrary: beforeState.library.map(({ id, label, category, hash }) => ({ id, label, category, hash })) });
  const started = await startHost(manifestPath);
  record("host", "host unit started with the release", started, unit, "seed.json");
  try {
    for (const harness of harnesses) await harnessRun(harness, seed, seedA, seedB, sourceHashBefore);
  } finally {
    await run("systemctl", ["--user", "stop", unit], { allowFail: true, timeout: 180_000 });
    const left = (await run("docker", ["ps", "-a", "--filter", `label=io.storybench.install=${installId}`, "-q"])).stdout.trim();
    record("host", "stop leaves no containers", !left, left || "none", "summary.json");
    await rm(runtimeRoot, { recursive: true, force: true });
  }
  await save("summary.json", { stamp, models, manifestId: manifest.id, images: manifest.images, results });
  const table = ["| area | check | result | detail | evidence |", "|---|---|---|---|---|", ...results.map((row) => `| ${row.area} | ${row.check} | ${row.pass ? "PASS" : "FAIL"} | ${String(row.detail).replace(/\|/g, "/").slice(0, 220)} | ${row.evidence ?? ""} |`)].join("\n");
  await save("summary.md", `# Media tools proof ${stamp}\n\nModels: codex ${models.codex}, claude ${models.claude}\nManifest: ${manifest.id}\n\n${table}\n`);
  log(`done: ${results.filter((row) => row.pass).length}/${results.length} passed`);
  if (!flag("keep-work")) await rm(work, { recursive: true, force: true });
  process.exitCode = results.every((row) => row.pass) ? 0 : 1;
}

await main();

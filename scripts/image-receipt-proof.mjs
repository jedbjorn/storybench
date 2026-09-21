#!/usr/bin/env node
// Deterministic image-receipt proof (review of PR #26): every run shows the model fresh images
// that contain random text (a still, and a clip frame at a known timestamp) and requires the
// model to echo that text exactly. Runs N fresh threads per harness through the real worker path.
//
//   node scripts/image-receipt-proof.mjs --evidence <dir> [--runs 5] [--harness codex,claude]
//        [--port 18863] [--codex-model gpt-5.6-terra] [--claude-model sonnet] [--keep-work]
import { execFile } from "node:child_process";
import { randomInt } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const arg = (name, fallback) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : fallback; };
const flag = (name) => argv.includes(`--${name}`);
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "").replace("T", "-");
const evidence = path.resolve(arg("evidence", path.join(repo, "image-receipt-evidence")));
const work = path.resolve(arg("work", path.join(os.tmpdir(), `storybench-images-${stamp}`)));
const port = Number(arg("port", "18863"));
const runs = Number(arg("runs", "5"));
const harnesses = arg("harness", "codex,claude").split(",").filter(Boolean);
const models = { codex: arg("codex-model", "gpt-5.6-terra"), claude: arg("claude-model", "sonnet") };
const installId = `img${stamp.replace("-", "")}`;
const unit = `storybench-slice-test-${stamp}-img`;
const runtimeRoot = path.join(process.env.XDG_RUNTIME_DIR || os.tmpdir(), `sb-img-${stamp}`);
const dataRoot = path.join(work, "data"), stateRoot = path.join(work, "state");
const home = os.homedir();
const credentials = { codex: path.join(home, ".codex/auth.json"), claude: path.join(home, ".claude/.credentials.json") };
const DRIVER = path.join(repo, "src/runtime/slice-proof-driver.js");
const log = (...parts) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...parts);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const ALPHABET = "ACDEFHJKLMNPRTUVWXY3479";
// Four distinct characters (no repeats, which models can misread as doubled letters).
const nonce = () => { const pool = [...ALPHABET]; return Array.from({ length: 4 }, () => pool.splice(randomInt(pool.length), 1)[0]).join(""); };

function run(command, args, { allowFail = false, timeout = 1_800_000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout, maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error && !allowFail) reject(Object.assign(new Error(`${command} ${args.slice(0, 3).join(" ")} failed: ${stderr || error.message}`), { stdout, stderr }));
      else resolve({ code: error ? (error.code ?? 1) : 0, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}
const save = (name, content) => writeFile(path.join(evidence, name), typeof content === "string" ? content : JSON.stringify(content, null, 2) + "\n");
const appName = `storybench-${installId}-app`;
let copied = null;
async function driver(spec) {
  const id = (await run("docker", ["inspect", appName, "--format", "{{.Id}}"], { allowFail: true })).stdout.trim();
  if (id && copied !== id) { await run("docker", ["cp", DRIVER, `${appName}:/opt/storybench/app/src/runtime/slice-proof-driver.js`]); copied = id; }
  const out = await run("docker", ["exec", appName, "node", "src/runtime/slice-proof-driver.js", JSON.stringify(spec)], { allowFail: true });
  try { return JSON.parse(out.stdout.trim().split("\n").pop()); } catch { return { fatal: `${out.stdout.slice(-2000)} ${out.stderr.slice(-2000)}` }; }
}
const offline = async (image, spec) => JSON.parse((await run("docker", ["run", "--rm", "--network", "none", "--user", "0:0", "--cap-drop", "ALL", "--mount", `type=bind,source=${dataRoot},target=/storybench/data`,
  "--mount", `type=bind,source=${DRIVER},target=/opt/storybench/app/src/runtime/slice-proof-driver.js,readonly`, image, "node", "src/runtime/slice-proof-driver.js", JSON.stringify(spec)])).stdout.trim().split("\n").pop());

// Render text fixtures with the worker image's Pillow and fonts (same toolchain everywhere).
async function renderFixtures(image, fixtures) {
  const dir = path.join(dataRoot, "imports/fixtures");
  await mkdir(dir, { recursive: true });
  const script = `
import json, sys
from PIL import Image, ImageDraw, ImageFont
font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 150)
for f in json.loads(sys.argv[1]):
    im = Image.new('RGB', (900, 360), tuple(f['bg'])); d = ImageDraw.Draw(im)
    d.text((450, 180), ' '.join(f['text']), fill=tuple(f['fg']), font=font, anchor='mm')
    im.save('/fixtures/' + f['name'])
`;
  await run("docker", ["run", "--rm", "--network", "none", "--user", "0:0", "--mount", `type=bind,source=${dir},target=/fixtures`, image, "python3", "-c", script, JSON.stringify(fixtures)]);
  return dir;
}

async function main() {
  await mkdir(evidence, { recursive: true });
  await rm(work, { recursive: true, force: true });
  await mkdir(dataRoot, { recursive: true }); await mkdir(stateRoot, { recursive: true });
  const manifestPath = path.join(work, "manifest.json");
  log("release");
  await run(process.execPath, [path.join(repo, "src/runtime/release.js"), "build", "--out", manifestPath, "--tag", "storybench-img"]);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  await save("release-manifest.json", manifest);
  const seed = await offline(manifest.images.app.id, { phase: "seed" });
  const episode = seed.episodes[0];
  // One still + one two-scene clip per run, each with fresh random text.
  const plan = [];
  const fixtures = [];
  for (const harness of harnesses) for (let n = 1; n <= runs; n++) {
    const entry = { harness, n, still: nonce(), frameA: nonce(), frameB: nonce() };
    plan.push(entry);
    fixtures.push({ name: `${harness}-${n}-still.png`, text: entry.still, bg: [250, 245, 230], fg: [20, 20, 20] });
    fixtures.push({ name: `${harness}-${n}-a.png`, text: entry.frameA, bg: [20, 40, 90], fg: [255, 255, 255] });
    fixtures.push({ name: `${harness}-${n}-b.png`, text: entry.frameB, bg: [90, 20, 40], fg: [255, 255, 255] });
  }
  const dir = await renderFixtures(manifest.images.worker.id, fixtures);
  for (const entry of plan) {
    // Clip: first text for 0-2 s, second text for 2-4 s. The model is asked for the frame at 3 s.
    await run("ffmpeg", ["-v", "error", "-y", "-loop", "1", "-t", "2", "-framerate", "24", "-i", path.join(dir, `${entry.harness}-${entry.n}-a.png`), "-loop", "1", "-t", "2", "-framerate", "24", "-i", path.join(dir, `${entry.harness}-${entry.n}-b.png`),
      "-filter_complex", "[0][1]concat=n=2:v=1:a=0,format=yuv420p[v]", "-map", "[v]", "-r", "24", path.join(dir, `${entry.harness}-${entry.n}-clip.mp4`)]);
  }
  const attached = await offline(manifest.images.app.id, { phase: "attach-files", episodeId: episode.id, files: plan.flatMap((entry) => [
    { file: `${entry.harness}-${entry.n}-still.png`, category: "Graphics", label: `Still ${entry.harness} ${entry.n}` },
    { file: `${entry.harness}-${entry.n}-clip.mp4`, category: "B-roll", label: `Clip ${entry.harness} ${entry.n}` }]) });
  const itemOf = (file) => attached.items.find((item) => item.file === file).itemId;
  const configPath = path.join(work, "host.json");
  await writeFile(configPath, JSON.stringify({ installId, dataRoot, stateRoot, runtimeRoot, port, manifestPath, credentials, healthTimeoutMs: 90_000 }, null, 2));
  await run("systemd-run", ["--user", `--unit=${unit}`, "--collect", "--property=KillMode=mixed", "--property=TimeoutStopSec=120", `--setenv=PATH=${process.env.PATH}`, `--setenv=HOME=${home}`,
    `--working-directory=${repo}`, process.execPath, path.join(repo, "src/runtime/host.js"), "--config", configPath]);
  for (let i = 0; i < 150 && !/"event":"app\.healthy"/.test((await run("journalctl", ["--user", "-u", unit, "--no-pager", "-o", "cat"], { allowFail: true })).stdout); i++) await sleep(1000);
  const results = [];
  try {
    for (const entry of plan) {
      const still = itemOf(`${entry.harness}-${entry.n}-still.png`), clip = itemOf(`${entry.harness}-${entry.n}-clip.mp4`);
      const prompt = flag("debug-shape") ? `Using your exec tool, run exactly this JavaScript and then reply with its output verbatim:\nconst r = await tools.inspect_image({itemId:"${still}"}); text("TYPE=" + typeof r + " ISARRAY=" + Array.isArray(r) + " KEYS=" + JSON.stringify(Object.keys(r ?? {})) + " CONTENT=" + JSON.stringify((r?.content ?? r?.contentItems ?? []).map((c) => ({ keys: Object.keys(c), type: c.type, len: JSON.stringify(c).length }))));` : [
        `Call the Storybench tool inspect_image with itemId ${still}. Then call inspect_image with itemId ${clip} and atSeconds 3.`,
        "Each image shows a short code of four large capital letters and digits. Reply with exactly two lines:",
        "STILL: <the code in the first image>",
        "FRAME: <the code in the second image>",
        "If a tool result does not contain an image that you can actually see, write NO IMAGE RECEIVED on that line instead. Do not guess, and do not use shell commands or any other tool to read these files.",
      ].join("\n");
      log(entry.harness, "run", entry.n);
      const out = await driver({ phase: "inspect", harness: entry.harness, model: models[entry.harness], conversationId: `conv-img-${entry.harness}-${entry.n}`, segmentId: `seg-img-${entry.harness}-${entry.n}`,
        episodeId: episode.id, requestId: `req-img-${entry.harness}-${entry.n}`, prompt, timeoutMs: 300_000,
        bootContext: { channel: { id: episode.channelId }, episode: { id: episode.id }, paths: { projects: "/storybench/data/channels" }, runtime: { harness: entry.harness, model: models[entry.harness], bootPhrase: "(none)", skillPhrase: "(none)" } } });
      await save(`${entry.harness}-${entry.n}.json`, out);
      // Compare with spaces removed (the code is drawn with spaced characters).
      const text = String(out.finalText ?? "").toUpperCase().replace(/(STILL|FRAME):\s*([A-Z0-9 ]+)/g, (_, label, code) => `${label}: ${code.replace(/ /g, "")}`);
      const images = (out.toolCalls ?? []).filter((call) => call.output?.images?.length).map((call) => `${call.tool}:${call.output.images[0].bytes}b`);
      const row = { harness: entry.harness, n: entry.n, expected: { still: entry.still, frame: entry.frameB }, still: text.includes(`STILL: ${entry.still}`), frame: text.includes(`FRAME: ${entry.frameB}`),
        wrongScene: text.includes(entry.frameA), noImage: text.includes("NO IMAGE RECEIVED"), images, reply: String(out.finalText ?? "").slice(-300), error: out.turnError ?? out.fatal ?? null };
      results.push(row);
      log(entry.harness, entry.n, row.still && row.frame ? "PASS" : "FAIL", JSON.stringify({ still: row.still, frame: row.frame, noImage: row.noImage }));
    }
  } finally {
    await run("systemctl", ["--user", "stop", unit], { allowFail: true, timeout: 180_000 });
    await rm(runtimeRoot, { recursive: true, force: true });
  }
  // Diagnostics: how each Codex rollout recorded the tool outputs (image items present or not).
  const rollouts = [];
  const walk = async (dirPath) => { for (const entry of await readdir(dirPath, { withFileTypes: true }).catch(() => [])) { const full = path.join(dirPath, entry.name); if (entry.isDirectory()) await walk(full); else if (/^rollout-.*\.jsonl$/.test(entry.name)) rollouts.push(full); } };
  await walk(path.join(stateRoot, "harnesses/codex"));
  const diagnostics = [];
  for (const file of rollouts) {
    const lines = (await readFile(file, "utf8")).split("\n").filter(Boolean).map((line) => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
    const outputs = lines.filter((line) => line.payload?.type === "function_call_output" || line.payload?.type === "custom_tool_call_output");
    diagnostics.push({ rollout: path.relative(stateRoot, file), outputs: outputs.map((line) => { const output = line.payload.output; const text = JSON.stringify(output); return { type: line.payload.type, shape: typeof output === "string" ? "string" : Array.isArray(output) ? "array" : typeof output, hasImage: /input_image|image_url|data:image/.test(text), length: text.length, sample: text.slice(0, 200) }; }) });
  }
  await save("codex-rollout-diagnostics.json", diagnostics);
  const summary = harnesses.map((harness) => ({ harness, model: models[harness], passed: results.filter((row) => row.harness === harness && row.still && row.frame).length, runs }));
  await save("summary.json", { stamp, manifestId: manifest.id, summary, results });
  await save("summary.md", `# Image receipt proof ${stamp}\n\n${summary.map((row) => `- ${row.harness} (${row.model}): ${row.passed}/${row.runs}`).join("\n")}\n\n| harness | run | still | frame@3s | no-image | images returned |\n|---|---|---|---|---|---|\n${results.map((row) => `| ${row.harness} | ${row.n} | ${row.still ? "PASS" : "FAIL"} | ${row.frame ? "PASS" : "FAIL"} | ${row.noImage} | ${row.images.join(" ")} |`).join("\n")}\n`);
  log(summary.map((row) => `${row.harness} ${row.passed}/${row.runs}`).join("; "));
  if (!flag("keep-work")) await rm(work, { recursive: true, force: true });
  process.exitCode = summary.every((row) => row.passed === row.runs) ? 0 : 1;
}

await main();

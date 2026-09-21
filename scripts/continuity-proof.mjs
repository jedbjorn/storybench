#!/usr/bin/env node
// Harness/model switching and continuity proof (spec #11 task #26). Repeatable.
//
//   node scripts/continuity-proof.mjs --evidence <dir> [--work <dir>] [--port 18861]
//        [--codex-model gpt-5.6-terra] [--codex-alt gpt-5.6-luna] [--claude-model sonnet]
//
// Real workers and both real harnesses through the real chat service (driver inside the app
// container; conversation persistence in memory until schema v9 lands). Also checks that
// container diagnostics reach the host journal without model text (SC-101).
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const arg = (name, fallback) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : fallback; };
const flag = (name) => argv.includes(`--${name}`);
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "").replace("T", "-");
const evidence = path.resolve(arg("evidence", path.join(repo, "continuity-evidence")));
const work = path.resolve(arg("work", path.join(os.tmpdir(), `storybench-continuity-${stamp}`)));
const port = Number(arg("port", "18861"));
const models = { codex: arg("codex-model", "gpt-5.6-terra"), codexAlt: arg("codex-alt", "gpt-5.6-luna"), claude: arg("claude-model", "sonnet") };
const installId = `cont${stamp.replace("-", "")}`;
const unit = `storybench-slice-test-${stamp}-cont`;
const runtimeRoot = path.join(process.env.XDG_RUNTIME_DIR || os.tmpdir(), `sb-cont-${stamp}`);
const dataRoot = path.join(work, "data"), stateRoot = path.join(work, "state");
const home = os.homedir();
const credentials = { codex: path.join(home, ".codex/auth.json"), claude: path.join(home, ".claude/.credentials.json") };
const DRIVER = path.join(repo, "src/runtime/slice-proof-driver.js");
const results = [];
const log = (...parts) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...parts);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function run(command, args, { allowFail = false, timeout = 1_800_000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout, maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error && !allowFail) reject(Object.assign(new Error(`${command} ${args.slice(0, 3).join(" ")} failed: ${stderr || error.message}`), { stdout, stderr }));
      else resolve({ code: error ? (error.code ?? 1) : 0, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}
const save = (name, content) => writeFile(path.join(evidence, name), typeof content === "string" ? content : JSON.stringify(content, null, 2) + "\n");
const record = (area, check, pass, detail, file) => { results.push({ area, check, pass: Boolean(pass), detail, evidence: file }); log(pass ? "PASS" : "FAIL", area, check, "-", detail); };
const appName = `storybench-${installId}-app`;
let copied = null;
async function driver(spec) {
  const id = (await run("docker", ["inspect", appName, "--format", "{{.Id}}"], { allowFail: true })).stdout.trim();
  if (id && copied !== id) { await run("docker", ["cp", DRIVER, `${appName}:/opt/storybench/app/src/runtime/slice-proof-driver.js`]); copied = id; }
  const out = await run("docker", ["exec", appName, "node", "src/runtime/slice-proof-driver.js", JSON.stringify(spec)], { allowFail: true });
  try { return JSON.parse(out.stdout.trim().split("\n").pop()); } catch { return { fatal: `${out.stdout.slice(-2000)} ${out.stderr.slice(-2000)}` }; }
}

async function main() {
  await mkdir(evidence, { recursive: true });
  await rm(work, { recursive: true, force: true });
  await mkdir(dataRoot, { recursive: true }); await mkdir(stateRoot, { recursive: true });
  const manifestPath = path.join(work, "manifest.json");
  log("release");
  await run(process.execPath, [path.join(repo, "src/runtime/release.js"), "build", "--out", manifestPath, "--tag", "storybench-cont"]);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  await save("release-manifest.json", manifest);
  const seed = JSON.parse((await run("docker", ["run", "--rm", "--network", "none", "--user", "0:0", "--cap-drop", "ALL", "--mount", `type=bind,source=${dataRoot},target=/storybench/data`,
    "--mount", `type=bind,source=${DRIVER},target=/opt/storybench/app/src/runtime/slice-proof-driver.js,readonly`, manifest.images.app.id, "node", "src/runtime/slice-proof-driver.js", JSON.stringify({ phase: "seed" })])).stdout.trim().split("\n").pop());
  const episode = seed.episodes[0];
  const configPath = path.join(work, "host.json");
  await writeFile(configPath, JSON.stringify({ installId, dataRoot, stateRoot, runtimeRoot, port, manifestPath, credentials, healthTimeoutMs: 90_000 }, null, 2));
  await run("systemd-run", ["--user", `--unit=${unit}`, "--collect", "--property=KillMode=mixed", "--property=TimeoutStopSec=120", `--setenv=PATH=${process.env.PATH}`, `--setenv=HOME=${home}`,
    `--working-directory=${repo}`, process.execPath, path.join(repo, "src/runtime/host.js"), "--config", configPath]);
  for (let i = 0; i < 150 && !/"event":"app\.healthy"/.test((await run("journalctl", ["--user", "-u", unit, "--no-pager", "-o", "cat"], { allowFail: true })).stdout); i++) await sleep(1000);

  // Live catalogue from installed-harness discovery.
  const codexCatalog = await driver({ phase: "control", body: { op: "harness.models", harness: "codex", refresh: true } });
  const claudeCatalog = await driver({ phase: "control", body: { op: "harness.models", harness: "claude" } });
  await save("catalog.json", { codex: codexCatalog.reply, claude: claudeCatalog.reply });
  const codexIds = codexCatalog.reply?.value?.models?.map((model) => model.id) ?? [];
  record("catalog", "Codex models from native model/list; Claude aliases labelled advisory", codexIds.includes(models.codex) && codexIds.includes(models.codexAlt) && claudeCatalog.reply?.value?.advisory === true && claudeCatalog.reply.value.models.some((model) => model.id === models.claude),
    `codex: ${codexIds.join(", ")}; claude: ${claudeCatalog.reply?.value?.models?.map((model) => model.id).join(", ")}`, "catalog.json");

  const word = `KESTREL-${randomBytes(3).toString("hex").toUpperCase()}`;
  const hook = `A lighthouse keeper's cat named ${randomBytes(2).toString("hex").toUpperCase()} rings the fog bell.`;
  const followUp = "Use the Storybench get_context tool to read this episode's story, then answer in one line: the story's Hook line, and the code word I gave you earlier in this conversation.";
  const steps = [
    { settings: { harness: "codex", model: models.codex, effort: "low" } },
    { send: `Remember this code word for later: ${word}. Reply only with OK.` },
    { settings: { harness: "codex", model: models.codexAlt, effort: "low" } },
    { send: followUp },
    { settings: { harness: "claude", model: models.claude } },
    { send: followUp },
    { settings: { harness: "codex", model: models.codex, effort: "low" } },
    { send: followUp },
  ];
  log("continuity run");
  const result = await driver({ phase: "continuity", episodeId: episode.id, story: `# Overview\n\nContinuity proof episode.\n\n# Hook\n\n${hook}\n\n# Sections\n\n## Intro\n\nOpening.\n`, steps, timeoutMs: 360_000 });
  await save("continuity.json", result);
  const turns = (result.steps ?? []).filter((step) => step.send);
  const [t1, t2, t3, t4] = turns;
  const segments = result.segments ?? [];
  // Storybench tools used in a turn (Claude's own ToolSearch loads deferred MCP schemas; it is not a Storybench tool).
  const toolTurns = (turnId) => (result.events ?? []).filter((event) => event.type === "tool.started" && event.payload.turnId === turnId && event.payload.name !== "ToolSearch").map((event) => event.payload.name);
  const hookWord = hook.split(" ")[5];
  const answered = (turn) => turn?.state === "idle" && turn.reply.includes(word) && turn.reply.includes(hookWord);
  record("codex", "first turn with gpt-5.6-terra (low effort) in a worker", t1?.state === "idle" && t1.run?.harness === "codex" && t1.run?.modelSelected === models.codex && t1.run?.modelResolved === models.codex, `resolved ${t1?.run?.modelResolved}, effort ${t1?.run?.effortResolved}`, "continuity.json");
  record("switch", "Codex model switch resumes the exact native thread with the new model", answered(t2) && t2.threadId === t1.threadId && t2.run?.segmentId === t1.run?.segmentId && t2.run?.modelResolved === models.codexAlt && toolTurns(t2.run?.nativeTurnId).includes("get_context"),
    `thread ${t1?.threadId} -> ${t2?.threadId}; resolved ${t2?.run?.modelResolved}; tools ${toolTurns(t2?.run?.nativeTurnId).join(",")}`, "continuity.json");
  const claudeSegment = segments.find((segment) => segment.id === t3?.run?.segmentId);
  const seeded = (result.events ?? []).find((event) => event.type === "segment.started" && event.payload.segmentId === t3?.run?.segmentId);
  record("switch", "Codex -> Claude starts a new seeded segment; no native ID crosses; no replay", answered(t3) && t3.run?.harness === "claude" && claudeSegment?.reason === "harness-switch" && t3.threadId !== t1.threadId && seeded?.payload?.includedMessages >= 2
    && toolTurns(t3.run?.nativeTurnId).every((name) => name === "get_context") && toolTurns(t3.run?.nativeTurnId).length >= 1,
    `segment ${claudeSegment?.id} (${claudeSegment?.reason}); seeded ${seeded?.payload?.includedMessages} msgs; claude session ${t3?.threadId}; resolved ${t3?.run?.modelResolved}; tools ${toolTurns(t3?.run?.nativeTurnId).join(",")}`, "continuity.json");
  const back = segments.find((segment) => segment.id === t4?.run?.segmentId);
  record("switch", "Claude -> Codex starts a fresh segment (harness-return), not the stale Codex thread", answered(t4) && back?.reason === "harness-return" && t4.threadId !== t1.threadId && t4.run?.harness === "codex" && toolTurns(t4.run?.nativeTurnId).includes("get_context"),
    `segment ${back?.id} (${back?.reason}); thread ${t4?.threadId}`, "continuity.json");
  record("attribution", "every run records selected and reported model", (result.runs ?? []).length === 4 && result.runs.every((runRow) => runRow.harness && runRow.modelResolved && runRow.state === "completed"), (result.runs ?? []).map((runRow) => `${runRow.harness}:${runRow.modelSelected}->${runRow.modelResolved}`).join(" "), "continuity.json");
  record("transcript", "visible settings and session boundaries", (result.events ?? []).filter((event) => event.type === "settings.changed").length === 4 && (result.events ?? []).filter((event) => event.type === "segment.started").length === 2, "4 settings boundaries, 2 new-session boundaries", "continuity.json");

  // SC-101: diagnostics in the journal, no model/prompt text.
  const journal = (await run("journalctl", ["--user", "-u", unit, "--no-pager", "-o", "cat"], { allowFail: true })).stdout;
  await save("journal.txt", journal);
  const appLines = journal.split("\n").filter((line) => line.includes('"event":"app.output"'));
  const workerLines = journal.split("\n").filter((line) => line.includes('"event":"worker.output"'));
  record("SC-101", "app and worker diagnostics forwarded to the host journal without prompt or model text", appLines.length > 0 && workerLines.some((line) => line.includes("harness.started")) && !journal.includes(word) && !journal.includes(hookWord),
    `${appLines.length} app lines, ${workerLines.length} worker diagnostic lines; code word/story absent`, "journal.txt");

  await run("systemctl", ["--user", "stop", unit], { allowFail: true, timeout: 180_000 });
  const left = (await run("docker", ["ps", "-a", "--filter", `label=io.storybench.install=${installId}`, "-q"])).stdout.trim();
  const followers = (await run("pgrep", ["-af", `docker logs --follow`], { allowFail: true })).stdout.split("\n").filter((line) => line.includes(installId) || false);
  record("host", "stop leaves no containers or log followers", !left && !followers.length, left || "none", "journal.txt");
  await rm(runtimeRoot, { recursive: true, force: true });
  await save("summary.json", { stamp, models, manifestId: manifest.id, results });
  const table = ["| area | check | result | detail |", "|---|---|---|---|", ...results.map((row) => `| ${row.area} | ${row.check} | ${row.pass ? "PASS" : "FAIL"} | ${String(row.detail).replace(/\|/g, "/").slice(0, 240)} |`)].join("\n");
  await save("summary.md", `# Continuity proof ${stamp}\n\nModels: codex ${models.codex} / ${models.codexAlt}, claude ${models.claude}\n\n${table}\n`);
  log(`done: ${results.filter((row) => row.pass).length}/${results.length} passed`);
  if (!flag("keep-work")) await rm(work, { recursive: true, force: true });
  process.exitCode = results.every((row) => row.pass) ? 0 : 1;
}

await main();

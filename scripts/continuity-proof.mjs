#!/usr/bin/env node
// Harness/model switching and continuity proof (spec #11 task #26). Repeatable.
//
//   node scripts/continuity-proof.mjs --evidence <dir> [--work <dir>] [--port 18861]
//        [--codex-model gpt-5.6-terra] [--codex-alt gpt-5.6-luna] [--claude-model sonnet]
//
// Real workers and both real harnesses through the app's HTTP API and chat service with the
// schema v9 store (settings, segments, production requests). Also checks that container
// diagnostics reach the host journal without model text (SC-101).
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

  const api = async (method, route, body) => {
    const response = await fetch(`http://127.0.0.1:${port}${route}`, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
    const text = await response.text();
    let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: response.status, json, text };
  };
  // Live catalogue from installed-harness discovery, through the app.
  const harnesses = (await api("GET", "/api/harnesses?refresh=1")).json;
  await save("catalog.json", harnesses);
  const entry = (name) => harnesses?.harnesses?.find((value) => value.harness === name);
  const codexIds = entry("codex")?.models?.map((model) => model.id) ?? [];
  record("catalog", "GET /api/harnesses: Codex models from native model/list; Claude aliases labelled advisory; selection enabled", harnesses?.available === true && codexIds.includes(models.codex) && codexIds.includes(models.codexAlt) && entry("claude")?.advisory === true && entry("claude").models.some((model) => model.id === models.claude),
    `codex: ${codexIds.join(", ")}; claude: ${entry("claude")?.models?.map((model) => model.id).join(", ")}`, "catalog.json");

  const word = `KESTREL-${randomBytes(3).toString("hex").toUpperCase()}`;
  const hook = `A lighthouse keeper's cat named ${randomBytes(2).toString("hex").toUpperCase()} rings the fog bell.`;
  // Story with a distinctive Hook, saved through the app.
  const story = (await api("GET", `/api/episodes/${episode.id}/story`)).json;
  const saved = await api("PUT", `/api/episodes/${episode.id}/story`, { expectedStoryRevision: story?.storyRevision, source: `# Overview\n\nContinuity proof episode.\n\n# Hook\n\n${hook}\n\n# Sections\n\n## Intro\n\nOpening.\n` });
  if (saved.status >= 300) throw new Error(`story save failed: ${saved.text}`);
  const followUp = "Use the Storybench get_context tool to read this episode's story, then answer in one line: the story's Hook line, and the code word I gave you earlier in this conversation.";
  const conversation = (await api("POST", `/api/episodes/${episode.id}/chats`, { name: "Continuity proof" })).json;
  const url = `/api/episodes/${episode.id}/chats/${conversation.id}`;
  const steps = [
    { settings: { harness: "codex", model: models.codex, effort: "low" } },
    { send: `Remember this code word for later: ${word}. Reply only with OK.` },
    { settings: { harness: "codex", model: models.codexAlt, effort: "low" } },
    { settings: { harness: "codex", model: models.codexAlt, effort: "low" }, duplicate: true },
    { send: followUp },
    { settings: { harness: "claude", model: models.claude } },
    { send: followUp },
    { settings: { harness: "codex", model: models.codex, effort: "low" } },
    { send: followUp },
  ];
  log("continuity run");
  const result = { steps: [] };
  let lastClientRequestId = null;
  for (const step of steps) {
    if (step.settings) {
      const current = (await api("GET", url)).json;
      const clientRequestId = step.duplicate ? lastClientRequestId : randomBytes(8).toString("hex");
      lastClientRequestId = clientRequestId;
      const response = await api("PUT", `${url}/settings`, { ...step.settings, expectedRevision: step.duplicate ? current.settings.revision - 1 : current.settings.revision, clientRequestId });
      result.steps.push({ settings: step.settings, duplicate: Boolean(step.duplicate), status: response.status, result: response.json?.settingsResult ?? response.json });
      continue;
    }
    const before = (await api("GET", url)).json.messages.length;
    const sent = await api("POST", `${url}/messages`, { text: step.send });
    let value;
    const deadline = Date.now() + 360_000;
    do { await sleep(1000); value = (await api("GET", url)).json; } while (!["idle", "error", "interrupted"].includes(value.state) && Date.now() < deadline);
    const reply = value.messages.slice(before).filter((message) => message.role === "assistant").map((message) => message.text).join("\n");
    result.steps.push({ send: step.send, sendStatus: sent.status, state: value.state, error: value.error ?? null, threadId: value.threadId ?? null, reply, run: value.runs?.at(-1) });
  }
  const final = (await api("GET", url)).json;
  result.segments = final.segments; result.runs = final.runs; result.settings = final.settings;
  result.events = final.events.filter((event) => ["settings.changed", "segment.started", "tool.called", "turn.started"].includes(event.type)).map(({ type, payload, createdAt }) => ({ type, payload, createdAt }));
  await save("continuity.json", result);
  // Busy refusal and duplicate submission through the API.
  const dup = result.steps.find((step) => step.duplicate);
  record("settings", "duplicate settings submission is idempotent (one boundary)", dup?.status === 200 && dup.result?.duplicate === true, JSON.stringify(dup?.result ?? null), "continuity.json");
  const turns = (result.steps ?? []).filter((step) => step.send);
  const [t1, t2, t3, t4] = turns;
  const segments = result.segments ?? [];
  // Storybench tools used in a turn (Claude's own ToolSearch loads deferred MCP schemas; it is not a Storybench tool).
  // Storybench tools each request actually called (recorded at the request bridge).
  const toolsOf = (runRow) => (result.events ?? []).filter((event) => event.type === "tool.called" && event.payload.requestId === runRow?.id).map((event) => event.payload.name);
  const hookWord = hook.split(" ")[5];
  const answered = (turn) => turn?.state === "idle" && turn.reply.includes(word) && turn.reply.includes(hookWord);
  record("codex", "first turn with gpt-5.6-terra (low effort) in a worker", t1?.state === "idle" && t1.run?.harness === "codex" && t1.run?.modelSelected === models.codex && t1.run?.modelResolved === models.codex, `resolved ${t1?.run?.modelResolved}, effort ${t1?.run?.effortResolved}`, "continuity.json");
  record("switch", "Codex model switch resumes the exact native thread with the new model", answered(t2) && t2.threadId === t1.threadId && t2.run?.segmentId === t1.run?.segmentId && t2.run?.modelResolved === models.codexAlt && toolsOf(t2.run).includes("get_context"),
    `thread ${t1?.threadId} -> ${t2?.threadId}; resolved ${t2?.run?.modelResolved}; tools ${toolsOf(t2?.run).join(",")}`, "continuity.json");
  const claudeSegment = segments.find((segment) => segment.id === t3?.run?.segmentId);
  const seeded = (result.events ?? []).find((event) => event.type === "segment.started" && event.payload.segmentId === t3?.run?.segmentId);
  record("switch", "Codex -> Claude starts a new seeded segment; no native ID crosses; no replay", answered(t3) && t3.run?.harness === "claude" && claudeSegment?.reason === "harness-switch" && t3.threadId !== t1.threadId && seeded?.payload?.includedMessages >= 2
    && toolsOf(t3.run).every((name) => name === "get_context") && toolsOf(t3.run).length >= 1,
    `segment ${claudeSegment?.id} (${claudeSegment?.reason}); seeded ${seeded?.payload?.includedMessages} msgs; claude session ${t3?.threadId}; resolved ${t3?.run?.modelResolved}; tools ${toolsOf(t3?.run).join(",")}`, "continuity.json");
  const back = segments.find((segment) => segment.id === t4?.run?.segmentId);
  record("switch", "Claude -> Codex starts a fresh segment (harness-return), not the stale Codex thread", answered(t4) && back?.reason === "harness-return" && t4.threadId !== t1.threadId && t4.run?.harness === "codex" && toolsOf(t4.run).includes("get_context"),
    `segment ${back?.id} (${back?.reason}); thread ${t4?.threadId}`, "continuity.json");
  record("attribution", "every run records selected and reported model", (result.runs ?? []).length === 4 && result.runs.every((runRow) => runRow.harness && runRow.modelResolved && runRow.state === "completed"), (result.runs ?? []).map((runRow) => `${runRow.harness}:${runRow.modelSelected}->${runRow.modelResolved}`).join(" "), "continuity.json");
  record("transcript", "visible settings and session boundaries (v9 segments and requests)", (result.events ?? []).filter((event) => event.type === "settings.changed").length === 4
    && segments.length === 3 && segments.filter((segment) => !segment.endedAt).length === 1 && (result.runs ?? []).every((row) => row.originatingMessageId && row.assistantMessageId && row.segmentId) && (result.events ?? []).filter((event) => event.type === "segment.started").length === 2, "4 settings boundaries, 2 new-session boundaries", "continuity.json");

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

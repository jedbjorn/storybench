#!/usr/bin/env node
// Lifecycle foundation proof (spec #11 task #22 / spec #10 task #15 core). Repeatable.
//
//   node scripts/lifecycle-proof.mjs --evidence <dir> [--work <dir>] [--port 18852] [--model gpt-5.6-terra]
//        [--rehearse-live-copy]   (migration rehearsal on a read-only VACUUM INTO copy of the live DB)
//
// Disposable data only. The host entry point runs as transient user units. Real credential
// files are only read (per-request staging); no rotation. Codex only (Claude is #26).
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const arg = (name, fallback) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : fallback; };
const flag = (name) => argv.includes(`--${name}`);
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "").replace("T", "-");
const evidence = path.resolve(arg("evidence", path.join(repo, "lifecycle-evidence")));
const work = path.resolve(arg("work", path.join(os.tmpdir(), `storybench-lifecycle-${stamp}`)));
const port = Number(arg("port", "18852"));
const model = arg("model", "gpt-5.6-terra");
const home = os.homedir();
const credentials = { codex: path.join(home, ".codex/auth.json"), claude: path.join(home, ".claude/.credentials.json") };
const results = [];
const log = (...parts) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...parts);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const nonce = () => randomBytes(4).toString("hex").toUpperCase();

function run(command, args, { allowFail = false, timeout = 600_000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout, maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error && !allowFail) reject(Object.assign(new Error(`${command} ${args.slice(0, 3).join(" ")} failed: ${stderr || error.message}`), { stdout, stderr }));
      else resolve({ code: error ? (error.code ?? 1) : 0, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}
const save = (name, content) => writeFile(path.join(evidence, name), typeof content === "string" ? content : JSON.stringify(content, null, 2) + "\n");
const record = (area, check, pass, detail, file) => { results.push({ area, check, pass: Boolean(pass), detail, evidence: file }); log(pass ? "PASS" : "FAIL", area, check, "-", detail); };

// One installation (data root + state + runtime + port) driven through transient units.
function installation(name, dataRoot, stateRoot) {
  const installId = `life${stamp.replace("-", "")}${name}`;
  const runtimeRoot = path.join(process.env.XDG_RUNTIME_DIR || os.tmpdir(), `sb-life-${stamp}-${name}`);
  const configPath = path.join(work, `host-${name}.json`);
  let unitCount = 0, unit = null;
  const api = async (method, route, body) => {
    const response = await fetch(`http://127.0.0.1:${port}${route}`, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
    const text = await response.text();
    let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: response.status, json, text };
  };
  const self = {
    installId, runtimeRoot, api,
    get unit() { return unit; },
    async writeConfig(manifestPath) {
      await writeFile(configPath, JSON.stringify({ installId, dataRoot, stateRoot, runtimeRoot, port, manifestPath, credentials, codexModel: model, healthTimeoutMs: 90_000, appStopTimeoutS: 30 }, null, 2));
    },
    async start(label) {
      unit = `storybench-slice-test-${stamp}-${name}${++unitCount}`;
      await run("systemd-run", ["--user", `--unit=${unit}`, "--collect", "--property=KillMode=mixed", "--property=TimeoutStopSec=120",
        `--setenv=PATH=${process.env.PATH}`, `--setenv=HOME=${home}`, `--working-directory=${repo}`,
        process.execPath, path.join(repo, "src/runtime/host.js"), "--config", configPath]);
      const deadline = Date.now() + 150_000;
      let health = null;
      while (Date.now() < deadline) {
        const response = await api("GET", "/api/health").catch(() => null);
        if (response?.status === 200) { health = response.json; break; }
        const state = (await run("systemctl", ["--user", "show", unit, "-p", "ActiveState", "--value"], { allowFail: true })).stdout.trim();
        if (["failed", "inactive"].includes(state)) break;
        await sleep(1000);
      }
      const show = (await run("systemctl", ["--user", "show", unit, "-p", "Id,ActiveState,SubState,MainPID"], { allowFail: true })).stdout;
      await save(`${label}-unit.txt`, `${show}\nuser manager aggregate: ${(await run("systemctl", ["--user", "is-system-running"], { allowFail: true })).stdout.trim()}\n`);
      return { health, show, mainPid: Number(/MainPID=(\d+)/.exec(show)?.[1] ?? 0) };
    },
    journal: async () => (await run("journalctl", ["--user", "-u", unit, "--no-pager", "-o", "cat"], { allowFail: true })).stdout,
    containers: async (role) => (await run("docker", ["ps", "-a", "--filter", `label=io.storybench.install=${installId}`, ...(role ? ["--filter", `label=io.storybench.role=${role}`] : []), "--format", "{{.ID}} {{.Label \"io.storybench.role\"}} {{.Label \"io.storybench.request\"}} {{.Status}}"])).stdout.trim(),
    async stop() {
      await run("systemctl", ["--user", "stop", unit], { allowFail: true, timeout: 180_000 });
      return (await run("systemctl", ["--user", "show", unit, "-p", "ActiveState,SubState,LoadState"], { allowFail: true })).stdout;
    },
  };
  return self;
}

async function sleepPidsIn(installId) {
  const workers = (await run("docker", ["ps", "--filter", `label=io.storybench.install=${installId}`, "--filter", "label=io.storybench.role=worker", "--format", "{{.ID}}"], { allowFail: true })).stdout.trim().split("\n").filter(Boolean);
  const found = [];
  let top = "";
  for (const id of workers) {
    const out = (await run("docker", ["top", id, "-eo", "pid,ppid,args"], { allowFail: true })).stdout;
    top += `--- worker ${id}\n${out}`;
    for (const line of out.split("\n")) { const cols = line.trim().split(/\s+/); if (cols[2] === "sleep" && /^24[01]$/.test(cols[3] ?? "")) found.push(cols[0]); }
  }
  return { workers, pids: found, top };
}
const alive = async (pids) => pids.length ? (await run("ps", ["-o", "pid=", "-p", pids.join(",")], { allowFail: true })).stdout.trim() : "";

async function waitFor(check, { timeout = 300_000, interval = 1000 } = {}) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const value = await check(); if (value) return value; await sleep(interval); }
  return null;
}

async function conversation(inst, episodeId, name) {
  return (await inst.api("POST", `/api/episodes/${episodeId}/chats`, { name })).json;
}
const getChat = async (inst, episodeId, id) => (await inst.api("GET", `/api/episodes/${episodeId}/chats/${id}`)).json;
async function sendAndWait(inst, episodeId, id, text, { timeout = 480_000, onWorker } = {}) {
  const sent = await inst.api("POST", `/api/episodes/${episodeId}/chats/${id}/messages`, { text });
  if (sent.status !== 202) return { error: sent.text };
  let workersSeen = new Set();
  const done = await waitFor(async () => {
    for (const line of (await inst.containers("worker")).split("\n").filter(Boolean)) { const cid = line.split(" ")[0]; if (!workersSeen.has(cid)) { workersSeen.add(cid); onWorker?.(line); } }
    const chat = await getChat(inst, episodeId, id);
    return ["idle", "error", "interrupted"].includes(chat.state) ? chat : null;
  }, { timeout });
  return { chat: done, workers: [...workersSeen] };
}
const lastAssistant = (chat) => [...(chat?.messages ?? [])].reverse().find((message) => message.role === "assistant")?.text ?? "";
const trimChat = (chat) => chat && { state: chat.state, threadId: chat.threadId, error: chat.error, messages: chat.messages.map((m) => ({ role: m.role, state: m.state, text: m.text.slice(0, 1500) })),
  events: chat.events.filter((e) => !["assistant.delta"].includes(e.type)).map((e) => ({ type: e.type, payload: e.payload })) };

async function main() {
  await mkdir(evidence, { recursive: true });
  await rm(work, { recursive: true, force: true });
  await mkdir(work, { recursive: true });
  const credentialBefore = {};
  for (const [h, file] of Object.entries(credentials)) credentialBefore[h] = await import("node:fs/promises").then((fs) => fs.stat(file)).then((info) => ({ ino: info.ino, mtimeMs: info.mtimeMs }), () => null);

  // 1. Release: images and manifest from the one Dockerfile.
  log("building release");
  const manifestPath = path.join(work, "manifest.json");
  await run(process.execPath, [path.join(repo, "src/runtime/release.js"), "build", "--out", manifestPath, "--tag", "storybench-lifecycle"], { timeout: 1_200_000 });
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  await save("release-manifest.json", manifest);
  const driverInImage = (await run("docker", ["run", "--rm", "--network", "none", manifest.images.app.id, "ls", "src/runtime/"])).stdout;
  record("release", "manifest pins exact app/worker IDs, protocol, tools, schema range; proof driver excluded", /^sha256:/.test(manifest.images.app.id) && manifest.runtime.protocol === 1 && manifest.database.supportedSchema.max >= 7 && !driverInImage.includes("slice-proof-driver"), `app ${manifest.images.app.id.slice(0, 19)} worker ${manifest.images.worker.id.slice(0, 19)} schema ${manifest.database.supportedSchema.min}-${manifest.database.supportedSchema.max}`, "release-manifest.json");

  // 2. Disposable data root with two channels (seeded offline via the app image's services).
  const dataRoot = path.join(work, "data"), stateRoot = path.join(work, "state");
  await mkdir(dataRoot, { recursive: true }); await mkdir(stateRoot, { recursive: true });
  const seed = JSON.parse((await run("docker", ["run", "--rm", "--network", "none", "--user", "0:0", "--cap-drop", "ALL",
    "--mount", `type=bind,source=${dataRoot},target=/storybench/data`,
    "--mount", `type=bind,source=${path.join(repo, "src/runtime/slice-proof-driver.js")},target=/opt/storybench/app/src/runtime/slice-proof-driver.js,readonly`,
    manifest.images.app.id, "node", "src/runtime/slice-proof-driver.js", JSON.stringify({ phase: "seed" })])).stdout.trim().split("\n").pop());
  await save("seed.json", seed);
  const [epA, epB] = seed.episodes;
  const main = installation("m", dataRoot, stateRoot);
  await main.writeConfig(manifestPath);

  // 3. Start under a user unit; health.
  let started = await main.start("start-1");
  record("host", "host entry point runs as transient user unit and app is healthy", started.health?.ready === true && /ActiveState=active/.test(started.show), `${main.unit}: ${started.show.match(/SubState=\S+/)?.[0]}`, "start-1-unit.txt");
  const health = (await main.api("GET", "/api/health")).json;
  await save("health-idle.json", health);
  const healthText = JSON.stringify(health);
  record("health", "identity: release/manifest/images/schema/database; no paths or names", health.release.manifestId === manifest.id && health.release.images.worker === manifest.images.worker.id && health.release.commit === manifest.source.commit
    && health.schema.current === manifest.database.supportedSchema.max && health.database.id && !healthText.includes(dataRoot) && !healthText.includes("/storybench") && !healthText.includes("Slice A"), `manifest ${health.release.manifestId?.slice(0, 19)} schema ${health.schema.current} db ${health.database.id}`, "health-idle.json");

  // 4. Production turn in a worker, registering a file.
  const word = `HERON-${nonce()}`;
  const chatA = await conversation(main, epA.id, "Lifecycle A");
  const workerLines = [];
  const turn1 = await sendAndWait(main, epA.id, chatA.id, `Use a shell command with ffmpeg to create a 2-second 320x240 test video at work/lifecycle-1.mp4 (for example: ffmpeg -y -f lavfi -i testsrc=duration=2:size=320x240:rate=24 -pix_fmt yuv420p work/lifecycle-1.mp4), then register it with the Storybench tool register_work_file and reply with the returned assetId. Also remember this code word for later: ${word}.`, { onWorker: (line) => workerLines.push(line) });
  const library = (await main.api("GET", `/api/episodes/${epA.id}/library`)).json;
  const registered = (library ?? []).find((item) => item.provenance?.tool === "register_work_file");
  const afterTurn1 = await main.containers("worker");
  await save("turn1-production.json", { chat: trimChat(turn1.chat), workersSeenDuringTurn: workerLines, workersAfterTurn: afterTurn1, registered: registered && { id: registered.id, category: registered.category, asset: { id: registered.asset?.id, kind: registered.asset?.kind, channelId: registered.asset?.channelId }, provenance: registered.provenance } });
  record("turn", "real Codex turn via app API ran in a request-scoped worker and registered a file", turn1.chat?.state === "idle" && workerLines.length >= 1 && registered && lastAssistant(turn1.chat).includes(registered.asset?.id ?? "none") && !afterTurn1,
    `workers during turn ${workerLines.length}, after ${afterTurn1 || "none"}; asset ${registered?.asset?.id} in ${registered?.category}`, "turn1-production.json");

  // 5. Container replacement keeps the native session.
  const turn2Workers = [];
  const turn2 = await sendAndWait(main, epA.id, chatA.id, "What code word did I ask you to remember? Answer with the word only, without using tools.", { onWorker: (line) => turn2Workers.push(line) });
  await save("turn2-resume.json", { chat: trimChat(turn2.chat), workers: turn2Workers });
  record("session", "new worker container resumes the exact native thread", turn2.chat?.state === "idle" && turn2.chat.threadId === turn1.chat?.threadId && lastAssistant(turn2.chat).includes(word) && turn2Workers[0]?.split(" ")[0] !== workerLines[0]?.split(" ")[0] && !turn2.chat.events.some((e) => e.type === "segment.started"),
    `thread ${turn2.chat?.threadId}; worker ${workerLines[0]?.split(" ")[0]} -> ${turn2Workers[0]?.split(" ")[0]}`, "turn2-resume.json");
  const sessionListing = (await run("find", [path.join(stateRoot, "harnesses"), "-maxdepth", "6", "-printf", "%M %u %p\n"], { allowFail: true })).stdout.replaceAll(stateRoot, "<state>");
  await save("session-storage.txt", sessionListing.split("\n").filter((line) => !/auth\.json$/.test(line) || / -rw------- /.test(line)).join("\n"));

  // 6. Stop mid-command kills descendants; busy health while channel B is viewed.
  const sleepPrompt = "Run this exact shell command in the foreground with a 10-minute timeout and wait for it to finish before replying (it takes about 8 minutes; do not background it): sh -c 'sleep 240; sleep 241'";
  await main.api("POST", `/api/episodes/${epA.id}/chats/${chatA.id}/messages`, { text: sleepPrompt });
  const busy = await waitFor(async () => { const s = await sleepPidsIn(main.installId); return s.pids.length ? s : null; }, { timeout: 180_000 });
  const viewB = await main.api("GET", `/api/state?channel=${epB.channelId}`);
  const busyHealth = (await main.api("GET", `/api/health?channel=${epB.channelId}`)).json;
  await save("health-busy.json", { viewedChannelIsB: viewB.json?.channel?.id === epB.channelId, health: busyHealth });
  record("health", "busy counts aggregate across channels (agent turn in A while B viewed)", busy && viewB.json?.channel?.id === epB.channelId && busyHealth.activity.agents.active === 1, `agents.active ${busyHealth?.activity?.agents?.active}; renders ${JSON.stringify(busyHealth?.activity?.renders)}`, "health-busy.json");
  const stopAt = Date.now();
  const interrupt = await main.api("POST", `/api/episodes/${epA.id}/chats/${chatA.id}/interrupt`);
  const stoppedChat = await waitFor(async () => { const c = await getChat(main, epA.id, chatA.id); return c.state === "interrupted" ? c : null; }, { timeout: 60_000 });
  const goneAt = await waitFor(async () => (!(await alive(busy?.pids ?? [])) && !(await main.containers("worker"))) ? Date.now() : null, { timeout: 60_000 });
  await save("stop-mid-command.txt", `worker processes before Stop (docker top, host PIDs):\n${busy?.top}\nsleep PIDs: ${busy?.pids}\ninterrupt: HTTP ${interrupt.status}\nchat after: ${JSON.stringify(trimChat(stoppedChat), null, 2)}\nsleep PIDs alive after: ${await alive(busy?.pids ?? []) || "(none)"}\nworkers after: ${await main.containers("worker") || "(none)"}\nstop latency: ${goneAt ? goneAt - stopAt : "n/a"} ms\n`);
  record("stop", "Stop mid-command terminates descendants and the worker; turn interrupted", busy && stoppedChat && goneAt, `sleep PIDs ${busy?.pids}; gone after ${goneAt ? goneAt - stopAt : "?"} ms`, "stop-mid-command.txt");

  // 7. kill -9 the host mid-request; restart reconciles the orphan and marks it interrupted.
  const chatK = await conversation(main, epA.id, "Crash");
  await main.api("POST", `/api/episodes/${epA.id}/chats/${chatK.id}/messages`, { text: sleepPrompt });
  const crashBusy = await waitFor(async () => { const s = await sleepPidsIn(main.installId); return s.pids.length ? s : null; }, { timeout: 180_000 });
  const beforeKill = await main.containers();
  const killedUnit = main.unit;
  await run("kill", ["-9", String(started.mainPid)]);
  await sleep(2000);
  const afterKill = await main.containers();
  const killedState = (await run("systemctl", ["--user", "show", killedUnit, "-p", "ActiveState,SubState,Result"], { allowFail: true })).stdout;
  started = await main.start("start-2");
  const journal2 = await main.journal();
  const reconciledChat = await getChat(main, epA.id, chatK.id);
  await sleep(3000);
  await save("kill9-reconcile.txt", `containers before kill -9:\n${beforeKill}\nsleep PIDs: ${crashBusy?.pids}\nkilled unit ${killedUnit}: ${killedState}\ncontainers after kill (orphans):\n${afterKill}\n\nrestart ${main.unit} journal:\n${journal2}\nsleep PIDs alive after restart: ${await alive(crashBusy?.pids ?? []) || "(none)"}\nworkers now: ${await main.containers("worker") || "(none)"}\nconversation after restart: ${JSON.stringify(trimChat(reconciledChat), null, 2)}\n`);
  const orphanRequest = /"role":"worker","requestId":"(request_[^"]+)"/.exec(journal2)?.[1];
  record("reconcile", "kill -9 host mid-request: orphan worker+app removed on restart, request interrupted, no replay", started.health?.ready && orphanRequest && afterKill.includes("worker") && !(await alive(crashBusy?.pids ?? [])) && reconciledChat.state === "interrupted" && /not replayed/.test(reconciledChat.error ?? "") && !(await main.containers("worker")),
    `orphan ${orphanRequest}; conversation ${reconciledChat.state}`, "kill9-reconcile.txt");

  // 8. SIGTERM drains active work.
  const chatD = await conversation(main, epA.id, "Drain");
  await main.api("POST", `/api/episodes/${epA.id}/chats/${chatD.id}/messages`, { text: sleepPrompt });
  const drainBusy = await waitFor(async () => { const s = await sleepPidsIn(main.installId); return s.pids.length ? s : null; }, { timeout: 180_000 });
  const drainUnit = main.unit;
  const drainHealth = [];
  const poller = (async () => { for (let i = 0; i < 40; i++) { const r = await main.api("GET", "/api/health").catch(() => null); if (r) drainHealth.push({ status: r.status, state: r.json?.status }); else break; await sleep(250); } })();
  const stoppedState = await main.stop();
  await poller;
  const journal3 = (await run("journalctl", ["--user", "-u", drainUnit, "--no-pager", "-o", "cat"], { allowFail: true })).stdout;
  const drainLeft = await main.containers();
  await save("sigterm-drain.txt", `sleep PIDs: ${drainBusy?.pids}\nhealth during stop: ${JSON.stringify(drainHealth)}\nunit after stop: ${stoppedState}\njournal:\n${journal3}\ncontainers after: ${drainLeft || "(none)"}\nsleep alive after: ${await alive(drainBusy?.pids ?? []) || "(none)"}\ncontrol dir exists after: ${existsSync(path.join(main.runtimeRoot, "control"))}\n`);
  started = await main.start("start-3");
  const drainedChat = await getChat(main, epA.id, chatD.id);
  await save("sigterm-drain-conversation.json", trimChat(drainedChat));
  const order = ["host.stopping", "worker.stopped", "app.stopped", "host.stopped"].map((event) => journal3.indexOf(`"event":"${event}"`));
  record("drain", "SIGTERM: app drains (turn interrupted, worker stopped via control) before host confirms zero containers",
    drainBusy && /"containersRemaining":0/.test(journal3) && !drainLeft && !(await alive(drainBusy?.pids ?? [])) && order.every((index) => index >= 0) && order[1] < order[2] && drainedChat.state === "interrupted" && /shut down/.test(drainedChat.error ?? ""),
    `order stopping<worker.stopped<app.stopped<host.stopped: ${order.join("<")}; conversation ${drainedChat.state}`, "sigterm-drain.txt");
  await main.stop();
  record("host", "stop removes all owned containers, networks and control dir", !(await main.containers()) && !existsSync(path.join(main.runtimeRoot, "control")) && !(await run("docker", ["network", "ls", "--filter", `label=io.storybench.install=${main.installId}`, "-q"])).stdout.trim(), "none left", "sigterm-drain.txt");

  // 9. Migration rehearsal on a disposable copy of the live database (read-only source).
  if (flag("rehearse-live-copy")) await rehearse(manifestPath, manifest);

  const credentialAfter = {};
  for (const [h, file] of Object.entries(credentials)) credentialAfter[h] = await import("node:fs/promises").then((fs) => fs.stat(file)).then((info) => ({ ino: info.ino, mtimeMs: info.mtimeMs }), () => null);
  await save("credential-files-untouched.json", { before: credentialBefore, after: credentialAfter });
  record("credentials", "real credential files unchanged (inode/mtime)", JSON.stringify(credentialBefore) === JSON.stringify(credentialAfter), "read-only staging only", "credential-files-untouched.json");
  await save("summary.json", { stamp, model, manifestId: manifest.id, images: manifest.images, results });
  const table = ["| area | check | result | detail | evidence |", "|---|---|---|---|---|", ...results.map((row) => `| ${row.area} | ${row.check} | ${row.pass ? "PASS" : "FAIL"} | ${String(row.detail).replace(/\|/g, "/").slice(0, 260)} | ${row.evidence ?? ""} |`)].join("\n");
  await save("summary.md", `# Lifecycle proof ${stamp}\n\nModel: codex ${model}\nManifest: ${manifest.id}\n\n${table}\n`);
  log(`done: ${results.filter((row) => row.pass).length}/${results.length} passed`);
  if (!flag("keep-work")) await rm(work, { recursive: true, force: true });
  process.exitCode = results.every((row) => row.pass) ? 0 : 1;
}

async function rehearse(manifestPath, manifest) {
  const live = path.join(home, ".local/share/storybench/prototype/storybench.sqlite");
  const dataRoot = path.join(work, "rehearsal-data"), stateRoot = path.join(work, "rehearsal-state");
  await mkdir(dataRoot, { recursive: true }); await mkdir(stateRoot, { recursive: true });
  // Consistent read-only snapshot of the live metadata; the live data root is never written.
  const { DatabaseSync } = await import("node:sqlite");
  const source = new DatabaseSync(live, { readOnly: true });
  try { source.exec(`VACUUM INTO '${path.join(dataRoot, "storybench.sqlite").replaceAll("'", "''")}'`); } finally { source.close(); }
  const inApp = (script) => run("docker", ["run", "--rm", "--network", "none", "--user", "0:0", "--cap-drop", "ALL", "--mount", `type=bind,source=${dataRoot},target=/storybench/data`, manifest.images.app.id, "node", "--input-type=module", "-e", script]);
  const adopt = JSON.parse((await inApp(`import { adoptWorkspace } from "/opt/storybench/app/src/services/data-root.js"; const r = adoptWorkspace("/storybench/data"); console.log(JSON.stringify({ adopted: r.adopted, previousSchemaVersion: r.previousSchemaVersion, channels: r.channels.length }));`)).stdout.trim().split("\n").pop());
  const threads = JSON.parse((await run("docker", ["run", "--rm", "--network", "none", "--user", "0:0", "--cap-drop", "ALL", "--mount", `type=bind,source=${dataRoot},target=/storybench/data`, manifest.images.app.id, "node", "src/runtime/session-migrate.js", "list", "--data-root", "/storybench/data"])).stdout);
  await writeFile(path.join(work, "threads.json"), JSON.stringify(threads));
  const transfer = JSON.parse((await run(process.execPath, [path.join(repo, "src/runtime/session-migrate.js"), "transfer", "--state-root", stateRoot, "--threads", path.join(work, "threads.json")])).stdout);
  await save("rehearsal-transfer.json", { adopt, threads, transfer });
  const inst = installation("r", dataRoot, stateRoot);
  await inst.writeConfig(manifestPath);
  const startedR = await inst.start("rehearsal-start");
  const target = transfer.transferred[transfer.transferred.length - 1];
  const episodeId = await (async () => {
    // Find the transferred conversation's episode through the API.
    const state = (await inst.api("GET", "/api/state")).json;
    for (const channel of state.channels) for (const episode of (await inst.api("GET", `/api/channels/${channel.id}/episodes`)).json) {
      const chats = (await inst.api("GET", `/api/episodes/${episode.id}/chats`)).json ?? [];
      if (chats.some((chat) => chat.id === target?.conversationId)) return episode.id;
    }
    return null;
  })();
  const before = episodeId ? await getChat(inst, episodeId, target.conversationId) : null;
  const turn = episodeId ? await sendAndWait(inst, episodeId, target.conversationId, "Without using any tools: in one short sentence, what did I first ask you in this conversation?") : { chat: null };
  const segment = turn.chat?.events.find((event) => event.type === "segment.started");
  await save("rehearsal-resume.json", { startedHealthy: startedR.health?.ready, conversationId: target?.conversationId, threadBefore: before?.threadId, threadAfter: turn.chat?.threadId, state: turn.chat?.state, segmentStarted: segment ?? null, messagesBefore: before?.messages.length, messagesAfter: turn.chat?.messages.length, answer: lastAssistant(turn.chat).slice(0, 300) });
  record("migration", "rehearsal: adopted live copy, transferred only referenced rollouts, native thread resumed in worker at new path", adopt.adopted && transfer.transferred.length >= 1 && transfer.missing.length === 0 && turn.chat?.state === "idle" && turn.chat.threadId === target.threadId && !segment && turn.chat.messages.length === before.messages.length + 2,
    `transferred ${transfer.transferred.length}, missing ${transfer.missing.length}; thread ${turn.chat?.threadId}; segment transition ${segment ? "yes" : "no"}`, "rehearsal-resume.json");
  await inst.stop();
  record("migration", "rehearsal installation stopped cleanly", !(await inst.containers()), "none left", "rehearsal-resume.json");
}

await main();

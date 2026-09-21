#!/usr/bin/env node
// Runtime capability-slice proof (spec #11 task #20). Repeatable by the Reviewer.
//
//   node scripts/runtime-slice-proof.mjs --evidence <dir> [--work <dir>] [--port 18841]
//        [--harness codex,claude] [--skip-build] [--codex-model gpt-5.6-terra] [--claude-model sonnet]
//
// Uses only disposable data (a fresh data/state root under --work and a runtime root
// under $XDG_RUNTIME_DIR). Reads the host's Codex/Claude logins read-only through the
// lifecycle entry point's per-request credential staging; never writes token contents
// to evidence. Runs the host lifecycle entry point as a transient user unit
// (systemd-run --user --unit=storybench-slice-test-<stamp>) and removes it afterwards.
import { execFile, spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const arg = (name, fallback) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : fallback; };
const flag = (name) => argv.includes(`--${name}`);
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "").replace("T", "-");
const evidence = path.resolve(arg("evidence", path.join(repo, "runtime-slice-evidence")));
const work = path.resolve(arg("work", path.join(os.tmpdir(), `storybench-slice-${stamp}`)));
const port = Number(arg("port", "18841"));
const harnesses = arg("harness", "codex,claude").split(",").filter(Boolean);
const models = { codex: arg("codex-model", "gpt-5.6-terra"), claude: arg("claude-model", "sonnet") };
const installId = `slice${stamp.replace("-", "")}`;
const unit = `storybench-slice-test-${stamp}`;
const runtimeRoot = path.join(process.env.XDG_RUNTIME_DIR || os.tmpdir(), `sb-slice-${stamp}`);
const dataRoot = path.join(work, "data");
const stateRoot = path.join(work, "state");
const home = os.homedir();
const credentials = { codex: path.join(home, ".codex/auth.json"), claude: path.join(home, ".claude/.credentials.json") };
const ep1 = "channels/ch-a/episodes/ep-1";
const ep2 = "channels/ch-b/episodes/ep-2";
const results = [];
const log = (...parts) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...parts);

function run(command, args, { allowFail = false, timeout = 600_000, input } = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile(command, args, { timeout, maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error && !allowFail) reject(Object.assign(new Error(`${command} ${args.slice(0, 3).join(" ")} failed: ${stderr || error.message}`), { stdout, stderr }));
      else resolve({ code: error ? (error.code ?? 1) : 0, stdout: stdout.toString(), stderr: stderr.toString() });
    });
    if (input !== undefined) child.stdin.end(input);
  });
}
const sh = (script, opts) => run("bash", ["-c", script], opts);
const sha = async (file) => createHash("sha256").update(await readFile(file)).digest("hex");
const save = (name, content) => writeFile(path.join(evidence, name), typeof content === "string" ? content : JSON.stringify(content, null, 2) + "\n");
const record = (harness, check, pass, detail, evidenceFile) => { results.push({ harness, check, pass, detail, evidence: evidenceFile }); log(pass ? "PASS" : "FAIL", harness, check, "-", detail); };
const nonce = () => randomBytes(4).toString("hex").toUpperCase();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function buildImages() {
  const ids = {};
  for (const target of ["app", "worker"]) {
    const tag = `storybench-slice-${target}:task20`;
    if (!flag("skip-build")) {
      log("building", target);
      const out = await run("docker", ["build", "-f", "docker/Dockerfile", "--target", target, "-t", tag, "."].map((part) => part === "." ? repo : part === "docker/Dockerfile" ? path.join(repo, "docker/Dockerfile") : part));
      await save(`build-${target}.log`, out.stdout + out.stderr);
    }
    ids[target] = (await run("docker", ["image", "inspect", tag, "--format", "{{.Id}}"])).stdout.trim();
  }
  const versions = (await run("docker", ["run", "--rm", "--network", "none", ids.worker, "sh", "-c", "node --version; codex --version; claude --version; ffmpeg -version | head -1; ffprobe -version | head -1; pdftotext -v 2>&1 | head -1; python3 -c 'import PIL; print(\"Pillow\", PIL.__version__)'; resvg --version"])).stdout;
  await save("images.json", { ...ids, tags: { app: "storybench-slice-app:task20", worker: "storybench-slice-worker:task20" }, workerToolVersions: versions.trim().split("\n") });
  return ids;
}

async function prepareData() {
  await rm(work, { recursive: true, force: true });
  for (const dir of [`${ep1}/reference`, `${ep1}/outputs`, `${ep1}/work`, `${ep2}/work`, "media", stateRoot])
    await mkdir(path.isAbsolute(dir) ? dir : path.join(dataRoot, dir), { recursive: true });
  const codeWord = `OTTER-${nonce()}`;
  await writeFile(path.join(dataRoot, ep1, "story.md"), "# Overview\n\nA disposable slice-test episode.\n");
  await writeFile(path.join(dataRoot, ep2, "notes.txt"), `Channel B notes. The code word is ${codeWord}.\n`);
  await writeFile(path.join(dataRoot, "media", "legacy-original.txt"), "legacy managed original stand-in\n");
  const ref = path.join(dataRoot, ep1, "reference");
  // Still: an orange five-pointed star on a teal background.
  // Clip: 0-2s purple + white square, 2-4s yellow + black circle, 4-6s red + white triangle.
  await run("python3", ["-c", `
from PIL import Image, ImageDraw
import math
im = Image.new('RGB', (640, 480), (0, 128, 128)); d = ImageDraw.Draw(im)
pts = []
for i in range(10):
    r = 200 if i % 2 == 0 else 80; a = -math.pi/2 + i*math.pi/5
    pts.append((320 + r*math.cos(a), 240 + r*math.sin(a)))
d.polygon(pts, fill=(255, 140, 0)); im.save('${ref}/fixture-a.png')
for name, bg, shape in [('s1', (128, 0, 160), 'square'), ('s2', (255, 230, 0), 'circle'), ('s3', (220, 0, 0), 'triangle')]:
    im = Image.new('RGB', (640, 480), bg); d = ImageDraw.Draw(im)
    if shape == 'square': d.rectangle((220, 140, 420, 340), fill=(255, 255, 255))
    if shape == 'circle': d.ellipse((220, 140, 420, 340), fill=(0, 0, 0))
    if shape == 'triangle': d.polygon([(320, 120), (440, 360), (200, 360)], fill=(255, 255, 255))
    im.save('${work}/' + name + '.png')
`]);
  await run("ffmpeg", ["-v", "error", "-y", ...["s1", "s2", "s3"].flatMap((name) => ["-loop", "1", "-t", "2", "-framerate", "24", "-i", path.join(work, `${name}.png`)]),
    "-filter_complex", "[0][1][2]concat=n=3:v=1:a=0,format=yuv420p[v]", "-map", "[v]", "-r", "24", path.join(ref, "clip-b.mp4")]);
  await run("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=gray:s=320x240:d=1", "-pix_fmt", "yuv420p", path.join(dataRoot, ep1, "outputs", "draft-001.mp4")]);
  return { codeWord };
}

async function protectedHashes() {
  const files = [`${ep1}/story.md`, `${ep1}/reference/fixture-a.png`, `${ep1}/reference/clip-b.mp4`, `${ep1}/outputs/draft-001.mp4`, `${ep2}/notes.txt`, "media/legacy-original.txt", "storybench.sqlite"];
  const out = {};
  for (const file of files) out[file] = existsSync(path.join(dataRoot, file)) ? await sha(path.join(dataRoot, file)) : null;
  return out;
}

async function startHost(images) {
  const config = { installId, dataRoot, stateRoot, runtimeRoot, port, images, credentials, healthTimeoutMs: 60_000 };
  const configPath = path.join(work, "host-config.json");
  await writeFile(configPath, JSON.stringify(config, null, 2));
  await save("host-config.json", { ...config, credentials: { codex: "~/.codex/auth.json (read-only source)", claude: "~/.claude/.credentials.json (read-only source)" } });
  const envPath = `PATH=${process.env.PATH}`;
  await run("systemd-run", ["--user", `--unit=${unit}`, "--collect", "--property=KillMode=mixed", "--property=TimeoutStopSec=60",
    `--setenv=${envPath}`, `--setenv=HOME=${home}`, ...(process.env.DOCKER_HOST ? [`--setenv=DOCKER_HOST=${process.env.DOCKER_HOST}`] : []),
    `--working-directory=${repo}`, process.execPath, path.join(repo, "src/runtime/host.js"), "--config", configPath]);
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const res = await fetch(`http://127.0.0.1:${port}/`).catch(() => null);
    if (res?.ok) break;
    const state = (await run("systemctl", ["--user", "show", unit, "-p", "ActiveState", "--value"], { allowFail: true })).stdout.trim();
    if (state === "failed" || state === "inactive") break;
    await sleep(1000);
  }
  const show = (await run("systemctl", ["--user", "show", unit, "-p", "Id,ActiveState,SubState,MainPID,ExecMainStartTimestamp,ControlGroup"], { allowFail: true })).stdout;
  const aggregate = (await run("systemctl", ["--user", "is-system-running"], { allowFail: true })).stdout.trim();
  const journal = (await run("journalctl", ["--user", "-u", unit, "--no-pager", "-o", "cat"], { allowFail: true })).stdout;
  await save("unit-started.txt", `${show}\nuser manager aggregate (is-system-running): ${aggregate}\n\n--- journal ---\n${journal}`);
  const active = /ActiveState=active/.test(show) && /SubState=running/.test(show);
  record("host", "lifecycle entry point runs as transient user unit", active, `${unit}: ${show.match(/ActiveState=\S+/)?.[0]} ${show.match(/SubState=\S+/)?.[0]} (aggregate ${aggregate})`, "unit-started.txt");
  if (!active) throw new Error("host unit did not start");
  return configPath;
}

const appName = () => `storybench-${installId}-app`;
async function driver(spec, { timeout = 900_000 } = {}) {
  const out = await run("docker", ["exec", appName(), "node", "src/runtime/slice-proof-driver.js", JSON.stringify(spec)], { allowFail: true, timeout });
  try { return JSON.parse(out.stdout.trim().split("\n").pop()); }
  catch { return { fatal: `driver output unparseable: ${out.stdout.slice(-2000)} ${out.stderr.slice(-2000)}` }; }
}
const control = (body) => driver({ phase: "control", body });

async function publicationChecks() {
  const ss = (await run("ss", ["-ltnp"], { allowFail: true })).stdout.split("\n").filter((line) => line.includes(`:${port} `) || line.startsWith("State"));
  const dockerPort = (await run("docker", ["port", appName()], { allowFail: true })).stdout.trim();
  const inAppListen = (await run("docker", ["exec", appName(), "node", "-e", `
const fs=require('fs');const rows=fs.readFileSync('/proc/net/tcp','utf8').trim().split('\\n').slice(1).map(l=>l.trim().split(/\\s+/)).filter(c=>c[3]==='0A');
console.log(rows.map(c=>{const [ip,p]=c[1].split(':');return ip.match(/../g).reverse().map(h=>parseInt(h,16)).join('.')+':'+parseInt(p,16)}).join('\\n'))`], { allowFail: true })).stdout.trim();
  const lanIp = (await sh("ip -4 route get 1.1.1.1 | sed -n 's/.* src \\([0-9.]*\\).*/\\1/p'", { allowFail: true })).stdout.trim();
  const loopback = await fetch(`http://127.0.0.1:${port}/`).then((res) => res.status, (error) => error.message);
  const lan = lanIp ? await fetch(`http://${lanIp}:${port}/`, { signal: AbortSignal.timeout(3000) }).then((res) => `HTTP ${res.status}`, (error) => `refused/failed: ${error.cause?.code || error.message}`) : "no LAN address";
  await save("publication.txt", `ss -ltnp (port ${port}):\n${ss.join("\n")}\n\ndocker port ${appName()}:\n${dockerPort}\n\nlisteners inside app container (/proc/net/tcp):\n${inAppListen}\n\nGET http://127.0.0.1:${port}/ -> ${loopback}\nGET http://${lanIp}:${port}/ -> ${lan}\n`);
  const hostOk = ss.filter((line) => line.includes(`:${port} `)).every((line) => line.includes(`127.0.0.1:${port}`)) && ss.some((line) => line.includes(`127.0.0.1:${port}`));
  const pass = hostOk && dockerPort.includes(`127.0.0.1:${port}`) && !dockerPort.includes("0.0.0.0:") && inAppListen.includes(`0.0.0.0:${port}`) && loopback === 200 && !lan.startsWith("HTTP");
  record("host", "loopback-only publication (ss + docker port + container bind)", pass, `host ${hostOk ? "127.0.0.1 only" : "NOT loopback-only"}; docker port "${dockerPort}"; app binds 0.0.0.0:${port} in its netns; LAN ${lan}`, "publication.txt");
}

async function controlChecks() {
  const base = { op: "worker.start", requestId: "probe-reject", harness: "codex", segmentId: "seg-x", episodeDir: ep1 };
  const cases = {
    arbitraryImage: { ...base, image: "alpine:latest" },
    extraMount: { ...base, mounts: [{ source: "/", target: "/host" }] },
    dockerFlags: { ...base, flags: ["--privileged"] },
    pathEscape: { ...base, episodeDir: "channels/ch-a/episodes/../../../.." },
    absoluteEpisode: { ...base, episodeDir: "/etc" },
    unknownOp: { op: "docker.run", image: "alpine" },
    badHarness: { ...base, harness: "bash" },
    missingEpisode: { ...base, episodeDir: "channels/ch-a/episodes/nope" },
  };
  const replies = {};
  for (const [name, body] of Object.entries(cases)) replies[name] = (await control(body)).reply;
  const availability = (await control({ op: "harness.availability" })).reply;
  await save("control-validation.json", { rejected: replies, availability });
  const allRejected = Object.values(replies).every((reply) => reply && reply.ok === false);
  record("host", "control channel rejects images/flags/mounts/escapes", allRejected, Object.entries(replies).map(([name, reply]) => `${name}:${reply?.code}`).join(" "), "control-validation.json");
  for (const harness of harnesses) record(harness, "harnessAvailability() from live credential", availability?.ok && availability.value?.[harness]?.available === true, JSON.stringify(availability?.value?.[harness] ?? availability), "control-validation.json");
}

// Deterministic boundary probe: a real worker started through the app's control route,
// inspected with docker exec (test harness only), then stopped through control.
async function boundaryProbe() {
  const started = await control({ op: "worker.start", requestId: "probe-boundary", harness: "codex", segmentId: "seg-probe", episodeDir: ep1 });
  if (!started.reply?.ok) { record("host", "worker boundary probe", false, JSON.stringify(started), null); return; }
  const id = started.reply.value.containerId;
  const appIp = (await run("docker", ["inspect", appName(), "--format", "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}"])).stdout.trim();
  const script = `
set +e
echo "== id"; id
echo "== /storybench/data"; ls -la /storybench/data
echo "== DB visible?"; ls -la /storybench/data/storybench.sqlite 2>&1
echo "== write DB path"; touch /storybench/data/storybench.sqlite 2>&1; echo "exit=$?"
echo "== write story.md"; sh -c 'echo x >> ${"/storybench/data/" + ep1}/story.md' 2>&1; echo "exit=$?"
echo "== write reference"; sh -c 'echo x >> ${"/storybench/data/" + ep1}/reference/fixture-a.png' 2>&1; echo "exit=$?"
echo "== write managed output"; sh -c 'echo x >> ${"/storybench/data/" + ep1}/outputs/draft-001.mp4' 2>&1; echo "exit=$?"
echo "== write legacy media"; touch /storybench/data/media/probe.txt 2>&1; echo "exit=$?"
echo "== write other channel"; touch ${"/storybench/data/" + ep2}/work/probe.txt 2>&1; echo "exit=$?"
echo "== write boot render"; sh -c 'echo x >> ${"/storybench/data/" + ep1}/AGENTS.md' 2>&1; echo "exit=$?"
echo "== write rootfs"; touch /usr/probe 2>&1; echo "exit=$?"
echo "== write work"; echo ok > ${"/storybench/data/" + ep1}/work/probe-boundary.txt; echo "exit=$?"
echo "== read other channel"; cat ${"/storybench/data/" + ep2}/notes.txt; echo "exit=$?"
echo "== docker socket"; ls -la /var/run/docker.sock /run/docker.sock 2>&1
echo "== session dir"; ls -la /storybench/session /storybench/session/codex 2>&1
echo "== home creds?"; ls -la /storybench/home 2>&1
echo "== capabilities"; grep -E 'Cap(Eff|Prm|Bnd)|NoNewPrivs' /proc/self/status
echo "== reach app ${appIp}:${port}"; node -e "fetch('http://${appIp}:${port}/',{signal:AbortSignal.timeout(4000)}).then(r=>console.log('HTTP',r.status),e=>console.log('unreachable:',e.cause?.code||e.message))"
echo "== reach host loopback"; node -e "fetch('http://127.0.0.1:${port}/',{signal:AbortSignal.timeout(4000)}).then(r=>console.log('HTTP',r.status),e=>console.log('unreachable:',e.cause?.code||e.message))"
echo "== reach app by name"; node -e "fetch('http://${appName()}:${port}/',{signal:AbortSignal.timeout(4000)}).then(r=>console.log('HTTP',r.status),e=>console.log('unreachable:',e.cause?.code||e.message))"
echo "== mounts"; grep -E ' /storybench| /run/storybench' /proc/self/mountinfo | awk '{print $5, $6}'
`;
  const probe = await run("docker", ["exec", id, "bash", "-c", script], { allowFail: true });
  const inspect = JSON.parse((await run("docker", ["inspect", id])).stdout)[0];
  const hostConfig = { Privileged: inspect.HostConfig.Privileged, ReadonlyRootfs: inspect.HostConfig.ReadonlyRootfs, CapDrop: inspect.HostConfig.CapDrop, SecurityOpt: inspect.HostConfig.SecurityOpt, User: inspect.Config.User, NetworkMode: inspect.HostConfig.NetworkMode, Mounts: inspect.Mounts.map((m) => ({ Source: m.Source.replace(home, "~"), Destination: m.Destination, RW: m.RW })) };
  const hostOwner = await stat(path.join(dataRoot, ep1, "work", "probe-boundary.txt")).then((info) => info.uid, () => null);
  const stop = await control({ op: "worker.stop", requestId: "probe-boundary" });
  const leftover = (await run("docker", ["ps", "-a", "--filter", `id=${id}`, "--format", "{{.ID}}"])).stdout.trim();
  await save("boundary-probe.txt", `${probe.stdout}${probe.stderr}\n== docker inspect (worker)\n${JSON.stringify(hostConfig, null, 2)}\n== host owner of work/probe-boundary.txt: uid ${hostOwner} (host id -u ${process.getuid()})\n== stop: ${JSON.stringify(stop.reply)}\n== container after stop: ${leftover || "(gone)"}\n`);
  const text = probe.stdout;
  const section = (name) => (text.split(`== ${name}`)[1] ?? "").split("\n==")[0];
  const denied = (name) => /Read-only file system|Permission denied|No such file/.test(section(name)) && /exit=[1-9]/.test(section(name));
  const checks = {
    dbNotVisible: /No such file/.test(section("DB visible?")) && !/storybench\.sqlite/.test(section("/storybench/data")),
    writesRejected: ["write DB path", "write story.md", "write reference", "write managed output", "write legacy media", "write other channel", "write boot render", "write rootfs"].every(denied),
    workWritable: /exit=0/.test(section("write work")),
    otherChannelReadable: /code word/.test(section("read other channel")),
    noDockerSocket: !/srw/.test(section("docker socket")),
    unprivileged: hostConfig.Privileged === false && hostConfig.CapDrop?.includes("ALL") && /CapEff:\s*0+\b/.test(section("capabilities")),
    appUnreachable: ["reach app", "reach host loopback", "reach app by name"].every((name) => /unreachable/.test(section(name))),
    hostOwnership: hostOwner === process.getuid(),
    stoppedAndGone: stop.reply?.ok && !leftover,
  };
  for (const [check, pass] of Object.entries(checks)) record("worker", `boundary: ${check}`, pass, pass ? "ok" : "see evidence", "boundary-probe.txt");
}

function prompts(harness, phrases) {
  return {
    fresh: [
      "This is a short Storybench runtime check. Do each step, then answer with a short numbered list.",
      "1. From your boot instructions file in the episode directory (AGENTS.md / CLAUDE.md), report the Runtime verification phrase.",
      "2. Use the Storybench skill named storybench-runtime-check and report its Skill verification phrase.",
      "3. Call the Storybench tool inspect_image with path \"reference/fixture-a.png\" and describe the main shape, its color and the background color. Do not use shell commands, scripts or any other tool to analyze the image or the clip; rely only on what inspect_image shows you.",
      "4. Call inspect_image with path \"reference/clip-b.mp4\" and atSeconds 3. Describe that frame's background color and the shape.",
      `5. Run a shell command using ffmpeg to cut seconds 4 to 6 of reference/clip-b.mp4 into a 320x240 MP4 at work/${harness}-derivative.mp4 (for example: ffmpeg -y -ss 4 -t 2 -i reference/clip-b.mp4 -vf scale=320:240 -an work/${harness}-derivative.mp4). Then register it with the Storybench tool register_work_file (path work/${harness}-derivative.mp4) and report the returned assetId.`,
      "6. Read ../../../ch-b/episodes/ep-2/notes.txt (another channel's episode) and report the code word.",
      "7. With shell commands, try each of these writes and report the error for each: append a line to story.md; create /storybench/data/storybench.sqlite; append to outputs/draft-001.mp4; create /storybench/data/media/probe.txt.",
      "8. Report the output of `id -u` and of `ls -ln work/`.",
    ].join("\n"),
    resume: "Answer from this conversation's history only, without using any tools: which Runtime verification phrase did you report earlier, and what shape and color did you see in fixture-a.png? One line.",
    cancel: "Run this exact shell command in the foreground with a 10-minute timeout and wait for it to finish before replying (it takes about 8 minutes; do not background it): sh -c 'sleep 240; sleep 241'",
    phrases,
  };
}

const bootContext = (harness, phrases) => ({
  channel: { id: "ch-a" }, episode: { id: "ep-1" },
  paths: { episode: `/storybench/data/${ep1}`, work: `/storybench/data/${ep1}/work`, projects: "`/storybench/data/channels` (all channels/episodes), `/storybench/data/media` (legacy originals)" },
  runtime: { harness, model: models[harness], bootPhrase: phrases.boot, skillPhrase: phrases.skill },
});

async function harnessRun(harness, fixtures) {
  const phrases = { boot: `BOOT-${nonce()}`, skill: `SKILL-${nonce()}` };
  const p = prompts(harness, phrases);
  const segmentId = `seg-${harness}-1`;
  const common = { harness, model: models[harness], conversationId: `conv-${harness}`, segmentId, episodeDir: ep1, bootContext: bootContext(harness, phrases) };
  const hostUid = process.getuid();

  // Phase A: fresh session.
  log(harness, "phase A (fresh)");
  const a = await driver({ ...common, phase: "fresh", requestId: `${harness}-a`, prompt: p.fresh, timeoutMs: 480_000 });
  await save(`${harness}-A-fresh.json`, a);
  const containerA = a.worker?.containerId;
  const text = (a.finalText ?? "").toLowerCase();
  const tools = a.toolCalls ?? [];
  const inspects = tools.filter((call) => call.tool === "inspect_image" && call.output?.images?.length);
  // Shell commands the agent ran (Codex commandExecution items, Claude Bash tool_use inputs).
  const commands = (a.events ?? []).flatMap((event) => event.type === "commandExecution" ? [event.command ?? ""]
    : event.type === "assistant" ? (event.blocks ?? []).filter((block) => block.tool_use === "Bash").map((block) => block.input) : []).join("\n");
  const analyzedByCommand = /fixture-a|PIL|Image\.open|ffprobe|identify /.test(commands);
  const workFile = path.join(dataRoot, ep1, "work", `${harness}-derivative.mp4`);
  const workInfo = await stat(workFile).catch(() => null);
  const lsWork = (await run("ls", ["-ln", path.join(dataRoot, ep1, "work")])).stdout;
  const registered = (a.registeredAssets ?? []).find((asset) => asset.registered);
  const asset = registered ? (await driver({ phase: "asset", assetId: registered.assetId })).asset : null;
  await save(`${harness}-A-checks.txt`, `host id -u: ${hostUid}\nls -ln work/:\n${lsWork}\nregistered asset:\n${JSON.stringify(asset, null, 2)}\nnative skills (codex skills/list or claude init):\n${JSON.stringify(a.nativeSkills ?? a.events?.find((event) => event.type === "init")?.skills ?? null, null, 2)}\n`);
  record(harness, "authentication inside worker", Boolean(a.sessionId) && !a.turnError && !a.isError && (a.turn?.status ?? "completed") === "completed", `session ${a.sessionId ?? "none"}${a.turnError ? ` error ${a.turnError}` : ""}`, `${harness}-A-fresh.json`);
  record(harness, "boot discovery (AGENTS.md/CLAUDE.md phrase)", text.includes(phrases.boot.toLowerCase()), `expected ${phrases.boot}`, `${harness}-A-fresh.json`);
  const nativeSkill = harness === "codex" ? (a.nativeSkills ?? []).some((skill) => skill.name === "storybench-runtime-check") : (a.events?.find((event) => event.type === "init")?.skills ?? a.events?.find((event) => event.type === "init")?.slash_commands ?? []).some((name) => String(name).includes("storybench-runtime-check"));
  record(harness, "skill discovery (native list + phrase)", nativeSkill && text.includes(phrases.skill.toLowerCase()), `native listing ${nativeSkill ? "includes" : "MISSING"} storybench-runtime-check; expected ${phrases.skill}`, `${harness}-A-fresh.json`);
  record(harness, "image receipt: still (orange star on teal)", inspects.some((call) => /fixture-a/.test(call.args?.path)) && /star/.test(text) && /orange/.test(text) && /teal|turquoise|cyan|blue-green/.test(text) && !analyzedByCommand, `inspect_image returned ${inspects.length} image(s); analyzed by command: ${analyzedByCommand}`, `${harness}-A-fresh.json`);
  record(harness, "image receipt: clip frame at 3s (yellow + black circle)", inspects.some((call) => /clip-b/.test(call.args?.path) && call.args?.atSeconds === 3) && /yellow/.test(text) && /circle/.test(text), "frame 2-4s scene is yellow with a black circle", `${harness}-A-fresh.json`);
  record(harness, "command-created media in work/", Boolean(workInfo?.size), workInfo ? `${workInfo.size} bytes` : "missing", `${harness}-A-checks.txt`);
  record(harness, "result registration through scoped bridge", Boolean(asset && asset.metadata?.provenance?.requestId === `${harness}-a` && text.includes(String(registered?.assetId).toLowerCase())), asset ? `asset ${asset.id} kind ${asset.kind} provenance ${JSON.stringify(asset.metadata.provenance)}` : "no registered asset", `${harness}-A-checks.txt`);
  record(harness, "host ownership of created files", Boolean(workInfo) && workInfo.uid === hostUid, `uid ${workInfo?.uid} vs id -u ${hostUid}`, `${harness}-A-checks.txt`);
  record(harness, "read another channel's episode", text.includes(fixtures.codeWord.toLowerCase()), `expected ${fixtures.codeWord}`, `${harness}-A-fresh.json`);
  record(harness, "agent-attempted protected writes rejected", /read-only|permission denied|read only/.test(text), "agent reported errors; hashes verified separately", `${harness}-A-fresh.json`);

  // Phase B: destroy/replace the worker, resume by exact native session ID.
  log(harness, "phase B (resume after replacement)");
  const goneA = !(await run("docker", ["ps", "-a", "--filter", `id=${containerA}`, "--format", "{{.ID}}"])).stdout.trim();
  const b = await driver({ ...common, phase: "resume", requestId: `${harness}-b`, resume: a.sessionId, prompt: p.resume, timeoutMs: 240_000 });
  await save(`${harness}-B-resume.json`, b);
  const btext = (b.finalText ?? "").toLowerCase();
  record(harness, "exact resume after worker replaced", goneA && b.worker?.containerId !== containerA && b.sessionId === a.sessionId && btext.includes(phrases.boot.toLowerCase()) && /star/.test(btext), `A ${containerA?.slice(0, 12)} removed=${goneA}; B ${b.worker?.containerId?.slice(0, 12)}; session ${b.sessionId}`, `${harness}-B-resume.json`);

  // Phase C: descendant cancellation while the agent's sleep chain runs.
  log(harness, "phase C (cancel)");
  const requestId = `${harness}-c`;
  const pending = driver({ ...common, phase: "cancel", requestId, resume: a.sessionId, prompt: p.cancel, timeoutMs: 300_000 });
  // Look only inside this request's worker (docker top lists its processes by host PID).
  let containerC = "", top = "", sleepPids = [];
  for (let i = 0; i < 150 && !sleepPids.length; i++) {
    await sleep(1000);
    containerC ||= (await run("docker", ["ps", "--filter", `label=io.storybench.request=${requestId}`, "--format", "{{.ID}}"], { allowFail: true })).stdout.trim();
    if (!containerC) continue;
    top = (await run("docker", ["top", containerC, "-eo", "pid,ppid,uid,args"], { allowFail: true })).stdout;
    sleepPids = top.split("\n").map((line) => line.trim().split(/\s+/)).filter((cols) => cols[3] === "sleep" && /^24[01]$/.test(cols[4] ?? "")).map((cols) => cols[0]);
  }
  const stop = await control({ op: "worker.stop", requestId });
  const c = await pending;
  await sleep(1000);
  const survivors = sleepPids.length ? (await run("ps", ["-o", "pid,args", "-p", sleepPids.join(",")], { allowFail: true })).stdout.trim().split("\n").slice(1).join("\n") : "";
  const stray = (await run("pgrep", ["-af", "^sleep 24[01]$"], { allowFail: true })).stdout.trim();
  const containers = (await run("docker", ["ps", "-a", "--filter", `label=io.storybench.request=${requestId}`, "--format", "{{.ID}} {{.Status}}"])).stdout.trim();
  await save(`${harness}-C-cancel.txt`, `worker container: ${containerC}\n\ndocker top before stop (host PIDs):\n${top}\nsleep PIDs: ${sleepPids.join(",") || "(none found)"}\n\nstop reply: ${JSON.stringify(stop.reply)}\n\nps -p <sleep PIDs> after stop:\n${survivors || "(none alive)"}\n\npgrep -af '^sleep 24[01]$' after stop:\n${stray || "(none)"}\n\ncontainers with request label after stop:\n${containers || "(none)"}\n\ndriver result:\n${JSON.stringify({ ...c, events: c.events?.slice(-12) }, null, 2)}\n`);
  const before = sleepPids.length > 0, after = survivors || stray;
  record(harness, "descendant cancellation on Stop", before && !after && !containers && stop.reply?.ok, `sleep PIDs in worker before stop: ${sleepPids.join(",") || "none"}; after: ${after ? "STILL RUNNING" : "gone"}; containers: ${containers || "none"}`, `${harness}-C-cancel.txt`);
}

async function stopHost() {
  await run("systemctl", ["--user", "stop", unit], { allowFail: true, timeout: 120_000 });
  const state = (await run("systemctl", ["--user", "show", unit, "-p", "ActiveState,SubState,LoadState"], { allowFail: true })).stdout;
  const containers = (await run("docker", ["ps", "-a", "--filter", `label=io.storybench.install=${installId}`, "--format", "{{.ID}} {{.Names}}"])).stdout.trim();
  const networks = (await run("docker", ["network", "ls", "--filter", `label=io.storybench.install=${installId}`, "--format", "{{.Name}}"])).stdout.trim();
  const sleeps = (await run("pgrep", ["-af", "^sleep 24[01]$"], { allowFail: true })).stdout.trim();
  const runtimeLeft = existsSync(runtimeRoot) ? await readdir(runtimeRoot, { recursive: true }) : [];
  await save("unit-stopped.txt", `${state}\ncontainers: ${containers || "(none)"}\nnetworks: ${networks || "(none)"}\nstray sleeps: ${sleeps || "(none)"}\nruntime root entries left: ${JSON.stringify(runtimeLeft)}\n`);
  record("host", "unit stop removes all owned containers/networks/credential copies", !containers && !networks && !sleeps && !runtimeLeft.some((entry) => entry.includes("credentials/")), `containers ${containers || "none"}; networks ${networks || "none"}`, "unit-stopped.txt");
  await rm(runtimeRoot, { recursive: true, force: true });
}

async function main() {
  await mkdir(evidence, { recursive: true });
  const credentialFingerprintBefore = {};
  for (const [harness, file] of Object.entries(credentials)) credentialFingerprintBefore[harness] = await stat(file).then((info) => ({ ino: info.ino, mtimeMs: info.mtimeMs }), () => null);
  const images = await buildImages();
  const fixtures = await prepareData();
  let started = false;
  try {
    await startHost(images);
    started = true;
    const hashesBefore = await protectedHashes();
    await publicationChecks();
    await controlChecks();
    await boundaryProbe();
    for (const harness of harnesses) await harnessRun(harness, fixtures);
    const hashesAfter = await protectedHashes();
    await save("protected-hashes.json", { before: hashesBefore, after: hashesAfter });
    const sourceKeys = Object.keys(hashesBefore).filter((key) => key !== "storybench.sqlite");
    record("host", "project sources / references / outputs / legacy media unchanged", sourceKeys.every((key) => hashesBefore[key] === hashesAfter[key]), "sha256 before == after", "protected-hashes.json");
  } catch (error) {
    record("host", "proof run", false, error.message, null);
  } finally {
    if (started) await stopHost();
    else await run("systemctl", ["--user", "stop", unit], { allowFail: true });
  }
  const credentialFingerprintAfter = {};
  for (const [harness, file] of Object.entries(credentials)) credentialFingerprintAfter[harness] = await stat(file).then((info) => ({ ino: info.ino, mtimeMs: info.mtimeMs }), () => null);
  await save("credential-files-untouched.json", { note: "inode/mtime only; contents never read into evidence", before: credentialFingerprintBefore, after: credentialFingerprintAfter });
  await save("summary.json", { stamp, installId, unit, port, models, images, results });
  const table = ["| harness | check | result | detail | evidence |", "|---|---|---|---|---|", ...results.map((row) => `| ${row.harness} | ${row.check} | ${row.pass ? "PASS" : "FAIL"} | ${String(row.detail).replace(/\|/g, "/").slice(0, 300)} | ${row.evidence ?? ""} |`)].join("\n");
  await save("summary.md", `# Runtime slice proof ${stamp}\n\nModels: codex ${models.codex}, claude ${models.claude}\nImages: app ${images.app}, worker ${images.worker}\n\n${table}\n`);
  log(`done: ${results.filter((row) => row.pass).length}/${results.length} passed; evidence in ${evidence}`);
  if (!flag("keep-work")) await rm(work, { recursive: true, force: true });
  process.exitCode = results.every((row) => row.pass) ? 0 : 1;
}

await main();

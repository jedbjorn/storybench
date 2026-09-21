#!/usr/bin/env node
// Disposable task #27 live proof. Builds this checkout, starts the normal host/app/worker
// boundary on a loopback 188xx port, sends real shortcut requests, and removes its exact
// containers/images/work directory. Credential files are hashed read-only before/after.
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2), arg = (name, fallback) => { const index = args.indexOf(`--${name}`); return index < 0 ? fallback : args[index + 1]; };
const evidence = path.resolve(arg("evidence", path.join(repo, "task27-live-evidence")));
const work = path.resolve(arg("work", path.join(os.tmpdir(), `storybench-task27-${Date.now()}`)));
const port = Number(arg("port", "18863"));
if (!Number.isInteger(port) || port < 18800 || port > 18899) throw new Error("--port must be in 18800-18899");
const dataRoot = path.join(work, "data"), stateRoot = path.join(work, "state"), runtimeRoot = path.join(work, "runtime");
const installId = `task27${Date.now()}`, appName = `storybench-${installId}-app`;
const tags = { app: "storybench-task27-app:live", worker: "storybench-task27-worker:live" };
const credentials = { codex: path.join(os.homedir(), ".codex/auth.json"), claude: path.join(os.homedir(), ".claude/.credentials.json") };
const driver = path.join(repo, "src/runtime/slice-proof-driver.js");
const logs = [];
const run = (command, values, { allowFail = false, timeout = 900_000 } = {}) => new Promise((resolve, reject) => {
  execFile(command, values, { timeout, maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
    const result = { code: error ? error.code ?? 1 : 0, stdout: String(stdout), stderr: String(stderr) };
    if (error && !allowFail) reject(Object.assign(new Error(`${command} failed: ${result.stderr || error.message}`), result)); else resolve(result);
  });
});
const sha = async (file) => existsSync(file) ? createHash("sha256").update(await readFile(file)).digest("hex") : null;
const jsonLine = (output) => JSON.parse(output.trim().split("\n").at(-1));
let host = null, images = null, seeded = null;

async function cleanup() {
  if (host && host.exitCode == null) { host.kill("SIGTERM"); await new Promise((resolve) => { host.once("exit", resolve); setTimeout(resolve, 30_000); }); }
  const owned = (await run("docker", ["ps", "-aq", "--filter", `label=storybench.install=${installId}`], { allowFail: true })).stdout.trim().split(/\s+/).filter(Boolean);
  for (const id of owned) await run("docker", ["rm", "-f", "-v", id], { allowFail: true });
  for (const tag of Object.values(tags)) await run("docker", ["image", "rm", tag], { allowFail: true });
  await rm(work, { recursive: true, force: true });
}

try {
  await mkdir(evidence, { recursive: true }); await mkdir(dataRoot, { recursive: true }); await mkdir(stateRoot, { recursive: true });
  const before = { codex: await sha(credentials.codex), claude: await sha(credentials.claude) };
  for (const target of ["app", "worker"]) {
    const built = await run("docker", ["build", "-f", path.join(repo, "docker/Dockerfile"), "--target", target, "-t", tags[target], repo]);
    await writeFile(path.join(evidence, `build-${target}.log`), built.stdout + built.stderr);
  }
  images = { app: (await run("docker", ["image", "inspect", tags.app, "--format", "{{.Id}}"])) .stdout.trim(),
    worker: (await run("docker", ["image", "inspect", tags.worker, "--format", "{{.Id}}"])) .stdout.trim() };
  const seededOutput = await run("docker", ["run", "--rm", "--network", "none", "--user", "0:0", "--cap-drop", "ALL",
    "--mount", `type=bind,source=${dataRoot},target=/storybench/data`, "--mount", `type=bind,source=${driver},target=/opt/storybench/app/src/runtime/slice-proof-driver.js,readonly`,
    images.app, "node", "src/runtime/slice-proof-driver.js", JSON.stringify({ phase: "seed", nameSuffix: " TASK27" })]);
  seeded = jsonLine(seededOutput.stdout);
  const config = { installId, dataRoot, stateRoot, runtimeRoot, port, images, credentials, healthTimeoutMs: 60_000 };
  const configPath = path.join(work, "host.json"); await writeFile(configPath, JSON.stringify(config));
  host = spawn(process.execPath, [path.join(repo, "src/runtime/host.js"), "--config", configPath], { cwd: repo, stdio: ["ignore", "pipe", "pipe"] });
  host.stdout.on("data", (value) => logs.push(String(value))); host.stderr.on("data", (value) => logs.push(String(value)));
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const healthy = await fetch(`http://127.0.0.1:${port}/api/health`).then((value) => value.ok, () => false);
    if (healthy) break;
    if (host.exitCode != null) throw new Error(`host exited ${host.exitCode}`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!(await fetch(`http://127.0.0.1:${port}/api/health`).then((value) => value.ok, () => false))) throw new Error("host did not become healthy");
  await run("docker", ["cp", driver, `${appName}:/opt/storybench/app/src/runtime/slice-proof-driver.js`]);
  const episodeId = seeded.episodes[0].id;
  const invoke = async (spec) => jsonLine((await run("docker", ["exec", appName, "node", "src/runtime/slice-proof-driver.js", JSON.stringify({ phase: "production", episodeId, timeoutMs: 360_000, ...spec })])).stdout);
  const codex = await invoke({ requestId: "codex-success", harness: "codex", model: "gpt-5.6-terra", kind: "still_graphic",
    prompt: "Create a simple 320x180 still graphic with a dark green background and the text TASK 27. You must use create_graphic_recipe, then render_graphic, then await_job. Finish only after the job is completed." });
  const stopped = await invoke({ requestId: "codex-stop", harness: "codex", model: "gpt-5.6-terra", kind: "animated_graphic", stopWhenJobActive: true,
    prompt: "Create a 30-second 1920x1080 animated graphic with moving text TASK 27 STOP. You must use create_graphic_recipe, then render_graphic, then await_job and wait for completion." });
  const claude = await invoke({ requestId: "claude-success", harness: "claude", model: "sonnet", kind: "still_graphic",
    prompt: "Create a simple 320x180 still graphic with a navy background and the text CLAUDE TASK 27. You must use create_graphic_recipe, then render_graphic, then await_job. Finish only after the job is completed." });
  const after = { codex: await sha(credentials.codex), claude: await sha(credentials.claude) };
  const summary = {
    port, models: { codex: "gpt-5.6-terra", claude: "sonnet" }, images,
    credentialFilesUnchanged: before.codex === after.codex && before.claude === after.claude,
    codex: { state: codex.state, run: codex.run, jobs: codex.jobs, assistant: codex.messages.filter((value) => value.role === "assistant").at(-1)?.text ?? null },
    stop: { requested: stopped.stopped, state: stopped.state, run: stopped.run, jobs: stopped.jobs },
    claude: { state: claude.state, run: claude.run, jobs: claude.jobs, assistant: claude.messages.filter((value) => value.role === "assistant").at(-1)?.text ?? null },
  };
  await writeFile(path.join(evidence, "live-summary.json"), JSON.stringify(summary, null, 2) + "\n");
  await writeFile(path.join(evidence, "live-codex.json"), JSON.stringify(codex, null, 2) + "\n");
  await writeFile(path.join(evidence, "live-stop.json"), JSON.stringify(stopped, null, 2) + "\n");
  await writeFile(path.join(evidence, "live-claude.json"), JSON.stringify(claude, null, 2) + "\n");
  if (!summary.credentialFilesUnchanged || codex.state !== "idle" || !codex.jobs.some((job) => job.state === "completed") || !stopped.stopped
      || stopped.jobs.some((job) => ["queued", "running", "cancelling"].includes(job.state)) || claude.state !== "idle" || !claude.jobs.some((job) => job.state === "completed"))
    throw new Error(`live proof did not pass: ${JSON.stringify({ codex: codex.state, stop: stopped.state, claude: claude.state })}`);
  console.log(JSON.stringify({ ok: true, evidence, codex: codex.state, stop: stopped.state, claude: claude.state }));
} catch (error) {
  await mkdir(evidence, { recursive: true });
  await writeFile(path.join(evidence, "live-error.txt"), `${error.stack || error.message}\n\n${logs.join("")}`);
  throw error;
} finally { await cleanup(); }

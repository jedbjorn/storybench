#!/usr/bin/env node
// Disposable task #27 review proof. Builds this checkout, starts the normal host/app/worker
// boundary on a loopback 188xx port, sends one real shortcut request, and removes its exact
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
const tags = { app: `storybench-task27-app:${installId}`, worker: `storybench-task27-worker:${installId}` };
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
  await mkdir(path.join(dataRoot, "imports", "fixtures"), { recursive: true });
  await run("docker", ["run", "--rm", "--network", "none", "--user", "0:0", "--cap-drop", "ALL",
    "--mount", `type=bind,source=${dataRoot},target=/storybench/data`, images.app, "ffmpeg", "-hide_banner", "-loglevel", "error",
    "-f", "lavfi", "-i", "color=c=0x2040ff:s=96x64:d=1", "-frames:v", "1", "-y", "/storybench/data/imports/fixtures/review-reference.png"]);
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
  const rawInvoke = async (spec) => jsonLine((await run("docker", ["exec", appName, "node", "src/runtime/slice-proof-driver.js", JSON.stringify(spec)])).stdout);
  const attached = await rawInvoke({ phase: "attach-files", episodeId: seeded.episodes[1].id,
    files: [{ file: "review-reference.png", category: "Reference", label: "Review blue reference" }] });
  const sourceItemId = attached.items[0].itemId, sourceEpisodeId = seeded.episodes[1].id;
  const codex = await rawInvoke({ phase: "production", episodeId, timeoutMs: 360_000, requestId: "codex-review", harness: "codex", model: "gpt-5.6-terra", kind: "still_graphic",
    directionText: "Use the Review blue reference directly in this episode.",
    prompt: `First call reuse_project_item for source episode ${sourceEpisodeId}, item ${sourceItemId}, with no direction argument. Then call reuse_project_item for the same item again with direction.messageId {{directionMessageId}} and use direct-use, so provenance is recorded. Finally create a simple 320x180 still graphic with a dark green background and the text TASK 27 REVIEW: use create_graphic_recipe, render_graphic, and await_job. Finish only after the job is completed.` });
  const state = await rawInvoke({ phase: "episode-state", episodeId });
  const after = { codex: await sha(credentials.codex), claude: await sha(credentials.claude) };
  const summary = {
    port, model: "gpt-5.6-terra", images,
    credentialFilesUnchanged: before.codex === after.codex && before.claude === after.claude,
    codex: { state: codex.state, run: codex.run, jobs: codex.jobs, assistant: codex.messages.filter((value) => value.role === "assistant").at(-1)?.text ?? null },
    reuseToolCalls: codex.events.filter((event) => event.payload?.name === "reuse_project_item").length,
    recordedDirections: state.directions,
    reusedItems: state.library.filter((item) => item.provenance?.reusedFrom?.itemId === sourceItemId),
  };
  await writeFile(path.join(evidence, "live-summary.json"), JSON.stringify(summary, null, 2) + "\n");
  await writeFile(path.join(evidence, "live-codex.json"), JSON.stringify(codex, null, 2) + "\n");
  if (!summary.credentialFilesUnchanged || codex.state !== "idle" || !codex.jobs.some((job) => job.state === "completed")
      || summary.reuseToolCalls < 2 || summary.reusedItems.length !== 1 || summary.recordedDirections.length !== 1
      || summary.recordedDirections[0].messageId !== codex.directionMessageId)
    throw new Error(`live proof did not pass: ${JSON.stringify({ codex: codex.state, reuseToolCalls: summary.reuseToolCalls, directions: summary.recordedDirections.length })}`);
  console.log(JSON.stringify({ ok: true, evidence, codex: codex.state, reuseToolCalls: summary.reuseToolCalls, directions: summary.recordedDirections.length }));
} catch (error) {
  await mkdir(evidence, { recursive: true });
  await writeFile(path.join(evidence, "live-error.txt"), `${error.stack || error.message}\n\n${logs.join("")}`);
  throw error;
} finally { await cleanup(); }

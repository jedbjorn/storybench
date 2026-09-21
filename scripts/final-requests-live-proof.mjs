#!/usr/bin/env node
// Disposable task #28B live proof: real typed Codex Final, reclassification plus a new
// version, and one Claude Final-button turn. Everything is scoped to one temporary install.
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2), arg = (name, fallback) => { const index = args.indexOf(`--${name}`); return index < 0 ? fallback : args[index + 1]; };
const reviewOnly = args.includes("--review-only");
const evidence = path.resolve(arg("evidence", path.join(repo, "task28b-live-evidence")));
const work = path.resolve(arg("work", path.join(os.tmpdir(), `sbf-${Date.now()}`)));
const port = Number(arg("port", "18871"));
if (!Number.isInteger(port) || port < 18800 || port > 18899) throw new Error("--port must be in 18800-18899");
const dataRoot = path.join(work, "data"), stateRoot = path.join(work, "state"), runtimeRoot = path.join(work, "runtime");
const installId = `task28b${Date.now()}`, appName = `storybench-${installId}-app`;
const tags = { app: `storybench-task28b-app:${installId}`, worker: `storybench-task28b-worker:${installId}` };
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
let host = null;

async function cleanup() {
  if (host && host.exitCode == null) { host.kill("SIGTERM"); await new Promise((resolve) => { host.once("exit", resolve); setTimeout(resolve, 30_000); }); }
  const owned = (await run("docker", ["ps", "-aq", "--filter", `label=storybench.install=${installId}`], { allowFail: true })).stdout.trim().split(/\s+/).filter(Boolean);
  for (const id of owned) await run("docker", ["rm", "-f", "-v", id], { allowFail: true });
  for (const tag of Object.values(tags)) await run("docker", ["image", "rm", tag], { allowFail: true });
  await rm(work, { recursive: true, force: true });
}

try {
  await mkdir(evidence, { recursive: true }); await rm(path.join(evidence, "live-error.txt"), { force: true });
  await mkdir(dataRoot, { recursive: true }); await mkdir(stateRoot, { recursive: true });
  const beforeCredentials = { codex: await sha(credentials.codex), claude: await sha(credentials.claude) };
  for (const target of ["app", "worker"]) {
    const built = await run("docker", ["build", "-f", path.join(repo, "docker/Dockerfile"), "--target", target, "-t", tags[target], repo]);
    await writeFile(path.join(evidence, `build-${target}.log`), built.stdout + built.stderr);
  }
  const images = { app: (await run("docker", ["image", "inspect", tags.app, "--format", "{{.Id}}"])) .stdout.trim(),
    worker: (await run("docker", ["image", "inspect", tags.worker, "--format", "{{.Id}}"])) .stdout.trim() };
  const seeded = jsonLine((await run("docker", ["run", "--rm", "--network", "none", "--user", "0:0", "--cap-drop", "ALL",
    "--mount", `type=bind,source=${dataRoot},target=/storybench/data`, "--mount", `type=bind,source=${driver},target=/opt/storybench/app/src/runtime/slice-proof-driver.js,readonly`,
    images.app, "node", "src/runtime/slice-proof-driver.js", JSON.stringify({ phase: "seed", nameSuffix: " TASK28B" })])).stdout);
  await mkdir(path.join(dataRoot, "imports", "fixtures"), { recursive: true });
  await run("docker", ["run", "--rm", "--network", "none", "--user", "0:0", "--cap-drop", "ALL",
    "--mount", `type=bind,source=${dataRoot},target=/storybench/data`, images.app, "ffmpeg", "-hide_banner", "-loglevel", "error",
    "-f", "lavfi", "-i", "color=c=0x9B1C31:s=320x180:d=1:r=30", "-f", "lavfi", "-i", "color=c=0x1C4E9B:s=320x180:d=1:r=30",
    "-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0[v]", "-map", "[v]", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-y", "/storybench/data/imports/fixtures/final-clip.mp4"]);

  const config = { installId, dataRoot, stateRoot, runtimeRoot, port, images, credentials, healthTimeoutMs: 60_000 };
  const configPath = path.join(work, "host.json"); await writeFile(configPath, JSON.stringify(config));
  host = spawn(process.execPath, [path.join(repo, "src/runtime/host.js"), "--config", configPath], { cwd: repo, stdio: ["ignore", "pipe", "pipe"] });
  host.stdout.on("data", (value) => logs.push(String(value))); host.stderr.on("data", (value) => logs.push(String(value)));
  const healthyBy = Date.now() + 120_000;
  while (Date.now() < healthyBy) {
    if (await fetch(`http://127.0.0.1:${port}/api/health`).then((value) => value.ok, () => false)) break;
    if (host.exitCode != null) throw new Error(`host exited ${host.exitCode}`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!(await fetch(`http://127.0.0.1:${port}/api/health`).then((value) => value.ok, () => false))) throw new Error("host did not become healthy");
  await run("docker", ["cp", driver, `${appName}:/opt/storybench/app/src/runtime/slice-proof-driver.js`]);
  const episodeId = seeded.episodes[0].id;
  const invoke = async (spec) => jsonLine((await run("docker", ["exec", appName, "node", "src/runtime/slice-proof-driver.js", JSON.stringify(spec)])).stdout);
  const fixture = await invoke({ phase: "seed-final", episodeId });

  const first = await invoke({ phase: "production", episodeId, requestId: "codex-typed-first", harness: "codex", model: "gpt-5.6-terra", typed: true, timeoutMs: 360_000,
    prompt: reviewOnly ? "Draft looks great — now create the final."
      : "Please finish this video and publish a complete Final. The closing card is intentionally incomplete: use the available Two-scene synthetic clip for its second scene, update the saved card with the exact current revision, then validate_render, create_final, and await_job. Finish only after the Final job is completed." });
  await writeFile(path.join(evidence, "live-codex-first.json"), JSON.stringify(first, null, 2) + "\n");
  const firstJob = first.jobs.find((job) => job.id === first.run.finalOutputJobId);
  if (!firstJob) throw new Error(`first request did not publish its Final: ${JSON.stringify(first.run)}`);
  const firstFile = path.join(dataRoot, firstJob.outputPath), firstHash = await sha(firstFile);
  const firstProbe = JSON.parse((await run("ffprobe", ["-v", "error", "-show_entries", "format=duration,size", "-show_entries", "stream=codec_type,width,height", "-of", "json", firstFile])).stdout);
  const afterCredentials = { codex: await sha(credentials.codex), claude: await sha(credentials.claude) };
  if (reviewOnly) {
    const summary = { port, images, fixture, prompt: "Draft looks great — now create the final.",
      credentialFilesUnchanged: beforeCredentials.codex === afterCredentials.codex && beforeCredentials.claude === afterCredentials.claude,
      first: { state: first.state, run: first.run, job: firstJob, probe: firstProbe, sha256: firstHash } };
    await writeFile(path.join(evidence, "live-summary.json"), JSON.stringify(summary, null, 2) + "\n");
    if (!summary.credentialFilesUnchanged || first.run.finalIntent !== "published" || first.state !== "idle" || firstJob.state !== "completed"
        || !firstJob.snapshot?.output?.sha256 || firstJob.snapshot.output.sha256 !== firstHash || !firstJob.snapshot?.episode?.revision)
      throw new Error(`review live proof did not pass: ${JSON.stringify(first.run)}`);
    console.log(JSON.stringify({ ok: true, evidence, first: firstJob.id }));
  } else {
    const moved = await invoke({ phase: "move-final", episodeId, outputId: firstJob.id, expectedRevision: firstJob.recordRevision });
    const movedHash = await sha(firstFile);
    const second = await invoke({ phase: "production", episodeId, requestId: "codex-typed-second", harness: "codex", model: "gpt-5.6-terra", typed: true, timeoutMs: 360_000,
      prompt: "Please create another complete Final video. First make a small edit to the closing card by ending its selected clip at 1.8 seconds. Use exact current revisions, validate_render, create_final, and await_job; finish only after the new Final is completed." });
    await writeFile(path.join(evidence, "live-codex-second.json"), JSON.stringify(second, null, 2) + "\n");
    const secondJob = second.jobs.find((job) => job.id === second.run.finalOutputJobId);
    if (!secondJob) throw new Error(`second request did not publish its Final: ${JSON.stringify(second.run)}`);
    const claude = await invoke({ phase: "production", episodeId, requestId: "claude-button", harness: "claude", model: "sonnet", kind: "final", timeoutMs: 360_000,
      prompt: "Create the final output from the current saved episode." });
    await writeFile(path.join(evidence, "live-claude.json"), JSON.stringify(claude, null, 2) + "\n");
    const claudeJob = claude.jobs.find((job) => job.id === claude.run.finalOutputJobId);
    const finalState = await invoke({ phase: "final-state", episodeId });
    const summary = {
      port, images, fixture, credentialFilesUnchanged: beforeCredentials.codex === afterCredentials.codex && beforeCredentials.claude === afterCredentials.claude,
      first: { state: first.state, run: first.run, job: firstJob, probe: firstProbe, sha256: firstHash },
      moved: { id: moved.output.id, designation: moved.output.designation, recordRevision: moved.output.recordRevision, sha256Unchanged: firstHash === movedHash },
      second: { state: second.state, run: second.run, job: secondJob },
      claude: { state: claude.state, run: claude.run, job: claudeJob ?? null },
      finalIds: finalState.jobs.filter((job) => job.outputClass === "final").map((job) => ({ id: job.id, designation: job.designation, requestId: job.requestId, output: job.snapshot?.output ?? null })),
    };
    await writeFile(path.join(evidence, "live-summary.json"), JSON.stringify(summary, null, 2) + "\n");
    if (!summary.credentialFilesUnchanged || first.run.finalIntent !== "published" || first.state !== "idle" || firstJob.state !== "completed"
        || !firstJob.snapshot?.output?.sha256 || firstJob.snapshot.output.sha256 !== firstHash || moved.output.designation !== "draft" || firstHash !== movedHash
        || second.run.finalIntent !== "published" || secondJob.id === firstJob.id || claude.run.finalIntent !== "published" || !claudeJob)
      throw new Error(`live proof did not pass: ${JSON.stringify({ first: first.run, moved: moved.output, second: second.run, claude: claude.run })}`);
    console.log(JSON.stringify({ ok: true, evidence, first: firstJob.id, second: secondJob.id, claude: claudeJob.id }));
  }
} catch (error) {
  await mkdir(evidence, { recursive: true });
  await writeFile(path.join(evidence, "live-error.txt"), `${error.stack || error.message}\n\n${logs.join("")}`);
  throw error;
} finally { await cleanup(); }

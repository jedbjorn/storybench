#!/usr/bin/env node
// Storybench host lifecycle entry point (spec #11 Runtime Contract; spec #10 Health and
// Lifecycle). Runs on the host under the user's service manager and is the only
// component with Docker authority. It:
//   - reconciles installation-owned containers left by a previous run,
//   - starts the app container (data root mounted, port published on 127.0.0.1 only),
//   - serves a private unix-socket control channel mounted into the app that permits
//     only validated worker.start / worker.stop / worker.status / harness.availability,
//   - stages per-request credential copies and syncs them with the host login,
//   - on SIGTERM stops workers (and their descendant processes) and the app.
// Neither container receives the Docker socket or runs privileged.
import { createServer } from "node:net";
import { chmod, lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as dockerCli from "./docker.js";
import { RUNTIME_PROTOCOL, checkCompatibility, manifestId, validateManifest } from "./manifest.js";
import { CredentialLink, CREDENTIAL_FILES, harnessAvailability, shouldLogSyncAction } from "./credentials.js";
import {
  APP_REQUESTS_MOUNT, BRIDGE_SOCKET_NAME, DATA_MOUNT, LABEL, PROJECT_ROOTS,
  appRunArgs, hostPaths, names, validateHostConfig, workerRunArgs,
} from "./layout.js";
import { RuntimeError, resolveEpisodeDirectory, validateControlRequest } from "./validate.js";

const MAX_CONTROL_BYTES = 64 * 1024;

export function createHost(rawConfig, { log = (event) => console.log(JSON.stringify({ at: new Date().toISOString(), ...event })), syncIntervalMs = 2000, dockerApi = dockerCli } = {}) {
  const { docker, ensureNetwork, inspectContainer, listByLabels } = dockerApi;
  const config = validateHostConfig(rawConfig);
  if (config.manifest) {
    const compatibility = checkCompatibility(config.manifest, { hostProtocol: RUNTIME_PROTOCOL });
    if (!compatibility.compatible) throw new RuntimeError("INCOMPATIBLE_RELEASE", compatibility.problems.join("; "));
  }
  const paths = hostPaths(config);
  const n = names(config.installId);
  const workers = new Map();
  let server, syncTimer, appId, stopped, stopping = false;

  async function presentRoots() {
    const present = [];
    for (const root of PROJECT_ROOTS) {
      const info = await lstat(path.join(config.dataRoot, root)).catch(() => null);
      if (info?.isDirectory() && !info.isSymbolicLink()) present.push(root);
    }
    return present;
  }

  async function removeContainer(id) {
    await docker(["stop", "--time", "3", id]).catch(() => {});
    await docker(["rm", "--force", "--volumes", id]).catch(() => {});
    // Removal may still be completing (e.g. a concurrent removal); confirm it is gone.
    for (let attempt = 0; attempt < 40; attempt++) {
      if (!(await inspectContainer(id))) return;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new RuntimeError("STOP_FAILED", `Container ${id.slice(0, 12)} is still present after stop`, { status: 500 });
  }

  // Remove every container this installation owns (left by a crash or an unclean stop) and
  // the per-request runtime state. Requests whose workers are removed here are unfinished;
  // the restarted app marks them interrupted and never replays them.
  async function reconcile({ reason = "start" } = {}) {
    const owned = [];
    for (const id of await listByLabels({ [LABEL.install]: config.installId })) owned.push({ id, info: await inspectContainer(id) });
    // A surviving app goes first, so it cannot observe its workers vanish and record the
    // turn as a failure; the restarted app then marks those requests interrupted.
    owned.sort((a, b) => (a.info?.Config?.Labels?.[LABEL.role] === "app" ? 0 : 1) - (b.info?.Config?.Labels?.[LABEL.role] === "app" ? 0 : 1));
    const removed = [];
    for (const { id, info } of owned) {
      const labels = info?.Config?.Labels ?? {};
      const entry = { container: id.slice(0, 12), role: labels[LABEL.role] ?? "unknown", requestId: labels[LABEL.request] ?? null, harness: labels[LABEL.harness] ?? null, state: info?.State?.Status ?? "absent" };
      log({ event: "reconcile.remove", reason, ...entry });
      await removeContainer(id);
      removed.push(entry);
    }
    await rm(paths.requestsDir, { recursive: true, force: true });
    await rm(path.join(config.runtimeRoot, "credentials"), { recursive: true, force: true });
    const orphanRequests = removed.filter((entry) => entry.role === "worker").map((entry) => entry.requestId);
    if (removed.length) log({ event: "reconcile.done", reason, removed: removed.length, orphanRequests });
    return { removed, orphanRequests };
  }

  function statusOf(requestId, worker, info) {
    return {
      requestId, containerId: worker?.containerId ?? info?.Id ?? null,
      state: info ? info.State.Status : "absent",
      exitCode: info?.State?.ExitCode ?? null,
      harness: worker?.harness ?? info?.Config?.Labels?.[LABEL.harness] ?? null,
      credential: worker ? { lastSync: worker.credential.lastAction, conflict: worker.credential.conflict } : null,
    };
  }

  async function startWorker(request) {
    const existing = workers.get(request.requestId);
    if (existing) {
      if (existing.harness !== request.harness || existing.segmentId !== request.segmentId || existing.episode.relative !== request.episode.relative || existing.episode.work !== request.episode.work)
        throw new RuntimeError("DUPLICATE_REQUEST", "requestId already owns a worker with different settings", { status: 409 });
      return { ...statusOf(request.requestId, existing, await inspectContainer(existing.containerId)), reused: true };
    }
    await resolveEpisodeDirectory(config.dataRoot, request.episode);
    const sessionDir = paths.sessionDir(request.harness, request.segmentId);
    await mkdir(sessionDir, { recursive: true, mode: 0o700 });
    // Pre-create the empty mountpoint for the single credential file bind.
    await writeFile(path.join(sessionDir, CREDENTIAL_FILES[request.harness]), "", { flag: "a", mode: 0o600 });
    const requestDir = paths.requestDir(request.requestId);
    await rm(requestDir, { recursive: true, force: true });
    await mkdir(path.join(requestDir, "app"), { recursive: true, mode: 0o700 });
    await mkdir(path.join(requestDir, "worker"), { recursive: true, mode: 0o700 });
    let credential;
    try {
      // Resolve the host's current login fresh for this worker (decision #43).
      credential = await CredentialLink.stage({ harness: request.harness, hostPath: config.credentials[request.harness], stageDir: paths.credentialDir(request.requestId) });
      const args = workerRunArgs(config, request, { presentRoots: await presentRoots(), credentialFile: credential.stagePath });
      const containerId = await docker(args);
      const worker = { ...request, containerId, credential, startedAt: new Date().toISOString() };
      workers.set(request.requestId, worker);
      log({ event: "worker.started", requestId: request.requestId, harness: request.harness, container: containerId.slice(0, 12) });
      const requestMount = `${APP_REQUESTS_MOUNT}/${request.requestId}`;
      return {
        ...statusOf(request.requestId, worker, await inspectContainer(containerId)),
        episodeDir: `${DATA_MOUNT}/${request.episode.relative}`,
        workDir: `${DATA_MOUNT}/${request.episode.work}`,
        harnessSocket: `${requestMount}/worker/harness.sock`,
        bridgeSocket: `${requestMount}/app/${BRIDGE_SOCKET_NAME}`,
        appRequestDir: `${requestMount}/app`,
      };
    } catch (error) {
      await credential?.dispose();
      await rm(requestDir, { recursive: true, force: true });
      throw error;
    }
  }

  // Concurrent stops of one request (user Stop racing request cleanup) share one operation.
  const inFlightStops = new Map();
  function stopWorker(requestId) {
    if (!inFlightStops.has(requestId)) inFlightStops.set(requestId, stopWorkerOnce(requestId).finally(() => inFlightStops.delete(requestId)));
    return inFlightStops.get(requestId);
  }

  async function stopWorkerOnce(requestId) {
    const worker = workers.get(requestId);
    const ids = worker ? [worker.containerId] : await listByLabels({ [LABEL.install]: config.installId, [LABEL.request]: requestId });
    for (const id of ids) await removeContainer(id);
    let credentialSync = null;
    if (worker) {
      credentialSync = await worker.credential.sync().catch((error) => `error: ${error.message}`);
      await worker.credential.dispose();
      workers.delete(requestId);
    }
    await rm(paths.requestDir(requestId), { recursive: true, force: true });
    log({ event: "worker.stopped", requestId, removed: ids.length });
    return { requestId, removed: ids.length, state: "absent", credentialSync };
  }

  async function handle(raw) {
    const request = validateControlRequest(raw);
    // While draining, the app may still stop and inspect its workers, but nothing new starts.
    if (stopping && request.op === "worker.start") throw new RuntimeError("STOPPING", "Storybench is shutting down", { status: 503 });
    if (request.op === "harness.availability") return harnessAvailability(config.credentials);
    if (request.op === "worker.start") return startWorker(request);
    if (request.op === "worker.stop") return stopWorker(request.requestId);
    const worker = workers.get(request.requestId);
    const [id] = worker ? [worker.containerId] : await listByLabels({ [LABEL.install]: config.installId, [LABEL.request]: request.requestId });
    return statusOf(request.requestId, worker, id ? await inspectContainer(id) : null);
  }

  function serveControl() {
    server = createServer((socket) => {
      let buffer = "";
      socket.setEncoding("utf8");
      socket.on("error", () => {});
      socket.on("data", async (chunk) => {
        buffer += chunk;
        if (buffer.length > MAX_CONTROL_BYTES) { socket.end(JSON.stringify({ ok: false, code: "TOO_LARGE", error: "Control request too large" }) + "\n"); return; }
        const newline = buffer.indexOf("\n");
        if (newline < 0) return;
        socket.pause();
        let reply;
        try {
          const parsed = JSON.parse(buffer.slice(0, newline));
          reply = { ok: true, result: await handle(parsed) };
        } catch (error) {
          reply = { ok: false, code: error.code || "ERROR", error: error instanceof SyntaxError ? "Invalid JSON" : error.message };
          log({ event: "control.rejected", code: reply.code, error: reply.error });
        }
        socket.end(JSON.stringify(reply) + "\n");
      });
    });
    return new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(paths.controlSocket, async () => { await chmod(paths.controlSocket, 0o600); resolve(); });
    });
  }

  async function waitHealthy() {
    const deadline = Date.now() + config.healthTimeoutMs;
    while (Date.now() < deadline) {
      try {
        const response = await fetch(`http://127.0.0.1:${config.port}/api/health`, { signal: AbortSignal.timeout(2000) });
        if (response.ok) {
          const health = await response.json();
          // The app must report the exact release this host started.
          if (config.manifest && health.release?.manifestId !== (config.manifest.id ?? manifestId(config.manifest)))
            throw new RuntimeError("RELEASE_MISMATCH", "The app reports a different release than the host started", { status: 500 });
          return health;
        }
      } catch (error) { if (error.code === "RELEASE_MISMATCH") throw error; }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new RuntimeError("APP_UNHEALTHY", `App did not become healthy on 127.0.0.1:${config.port}`, { status: 500 });
  }

  async function start() {
    const rootInfo = await lstat(config.dataRoot).catch(() => null);
    if (!rootInfo?.isDirectory()) throw new RuntimeError("DATA_ROOT_MISSING", `Data root does not exist: ${config.dataRoot}`);
    for (const dir of [config.runtimeRoot, paths.controlDir, paths.requestsDir, path.join(config.runtimeRoot, "credentials"), path.join(config.stateRoot, "harnesses")])
      await mkdir(dir, { recursive: true, mode: 0o700 });
    await reconcile();
    await mkdir(paths.requestsDir, { recursive: true, mode: 0o700 });
    await rm(paths.controlSocket, { force: true });
    const labels = { [LABEL.install]: config.installId };
    await ensureNetwork(n.appNetwork, labels);
    await ensureNetwork(n.workerNetwork, labels);
    await serveControl();
    appId = await docker(appRunArgs(config));
    log({ event: "app.started", container: appId.slice(0, 12), port: config.port });
    const health = await waitHealthy();
    log({ event: "app.healthy", port: config.port, release: health.release?.manifestId ?? null, schema: health.schema?.current ?? null, database: health.database?.id ?? null });
    syncTimer = setInterval(async () => {
      for (const worker of workers.values()) {
        const action = await worker.credential.sync().catch((error) => `error: ${error.message}`);
        const previous = worker.loggedSyncAction;
        worker.loggedSyncAction = action;
        if (shouldLogSyncAction(previous, action)) log({ event: "credential.sync", requestId: worker.requestId, harness: worker.harness, action, level: ["conflict", "host-missing", "host-invalid", "invalid-worker-write"].includes(action) || action.startsWith("error") ? "error" : "info" });
      }
    }, syncIntervalMs);
    return { appId };
  }

  // Graceful stop: the app drains first (SIGTERM: it interrupts its active turns, which
  // stop their workers through the still-open control channel, and cancels render jobs);
  // then any remaining worker is removed with its descendants, and termination of every
  // installation-owned container is confirmed.
  async function stop() {
    if (stopping) return stopped;
    stopping = true;
    clearInterval(syncTimer);
    stopped = (async () => {
      log({ event: "host.stopping", activeWorkers: workers.size });
      if (appId) {
        await docker(["stop", "--time", String(config.appStopTimeoutS), appId], { timeout: (config.appStopTimeoutS + 30) * 1000 }).catch((error) => log({ event: "app.stop.failed", error: error.message }));
        const info = await inspectContainer(appId).catch(() => null);
        log({ event: "app.stopped", exitCode: info?.State?.ExitCode ?? null });
        await docker(["rm", "--force", appId]).catch(() => {});
      }
      for (const requestId of [...workers.keys()]) await stopWorker(requestId).catch((error) => log({ event: "worker.stop.failed", requestId, error: error.message }));
      await reconcile({ reason: "stop" }).catch((error) => log({ event: "reconcile.failed", error: error.message }));
      const remaining = await listByLabels({ [LABEL.install]: config.installId }).catch(() => ["unknown"]);
      await new Promise((resolve) => (server ? server.close(() => resolve()) : resolve()));
      await rm(paths.controlDir, { recursive: true, force: true });
      for (const network of [n.appNetwork, n.workerNetwork]) await docker(["network", "rm", network]).catch(() => {});
      log({ event: "host.stopped", containersRemaining: remaining.length });
      return { containersRemaining: remaining.length };
    })();
    return stopped;
  }

  return { config, start, stop, handle, reconcile, workers, get appId() { return appId; } };
}

async function main(argv) {
  const index = argv.indexOf("--config");
  if (index < 0 || !argv[index + 1]) throw new Error("Usage: host.js --config /absolute/config.json");
  const config = JSON.parse(await readFile(argv[index + 1], "utf8"));
  // `manifestPath` names the release manifest written by src/runtime/release.js.
  if (typeof config.manifestPath === "string") {
    config.manifest = validateManifest(JSON.parse(await readFile(config.manifestPath, "utf8")));
    delete config.manifestPath;
  }
  const host = createHost(config);
  let exiting = false;
  const shutdown = async (code) => {
    if (exiting) return;
    exiting = true;
    await host.stop();
    process.exit(code);
  };
  process.once("SIGTERM", () => shutdown(0));
  process.once("SIGINT", () => shutdown(0));
  try { await host.start(); }
  catch (error) {
    console.error(JSON.stringify({ event: "host.start.failed", code: error.code, error: error.message }));
    await shutdown(1);
    return;
  }
  // Exit (and let the service manager decide) if the app container dies unexpectedly.
  dockerCli.docker(["wait", host.appId], { timeout: 0 }).then((code) => {
    if (!exiting) { console.error(JSON.stringify({ event: "app.exited", code })); shutdown(1); }
  }, () => {});
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(2));

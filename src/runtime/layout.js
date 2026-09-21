// Container layout: the fixed, installation-owned templates for the app and worker
// containers. Pure functions from validated config + request to `docker` argv, so the
// mount contract is reviewable and unit-tested without Docker.
import path from "node:path";
import { RuntimeError, assertId, assertHarness, assertModel, isInside } from "./validate.js";
import { releaseIdentity, validateManifest } from "./manifest.js";

// Stable in-container paths. The app and the worker see project files at the same
// paths, so a path the agent reports is a path the app can validate.
export const DATA_MOUNT = "/storybench/data";
export const SESSION_MOUNT = "/storybench/session";
export const WORKER_REQUEST_MOUNT = "/run/storybench/request";
export const APP_REQUESTS_MOUNT = "/run/storybench/requests";
export const APP_CONTROL_MOUNT = "/run/storybench/control";
export const CONTROL_SOCKET_NAME = "control.sock";
export const HARNESS_SOCKET = `${WORKER_REQUEST_MOUNT}/worker/harness.sock`;
export const BRIDGE_SOCKET_NAME = "bridge.sock";

// Top-level data-root entries that are project material: channel-owned trees plus the
// legacy adopted-episode, legacy media and legacy branding roots (read-only reference
// material for older projects). Everything else in the data root (storybench.sqlite and
// its sidecars, backups, cache, imports — the app-only staging area) is never mounted
// into workers, and the data root itself is not mounted.
export const PROJECT_ROOTS = Object.freeze(["channels", "episodes", "media", "branding"]);

export const LABEL = Object.freeze({
  install: "io.storybench.install",
  role: "io.storybench.role",
  request: "io.storybench.request",
  harness: "io.storybench.harness",
});

export const CREDENTIAL_TARGETS = Object.freeze({
  codex: `${SESSION_MOUNT}/codex/auth.json`,
  claude: `${SESSION_MOUNT}/claude/.credentials.json`,
});

const IMAGE_ID = /^sha256:[0-9a-f]{64}$/;

export function validateHostConfig(input) {
  if (!input || typeof input !== "object") throw new RuntimeError("INVALID_CONFIG", "Host config must be an object");
  const absolute = (value, field) => {
    if (typeof value !== "string" || !path.isAbsolute(value) || path.normalize(value) !== value || (value.length > 1 && value.endsWith("/")) || /[,\0\n]/.test(value))
      throw new RuntimeError("INVALID_CONFIG", `${field} must be a normalized absolute path without commas`);
    return value;
  };
  const config = {
    installId: assertId(input.installId, "installId"),
    dataRoot: absolute(input.dataRoot, "dataRoot"),
    stateRoot: absolute(input.stateRoot, "stateRoot"),
    runtimeRoot: absolute(input.runtimeRoot, "runtimeRoot"),
    port: Number(input.port),
    images: {},
    credentials: {},
    manifest: null,
    codexModel: input.codexModel == null ? null : assertModel(input.codexModel),
    healthTimeoutMs: Number(input.healthTimeoutMs ?? 30_000),
    appStopTimeoutS: Number(input.appStopTimeoutS ?? 30),
  };
  if (!Number.isInteger(config.appStopTimeoutS) || config.appStopTimeoutS < 1 || config.appStopTimeoutS > 300) throw new RuntimeError("INVALID_CONFIG", "appStopTimeoutS must be 1-300");
  if (!Number.isInteger(config.port) || config.port < 1024 || config.port > 65535) throw new RuntimeError("INVALID_CONFIG", "port must be 1024-65535");
  // A release manifest is the image identity; bare `images` are accepted for development only.
  if (input.manifest) {
    try { config.manifest = validateManifest(input.manifest); }
    catch (error) { throw new RuntimeError("INVALID_CONFIG", error.message); }
    if (input.images) throw new RuntimeError("INVALID_CONFIG", "Give either a release manifest or images, not both");
  }
  for (const role of ["app", "worker"]) {
    const image = config.manifest ? config.manifest.images[role].id : input.images?.[role];
    if (typeof image !== "string" || !IMAGE_ID.test(image)) throw new RuntimeError("INVALID_CONFIG", `images.${role} must be an exact sha256 image ID`);
    config.images[role] = image;
  }
  for (const harness of ["codex", "claude"]) config.credentials[harness] = absolute(input.credentials?.[harness], `credentials.${harness}`);
  for (const [a, b] of [["dataRoot", "stateRoot"], ["dataRoot", "runtimeRoot"], ["stateRoot", "runtimeRoot"]]) {
    if (config[a] === config[b] || isInside(config[a], config[b]) || isInside(config[b], config[a]))
      throw new RuntimeError("INVALID_CONFIG", `${a} and ${b} must be separate, non-nested directories`);
  }
  return config;
}

export const names = (installId) => ({
  app: `storybench-${installId}-app`,
  worker: (requestId) => `storybench-${installId}-worker-${requestId}`,
  appNetwork: `storybench-${installId}-app`,
  workerNetwork: `storybench-${installId}-worker`,
});

export const hostPaths = (config) => ({
  controlDir: path.join(config.runtimeRoot, "control"),
  controlSocket: path.join(config.runtimeRoot, "control", CONTROL_SOCKET_NAME),
  requestsDir: path.join(config.runtimeRoot, "requests"),
  requestDir: (requestId) => path.join(config.runtimeRoot, "requests", assertId(requestId, "requestId")),
  // Credential staging is host-only: never under requestsDir (which the app mounts).
  credentialDir: (requestId) => path.join(config.runtimeRoot, "credentials", assertId(requestId, "requestId")),
  sessionDir: (harness, segmentId) => path.join(config.stateRoot, "harnesses", assertHarness(harness), assertId(segmentId, "segmentId")),
});

const bind = (source, target, { readonly = false } = {}) =>
  ["--mount", `type=bind,source=${source},target=${target}${readonly ? ",readonly" : ""}`];

const hardening = ["--user", "0:0", "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--init"];

export function appRunArgs(config) {
  const n = names(config.installId);
  const p = hostPaths(config);
  return [
    "run", "--detach", "--name", n.app,
    "--label", `${LABEL.install}=${config.installId}`, "--label", `${LABEL.role}=app`,
    ...hardening,
    "--network", n.appNetwork,
    // Publish only on host loopback; the app binds its container interface for it.
    "--publish", `127.0.0.1:${config.port}:${config.port}`,
    "--env", "STORYBENCH_BIND_HOST=0.0.0.0",
    "--env", `STORYBENCH_RUNTIME_CONTROL=${APP_CONTROL_MOUNT}/${CONTROL_SOCKET_NAME}`,
    "--env", `STORYBENCH_RUNTIME_REQUESTS=${APP_REQUESTS_MOUNT}`,
    ...(config.manifest ? ["--env", `STORYBENCH_RELEASE=${JSON.stringify(releaseIdentity(config.manifest))}`] : []),
    ...(config.codexModel ? ["--env", `STORYBENCH_CODEX_MODEL=${config.codexModel}`] : []),
    ...bind(config.dataRoot, DATA_MOUNT),
    ...bind(p.controlDir, APP_CONTROL_MOUNT),
    ...bind(p.requestsDir, APP_REQUESTS_MOUNT),
    config.images.app,
    "node", "src/server.js", "--data-root", DATA_MOUNT, "--port", String(config.port),
  ];
}

// `presentRoots` lists the PROJECT_ROOTS that exist in the data root (checked by the host).
export function workerRunArgs(config, request, { presentRoots, credentialFile }) {
  const n = names(config.installId);
  const p = hostPaths(config);
  const harness = assertHarness(request.harness);
  const episodeTarget = `${DATA_MOUNT}/${request.episode.relative}`;
  const roots = PROJECT_ROOTS.filter((root) => presentRoots.includes(root));
  if (!roots.includes(request.episode.relative.split("/")[0])) throw new RuntimeError("EPISODE_MISSING", "Episode project root is not present");
  return [
    "run", "--detach", "--name", n.worker(request.requestId),
    "--label", `${LABEL.install}=${config.installId}`, "--label", `${LABEL.role}=worker`,
    "--label", `${LABEL.request}=${request.requestId}`, "--label", `${LABEL.harness}=${harness}`,
    ...hardening,
    "--read-only", "--tmpfs", "/tmp:exec,mode=1777", "--tmpfs", "/storybench/home:exec,mode=0700",
    "--pids-limit", "1024",
    "--network", n.workerNetwork,
    "--workdir", episodeTarget,
    "--env", `STORYBENCH_REQUEST_ID=${request.requestId}`,
    "--env", `STORYBENCH_HARNESS=${harness}`,
    // Project trees: read-only for browsing across episodes/channels.
    ...roots.flatMap((root) => bind(path.join(config.dataRoot, root), `${DATA_MOUNT}/${root}`, { readonly: true })),
    // Current episode work: writable, nested over the read-only project mount.
    ...bind(path.join(config.dataRoot, request.episode.work), `${DATA_MOUNT}/${request.episode.work}`),
    // App-owned native session state for this harness and conversation segment.
    ...bind(p.sessionDir(harness, request.segmentId), `${SESSION_MOUNT}/${harness}`),
    // Exactly one per-request credential copy, freshly staged from the host login.
    ...bind(credentialFile, CREDENTIAL_TARGETS[harness]),
    // Request channel: the app's bridge socket (read-only) and the worker's harness socket.
    ...bind(path.join(p.requestDir(request.requestId), "app"), `${WORKER_REQUEST_MOUNT}/app`, { readonly: true }),
    ...bind(path.join(p.requestDir(request.requestId), "worker"), `${WORKER_REQUEST_MOUNT}/worker`),
    config.images.worker,
    "node", "/opt/storybench/app/src/runtime/worker/agent.mjs",
  ];
}

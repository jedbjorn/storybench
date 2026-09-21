// Lifecycle commands over the generated user unit (spec #10 "CLI Contract", "Health and Lifecycle").
// systemd is the single supervisor; these commands only ask it to start/stop and then verify /api/health against
// the expected release (manifest) and data-root identity within a bounded time.
import { accessSync, closeSync, constants, existsSync, fsyncSync, mkdirSync, openSync, renameSync, writeSync } from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { readReleaseManifest } from "../runtime/manifest.js";
import { DEFAULT_PORT, readConfig, validatePort, writeConfigAtomic } from "./config.js";
import { CliError, EXIT } from "./errors.js";
import { withLock } from "./lock.js";
import { PACKAGE_ROOT, manifestFile } from "./release.js";
import { activeWork, probeService, requestJson, serviceStatus } from "./service.js";
import { generateUnit, unitName, writeUnitAtomic } from "./unit.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const APP_STOP_TIMEOUT_S = 30;

export function lifecyclePaths(context, config) {
  const runtimeDir = context.env.XDG_RUNTIME_DIR && path.isAbsolute(context.env.XDG_RUNTIME_DIR) ? path.resolve(context.env.XDG_RUNTIME_DIR) : null;
  const unit = unitName(context.env);
  const unitDir = context.env.STORYBENCH_UNIT_DIR ? path.resolve(context.env.STORYBENCH_UNIT_DIR) : path.join(path.dirname(context.xdg.config), "systemd", "user");
  return {
    unit,
    unitFile: path.join(unitDir, unit),
    hostConfig: path.join(context.xdg.state, `host-${unit.replace(/\.service$/, "")}.json`),
    stateRoot: context.xdg.state,
    runtimeRoot: runtimeDir && config?.installId ? path.join(runtimeDir, "storybench", `host-${config.installId}`) : null,
  };
}

async function expectedRelease(context) {
  const file = manifestFile({ env: context.env });
  if (!existsSync(file)) throw new CliError("No release manifest is installed for this Storybench", {
    hint: `Install a release, or for a development checkout build one: node src/runtime/release.js build --out ${file}` });
  const result = await readReleaseManifest(file);
  if (!result.ok) throw new CliError(`The release manifest cannot be used: ${result.reason}`);
  return { file, manifest: result.manifest, identity: result.identity };
}

// A minimal PATH for the unit: where `docker` and Node live, plus the standard system directories. The caller's
// full shell PATH is not copied into the unit.
export function servicePath(callerPath = "", node = process.execPath) {
  const standard = ["/usr/local/bin", "/usr/bin", "/bin"];
  const dockerDir = String(callerPath).split(":").filter((dir) => path.isAbsolute(dir)).find((dir) => {
    try { accessSync(path.join(dir, "docker"), constants.X_OK); return true; } catch { return false; }
  });
  const extra = [dockerDir, path.dirname(node)].filter((dir) => dir && !standard.includes(dir));
  return [...new Set([...extra, ...standard])].join(":");
}

const urlFor = (port, channelId = null) => `http://127.0.0.1:${port}/${channelId ? `?channel=${encodeURIComponent(channelId)}` : ""}`;

// Refuse while any Storybench serves this installation: the unit is active, or a Storybench app answers on the
// configured port or the default port (for example a manually started prototype). Used by adopt, later backup.
export async function assertServiceStopped(context, config, action) {
  const unit = unitName(context.env);
  try {
    const state = await context.system.unitState(unit);
    if (["active", "activating", "reloading", "deactivating"].includes(state.active))
      throw new CliError(`The Storybench service (${unit}) is ${state.active}`, { hint: `Run \`storybench down\` before ${action}.` });
  } catch (error) { if (error instanceof CliError) throw error; }
  for (const port of new Set([config?.port ?? DEFAULT_PORT, DEFAULT_PORT])) {
    const answer = await context.probeService(port);
    if (answer.state === "running") throw new CliError(`A Storybench server is answering on port ${port}`, { hint: `Stop it before ${action}.` });
  }
}

async function waitForHealth(context, { unit, port, identity, dataRootId, timeoutMs }) {
  const deadline = Date.now() + timeoutMs;
  let last;
  for (;;) {
    last = await serviceStatus({ system: context.system, unit, port, identity, dataRootId, probe: context.probeService });
    if (last.state === "healthy") return last;
    if (last.state === "failed" || (last.unit.active === "inactive" && Date.now() > deadline - timeoutMs + 3000))
      throw new CliError(`The Storybench service did not start (${last.unit.active}${last.unit.result && last.unit.result !== "success" ? `, ${last.unit.result}` : ""})`, { hint: "See `storybench logs`." });
    if (last.state === "mismatched") throw new CliError(`The service started but ${last.problems.join("; ")}`, { hint: "See `storybench status`." });
    if (Date.now() >= deadline) throw new CliError(`The service did not become healthy within ${Math.round(timeoutMs / 1000)} s (${last.state})`, { hint: "See `storybench status` and `storybench logs`." });
    await sleep(context.pollMs ?? 500);
  }
}

// Writes the host configuration and the unit for the current release; returns what to expect from health.
async function prepareService(context, config) {
  const release = await expectedRelease(context);
  const paths = lifecyclePaths(context, config);
  if (!paths.runtimeRoot) throw new CliError("A systemd user session is required ($XDG_RUNTIME_DIR is not set)", { hint: "Run Storybench from a normal login session." });
  const home = context.home;
  const hostConfig = {
    installId: config.installId, dataRoot: config.dataRoot, stateRoot: paths.stateRoot, runtimeRoot: paths.runtimeRoot, port: config.port,
    manifestPath: release.file,
    credentials: { codex: config.credentials?.codex ?? path.join(home, ".codex", "auth.json"), claude: config.credentials?.claude ?? path.join(home, ".claude", ".credentials.json") },
    appStopTimeoutS: APP_STOP_TIMEOUT_S, healthTimeoutMs: 120_000,
  };
  writeConfigFile(paths.hostConfig, hostConfig);
  const environment = { PATH: servicePath(context.env.PATH, context.nodePath ?? process.execPath) };
  for (const key of ["DOCKER_HOST", "DOCKER_CONTEXT"]) if (context.env[key]) environment[key] = context.env[key];
  const content = generateUnit({ node: context.nodePath ?? process.execPath, hostEntry: path.join(PACKAGE_ROOT, "src", "runtime", "host.js"),
    hostConfig: paths.hostConfig, workingDirectory: PACKAGE_ROOT, stopTimeoutS: APP_STOP_TIMEOUT_S + 60, environment });
  if (writeUnitAtomic(paths.unitFile, content)) {
    const reload = await context.system.daemonReload();
    if (reload.code !== 0) throw new CliError("The systemd user manager could not reload units", { hint: reload.stderr.trim().split("\n")[0] || "Check `systemctl --user status`." });
  }
  return { release, paths };
}

function writeConfigFile(file, value) {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  const descriptor = openSync(temporary, "wx", 0o600);
  try { writeSync(descriptor, `${JSON.stringify(value, null, 2)}\n`); fsyncSync(descriptor); } finally { closeSync(descriptor); }
  renameSync(temporary, file);
}

async function startAndVerify(context, config, { release, paths }) {
  const state = await context.system.unitState(paths.unit).catch(() => ({ active: "unknown" }));
  if (state.active === "failed") await context.system.resetFailed(paths.unit);
  const started = await context.system.start(paths.unit);
  if (started.code !== 0) throw new CliError(`systemd could not start ${paths.unit}`, { hint: started.stderr.trim().split("\n")[0] || "See `storybench logs`." });
  return waitForHealth(context, { unit: paths.unit, port: config.port, identity: release.identity, dataRootId: config.dataRootId, timeoutMs: context.healthTimeoutMs });
}

export async function runUp(context, { options }, configuredRoot) {
  const port = options.port === undefined ? null : validatePort(options.port);
  if (port !== null && port < 1024) throw new CliError("The port must be from 1024 to 65535", { exitCode: EXIT.USAGE });
  let config = configuredRoot(context);
  return withLock(context.xdg.lockDir, "up", async () => {
    const unit = unitName(context.env);
    const release = await expectedRelease(context);
    const current = await serviceStatus({ system: context.system, unit, port: config.port, identity: release.identity, dataRootId: config.dataRootId, probe: context.probeService });
    if (["healthy", "starting", "mismatched", "stopping"].includes(current.state) || current.unit.active === "active") {
      if (port !== null && port !== config.port) throw new CliError(`Storybench is running on port ${config.port}`, { hint: "Run `storybench down`, then `storybench up --port N`." });
      if (current.state === "healthy") {
        context.out(`Storybench is already running: ${urlFor(config.port)}`);
        if (options.open) await openUrl(context, config);
        return EXIT.OK;
      }
      if (current.state === "mismatched") throw new CliError(`Storybench is running but ${current.problems.join("; ")}`, { hint: "Run `storybench restart` to serve the configured release and data root." });
    }
    const target = port ?? config.port;
    if (current.unit.active !== "active") {
      const listener = await context.probeService(target);
      if (listener.state === "running") throw new CliError(`Another Storybench server (not ${unit}) answers on port ${target}`, { hint: "Stop it, or choose another port with `storybench up --port N`." });
      if (listener.state === "other" || listener.state === "unreachable") throw new CliError(`Port ${target} is already in use by another program`, { hint: "Free it, or choose another port with `storybench up --port N`." });
    }
    if (port !== null || !config.installId) {
      config = { ...readConfig(context.xdg.configFile), port: target, installId: config.installId ?? `sb${crypto.randomBytes(5).toString("hex")}` };
      writeConfigAtomic(context.xdg.configFile, config);
    }
    const prepared = await prepareService(context, config);
    const status = await startAndVerify(context, config, prepared);
    context.out(`Storybench is running: ${urlFor(config.port)}\nRelease ${status.health.release.manifestId} (commit ${status.health.release.commit}); data root ${status.health.database.id}.`);
    if (options.open) await openUrl(context, config);
    return EXIT.OK;
  }, { timeoutMs: context.lockTimeoutMs });
}

export async function runDown(context, _parsed, configuredRoot) {
  const config = configuredRoot(context);
  return withLock(context.xdg.lockDir, "down", async () => {
    const unit = unitName(context.env);
    const state = await context.system.unitState(unit);
    if (!["active", "activating", "reloading", "deactivating", "failed"].includes(state.active)) { context.out("Storybench is already stopped."); return EXIT.OK; }
    const stopped = await context.system.stop(unit, (APP_STOP_TIMEOUT_S + 90) * 1000);
    if (stopped.code !== 0) throw new CliError(`systemd could not stop ${unit}`, { hint: stopped.stderr.trim().split("\n")[0] || "See `storybench logs`." });
    if (state.active === "failed") await context.system.resetFailed(unit);
    const after = await context.system.unitState(unit);
    if (["active", "deactivating"].includes(after.active)) throw new CliError(`${unit} is still ${after.active}`, { hint: "See `storybench logs`." });
    const answer = await context.probeService(config.port);
    if (answer.state === "running") throw new CliError(`The unit stopped but a Storybench server still answers on port ${config.port}`, { hint: "Another copy may be running outside the service." });
    context.out("Storybench stopped. Channels, episodes and the default channel are unchanged.");
    return EXIT.OK;
  }, { timeoutMs: context.lockTimeoutMs });
}

export async function runRestart(context, { options }, configuredRoot) {
  const config = configuredRoot(context);
  return withLock(context.xdg.lockDir, options.force ? "restart --force" : "restart", async () => {
    const unit = unitName(context.env);
    const release = await expectedRelease(context);
    const before = await serviceStatus({ system: context.system, unit, port: config.port, identity: release.identity, dataRootId: config.dataRootId, probe: context.probeService });
    if (before.health) {
      const work = activeWork(before.health);
      if (work.busy && !options.force) throw new CliError(`Storybench is busy: ${work.renders} render job(s) and ${work.agents} agent turn(s) are active across all channels`, {
        hint: "Wait for them to finish, or run `storybench restart --force` to interrupt them (interrupted work is not replayed)." });
    }
    if (before.unit.active !== "inactive" && before.unit.active !== "unknown") {
      const stopped = await context.system.stop(unit, (APP_STOP_TIMEOUT_S + 90) * 1000);
      if (stopped.code !== 0) throw new CliError(`systemd could not stop ${unit}`, { hint: "See `storybench logs`." });
    }
    const prepared = await prepareService(context, config);
    const status = await startAndVerify(context, config, prepared);
    const previous = before.health?.release?.manifestId;
    context.out(`Storybench restarted: ${urlFor(config.port)}\nRelease ${status.health.release.manifestId}${previous && previous !== status.health.release.manifestId ? ` (was ${previous}; the installed release changed)` : " (same release)"}; data root ${status.health.database.id} (same as configured).`);
    return EXIT.OK;
  }, { timeoutMs: context.lockTimeoutMs });
}

async function defaultChannel(port) {
  try { return (await requestJson(port, "/api/channels/default")).json?.channel ?? null; } catch { return null; }
}

async function openUrl(context, config) {
  const url = urlFor(config.port, (await defaultChannel(config.port))?.id);
  await context.system.open(url);
  context.out(`Opened ${url}`);
}

export async function runOpen(context, _parsed, configuredRoot) {
  const config = configuredRoot(context);
  const unit = unitName(context.env);
  const status = await serviceStatus({ system: context.system, unit, port: config.port, dataRootId: config.dataRootId, probe: context.probeService });
  if (status.state !== "healthy") throw new CliError(`Storybench is not running (${status.state})`, { hint: "Start it with `storybench up` (or `storybench up --open`)." });
  await openUrl(context, config);
  return EXIT.OK;
}

export async function runStatus(context, _parsed, configuredRoot) {
  const config = configuredRoot(context);
  const unit = unitName(context.env);
  let release = null;
  try { release = await expectedRelease(context); } catch (error) { release = { error: error.message }; }
  const status = await serviceStatus({ system: context.system, unit, port: config.port, identity: release.identity ?? null, dataRootId: config.dataRootId, probe: context.probeService });
  const lines = [`Status: ${status.state}`, `Unit: ${unit} (${status.unit.load ?? "unknown"}, ${status.unit.active ?? "unknown"}${status.unit.sub ? `/${status.unit.sub}` : ""})`];
  if (status.unit.pid) lines.push(`Process: host PID ${status.unit.pid}${status.unit.startedAt ? ` since ${status.unit.startedAt}` : ""}`);
  if (config.installId) {
    const containers = await context.system.containers(config.installId).catch(() => null);
    if (containers) lines.push(`Containers: ${containers.length ? containers.map((container) => `${container.role} ${container.id.slice(0, 12)}`).join(", ") : "none"}`);
  }
  const channel = status.health ? await defaultChannel(config.port) : null;
  lines.push(`URL: ${urlFor(config.port, channel?.id)}${status.state === "healthy" ? "" : " (not serving)"}`);
  lines.push(`Release expected: ${release.identity ? `${release.identity.manifestId} (version ${release.identity.version}, commit ${release.identity.commit})` : release.error}`);
  if (status.health) {
    const served = status.health.release || {};
    lines.push(`Release served: ${served.manifestId ?? "(none)"} (version ${served.version ?? status.health.package?.version ?? "?"}, commit ${served.commit ?? "?"})`);
    const work = activeWork(status.health);
    lines.push(`Activity: ${work.renders} render job(s), ${work.agents} agent turn(s) across all channels`);
    lines.push(`Database: schema ${status.health.schema.current} (supported ${status.health.schema.supported.min}-${status.health.schema.supported.max})`);
  }
  lines.push(`Data root: configured ${config.dataRootId ?? "(unknown)"}${status.health ? `, served ${status.health.database?.id ?? "(unknown)"}` : ""}`);
  if (channel) lines.push(`Default channel: ${channel.name} (${channel.id})`);
  for (const problem of status.problems) lines.push(`Mismatch: ${problem}`);
  if (status.unit.active !== "active" && status.answer.state === "running") lines.push(`Note: a Storybench server not managed by ${unit} answers on port ${config.port}`);
  if (status.state === "failed") lines.push("Hint: see `storybench logs`, then `storybench up`.");
  context.out(lines.join("\n"));
  return EXIT.OK;
}

export async function runLogs(context, { options }, configuredRoot) {
  configuredRoot(context);
  const unit = unitName(context.env);
  const child = context.system.journal(unit, { follow: Boolean(options.follow) });
  const code = await new Promise((resolve) => { child.on("close", (value) => resolve(value ?? 0)); child.on("error", () => resolve(1)); });
  return code === 0 ? EXIT.OK : EXIT.FAILED;
}

export { probeService };

// Where channel operations run. selectExecutor is the single switch point:
//   - the service is healthy for this data root -> the running app's shared operations (/api/channels);
//   - an installed service is stopped -> the selected release's exact app image, under the lifecycle lock;
//   - a development checkout with no installed release -> host Node, explicitly, under the same lock.
import { createChannel, getDefaultChannel, listChannels, useChannel } from "../services/channels.js";
import { inspectDataRoot, withDataRoot } from "../services/data-root.js";
import { SCHEMA_VERSION } from "../store.js";
import { CliError } from "./errors.js";
import { assertOwnedWritable, mountPath } from "./fs-safety.js";
import { installedOrConfiguredId } from "./installation.js";
import { withLock } from "./lock.js";
import { installedRelease } from "./release.js";
import { requestJson } from "./service.js";
import { runCommand as hostRunCommand } from "./system.js";

const DATA_IMAGE_SCHEMA = "storybench.data-command/1";
const DATA_IMAGE_ROOT = "/storybench/data";
const IMAGE_OPERATIONS = new Set(["init", "adopt", "channel-create", "channel-list", "channel-current", "channel-use"]);

function firstLine(value) { return String(value || "").trim().split("\n")[0]; }

// Offline commands never migrate a database: opening an older schema would upgrade it as a side effect.
export function assertCurrentSchema(info, dataRoot) {
  if (info.state === "newer" || (Number.isInteger(info.schemaVersion) && info.schemaVersion > SCHEMA_VERSION))
    throw new CliError(`The data root at ${dataRoot} uses database schema ${info.schemaVersion}, newer than this Storybench release supports (${SCHEMA_VERSION})`, {
      hint: "Use the Storybench release that last opened it, or a newer one." });
  if (Number.isInteger(info.schemaVersion) && info.schemaVersion < SCHEMA_VERSION)
    throw new CliError(`The data root at ${dataRoot} uses database schema ${info.schemaVersion}; this release uses schema ${SCHEMA_VERSION}`, {
      hint: `Upgrade it deliberately with \`storybench init ${dataRoot} --adopt\` while Storybench is stopped (a metadata backup is taken first).` });
}

export function offlineExecutor({ dataRoot, lockDir, lockTimeoutMs }) {
  const run = (operation, fn) => withLock(lockDir, operation, () => {
    assertCurrentSchema(inspectDataRoot(dataRoot), dataRoot);
    return withDataRoot(dataRoot, fn, { startup: false });
  }, { timeoutMs: lockTimeoutMs });
  return {
    kind: "offline",
    createChannel: (name) => run("channel create", (store) => createChannel(store, name)),
    listChannels: () => run("channel list", (store) => listChannels(store)),
    currentChannel: () => run("channel current", (store) => getDefaultChannel(store)),
    useChannel: (nameOrId) => run("channel use", (store) => useChannel(store, nameOrId)),
  };
}

// Run one shared data service in the selected app image. The caller decides lock scope so init/adopt can keep their
// host-side identity checks and the image operation in one lifecycle lock; appImageExecutor locks channel calls.
export async function runImageDataCommand(context, release, operation, args = []) {
  if (!IMAGE_OPERATIONS.has(operation)) throw new CliError(`Unknown image data operation: ${operation}`);
  assertOwnedWritable(context.dataRoot, "the data root");
  const installId = context.installId ?? (context.xdg ? installedOrConfiguredId(context.xdg) : null);
  const labels = installId ? ["--label", `io.storybench.install=${installId}`, "--label", "io.storybench.role=data-command"] : [];
  const command = context.runCommand ?? hostRunCommand;
  const result = await command("docker", [
    "run", "--rm", "--network", "none", "--user", "0:0", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
    ...labels,
    "--mount", `type=bind,source=${mountPath(context.dataRoot, "The data root")},target=${DATA_IMAGE_ROOT}`,
    release.manifest.images.app.id, "node", "src/cli/data-image.js", operation, ...args,
  ], { timeoutMs: 120_000 });
  let envelope = null;
  try { envelope = JSON.parse(result.stdout); } catch { /* mapped below without exposing arbitrary container output */ }
  if (envelope?.schema === DATA_IMAGE_SCHEMA && envelope.ok === true && result.code === 0) return envelope.result;
  if (envelope?.schema === DATA_IMAGE_SCHEMA && envelope.ok === false && typeof envelope.error?.message === "string") {
    const error = new CliError(envelope.error.message, {
      exitCode: Number.isInteger(envelope.error.exitCode) ? envelope.error.exitCode : undefined,
      hint: typeof envelope.error.hint === "string" ? envelope.error.hint : null,
    });
    if (Number.isInteger(envelope.error.statusCode)) error.statusCode = envelope.error.statusCode;
    throw error;
  }
  if (result.code !== 0) throw new CliError(`The selected app image could not run ${operation}: ${firstLine(result.stderr) || `exit ${result.code}`}`);
  throw new CliError(`The selected app image returned an invalid ${operation} result`);
}

export function appImageExecutor(context, release) {
  const run = (operation, imageOperation, args = []) => withLock(context.lockDir, operation,
    () => runImageDataCommand(context, release, imageOperation, args), { timeoutMs: context.lockTimeoutMs });
  return {
    kind: "app-image",
    release,
    createChannel: (name) => run("channel create", "channel-create", [name]),
    listChannels: () => run("channel list", "channel-list"),
    currentChannel: () => run("channel current", "channel-current"),
    useChannel: (nameOrId) => run("channel use", "channel-use", [nameOrId]),
  };
}

// The running app owns the database while it serves it; channel changes go through its routes (shared app
// transactions). Nothing here restarts the service or touches running work.
export function runningAppExecutor({ port }) {
  const call = async (method, pathName, body) => {
    let response;
    try { response = await requestJson(port, pathName, { method, body, timeoutMs: 10_000 }); }
    catch (error) { throw new CliError(`The running Storybench service did not answer (${error.code || error.message})`, { hint: "Check `storybench status`." }); }
    if (response.status >= 200 && response.status < 300) return response.json;
    const message = response.json?.error || `The running service refused the request (HTTP ${response.status})`;
    throw Object.assign(new CliError(message), { statusCode: response.status });
  };
  const find = async (nameOrId) => {
    const { channels } = await call("GET", "/api/channels");
    const key = String(nameOrId).normalize("NFKC").toLowerCase();
    return channels.find((channel) => channel.id === nameOrId) || channels.find((channel) => channel.name.normalize("NFKC").toLowerCase() === key) || null;
  };
  return {
    kind: "running-app",
    createChannel: (name) => call("POST", "/api/channels", { name }),
    listChannels: () => call("GET", "/api/channels"),
    currentChannel: async () => (await call("GET", "/api/channels/default")).channel,
    useChannel: async (nameOrId) => {
      const channel = await find(nameOrId);
      if (!channel) throw Object.assign(new CliError(`Unknown channel: ${nameOrId}`, { hint: "Run `storybench channel list` to see channel names and IDs." }), { statusCode: 404 });
      return call("PUT", "/api/channels/default", { channel: channel.id });
    },
  };
}

export const SERVICE_BUSY_STATES = Object.freeze(["active", "activating", "reloading", "deactivating"]);

// context: { dataRoot, dataRootId, lockDir, lockTimeoutMs, port, probeService, system, unit, xdg, runCommand }.
// A stopped installed service uses its exact app image. Host Node is only the development-checkout fallback. While
// systemd is starting, restarting or stopping the service, the app owns the database even if it does not answer yet.
export async function selectExecutor(context) {
  const answer = context.probeService ? await context.probeService(context.port) : { state: "stopped" };
  if (answer.state === "running") {
    if (context.dataRootId && answer.dataRootId && answer.dataRootId !== context.dataRootId)
      throw new CliError(`The Storybench service on port ${context.port} serves a different data root than the configured one`, { hint: "Check `storybench status`." });
    return runningAppExecutor(context);
  }
  if (context.system && context.unit) {
    let state;
    try { state = await context.system.unitState(context.unit); }
    catch (error) { throw new CliError(`Cannot determine whether the Storybench service is running (${error.message})`, { hint: "Check `systemctl --user status`." }); }
    if (SERVICE_BUSY_STATES.includes(state.active))
      throw new CliError(`The Storybench service is ${state.active}${state.sub && state.sub !== state.active ? ` (${state.sub})` : ""} but its app is not answering`, {
        hint: "Retry in a moment, or run `storybench down` to manage channels offline." });
  }
  const release = await installedRelease(context);
  return release ? appImageExecutor(context, release) : offlineExecutor(context);
}

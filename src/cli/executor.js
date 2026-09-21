// Where channel operations run. selectExecutor is the single switch point:
//   - the service is healthy for this data root -> the running app's shared operations (/api/channels);
//   - otherwise -> offline: the shared services against the data root with startup:false, under the lifecycle lock.
// Task #16 adds "via the selected app image" for the stopped case behind this same interface.
import { createChannel, getDefaultChannel, listChannels, useChannel } from "../services/channels.js";
import { inspectDataRoot, withDataRoot } from "../services/data-root.js";
import { SCHEMA_VERSION } from "../store.js";
import { CliError } from "./errors.js";
import { withLock } from "./lock.js";
import { requestJson } from "./service.js";

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

// context: { dataRoot, dataRootId, lockDir, lockTimeoutMs, port, probeService }.
export async function selectExecutor(context) {
  const answer = context.probeService ? await context.probeService(context.port) : { state: "stopped" };
  if (answer.state === "running") {
    if (context.dataRootId && answer.dataRootId && answer.dataRootId !== context.dataRootId)
      throw new CliError(`The Storybench service on port ${context.port} serves a different data root than the configured one`, { hint: "Check `storybench status`." });
    return runningAppExecutor(context);
  }
  return offlineExecutor(context);
}

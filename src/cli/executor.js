// Where channel operations run. This build only has the offline executor: the shared services against the data root
// with startup:false, under the lifecycle lock. Tasks #15/#16 add "via the running app" and "via the app image"
// executors behind this same interface; selectExecutor is the single switch point and receives everything they need.
import { createChannel, getDefaultChannel, listChannels, useChannel } from "../services/channels.js";
import { inspectDataRoot, withDataRoot } from "../services/data-root.js";
import { SCHEMA_VERSION } from "../store.js";
import { CliError } from "./errors.js";
import { withLock } from "./lock.js";

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

// context: { dataRoot, lockDir, lockTimeoutMs, port, probeService }. A later build probes the service here and
// returns a running-app executor when Storybench is up; the commands do not change.
export async function selectExecutor(context) {
  return offlineExecutor(context);
}

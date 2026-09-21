// Where channel operations run. This build only has the offline executor: the shared services against the data root
// with startup:false, under the lifecycle lock. Tasks #15/#16 add "via the running app" and "via the app image"
// executors behind this same interface; selectExecutor is the single switch point.
import { createChannel, getDefaultChannel, listChannels, useChannel } from "../services/channels.js";
import { withDataRoot } from "../services/data-root.js";
import { withLock } from "./lock.js";

export function offlineExecutor({ dataRoot, lockDir, lockTimeoutMs }) {
  const run = (operation, fn) => withLock(lockDir, operation, () => withDataRoot(dataRoot, fn, { startup: false }), { timeoutMs: lockTimeoutMs });
  return {
    kind: "offline",
    createChannel: (name) => run("channel create", (store) => createChannel(store, name)),
    listChannels: () => run("channel list", (store) => listChannels(store)),
    currentChannel: () => run("channel current", (store) => getDefaultChannel(store)),
    useChannel: (nameOrId) => run("channel use", (store) => useChannel(store, nameOrId)),
  };
}

export async function selectExecutor(context) {
  return offlineExecutor(context);
}

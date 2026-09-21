// Shared channel services for the server and an offline CLI. Each function accepts either an open Store or a
// data-root path (opened, used and closed for that one call). Channels are database records in the one shared
// database; the default channel is only the navigation entry point and never a process or data boundary.
import { Store } from "../store.js";
import { withDataRoot } from "./data-root.js";

const run = (target, fn) => target instanceof Store ? fn(target) : withDataRoot(target, fn);

// Adds a channel record and its channels/<id>/{branding,media,episodes} directories. The first becomes the default.
export function createChannel(target, name) {
  return run(target, (store) => store.createChannel(name));
}

export function listChannels(target) {
  return run(target, (store) => ({ channels: store.listChannels(), defaultChannelId: store.getDefaultChannel()?.id ?? null }));
}

export function getDefaultChannel(target) {
  return run(target, (store) => store.getDefaultChannel());
}

// Persists the default navigation target only: no restart, no job cancellation, no change to open views.
export function useChannel(target, nameOrId) {
  return run(target, (store) => store.setDefaultChannel(nameOrId));
}

// Display names change; channel IDs and directories do not.
export function renameChannel(target, nameOrId, name) {
  return run(target, (store) => {
    const channel = store.findChannel(nameOrId);
    if (!channel) return store.requireChannel(nameOrId);
    return store.renameChannel(channel.id, name);
  });
}

export function listChannelEpisodes(target, channelId) {
  return run(target, (store) => store.listEpisodes({ channelId: store.requireChannel(channelId).id }));
}

export function createChannelEpisode(target, channelId, { title, notes } = {}) {
  return run(target, (store) => store.createEpisode({ title, notes, channelId: store.requireChannel(channelId).id }));
}

// App-side wiring of Codex and Claude production turns into the chat service.
// Each turn runs in a request-scoped worker with Storybench and runtime tools.
// Closing the connection stops the worker and its descendant commands.
import path from "node:path";
import { STORYBENCH_TOOLS } from "../codex.js";
import { controlRequest } from "./channel.js";
import { openWorkerRequest } from "./request.js";
import { segmentForConversation } from "./session-migrate.js";

// Until #26 adds per-harness segments, a conversation's Codex segment is the conversation.
export const defaultSegmentFor = segmentForConversation;

// Values for the episode boot template (agent/BOOT.md and skills). Every key is always
// present; what is not known at render time is a literal "unknown"/"not reported" rather than
// an omission. Returns a function of the request's served tools and work directory.
const NOT_REPORTED = "not reported";
const oneLine = (value, max = 300) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
export function defaultBootContextFor(store, { episodeId, conversationId = null, model, effort = null, harness = "codex", request = {} }) {
  const location = store.episodeLocation(episodeId);
  const episode = store.getEpisode(episodeId);
  const channel = store.getChannel?.(location.channelId) ?? null;
  const conversation = conversationId ? store.getConversation?.(conversationId) ?? null : null;
  let storyRevision = NOT_REPORTED;
  try { storyRevision = String(store.getStory(episodeId).storyRevision); } catch { /* no story yet */ }
  const media = location.legacy ? path.join(store.workspace, "media") : store.channelMediaDirectory(location.channelId);
  const requestText = typeof request.text === "string" && request.text.trim() ? request.text.trim().slice(0, 4000) : NOT_REPORTED;
  return ({ requestWorkDir = null, served = [], release = null } = {}) => ({
    channel: { id: location.channelId, name: oneLine(channel?.name) || "unknown", direction: oneLine(channel?.direction, 1000) || "unknown (no channel direction is recorded)" },
    episode: { id: episodeId, title: oneLine(episode?.title) || "unknown", notes: oneLine(episode?.notes, 2000) || "none recorded", state: episode?.state ?? "unknown", revision: String(episode?.revision ?? NOT_REPORTED) },
    story: { revision: storyRevision },
    request: { text: requestText, messageId: request.messageId != null ? String(request.messageId) : NOT_REPORTED, kind: request.kind ?? "chat", cardId: request.cardId ?? "none" },
    conversation: { id: conversationId ?? NOT_REPORTED, name: oneLine(conversation?.name) || NOT_REPORTED },
    paths: {
      projects: "`/storybench/data/channels` (all channels, their media and episodes); legacy `/storybench/data/episodes`, `/storybench/data/media` and `/storybench/data/branding` when present",
      requestWork: requestWorkDir ?? NOT_REPORTED,
      channel: location.legacy ? "unknown (legacy episode)" : path.dirname(path.dirname(location.directory)),
      media, branding: location.legacy ? path.join(store.workspace, "branding") : store.channelBrandingDirectory(location.channelId),
      outputs: path.dirname(store.episodeOutputDirectory(episodeId, "drafts")),
      story: path.join(location.directory, "story.md"),
    },
    runtime: {
      harness, model: model || "harness default", effort: effort || "native default",
      resolvedModel: "not reported until the session starts (ask get_capabilities or say unknown)",
      harnessVersion: release?.tools?.[harness] ?? "unknown",
      bootPhrase: "(none)", skillPhrase: "(none)",
    },
    tools: { served: served.length ? served.join(", ") : NOT_REPORTED },
  });
}

// One scoped tool set: runtime tools first, then the chat's app operations (JSON results).
export function mergeTools(runtimeTools, chatHandlers = {}) {
  const runtimeNames = new Set(runtimeTools.definitions.map((definition) => definition.name));
  const appDefinitions = STORYBENCH_TOOLS.filter((spec) => !runtimeNames.has(spec.name) && typeof chatHandlers[spec.name] === "function")
    .map(({ type, ...definition }) => definition);
  return {
    definitions: [...runtimeTools.definitions, ...appDefinitions],
    async call(name, args) {
      if (runtimeNames.has(name)) return runtimeTools.call(name, args);
      const handler = chatHandlers[name];
      if (typeof handler !== "function") throw Object.assign(new Error(`Unknown Storybench tool: ${String(name)}`), { code: "UNKNOWN_TOOL" });
      return { text: JSON.stringify(await handler(args ?? {})) };
    },
  };
}

// Worker-backed production turns for either harness. The chat passes the conversation's
// selected harness/model/effort and its native-session segment; each turn runs in its own
// request-scoped worker whose session directory is that segment's. Without a segment
// the conversation ID is the segment.
export function createWorkerHarnessFactory({ store, controlSocket, templates, segmentFor = defaultSegmentFor, bootContextFor = defaultBootContextFor, onRequest = () => {} }) {
  return async function workerHarnessFactory({ episodeId, conversationId, requestId, harness = "codex", model, effort = null, segmentId = null, request: turnRequest = {}, tools, onEvent, onError, onToolCall = () => {} }) {
    if (!episodeId || !conversationId || !requestId) throw new Error("Worker-backed turns need episode, conversation and request identity");
    if (!["codex", "claude"].includes(harness)) throw new Error(`Unsupported harness: ${harness}`);
    const request = await openWorkerRequest({
      controlSocket, store, requestId, conversationId, harness, segmentId: segmentId ?? segmentFor(conversationId), episodeId, templates,
      bootContext: bootContextFor(store, { episodeId, conversationId, model, effort, harness, request: turnRequest }), model,
      wrapTools: (runtimeTools) => mergeTools(runtimeTools, tools), onToolCall,
    });
    onRequest({ requestId, episodeId, conversationId, harness, containerId: request.started.containerId, render: request.render });
    let connection;
    try {
      connection = harness === "codex"
        ? await request.codex({ model, effort, onEvent, onError, requestTimeout: 60_000 })
        : await request.claudeConnection({ model, effort, onEvent, onError }).open();
    } catch (error) { await request.stop().catch(() => {}); throw error; }
    const close = connection.close.bind(connection);
    let stopping;
    connection.close = () => {
      close();
      stopping ||= request.stop().catch((error) => ({ error: error.message }));
      return stopping;
    };
    connection.harness = harness;
    connection.workerRequest = { requestId, containerId: request.started.containerId, stop: () => connection.close() };
    return connection;
  };
}

// App-side model catalogue backed by the host's harness.models control operation.
export function createModelCatalog({ controlSocket, request = controlRequest }) {
  return {
    async list({ refresh = false } = {}) {
      return Promise.all(["codex", "claude"].map((harness) => request(controlSocket, { op: "harness.models", harness, refresh })
        .catch((error) => ({ harness, available: false, reason: `Model discovery is unavailable: ${error.message}`, models: [] }))));
    },
  };
}

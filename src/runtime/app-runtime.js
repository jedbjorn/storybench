// App-side wiring of worker-backed production turns into the existing chat service.
// createWorkerCodexFactory() returns a drop-in `codexFactory` for createChatService: each
// Codex turn runs in its own request-scoped worker (started through the host control
// channel), with the chat's existing Storybench tools plus the runtime tools
// (register_work_file, inspect_image) served through one scoped tool set. Closing the
// connection stops the worker, which also terminates every descendant command.
//
// Seams for later lanes: `segmentFor` maps a conversation to its native-session segment
// (#26 adds per-harness segments and switching); `bootContextFor` supplies boot template
// values (#25); `harness` is fixed to Codex here (#26 adds the Claude adapter selection).
import { STORYBENCH_TOOLS } from "../codex.js";
import { controlRequest } from "./channel.js";
import { openWorkerRequest } from "./request.js";
import { segmentForConversation } from "./session-migrate.js";

// Until #26 adds per-harness segments, a conversation's Codex segment is the conversation.
export const defaultSegmentFor = segmentForConversation;

export function defaultBootContextFor(store, { episodeId, model, harness = "codex" }) {
  const location = store.episodeLocation(episodeId);
  return {
    channel: { id: location.channelId }, episode: { id: episodeId },
    paths: { projects: "`/storybench/data/channels` (all channels, their media and episodes); legacy `/storybench/data/episodes`, `/storybench/data/media` and `/storybench/data/branding` when present" },
    runtime: { harness, model: model || "harness default", bootPhrase: "(none)", skillPhrase: "(none)" },
  };
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
// (legacy single-Codex path) the conversation ID is the segment.
export function createWorkerHarnessFactory({ store, controlSocket, templates, segmentFor = defaultSegmentFor, bootContextFor = defaultBootContextFor, onRequest = () => {} }) {
  return async function workerHarnessFactory({ episodeId, conversationId, requestId, harness = "codex", model, effort = null, segmentId = null, tools, onEvent, onError }) {
    if (!episodeId || !conversationId || !requestId) throw new Error("Worker-backed turns need episode, conversation and request identity");
    if (!["codex", "claude"].includes(harness)) throw new Error(`Unsupported harness: ${harness}`);
    const request = await openWorkerRequest({
      controlSocket, store, requestId, conversationId, harness, segmentId: segmentId ?? segmentFor(conversationId), episodeId, templates,
      bootContext: bootContextFor(store, { episodeId, conversationId, model, harness }), model,
      wrapTools: (runtimeTools) => mergeTools(runtimeTools, tools),
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

// Backwards-compatible name used by the lifecycle foundation.
export const createWorkerCodexFactory = createWorkerHarnessFactory;

// App-side model catalogue backed by the host's harness.models control operation.
export function createModelCatalog({ controlSocket, request = controlRequest }) {
  return {
    async list({ refresh = false } = {}) {
      return Promise.all(["codex", "claude"].map((harness) => request(controlSocket, { op: "harness.models", harness, refresh })
        .catch((error) => ({ harness, available: false, reason: `Model discovery is unavailable: ${error.message}`, models: [] }))));
    },
  };
}

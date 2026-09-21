// App-side orchestration of one worker-backed production request (slice version; the
// lifecycle lane #22 and adapter lane #26 integrate this with chat/jobs):
//   render boot/skills -> ask the host for a worker -> bind scoped tools to a request
//   bridge -> connect a harness -> ... -> stop (container and descendants removed).
import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { renderEpisodeBoot } from "./boot.js";
import { startBridge } from "./bridge.js";
import { connectHarness, controlRequest } from "./channel.js";
import { ClaudeStreamSession, WorkerCodexConnection } from "./harnesses.js";
import { BRIDGE_SOCKET_NAME, DATA_MOUNT, WORKER_REQUEST_MOUNT } from "./layout.js";
import { createScopedTools } from "./tools.js";
import { RuntimeError, assertModel, assertSessionId, parseEpisodeDir } from "./validate.js";

export const MCP_BRIDGE_SCRIPT = "/opt/storybench/app/src/runtime/worker/mcp-bridge.mjs";

// Episode directory -> requestId holding its boot/skill renders. A render never replaces
// the instructions of another request that is still active on the same episode.
const activeRenders = new Map();
export const activeRenderHolder = (episodeDirectory) => activeRenders.get(episodeDirectory) ?? null;

// Claim an episode's renders for one request; returns the release function.
export function claimEpisodeRenders(directory, requestId) {
  const holder = activeRenders.get(directory);
  if (holder && holder !== requestId)
    throw new RuntimeError("EPISODE_BUSY", "Another request is active for this episode; its instructions are not replaced mid-turn", { status: 409 });
  activeRenders.set(directory, requestId);
  return () => { if (activeRenders.get(directory) === requestId) activeRenders.delete(directory); };
}

// store: the app's open Store. All paths come from its path API (episodeLocation,
// episodeWorkDirectory), for both channel-owned and legacy adopted episode layouts.
export async function openWorkerRequest(options) {
  const release = claimEpisodeRenders(options.store.episodeLocation(options.episodeId).directory, options.requestId);
  let request;
  try { request = await openHeldRequest(options); }
  catch (error) { release(); throw error; }
  const stop = request.stop;
  request.stop = async () => { try { return await stop(); } finally { release(); } };
  return request;
}

async function openHeldRequest({
  controlSocket, store, requestId, conversationId, harness, segmentId, episodeId,
  bootContext = {}, templates, onToolCall = () => {}, wrapTools = (tools) => tools,
}) {
  const dataRoot = store.workspace;
  // App and worker must see project files at identical paths so worker-reported paths
  // validate against store paths; the app container mounts its data root at DATA_MOUNT.
  if (path.resolve(dataRoot) !== DATA_MOUNT) throw new Error(`Worker requests require the app data root at ${DATA_MOUNT}`);
  store.ensureEpisodeDirectories(episodeId);
  const location = store.episodeLocation(episodeId);
  const episodeDir = parseEpisodeDir(path.relative(dataRoot, location.directory));
  const workRelative = path.relative(dataRoot, store.episodeWorkDirectory(episodeId));
  // Render before the worker starts so the harness never sees a half-written boot.
  const render = await renderEpisodeBoot({
    episodeDir: location.directory, templates,
    context: { ...bootContext, paths: { ...bootContext.paths, episode: location.directory, work: store.episodeWorkDirectory(episodeId) } },
  });
  const started = await controlRequest(controlSocket, { op: "worker.start", requestId, harness, segmentId, episodeDir: episodeDir.relative, workDir: workRelative });
  const scope = {
    requestId, conversationId, harness, channelId: location.channelId, episodeId,
    dataRoot, episodeDir: location.directory, workDir: store.episodeWorkDirectory(episodeId),
  };
  const tools = wrapTools(createScopedTools(scope, { store }));
  const token = randomBytes(32).toString("hex");
  let bridge;
  try {
    bridge = await startBridge({ socketPath: started.bridgeSocket, token, tools, onCall: onToolCall });
    const mcpConfig = { mcpServers: { storybench: { type: "stdio", command: "node", args: [MCP_BRIDGE_SCRIPT], env: {
      STORYBENCH_BRIDGE_SOCKET: `${WORKER_REQUEST_MOUNT}/app/${BRIDGE_SOCKET_NAME}`, STORYBENCH_BRIDGE_TOKEN: token,
    } } } };
    await writeFile(path.join(started.appRequestDir, "mcp.json"), JSON.stringify(mcpConfig), { mode: 0o600 });
  } catch (error) {
    await bridge?.close();
    await controlRequest(controlSocket, { op: "worker.stop", requestId }).catch(() => {});
    throw error;
  }

  return {
    started, render, scope, tools,
    async codex({ model, onEvent, onError, requestTimeout } = {}) {
      const child = await connectHarness(started.harnessSocket, { harness: "codex" });
      const connection = new WorkerCodexConnection({ child, tools, cwd: started.episodeDir, model: model ? assertModel(model) : undefined, onEvent, onError, requestTimeout });
      return connection.open();
    },
    async claude({ model, resume, onEvent } = {}) {
      const child = await connectHarness(started.harnessSocket, { harness: "claude", model: assertModel(model), ...(resume ? { resume: assertSessionId(resume) } : {}) });
      return new ClaudeStreamSession(child, { onEvent });
    },
    status: () => controlRequest(controlSocket, { op: "worker.status", requestId }),
    async stop() {
      await bridge.close().catch(() => {});
      return controlRequest(controlSocket, { op: "worker.stop", requestId });
    },
  };
}

// App-side orchestration of one worker-backed production request (slice version; the
// lifecycle lane #22 and adapter lane #26 integrate this with chat/jobs):
//   render boot/skills -> ask the host for a worker -> bind scoped tools to a request
//   bridge -> connect a harness -> ... -> stop (container and descendants removed).
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { renderEpisodeBoot } from "./boot.js";
import { startBridge } from "./bridge.js";
import { connectHarness, controlRequest } from "./channel.js";
import { ClaudeStreamSession, WorkerCodexConnection } from "./harnesses.js";
import { WORKER_REQUEST_MOUNT, BRIDGE_SOCKET_NAME } from "./layout.js";
import { createScopedTools } from "./tools.js";
import { assertModel, assertSessionId, parseEpisodeDir } from "./validate.js";

export const MCP_BRIDGE_SCRIPT = "/opt/storybench/app/src/runtime/worker/mcp-bridge.mjs";

export async function openWorkerRequest({
  controlSocket, dataRoot, requestId, conversationId, harness, segmentId, episodeDir,
  bootContext, templates, registerAsset, onToolCall = () => {}, wrapTools = (tools) => tools,
}) {
  const episode = parseEpisodeDir(episodeDir);
  const episodeAbs = path.join(dataRoot, episode.relative);
  await mkdir(path.join(episodeAbs, "work"), { recursive: true });
  // Render before the worker starts so the harness never sees a half-written boot.
  const render = await renderEpisodeBoot({ episodeDir: episodeAbs, context: bootContext, templates });
  const started = await controlRequest(controlSocket, { op: "worker.start", requestId, harness, segmentId, episodeDir: episode.relative });
  const scope = {
    requestId, conversationId, harness, channelId: episode.channelId, episodeId: episode.episodeId,
    dataRoot, episodeDir: started.episodeDir, workDir: started.workDir,
  };
  const tools = wrapTools(createScopedTools(scope, { registerAsset }));
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

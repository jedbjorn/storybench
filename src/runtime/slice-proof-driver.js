#!/usr/bin/env node
// Runtime capability-slice driver. Runs INSIDE the app container (docker exec) so every
// step uses the real app-side route: control socket -> host -> worker, harness socket,
// request bridge, scoped tools and the existing import/registration services.
// Used by scripts/runtime-slice-proof.mjs; prints one JSON summary on stdout.
import { createHash } from "node:crypto";
import { Store } from "../store.js";
import { controlRequest } from "./channel.js";
import { DATA_MOUNT, APP_CONTROL_MOUNT, CONTROL_SOCKET_NAME } from "./layout.js";
import { openWorkerRequest } from "./request.js";

const CONTROL = process.env.STORYBENCH_RUNTIME_CONTROL || `${APP_CONTROL_MOUNT}/${CONTROL_SOCKET_NAME}`;
const clip = (value, max = 600) => (typeof value === "string" && value.length > max ? `${value.slice(0, max)}…[${value.length} chars]` : value);

function summarizeToolOutput(output) {
  return {
    text: clip(output.text, 400),
    images: (output.images ?? []).map((image) => {
      const bytes = Buffer.from(image.data, "base64");
      return { mimeType: image.mimeType, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
    }),
  };
}

function withTracing(tools, trace) {
  return {
    definitions: tools.definitions,
    async call(name, args) {
      const entry = { at: new Date().toISOString(), tool: name, args };
      trace.push(entry);
      try { const output = await tools.call(name, args); entry.output = summarizeToolOutput(output); return output; }
      catch (error) { entry.error = error.message; throw error; }
    },
  };
}

function codexEventSummary(event) {
  const params = event.params ?? {};
  if (event.method === "item/completed") {
    const item = params.item ?? {};
    return { method: event.method, type: item.type, command: clip(item.command, 400), status: item.status, exitCode: item.exitCode, tool: item.tool, output: clip(item.aggregatedOutput, 800), text: item.type === "agentMessage" ? clip(item.text, 4000) : undefined };
  }
  if (event.method === "turn/completed") return { method: event.method, status: params.turn?.status, error: params.turn?.error };
  if (["thread/started", "turn/started", "error"].includes(event.method)) return { method: event.method, params: clip(JSON.stringify(params), 800) };
  return null;
}

function claudeEventSummary(event) {
  if (event.type === "system" && event.subtype === "init")
    return { type: "init", session_id: event.session_id, model: event.model, cwd: event.cwd, permissionMode: event.permissionMode, tools: event.tools, mcp_servers: event.mcp_servers, skills: event.skills, slash_commands: event.slash_commands, claude_code_version: event.claude_code_version };
  if (event.type === "assistant") {
    const blocks = (event.message?.content ?? []).map((block) => block.type === "tool_use" ? { tool_use: block.name, input: clip(JSON.stringify(block.input), 600) } : block.type === "text" ? { text: clip(block.text, 4000) } : { type: block.type });
    return { type: "assistant", model: event.message?.model, blocks };
  }
  if (event.type === "user") {
    const blocks = (Array.isArray(event.message?.content) ? event.message.content : []).map((block) => block.type === "tool_result"
      ? { tool_result: true, is_error: block.is_error, content: Array.isArray(block.content) ? block.content.map((part) => part.type === "image" ? { image: part.source?.media_type ?? part.mimeType ?? "image", bytes: (part.source?.data ?? part.data ?? "").length } : { text: clip(part.text, 800) }) : clip(String(block.content), 800) }
      : { type: block.type });
    return { type: "user", blocks };
  }
  if (event.type === "result") return { type: "result", subtype: event.subtype, is_error: event.is_error, session_id: event.session_id, result: clip(event.result, 4000), num_turns: event.num_turns, total_cost_usd: event.total_cost_usd, modelUsage: event.modelUsage ? Object.keys(event.modelUsage) : undefined };
  return null;
}

async function runTurn(spec) {
  const store = new Store(DATA_MOUNT);
  const trace = [];
  const events = [];
  const out = { phase: spec.phase, harness: spec.harness, requestId: spec.requestId, events, toolCalls: trace };
  const request = await openWorkerRequest({
    controlSocket: CONTROL, dataRoot: DATA_MOUNT, requestId: spec.requestId, conversationId: spec.conversationId,
    harness: spec.harness, segmentId: spec.segmentId, episodeDir: spec.episodeDir, bootContext: spec.bootContext,
    registerAsset: (candidate) => store.saveAsset(candidate), wrapTools: (tools) => withTracing(tools, trace),
  });
  out.worker = { containerId: request.started.containerId, state: request.started.state };
  out.render = { templateVersion: request.render.templateVersion, bootSha256: request.render.bootSha256, files: request.render.files, removed: request.render.removed };
  const deadline = spec.timeoutMs ?? 300_000;
  try {
    if (spec.harness === "codex") {
      let finish;
      const completed = new Promise((resolve, reject) => { finish = { resolve, reject }; });
      const connection = await request.codex({
        model: spec.model, requestTimeout: 60_000,
        onEvent: (event) => {
          const summary = codexEventSummary(event);
          if (summary) events.push(summary);
          if (event.method === "turn/completed") finish.resolve(event.params?.turn);
        },
        onError: (error) => finish.reject(error),
      });
      const skills = await connection.listSkills();
      out.nativeSkills = (skills?.data ?? []).flatMap((entry) => (entry.skills ?? []).filter((skill) => skill.scope === "repo").map((skill) => ({ name: skill.name, path: skill.path })));
      out.sessionId = spec.resume ? await connection.resumeThread(spec.resume) : await connection.startThread();
      out.turnId = await connection.startTurn(out.sessionId, spec.prompt);
      const timer = setTimeout(() => finish.reject(new Error("turn timed out")), deadline);
      try { out.turn = await completed; } catch (error) { out.turnError = error.message; } finally { clearTimeout(timer); }
      out.finalText = events.filter((event) => event.type === "agentMessage").map((event) => event.text).join("\n");
      connection.close();
    } else {
      const session = await request.claude({ model: spec.model, resume: spec.resume, onEvent: (event) => { const summary = claudeEventSummary(event); if (summary) events.push(summary); } });
      const timer = setTimeout(() => session.close(), deadline);
      try {
        const result = await session.send(spec.prompt);
        out.sessionId = result.session_id ?? session.sessionId;
        out.finalText = result.result;
        out.isError = result.is_error;
      } catch (error) { out.turnError = error.message; out.sessionId = session.sessionId; }
      finally { clearTimeout(timer); }
      session.close();
    }
  } finally {
    out.statusBeforeStop = await request.status().catch((error) => ({ error: error.message }));
    out.stop = spec.keepWorker ? null : await request.stop().catch((error) => ({ error: error.message }));
    store.close();
  }
  out.registeredAssets = trace.filter((entry) => entry.tool === "register_work_file" && entry.output).map((entry) => JSON.parse(entry.output.text));
  return out;
}

async function main() {
  const spec = JSON.parse(process.argv[2] ?? "{}");
  let result;
  if (spec.phase === "control") result = { phase: "control", reply: await controlRequest(CONTROL, spec.body).then((value) => ({ ok: true, value }), (error) => ({ ok: false, code: error.code, error: error.message })) };
  else if (spec.phase === "asset") {
    const store = new Store(DATA_MOUNT);
    result = { phase: "asset", asset: store.getAsset(spec.assetId) };
    store.close();
  } else result = await runTurn(spec);
  process.stdout.write(JSON.stringify(result) + "\n");
  process.exit(0);
}

await main().catch((error) => { process.stdout.write(JSON.stringify({ fatal: error.message, code: error.code }) + "\n"); process.exit(1); });

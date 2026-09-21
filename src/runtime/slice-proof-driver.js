#!/usr/bin/env node
// Runtime capability-slice driver. Runs INSIDE the app container (docker exec) so every
// step uses the real app-side route: control socket -> host -> worker, harness socket,
// request bridge, scoped tools and the existing import/registration services.
// Used by scripts/runtime-slice-proof.mjs; prints one JSON summary on stdout.
import { createHash } from "node:crypto";
import path from "node:path";
import { initDataRoot, openDataRoot } from "../services/data-root.js";
import { createChannel, createChannelEpisode } from "../services/channels.js";
import { createChatService } from "../chat.js";
import { importMedia } from "../media.js";
import { controlRequest } from "./channel.js";
import { DATA_MOUNT, APP_CONTROL_MOUNT, CONTROL_SOCKET_NAME } from "./layout.js";
import { openWorkerRequest } from "./request.js";
import { defaultBootContextFor } from "./app-runtime.js";

const CONTROL = process.env.STORYBENCH_RUNTIME_CONTROL || `${APP_CONTROL_MOUNT}/${CONTROL_SOCKET_NAME}`;
const clip = (value, max = 600) => (typeof value === "string" && value.length > max ? `${value.slice(0, max)}…[${value.length} chars]` : value);

function summarizeToolOutput(output) {
  return {
    text: clip(output.text, 6000),
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
  const store = openDataRoot(DATA_MOUNT, { startup: false });
  const trace = [];
  const events = [];
  const out = { phase: spec.phase, harness: spec.harness, requestId: spec.requestId, events, toolCalls: trace };
  const request = await openWorkerRequest({
    controlSocket: CONTROL, store, requestId: spec.requestId, conversationId: spec.conversationId,
    harness: spec.harness, segmentId: spec.segmentId, episodeId: spec.episodeId, model: spec.model,
    // The app's real boot context (all template variables), as production requests build it.
    bootContext: defaultBootContextFor(store, { episodeId: spec.episodeId, conversationId: spec.conversationId, model: spec.model, harness: spec.harness, request: { text: spec.prompt, kind: "chat" } }),
    wrapTools: (tools) => withTracing(tools, trace),
  });
  out.worker = { containerId: request.started.containerId, state: request.started.state };
  out.render = { templateVersion: request.render.templateVersion, bootSha256: request.render.bootSha256, files: request.render.files, removed: request.render.removed };
  out.skillsRendered = [...new Set(request.render.files.map((file) => file.path.split("/")[2]).filter(Boolean))];
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
  out.registeredAssets = trace.filter((entry) => entry.tool === "register_work_file" && entry.output).map((entry) => { try { return JSON.parse(entry.output.text); } catch { return { unparsed: entry.output.text }; } });
  return out;
}

// Proof of harness/model switching through the real chat service, real workers and the host
// catalogue, with in-memory conversation persistence (schema v9 pending). Steps:
//   { settings: { harness, model, effort } } | { send: "text" }
async function continuityRun(spec) {
  const { createChatService } = await import("../chat.js");
  const { createRenderService } = await import("../render-service.js");
  const { renderGraphic, validateGraphicRecipe } = await import("../graphics.js");
  const { createMemoryConversationPersistence } = await import("./conversation-runtime.js");
  const { createModelCatalog, createWorkerHarnessFactory } = await import("./app-runtime.js");
  const store = openDataRoot(DATA_MOUNT, { startup: false });
  if (spec.story) { const story = store.getStory(spec.episodeId); store.saveStory(spec.episodeId, story.storyRevision, spec.story, "human"); }
  const renders = createRenderService({ workspace: DATA_MOUNT, store, renderGraphic, validateGraphicRecipe });
  const requests = [];
  const catalog = createModelCatalog({ controlSocket: CONTROL });
  const persistence = createMemoryConversationPersistence();
  const chat = createChatService({ store, renders, continuity: { persistence, catalog: (options) => catalog.list(options) },
    codexFactory: createWorkerHarnessFactory({ store, controlSocket: CONTROL, onRequest: (info) => requests.push({ requestId: info.requestId, harness: info.harness, container: info.containerId?.slice(0, 12) }) }) });
  const conversation = chat.create(spec.episodeId, { name: "Continuity proof" });
  const steps = [];
  for (const step of spec.steps) {
    if (step.settings) {
      const current = chat.get(spec.episodeId, conversation.id).settings;
      try { const value = await chat.updateSettings(spec.episodeId, conversation.id, { ...step.settings, expectedRevision: current.revision, clientRequestId: randomUUIDLocal() }); steps.push({ settings: step.settings, ok: true, result: value.settingsResult }); }
      catch (error) { steps.push({ settings: step.settings, ok: false, code: error.code, error: error.message }); }
      continue;
    }
    const before = chat.get(spec.episodeId, conversation.id).messages.length;
    await chat.send(spec.episodeId, conversation.id, step.send);
    const deadline = Date.now() + (spec.timeoutMs ?? 300_000);
    let value;
    do { await new Promise((resolve) => setTimeout(resolve, 500)); value = chat.get(spec.episodeId, conversation.id); } while (!["idle", "error", "interrupted"].includes(value.state) && Date.now() < deadline);
    const reply = value.messages.slice(before).filter((message) => message.role === "assistant").map((message) => message.text).join("\n");
    steps.push({ send: step.send, state: value.state, error: value.error ?? null, threadId: value.threadId ?? null, reply, run: value.runs.at(-1) });
  }
  const final = chat.get(spec.episodeId, conversation.id);
  await chat.close();
  store.close();
  return { phase: "continuity", conversationId: conversation.id, steps, requests, segments: final.segments,
    events: final.events.filter((event) => ["settings.changed", "segment.started", "tool.started", "turn.started"].includes(event.type)).map(({ type, payload, createdAt }) => ({ type, payload, createdAt })),
    runs: final.runs };
}

// Disposable live proof for task #27: enter through the same shortcut service as the UI,
// then observe request/job attribution and (optionally) stop while its render is active.
async function productionRun(spec) {
  const { createRenderService } = await import("../render-service.js");
  const { renderGraphic, validateGraphicRecipe } = await import("../graphics.js");
  const { createModelCatalog, createWorkerHarnessFactory } = await import("./app-runtime.js");
  const { createV9ConversationPersistence } = await import("./conversation-persistence.js");
  const store = openDataRoot(DATA_MOUNT, { startup: false });
  const renders = createRenderService({ workspace: DATA_MOUNT, store, renderGraphic, validateGraphicRecipe });
  const catalog = createModelCatalog({ controlSocket: CONTROL });
  const requests = [];
  const chat = createChatService({ store, renders, continuity: { persistence: createV9ConversationPersistence(store), catalog: (options) => catalog.list(options) },
    codexFactory: createWorkerHarnessFactory({ store, controlSocket: CONTROL, onRequest: (info) => requests.push(info) }) });
  const conversation = chat.create(spec.episodeId, { name: `Production ${spec.harness}` });
  const settings = store.getConversation(conversation.id);
  store.updateConversationSettings(conversation.id, settings.settingsRevision, { harness: spec.harness, model: spec.model, effort: spec.effort ?? null });
  const directionMessage = spec.directionText
    ? store.addConversationMessage({ conversationId: conversation.id, role: "user", text: spec.directionText }) : null;
  const prompt = String(spec.prompt ?? "").replaceAll("{{directionMessageId}}", String(directionMessage?.id ?? ""));
  const sent = await chat.sendProduction(spec.episodeId, conversation.id, { kind: spec.kind,
    prompt, targetCardId: spec.targetCardId ?? null, clientRequestId: `live-${spec.requestId}` });
  const requestId = sent.requestResult.run.id;
  let stopped = false;
  const deadline = Date.now() + (spec.timeoutMs ?? 300_000);
  while (Date.now() < deadline) {
    const activeJobs = store.listRequestJobs(requestId, { activeOnly: true });
    if (spec.stopWhenJobActive && activeJobs.length) {
      await chat.interrupt(spec.episodeId, conversation.id); stopped = true; break;
    }
    const state = chat.get(spec.episodeId, conversation.id).state;
    if (["idle", "error", "interrupted"].includes(state)) break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (stopped) {
    while (Date.now() < deadline && !["interrupted", "error"].includes(chat.get(spec.episodeId, conversation.id).state)) await new Promise((resolve) => setTimeout(resolve, 100));
    while (Date.now() < deadline && store.listRequestJobs(requestId, { activeOnly: true }).length) await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const result = chat.get(spec.episodeId, conversation.id);
  const jobs = store.listRequestJobs(requestId);
  await chat.close(); await renders.close("production proof finished"); store.close();
  return { phase: "production", harness: spec.harness, model: spec.model, requestId, stopped, requests: requests.map((value) => ({ requestId: value.requestId, harness: value.harness })),
    state: result.state, error: result.error ?? null, directionMessageId: directionMessage?.id ?? null, messages: result.messages,
    events: result.events.filter((event) => event.type === "tool.called"), run: result.runs.find((value) => value.id === requestId), jobs };
}
const randomUUIDLocal = () => globalThis.crypto.randomUUID();

async function main() {
  const spec = JSON.parse(process.argv[2] ?? "{}");
  let result;
  if (spec.phase === "control") result = { phase: "control", reply: await controlRequest(CONTROL, spec.body).then((value) => ({ ok: true, value }), (error) => ({ ok: false, code: error.code, error: error.message })) };
  else if (spec.phase === "asset") {
    const store = openDataRoot(DATA_MOUNT, { startup: false });
    const asset = store.getAsset(spec.assetId);
    const item = asset && spec.episodeId ? store.listEpisodeLibrary(spec.episodeId).find((entry) => (entry.assetId ?? entry.asset?.id) === asset.id) ?? null : null;
    result = { phase: "asset", asset, libraryItem: item };
    store.close();
  } else if (spec.phase === "seed") {
    // Offline (no server): initialize a disposable data root with two channels and one
    // episode each, returning locations from the store path API.
    initDataRoot(DATA_MOUNT);
    const channels = [createChannel(DATA_MOUNT, `Slice A${spec.nameSuffix ? ` ${spec.nameSuffix}` : ""}`), createChannel(DATA_MOUNT, `Slice B${spec.nameSuffix ? ` ${spec.nameSuffix}` : ""}`)];
    const store = openDataRoot(DATA_MOUNT, { startup: false });
    const rel = (value) => path.relative(DATA_MOUNT, value);
    const episodes = channels.map((channel) => {
      const episode = createChannelEpisode(store, channel.id, { title: `${channel.name} episode` });
      store.ensureEpisodeDirectories(episode.id);
      return { id: episode.id, channelId: channel.id, directory: rel(store.episodeDirectory(episode.id)), work: rel(store.episodeWorkDirectory(episode.id)),
        drafts: rel(store.episodeOutputDirectory(episode.id, "drafts")), channelMedia: rel(store.channelMediaDirectory(channel.id)) };
    });
    store.close();
    result = { phase: "seed", channels: channels.map((channel) => ({ id: channel.id, name: channel.name })), episodes };
  } else if (spec.phase === "seed-media") {
    // After "seed": register fixture files (placed by the proof under the app-only imports/)
    // as library items, add two cards, and one conversation per harness whose creator
    // message explicitly directs use of the other channel's reference still.
    const store = openDataRoot(DATA_MOUNT, { startup: false });
    const chat = createChatService({ store, codexFactory: async () => { throw new Error("offline"); } });
    const [a, b] = spec.episodes;
    const attach = async (episodeId, channelId, file, category, label) => {
      const imported = await importMedia({ workspace: DATA_MOUNT, sourcePath: path.join(DATA_MOUNT, "imports/fixtures", file), mediaDirectory: store.channelMediaDirectory(channelId) });
      const asset = store.saveAsset({ ...imported, channelId, name: file });
      return store.attachLibraryItem(episodeId, asset.id, { category, label });
    };
    const still = await attach(a.id, a.channelId, "fixture-a.png", "Graphics", "Fixture still");
    const clip = await attach(a.id, a.channelId, "clip-b.mp4", "B-roll", "Scene clip");
    const ordinary = await attach(b.id, b.channelId, "ordinary.png", "Graphics", "Beta badge");
    const reference = await attach(b.id, b.channelId, "reference.png", "Reference", "Beta mood reference");
    const episode = store.getEpisode(a.id);
    const card = (id, title, type, order) => ({ id, title, type, prompt: title, sectionId: null, itemId: null, referenceItemIds: [], order, enabled: true });
    const updated = store.updateEpisode(a.id, episode.revision, { cards: [card("card_title", "Title graphic", "Static Graphic", 0), card("card_broll", "Closing footage", "Video", 1)] });
    const now = new Date().toISOString();
    const conversations = {};
    for (const harness of spec.harnesses) {
      const conversation = chat.create(a.id, { name: `Media tools ${harness}` });
      const messageId = Number(store.db.prepare("INSERT INTO conversation_messages(conversation_id,role,text,state,created_at,updated_at) VALUES(?,?,?,'completed',?,?)")
        .run(conversation.id, "user", "Please use the 'Beta mood reference' still from the Beta channel directly in this episode as the opening image.", now, now).lastInsertRowid);
      conversations[harness] = { id: conversation.id, directionMessageId: messageId };
    }
    await chat.close();
    store.close();
    result = { phase: "seed-media", items: { still: still.id, clip: clip.id, ordinary: ordinary.id, reference: reference.id },
      assetPaths: { still: still.asset.path, clip: clip.asset.path, ordinary: ordinary.asset.path, reference: reference.asset.path }, revision: updated.revision, conversations };
  } else if (spec.phase === "attach-files") {
    // Register fixture files (under the app-only imports/fixtures) into an episode library.
    const store = openDataRoot(DATA_MOUNT, { startup: false });
    const episode = store.getEpisode(spec.episodeId);
    const items = [];
    for (const entry of spec.files) {
      const imported = await importMedia({ workspace: DATA_MOUNT, sourcePath: path.join(DATA_MOUNT, "imports/fixtures", entry.file), mediaDirectory: store.channelMediaDirectory(episode.channelId) });
      const asset = store.saveAsset({ ...imported, channelId: episode.channelId, name: entry.file });
      const item = store.attachLibraryItem(episode.id, asset.id, { category: entry.category ?? "Graphics", label: entry.label ?? entry.file });
      items.push({ file: entry.file, itemId: item.id, assetPath: item.asset.path });
    }
    store.close();
    result = { phase: "attach-files", items };
  } else if (spec.phase === "episode-state") {
    const store = openDataRoot(DATA_MOUNT, { startup: false });
    const episode = store.getEpisode(spec.episodeId);
    const library = store.listEpisodeLibrary(spec.episodeId).map((item) => ({ id: item.id, label: item.label, category: item.category, assetId: item.assetId, kind: item.asset?.kind,
      hash: item.asset?.hash, sourceKind: item.sourceKind, provenance: item.provenance }));
    const directions = store.listReferenceDirections(spec.episodeId);
    store.close();
    result = { phase: "episode-state", revision: episode.revision, cards: episode.cards.map(({ id, type, itemId, referenceItemIds }) => ({ id, type, itemId, referenceItemIds })), library, directions };
  } else if (spec.phase === "continuity") {
    result = await continuityRun(spec);
  } else if (spec.phase === "production") {
    result = await productionRun(spec);
  } else result = await runTurn(spec);
  process.stdout.write(JSON.stringify(result) + "\n");
  process.exit(0);
}

await main().catch((error) => { process.stdout.write(JSON.stringify({ fatal: error.message, code: error.code }) + "\n"); process.exit(1); });

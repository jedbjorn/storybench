import { FONTS, fontPath, fontCatalog } from './fonts.js';
import { validateSelection } from './runtime/conversation-runtime.js';
import http from "node:http";
import { rm, stat, realpath } from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Store, StoreError } from "./store.js";
import { importMedia } from "./media.js";
import { createChatService } from "./chat.js";
import { createModelCatalog, createWorkerHarnessFactory } from "./runtime/app-runtime.js";
import { conversationPersistenceFor } from "./runtime/conversation-persistence.js";
import { createHealth } from "./runtime/health.js";
import { createLibraryService } from "./library.js";
import { renderGraphic, validateGraphicRecipe } from "./graphics.js";
import { createRenderService } from "./render-service.js";
import { openDataRoot } from "./services/data-root.js";
import { createChannel, listChannels, renameChannel, useChannel } from "./services/channels.js";
import { deleteDraftOutputs, listDraftCleanup, moveFinalToDrafts } from "./services/outputs.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = path.join(root, "public");
const mime = {
  ".ttf": "font/ttf",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
};

// --data-root opens an explicitly initialized/adopted shared data root and never initializes one implicitly.
// --workspace keeps the prototype behavior: it opens (and migrates) a single workspace as a one-channel root.
function options(argv) {
  const out = {
    dataRoot: process.env.STORYBENCH_DATA_ROOT,
    workspace: process.env.STORYBENCH_WORKSPACE,
    port: Number(process.env.SC_DEV_PORT || process.env.PORT || 4173),
  };
  for (let i = 2; i < argv.length; i++)
    if (argv[i] === "--workspace") { out.workspace = argv[++i]; out.dataRoot = undefined; }
    else if (argv[i] === "--data-root") { out.dataRoot = argv[++i]; out.workspace = undefined; }
    else if (argv[i] === "--port") out.port = Number(argv[++i]);
  if (out.dataRoot) {
    if (!path.isAbsolute(out.dataRoot)) throw new Error("--data-root must be an absolute path");
    out.workspace = undefined;
  } else if (!out.workspace || !path.isAbsolute(out.workspace))
    throw new Error("Start with --data-root /absolute/data/root (or --workspace /absolute/prototype/workspace)");
  if (!Number.isInteger(out.port) || out.port < 0 || out.port > 65535)
    throw new Error("Invalid port");
  return out;
}

async function jsonBody(req) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 6_500_000) throw new StoreError("Request body too large", 413);
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks));
  } catch {
    throw new StoreError("Invalid JSON", 400);
  }
}
function send(res, status, data, headers = {}) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...headers,
  });
  res.end(JSON.stringify(data));
}
function ensureLocal(req) {
  const host = req.headers.host || "";
  if (!/^(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/i.test(host))
    throw new StoreError("Loopback Host required", 403);
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    const origin = req.headers.origin;
    if (origin && origin !== `http://${host}` && origin !== `https://${host}`)
      throw new StoreError("Cross-origin request rejected", 403);
    if ((req.headers["sec-fetch-site"] || "").toLowerCase() === "cross-site")
      throw new StoreError("Cross-site request rejected", 403);
  }
}
function contained(base, relative) {
  const value = path.resolve(base, relative);
  if (value !== base && !value.startsWith(base + path.sep))
    throw new StoreError("Invalid registered file path", 403);
  return value;
}
async function streamFile(req, res, file, contentType) {
  const info = await stat(file);
  if (!info.isFile()) throw new StoreError("File not found", 404);
  const range = req.headers.range;
  const selectedType =
    contentType || mime[path.extname(file).toLowerCase()] || "application/octet-stream";
  const headers = {
    "content-type": selectedType,
    "accept-ranges": "bytes",
    "cache-control": /^(text\/html|text\/css|text\/javascript)/.test(selectedType)
      ? "no-store"
      : "private, max-age=3600",
  };
  const pipe = (opts) => {
    const stream = createReadStream(file, opts);
    stream.on("error", () => res.destroy());
    stream.pipe(res);
  };
  if (!range) {
    res.writeHead(200, { ...headers, "content-length": info.size });
    if (req.method === "HEAD") return res.end();
    return pipe();
  }
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match) {
    res.writeHead(416, { "content-range": `bytes */${info.size}` });
    return res.end();
  }
  let start = match[1]
    ? Number(match[1])
    : Math.max(0, info.size - Number(match[2]));
  let end = match[2] && match[1] ? Number(match[2]) : info.size - 1;
  if (start > end || start >= info.size) {
    res.writeHead(416, { "content-range": `bytes */${info.size}` });
    return res.end();
  }
  end = Math.min(end, info.size - 1);
  res.writeHead(206, {
    ...headers,
    "content-length": end - start + 1,
    "content-range": `bytes ${start}-${end}/${info.size}`,
  });
  if (req.method === "HEAD") return res.end();
  pipe({ start, end });
}

export async function createApp({ workspace: workspaceOption, dataRoot, onListen, storeOptions, renderOptions = {}, chatOptions = {} } = {}) {
  const store = dataRoot ? openDataRoot(dataRoot, { startup: true, storeOptions }) : new Store(workspaceOption, storeOptions);
  const workspace = store.workspace;
  const listeners = new Map();
  const notify = (episodeId) => listeners.get(episodeId)?.forEach((fn) => fn());
  const library = createLibraryService({ workspace, store });
  const renders = createRenderService({ workspace, store, renderGraphic, validateGraphicRecipe, ...renderOptions });
  // In the Docker app container the host lifecycle entry point provides a private control
  // socket; Codex turns then run in request-scoped workers instead of in-process.
  const runtimeControl = process.env.STORYBENCH_RUNTIME_CONTROL;
  const runtimeChat = runtimeControl && !chatOptions.codexFactory ? { codexFactory: createWorkerHarnessFactory({ store, controlSocket: runtimeControl }) } : {};
  // Harness/model selection and native-session continuity need the conversation persistence
  // (schema v9) and the host's model catalogue; without either, the legacy Codex path runs.
  const catalog = chatOptions.catalog ?? (runtimeControl ? createModelCatalog({ controlSocket: runtimeControl }) : null);
  const persistence = chatOptions.persistence ?? conversationPersistenceFor(store);
  const continuity = catalog && persistence ? { persistence, catalog: (options) => catalog.list(options) } : null;
  const chat = createChatService({ store, renders, onChange: notify, ...runtimeChat, continuity, requestPersistence: persistence, ...chatOptions });
  const eventStreams = new Set();
  let closing = false;
  let closePromise;
  const health = createHealth({ store, getState: () => (closing ? "draining" : "ready") });

  const server = http.createServer(async (req, res) => {
    try {
      ensureLocal(req);
      if (closing && !["GET", "HEAD"].includes(req.method)) throw new StoreError("Application is shutting down", 503);
      const url = new URL(req.url, `http://${req.headers.host}`);
      const parts = url.pathname.split("/").filter(Boolean);
      // Channel scope is explicit per request (query or header, captured by each open view). The persisted
      // default is only a fallback for navigation entry; it never retargets an explicitly scoped request.
      const requestedChannel = url.searchParams.get("channel") || String(req.headers["x-storybench-channel"] || "") || null;
      const viewChannel = () => requestedChannel ? store.requireChannel(requestedChannel) : store.getDefaultChannel();
      if (req.method === "GET" && url.pathname === "/api/health") return send(res, closing ? 503 : 200, health.snapshot());
      if (req.method === "GET" && url.pathname === "/api/harnesses") {
        if (!catalog) return send(res, 200, { available: false, reason: "Harness selection needs the Storybench runtime (Docker lifecycle)", harnesses: [] });
        return send(res, 200, { available: Boolean(continuity), reason: continuity ? null : "Conversation settings storage is not available in this data root yet", harnesses: await catalog.list({ refresh: url.searchParams.get("refresh") === "1" }) });
      }
      if (url.pathname === "/api/model-default") {
        if (req.method === "GET") return send(res, 200, store.getModelDefault());
        if (req.method === "PUT") {
          if (!continuity) throw new StoreError("Model selection needs the Storybench runtime", 409);
          const body = await jsonBody(req);
          const { harness, model, effort, notes } = validateSelection(await catalog.list({}), body.selection ?? {});
          return send(res, 200, { ...store.saveModelDefault(body.expectedRevision, { harness, model, effort }), notes });
        }
      }
      if (req.method === "GET" && url.pathname === "/api/fonts") return send(res, 200, fontCatalog());
      if (["GET", "HEAD"].includes(req.method) && parts[0] === "api" && parts[1] === "fonts" && parts.length === 4) {
        const file = fontPath(FONTS.find((font) => font.id === parts[2]), parts[3]);
        if (!file) throw new StoreError("Requested font is unavailable", 404);
        return await streamFile(req, res, file);
      }
      if (url.pathname === "/api/brand-standards") {
        const channel = viewChannel();
        if (!channel) throw new StoreError("Select a channel first", 404);
        if (req.method === "GET") return send(res, 200, store.getBrandStandards(channel.id));
        if (req.method === "PUT") {
          const body = await jsonBody(req);
          return send(res, 200, store.saveBrandStandards(channel.id, body.expectedRevision, body));
        }
      }
      if (req.method === "GET" && url.pathname === "/api/state") {
        const channel = viewChannel();
        return send(res, 200, {
          channel,
          channels: store.listChannels(),
          defaultChannelId: store.getDefaultChannel()?.id ?? null,
          episodes: channel ? store.listEpisodes({ channelId: channel.id }) : [],
          assets: channel ? store.listAssets({ channelId: channel.id }) : [],
          jobs: channel ? store.listJobs(null, { channelId: channel.id }).map((job) => {
            try { return renders.getJob(job.episodeId, job.id); } catch { return job; }
          }) : [],
        });
      }
      if (req.method === "GET" && url.pathname === "/api/data-root") {
        const identity = store.dataRootIdentity();
        return send(res, 200, { id: identity.id, schemaVersion: identity.schemaVersion, defaultChannelId: identity.defaultChannelId,
          channelCount: store.listChannels().length, pid: process.pid });
      }
      if (parts[0] === "api" && parts[1] === "channels") {
        if (parts.length === 2 && req.method === "GET") return send(res, 200, listChannels(store));
        if (parts.length === 2 && req.method === "POST") return send(res, 201, createChannel(store, (await jsonBody(req)).name));
        if (parts[2] === "default" && parts.length === 3 && req.method === "GET") return send(res, 200, { channel: store.getDefaultChannel() });
        if (parts[2] === "default" && parts.length === 3 && req.method === "PUT") return send(res, 200, useChannel(store, (await jsonBody(req)).channel));
        if (parts[2] && parts.length === 3 && req.method === "GET") return send(res, 200, store.requireChannel(parts[2]));
        if (parts[2] && parts.length === 3 && req.method === "PUT") return send(res, 200, renameChannel(store, store.requireChannel(parts[2]).id, (await jsonBody(req)).name));
        if (parts[2] && parts[3] === "episodes" && parts.length === 4 && req.method === "GET")
          return send(res, 200, store.listEpisodes({ channelId: store.requireChannel(parts[2]).id }));
        if (parts[2] && parts[3] === "episodes" && parts.length === 4 && req.method === "POST") {
          const body = await jsonBody(req);
          return send(res, 201, store.createEpisode({ title: body.title, notes: body.notes, channelId: store.requireChannel(parts[2]).id }));
        }
      }
      if (req.method === "POST" && url.pathname === "/api/episodes") {
        const body = await jsonBody(req);
        return send(res, 201, store.createEpisode({ title: body.title, notes: body.notes, channelId: body.channelId ?? requestedChannel }));
      }
      if (req.method === "GET" && url.pathname === "/api/branding") {
        const channel = viewChannel();
        return send(res, 200, channel ? store.listBrandingTemplates({ channelId: channel.id }) : []);
      }
      if (parts[0] === "api" && parts[1] === "branding" && parts[2] && req.method === "PUT") {
        const body = await jsonBody(req);
        const template = store.getBrandingTemplate(parts[2]);
        if (template && requestedChannel && template.channelId !== requestedChannel) throw new StoreError("Branding template belongs to another channel", 409);
        return send(res, 200, store.setBrandingRole(parts[2], body.role ?? null));
      }
      if (parts[0] === "api" && parts[1] === "episodes" && parts[2]) {
        const episodeId = parts[2];
        // Every episode-scoped route validates the caller's channel together with the episode ID.
        if (requestedChannel) store.assertEpisodeChannel(episodeId, requestedChannel);
        if (parts.length === 3 && req.method === "GET") {
          const value = store.getEpisode(episodeId);
          if (!value) throw new StoreError("Episode not found", 404);
          return send(res, 200, value);
        }
        if (parts[3] === "story" && parts.length === 4 && req.method === "GET")
          return send(res, 200, store.getStory(episodeId));
        if (parts[3] === "story" && parts.length === 4 && req.method === "PUT") {
          const body = await jsonBody(req);
          const value = store.saveStory(
            episodeId,
            body.expectedStoryRevision,
            body.source,
          );
          notify(episodeId);
          return send(res, 200, value);
        }
        if (parts[3] === "story" && parts[4] === "publication" && parts.length === 5 && req.method === "POST") {
          const body = await jsonBody(req);
          const value = store.retryStoryPublication(episodeId, body.expectedStoryRevision);
          notify(episodeId);
          return send(res, 200, value);
        }
        if (parts[3] === "history" && req.method === "GET")
          return send(res, 200, store.listEpisodeHistory(episodeId));
        if (["composition", "render-plan"].includes(parts[3]) && parts.length === 4 && req.method === "GET")
          return send(res, 200, renders.validateRender(episodeId));
        if (parts[3] === "graphics") {
          if (parts.length === 4 && req.method === "GET") return send(res, 200, renders.listGraphicRecipes(episodeId));
          if (parts.length === 4 && req.method === "POST") {
            const value = renders.createGraphicRecipe(episodeId, await jsonBody(req));
            notify(episodeId); return send(res, 201, value);
          }
          if (parts[4] && parts.length === 5 && req.method === "GET") {
            const value = renders.getGraphicRecipe(episodeId, parts[4]);
            if (!value) throw new StoreError("Graphic recipe not found", 404);
            return send(res, 200, value);
          }
          if (parts[4] && parts.length === 5 && req.method === "PUT") {
            const body = await jsonBody(req);
            const value = renders.updateGraphicRecipe(episodeId, parts[4], body.expectedRecipeRevision, body);
            notify(episodeId); return send(res, 200, value);
          }
          if (parts[4] && parts[5] === "render" && parts.length === 6 && req.method === "POST") {
            const body = await jsonBody(req);
            const value = renders.enqueueGraphic({ episodeId, channelId: requestedChannel, recipeId: parts[4], expectedRecipeRevision: body.expectedRecipeRevision });
            notify(episodeId); return send(res, 202, value);
          }
        }
        if (parts[3] === "cards" && parts[4] && parts[5] === "promote" && req.method === "POST") {
          const value = store.promoteCard(episodeId, parts[4], await jsonBody(req));
          return send(res, 201, value);
        }
        if (parts[3] === "branding" && parts[4] && parts[5] === "apply" && req.method === "POST") {
          const value = store.applyBrandingTemplate(episodeId, parts[4]);
          notify(episodeId);
          return send(res, 200, value);
        }
        if (parts[3] === "library") {
          if (parts.length === 4 && req.method === "GET")
            return send(res, 200, store.listEpisodeLibrary(episodeId));
          if (parts[4] === "files" && parts.length === 5 && req.method === "POST") {
            let fileName, label;
            try {
              fileName = decodeURIComponent(String(req.headers["x-file-name"] || "upload"));
              label = decodeURIComponent(String(req.headers["x-library-label"] || ""));
            } catch { throw new StoreError("Import metadata is malformed"); }
            const value = await library.registerFile({
              episodeId,
              readable: req,
              fileName,
              label,
              sectionId: String(req.headers["x-story-section-id"] || "") || null,
              contentType: String(req.headers["content-type"] || "application/octet-stream"),
              selectedCategory: String(req.headers["x-library-category"] || "Reference"),
              signal: AbortSignal.any([AbortSignal.timeout(10 * 60_000)]),
            });
            notify(episodeId);
            return send(res, 201, value);
          }
          if (parts[4] === "text" && parts.length === 5 && req.method === "POST") {
            const body = await jsonBody(req);
            const value = await library.registerText({ episodeId, title: body.title, text: body.text, sectionId: body.sectionId });
            notify(episodeId);
            return send(res, 201, value);
          }
          if (parts[4] === "reuse" && parts.length === 5 && req.method === "POST") {
            const body = await jsonBody(req);
            const value = await library.reuseItem({
              source: { channelId: body.sourceChannelId ?? null, episodeId: body.sourceEpisodeId, itemId: body.sourceItemId },
              destination: { channelId: requestedChannel ?? body.channelId ?? null, episodeId, cardId: body.cardId ?? null,
                expectedRevision: body.expectedRevision, assign: body.assign },
              category: body.category ?? null, label: body.label ?? null, requestId: body.requestId ?? null,
            });
            notify(episodeId);
            return send(res, 201, value);
          }
          if (parts[4] === "url" && parts.length === 5 && req.method === "POST") {
            const body = await jsonBody(req);
            const value = await library.registerUrl({ episodeId, url: body.url, sectionId: body.sectionId, signal: AbortSignal.timeout(30_000) });
            notify(episodeId);
            return send(res, 201, value);
          }
          if (parts[4] && parts.length === 5 && req.method === "PUT") {
            const body = await jsonBody(req);
            const value = store.updateLibraryItem(episodeId, parts[4], body.expectedRevision, body);
            notify(episodeId);
            return send(res, 200, value);
          }
          if (parts[4] && parts[5] === "file" && parts.length === 6 && ["GET", "HEAD"].includes(req.method)) {
            const item = store.getLibraryItem(episodeId, parts[4]);
            if (!item) throw new StoreError("Library item not found", 404);
            const actual = await realpath(contained(workspace, item.asset.path));
            const workspaceReal = await realpath(workspace);
            contained(workspaceReal, path.relative(workspaceReal, actual));
            return await streamFile(req, res, actual, item.asset.metadata?.contentType);
          }
          if (parts[4] && parts[5] === "thumbnail" && parts.length === 6 && ["GET", "HEAD"].includes(req.method)) {
            const item = store.getLibraryItem(episodeId, parts[4]);
            if (!item?.asset.thumbnailPath) throw new StoreError("Thumbnail unavailable", 404);
            const actual = await realpath(contained(workspace, item.asset.thumbnailPath));
            const workspaceReal = await realpath(workspace);
            contained(workspaceReal, path.relative(workspaceReal, actual));
            return await streamFile(req, res, actual);
          }
        }
        if (parts.length === 3 && req.method === "PUT") {
          const body = await jsonBody(req);
          const value = store.updateEpisode(
            episodeId,
            body.expectedRevision,
            body,
          );
          notify(episodeId);
          return send(res, 200, value);
        }
        if (parts[3] === "undo" && req.method === "POST") {
          const body = await jsonBody(req);
          const value = store.undoEpisode(episodeId, body.expectedRevision);
          notify(episodeId);
          return send(res, 200, value);
        }
        if (parts[3] === "render" && req.method === "POST") {
          const body = await jsonBody(req);
          const outputClass = body.kind === "preview" ? "draft" : body.kind === "export" ? "final" : body.outputClass;
          const expectedRenderRevision = body.expectedRenderRevision ||
            (outputClass === "draft" ? renders.validateRender(episodeId).renderRevision : null);
          return send(res, 202, renders.enqueueRender({ episodeId, channelId: requestedChannel ?? body.channelId ?? null, outputClass,
            expectedRenderRevision,
            conversationId: body.conversationId ?? null, requestId: body.requestId ?? null }));
        }
        if (parts[3] === "final-authorizations" && req.method === "POST") {
          throw new StoreError("Final grants are retired; use a request-bound Final intent", 410);
        }
        if (parts[3] === "outputs") {
          if (parts[4] === "cleanup" && parts.length === 5 && req.method === "GET")
            return send(res, 200, await listDraftCleanup(store, episodeId));
          if (parts[4] === "delete" && parts.length === 5 && req.method === "POST") {
            const body = await jsonBody(req);
            const value = await deleteDraftOutputs(store, { episodeId, outputs: body.outputs, actor: "human" });
            notify(episodeId);
            return send(res, 200, value);
          }
          if (parts[4] && parts[5] === "move-to-drafts" && parts.length === 6 && req.method === "POST") {
            const body = await jsonBody(req);
            const value = moveFinalToDrafts(store, { episodeId, outputId: parts[4], expectedRevision: body.expectedRevision, actor: "human" });
            notify(episodeId);
            return send(res, 200, value);
          }
        }
        if (parts[3] === "jobs" && parts[4] && parts[5] === "cancel" && req.method === "POST") {
          const value = renders.cancelJob(episodeId, parts[4]); notify(episodeId); return send(res, 200, value);
        }
        if (parts[3] === "chats") {
          if (parts[4] && parts[5] === "settings" && parts.length === 6 && req.method === "PUT")
            return send(res, 200, await chat.updateSettings(episodeId, parts[4], await jsonBody(req)));
          if (parts.length === 4 && req.method === "GET") return send(res, 200, chat.list(episodeId));
          if (parts.length === 4 && req.method === "POST") return send(res, 201, chat.create(episodeId, await jsonBody(req)));
          const conversationId = parts[4];
          if (conversationId && parts.length === 5 && req.method === "GET") return send(res, 200, chat.get(episodeId, conversationId));
          if (conversationId && parts.length === 5 && req.method === "PUT") return send(res, 200, chat.update(episodeId, conversationId, await jsonBody(req)));
          if (conversationId && parts[5] === "messages" && req.method === "POST") {
            const body = await jsonBody(req); return send(res, 202, await chat.send(episodeId, conversationId, body.text ?? "", body.attachmentIds ?? []));
          }
          if (conversationId && parts[5] === "production-requests" && parts.length === 6 && req.method === "POST")
            return send(res, 202, await chat.sendProduction(episodeId, conversationId, await jsonBody(req)));
          if (conversationId && parts[5] === "production-requests" && parts[6] && parts[7] === "retry" && parts.length === 8 && req.method === "POST")
            return send(res, 202, await chat.retry(episodeId, conversationId, parts[6], await jsonBody(req)));
          if (conversationId && parts[5] === "interrupt" && req.method === "POST")
            return send(res, 202, await chat.interrupt(episodeId, conversationId));
          if (conversationId && parts[5] === "events" && req.method === "GET") {
            res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
            eventStreams.add(res);
            const emit = (event) => { if (!event || event.conversationId === conversationId) res.write(`data: ${JSON.stringify(event || chat.get(episodeId, conversationId))}\n\n`); };
            emit();
            const cleanup = chat.subscribe(episodeId, emit);
            const keep = setInterval(() => res.write(": keepalive\n\n"), 20000);
            req.on("close", () => { eventStreams.delete(res); clearInterval(keep); cleanup?.(); });
            return;
          }
        }
        if (parts[3] === "chat") {
          if (parts.length === 4 && req.method === "GET")
            return send(res, 200, chat.getLegacy(episodeId));
          if (parts.length === 4 && req.method === "POST") {
            const body = await jsonBody(req);
            if (!String(body.text || "").trim())
              throw new StoreError("Chat message is required");
            return send(
              res,
              202,
              await chat.sendLegacy(episodeId, String(body.text)),
            );
          }
          if (parts[4] === "interrupt" && req.method === "POST")
            return send(res, 202, await chat.interruptLegacy(episodeId));
          if (
            parts[4] === "events" &&
            req.method === "GET" &&
            typeof chat.subscribe === "function"
          ) {
            res.writeHead(200, {
              "content-type": "text/event-stream",
              "cache-control": "no-cache",
              connection: "keep-alive",
            });
            eventStreams.add(res);
            const emit = async () =>
              res.write(
                `data: ${JSON.stringify(chat.getLegacy(episodeId))}\n\n`,
              );
            await emit();
            const cleanup = chat.subscribe(episodeId, emit);
            const keep = setInterval(() => res.write(": keepalive\n\n"), 20000);
            req.on("close", () => {
              eventStreams.delete(res);
              clearInterval(keep);
              cleanup?.();
            });
            return;
          }
        }
      }
      if (req.method === "POST" && url.pathname === "/api/import") {
        const body = await jsonBody(req);
        if (!path.isAbsolute(body.path || ""))
          throw new StoreError("Import path must be absolute");
        const channelId = store.resolveChannelId(body.channelId ?? requestedChannel);
        const candidate = await importMedia({
          workspace,
          sourcePath: body.path,
          mediaDirectory: store.channelMediaDirectory(channelId),
        });
        const asset = store.saveAsset({ ...candidate, channelId });
        if (candidate.createdFile && asset.path !== candidate.path) await rm(path.join(workspace, candidate.path), { force: true });
        return send(res, 201, asset);
      }
      if (
        parts[0] === "api" &&
        parts[1] === "assets" &&
        parts[2] &&
        ["file", "thumbnail"].includes(parts[3])
      ) {
        const asset = store.getAsset(parts[2]);
        if (!asset) throw new StoreError("Asset not found", 404);
        const rel = parts[3] === "file" ? asset.path : asset.thumbnailPath;
        if (!rel) throw new StoreError("Thumbnail unavailable", 404);
        const file = contained(workspace, rel);
        const actual = await realpath(file);
        const workspaceReal = await realpath(workspace);
        contained(workspaceReal, path.relative(workspaceReal, actual));
        const sourceType =
          mime[path.extname(asset.metadata?.originPath || "").toLowerCase()];
        return await streamFile(
          req,
          res,
          actual,
          parts[3] === "file" ? sourceType : undefined,
        );
      }
      if (
        parts[0] === "api" &&
        parts[1] === "jobs" &&
        parts[2] &&
        parts[3] === "file"
      ) {
        const job = store.getJob(parts[2]);
        if (job && job.deletionState !== "present")
          throw new StoreError(job.deletionState === "deleted" ? "This output was deleted" : "This output is being deleted", 410);
        if (!job || job.state !== "completed" || !job.outputPath)
          throw new StoreError("Completed artifact not found", 404);
        const workspaceReal = await realpath(workspace);
        const actual = await realpath(contained(workspace, job.outputPath));
        contained(workspaceReal, path.relative(workspaceReal, actual));
        return await streamFile(req, res, actual);
      }
      if (!["GET", "HEAD"].includes(req.method))
        throw new StoreError("Route not found", 404);
      const relative =
        ["/", "/episodes", "/branding", "/models"].includes(url.pathname)
          ? "index.html"
          : decodeURIComponent(url.pathname.slice(1));
      return await streamFile(req, res, contained(publicDir, relative));
    } catch (error) {
      if (!res.headersSent)
        send(res, error.statusCode || (error.code === "ENOENT" ? 404 : 500), {
          error: error.message || "Internal error",
          ...(error.current ? { current: error.current } : {}),
          ...(error.committed ? { committed: error.committed } : {}),
          ...(error.conflictPath ? { conflictPath: error.conflictPath } : {}),
          ...(error.issues ? { issues: error.issues } : {}),
          ...(error.candidates ? { candidates: error.candidates } : {}),
        });
      else res.destroy();
    }
  });
  const close = () =>
    (closePromise ||= (async () => {
      closing = true;
      for (const response of eventStreams) response.end();
      const stopped = server.listening
        ? new Promise((resolve) => server.close(resolve))
        : Promise.resolve();
      await Promise.allSettled([stopped, renders.close("Job cancelled during server shutdown"), chat.close()]);
      store.close();
    })());
  return { server, store, chat, renders, close, health };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const config = options(process.argv);
  const { server, close } = await createApp(config);
  // Loopback by default. The Docker app container sets STORYBENCH_BIND_HOST=0.0.0.0 so its
  // host publication (bound to 127.0.0.1 on the host by the lifecycle entry point) works.
  const bindHost = process.env.STORYBENCH_BIND_HOST === "0.0.0.0" ? "0.0.0.0" : "127.0.0.1";
  server.listen(config.port, bindHost, () =>
    console.log(
      `Storybench: http://127.0.0.1:${server.address().port} — ${config.dataRoot ? `data root ${config.dataRoot}` : `workspace ${config.workspace}`}`,
    ),
  );
  const shutdown = async () => {
    await close();
    process.exitCode = 0;
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

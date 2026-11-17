import { previewMetadata, previewTarget } from './preview.js';
import { renderSvg } from './svg-render.js';
import { projectContentType, downloadDisposition } from './project-files.js';
import { createDeckService } from './deck-service.js';
import { createDeckCapture, reportsState, validateCaptureState, CAPTURE_REBUILD } from './deck-capture.js';
import { controlRequest } from './runtime/channel.js';
import { FONTS, fontPath, fontCatalog } from './fonts.js';
import { validateSelection } from './runtime/conversation-runtime.js';
import http from "node:http";
import { readFile, rm, stat, realpath } from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Store, StoreError, RESEARCH_TRANSPORT_BYTES } from "./store.js";
import { importMedia } from "./media.js";
import { createChatService } from "./chat.js";
import { createModelCatalog, createWorkerHarnessFactory } from "./runtime/app-runtime.js";
import { conversationPersistenceFor } from "./runtime/conversation-persistence.js";
import { startDeckReadiness } from "./runtime/deck-readiness.js";
import { createHealth, releaseFromEnv } from "./runtime/health.js";
import { createLibraryService } from "./library.js";
import { renderGraphic, validateGraphicRecipe } from "./graphics.js";
import { createRenderService } from "./render-service.js";
import { openDataRoot } from "./services/data-root.js";
import { createChannel, listChannels, openChannel, renameChannel, useChannel } from "./services/channels.js";
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
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".txt": "text/plain; charset=utf-8",
  ".mov": "video/quicktime",
  ".m4v": "video/x-m4v",
  ".xhtml": "application/xhtml+xml",
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

async function jsonBody(req, limit = 6_500_000) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    bytes += chunk.length;
    if (bytes > limit) {
      req.resume();
      throw new StoreError(`Request body exceeds the ${limit} byte transport limit; shorten it before saving`, 413);
    }
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
async function streamFile(req, res, file, contentType, status = 200) {
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
    res.writeHead(status, { ...headers, "content-length": info.size });
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
  await startDeckReadiness(releaseFromEnv());
  const store = dataRoot ? openDataRoot(dataRoot, { startup: true, storeOptions }) : new Store(workspaceOption, storeOptions);
  const workspace = store.workspace;
  const listeners = new Map();
  const notify = (episodeId) => listeners.get(episodeId)?.forEach((fn) => fn());
  const library = createLibraryService({ workspace, store });
  const decks = createDeckService({store,onChange:notify});
  const deckCapture = createDeckCapture({ store });
  const renders = createRenderService({ workspace, store, renderGraphic, validateGraphicRecipe, ...renderOptions, onChange: notify });
  // In the Docker app container the host lifecycle entry point provides a private control
  // socket; Codex turns then run in request-scoped workers instead of in-process.
  const runtimeControl = process.env.STORYBENCH_RUNTIME_CONTROL;
  const runtimeChat = runtimeControl && !chatOptions.codexFactory ? { codexFactory: createWorkerHarnessFactory({ store, controlSocket: runtimeControl }) } : {};
  // Harness/model selection and native-session continuity need the conversation persistence
  // (schema v9) and the host's model catalogue; without either, the legacy Codex path runs.
  const catalog = chatOptions.catalog ?? (runtimeControl ? createModelCatalog({ controlSocket: runtimeControl }) : null);
  const persistence = chatOptions.persistence ?? conversationPersistenceFor(store);
  const continuity = catalog && persistence ? { persistence, catalog: (options) => catalog.list(options) } : null;
  const chat = createChatService({ store, renders, decks, onChange: notify, ...runtimeChat, continuity, requestPersistence: persistence, ...chatOptions });
  const eventStreams = new Set();
  let closing = false;
  let closePromise;
  let activeMutations = 0;
  let activeFileReads = 0;
  const streamProjectFile = async (req, res, file, asset = {}, label) => {
    const type = projectContentType(asset, file);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (!res.hasHeader('Content-Disposition')) res.setHeader('Content-Disposition',
      downloadDisposition(new URL(req.url, 'http://localhost').searchParams.get('download') === '1', label || asset.name, asset.name || file));
    if (/^(image\/svg\+xml|text\/html|application\/xhtml\+xml)$/.test(type) && !res.hasHeader('Content-Security-Policy'))
      res.setHeader('Content-Security-Policy', 'sandbox');
    activeFileReads++;
    let released = false;
    const release = () => { if (!released) { released = true; activeFileReads--; } };
    res.once("close", release);
    try { return await streamFile(req, res, file, type); }
    catch (error) { release(); throw error; }
  };
  const health = createHealth({ store, getState: () => (closing ? "draining" : "ready") });
  const deletionBusyReason = () => {
    if (activeMutations > 1) return "Another change is still in progress. Let it finish before deleting channels.";
    if (activeFileReads) return "A production file is still being read. Let the download finish before deleting channels.";
    if (chat.workerStopFailure()) return `A worker could not be stopped: ${chat.workerStopFailure()}. Repair worker cleanup or restart Storybench before deleting channels.`;
    if (chat.hasActiveWorkers() || store.db.prepare("SELECT 1 FROM conversations WHERE state IN ('queued','running','interrupting') LIMIT 1").get() ||
      store.db.prepare("SELECT 1 FROM production_runs WHERE state IN ('starting','running') LIMIT 1").get())
      return "An agent turn is active. Let it finish and its worker stop before deleting channels.";
    if (renders.hasActiveWork() || decks.hasActiveWork() ||
      store.db.prepare("SELECT 1 FROM jobs WHERE state IN ('queued','running','cancelling') LIMIT 1").get())
      return "Production work is active. Let it finish or cancel it before deleting channels.";
    return null;
  };

  const server = http.createServer(async (req, res) => {
    const mutating = !["GET", "HEAD"].includes(req.method);
    if (mutating) activeMutations++;
    try {
      ensureLocal(req);
      if (closing && !["GET", "HEAD"].includes(req.method)) throw new StoreError("Application is shutting down", 503);
      const url = new URL(req.url, `http://${req.headers.host}`);
      const parts = url.pathname.split("/").filter(Boolean);
      // Channel scope is explicit per request (query or header, captured by each open view). The persisted
      // default is only a fallback for navigation entry; it never retargets an explicitly scoped request.
      const requestedChannel = url.searchParams.get("channel") || String(req.headers["x-storybench-channel"] || "") || null;
      const viewChannel = () => requestedChannel ? store.requireChannel(requestedChannel) : store.getDefaultChannel();
      if (req.method === 'POST' && parts[0] === 'api' && parts[1] === 'preview' && parts.at(-1) === 'redline') {
        // The redline popup's upload: pinned to the previewed asset, so a deleted asset or unavailable channel refuses it.
        const { metadata } = await previewTarget(store, workspace, parts.slice(2, -1), requestedChannel);
        if (!/^image\/png(;|$)/i.test(String(req.headers['content-type'] || ''))) throw new StoreError('A redline must be a PNG image', 415);
        const position = String(req.headers['x-redline-position'] || '');
        if (position && !/^(at \d+:\d{2}\.\d|slide \d+)$/.test(position)) throw new StoreError('Redline position must be a timecode or slide number');
        const value = await library.registerRedline({ episodeId: metadata.episodeId, readable: req,
          label: `Redline — ${metadata.label}${position ? ` ${position}` : ''}`, signal: AbortSignal.timeout(60_000) });
        notify(metadata.episodeId);
        return send(res, value.created ? 201 : 200, value.item);
      }
      if (['GET', 'HEAD'].includes(req.method) && parts[0] === 'api' && parts[1] === 'preview' && parts.at(-1) === 'raster') {
        // Fallback base image when the browser refuses to read an SVG drawn into a canvas.
        const { metadata, file } = await previewTarget(store, workspace, parts.slice(2, -1), requestedChannel);
        if (metadata.contentType !== 'image/svg+xml') throw new StoreError('Only SVG previews have a server raster', 404);
        const png = await renderSvg(await readFile(file), { maxWidth: 2048 });
        res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-length': png.length });
        return res.end(req.method === 'HEAD' ? undefined : png);
      }
      if (['GET', 'HEAD'].includes(req.method) && (parts[0] === 'preview' || (parts[0] === 'api' && parts[1] === 'preview'))) {
        const page = parts[0] === 'preview';
        let status = 200;
        try {
          const metadata = await previewMetadata(store, workspace, parts.slice(page ? 1 : 2), requestedChannel);
          if (!page) return send(res, 200, metadata);
        } catch (error) {
          if (!page || ![404, 410].includes(error.statusCode)) throw error;
          status = error.statusCode;
        }
        return await streamFile(req, res, path.join(publicDir, 'preview.html'), undefined, status);
      }
      if (req.method === 'POST' && parts.length === 5 && parts[0] === 'api' && parts[1] === 'preview' && parts[2] === 'deck' && parts[4] === 'capture') {
        // Same channel, deletion and completed-build checks as the Preview page itself.
        await previewMetadata(store, workspace, ['deck', parts[3]], requestedChannel);
        const job = store.getJob(parts[3]);
        if (!reportsState(job)) throw new StoreError(CAPTURE_REBUILD, 409);
        const png = await deckCapture.capture(job, validateCaptureState(job, await jsonBody(req)));
        res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-length': png.length });
        return res.end(png);
      }
      if (req.method === "GET" && url.pathname === "/api/health") return send(res, closing ? 503 : 200, health.snapshot());
      if (parts[0] === 'api' && parts[1] === 'providers') {
        if (!runtimeControl) throw new StoreError('Providers need the Storybench host runtime', 409);
        res.setHeader('Cache-Control', 'no-store');
        if (req.method === 'GET' && parts.length === 2) return send(res, 200, await controlRequest(runtimeControl, { op: 'providers.list' }));
        if (req.method === 'PUT' && parts.length === 2) return send(res, 200, await controlRequest(runtimeControl, { op: 'providers.gateway', gateway: await jsonBody(req) }));
        const source = parts[2];
        if (req.method === 'PUT' && parts.length === 3) { const body = await jsonBody(req); return send(res, 200, await controlRequest(runtimeControl, { op: 'providers.key', source, key: body.key, saveUnchecked: body.saveUnchecked === true })); }
        if (req.method === 'DELETE' && parts.length === 3) return send(res, 200, await controlRequest(runtimeControl, { op: 'providers.remove', source }));
        if (req.method === 'POST' && parts[3] === 'test') return send(res, 200, await controlRequest(runtimeControl, { op: 'providers.test', source }));
      }
      if (req.method === "GET" && url.pathname === "/api/harnesses") {
        if (!catalog) return send(res, 200, { available: false, reason: "Harness selection needs the Storybench runtime (Docker lifecycle)", harnesses: [] });
        return send(res, 200, { available: Boolean(continuity), reason: continuity ? null : "Conversation settings storage is not available in this data root yet", harnesses: await catalog.list({ refresh: url.searchParams.get("refresh") === "1" }) });
      }
      if (req.method === "GET" && url.pathname === "/api/model-defaults") return send(res, 200, store.listModelDefaults());
      if (url.pathname === "/api/model-default") {
        if (req.method === "GET") return send(res, 200, store.getModelDefault(url.searchParams.get("mode") || "video"));
        if (req.method === "PUT") {
          if (!continuity) throw new StoreError("Model selection needs the Storybench runtime", 409);
          const body = await jsonBody(req);
          const { source, harness, model, effort, notes } = validateSelection(await catalog.list({}), body.selection ?? {});
          return send(res, 200, { ...store.saveModelDefault(body.expectedRevision, { source, harness, model, effort }, body.mode || "video"), notes });
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
      if (req.method === "GET" && url.pathname === "/api/production-search") {
        const channels = new Map(store.listChannels().map((channel) => [channel.id, channel.name]));
        return send(res, 200, store.listEpisodes().map(({ id, channelId, title, state, archivedAt, updatedAt }) => ({
          id, channelId, channelName: channels.get(channelId), title, stage: archivedAt ? `Archived · ${state}` : state, updatedAt,
        })));
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
      if (parts[0] === "api" && parts[1] === "channel-deletions") {
        if (parts.length === 2 && req.method === "GET") return send(res, 200, store.channelDeletion.list());
        if (parts.length === 3 && parts[2] === "preview" && req.method === "POST")
          return send(res, 200, store.channelDeletion.preview((await jsonBody(req))?.channelIds));
        if (parts.length === 2 && req.method === "POST") {
          const result = store.channelDeletion.accept(await jsonBody(req), deletionBusyReason);
          return send(res, result.state === "completed" ? 200 : 202, result);
        }
        if (parts.length === 3 && req.method === "GET") return send(res, 200, store.channelDeletion.status(parts[2]));
        if (parts.length === 4 && parts[3] === "retry" && req.method === "POST") {
          const reason = deletionBusyReason();
          if (reason) throw new StoreError(reason, 409);
          const result = store.channelDeletion.finish(parts[2]);
          return send(res, result.state === "completed" ? 200 : 202, result);
        }
      }
      if (parts[0] === "api" && parts[1] === "channels") {
        if (parts.length === 2 && req.method === "GET") return send(res, 200, listChannels(store));
        if (parts.length === 2 && req.method === "POST") return send(res, 201, createChannel(store, (await jsonBody(req)).name));
        if (parts[2] === "default" && parts.length === 3 && req.method === "GET") return send(res, 200, { channel: store.getDefaultChannel() });
        if (parts[2] === "default" && parts.length === 3 && req.method === "PUT") return send(res, 200, useChannel(store, (await jsonBody(req)).channel));
        if (parts[2] && parts.length === 3 && req.method === "GET") return send(res, 200, store.requireChannel(parts[2]));
        if (parts[2] && parts.length === 3 && req.method === "PUT") {
          const body = await jsonBody(req);
          if (!Number.isInteger(body.expectedRevision)) throw new StoreError("expectedRevision is required to rename a channel");
          return send(res, 200, renameChannel(store, store.requireChannel(parts[2]).id, body.name, body.expectedRevision));
        }
        if (parts[2] && parts[3] === "open" && parts.length === 4 && req.method === "POST")
          return send(res, 200, openChannel(store, parts[2]));
        if (parts[2] && parts[3] === "episodes" && parts.length === 4 && req.method === "GET")
          return send(res, 200, store.listEpisodes({ channelId: store.requireChannel(parts[2]).id }));
        if (parts[2] && parts[3] === "episodes" && parts.length === 4 && req.method === "POST") {
          const body = await jsonBody(req);
          return send(res, 201, store.createEpisode({ title: body.title, notes: body.notes, kind: body.kind, channelId: store.requireChannel(parts[2]).id }));
        }
      }
      if (req.method === "POST" && url.pathname === "/api/episodes") {
        const body = await jsonBody(req);
        return send(res, 201, store.createEpisode({ title: body.title, notes: body.notes, kind: body.kind, channelId: body.channelId ?? requestedChannel }));
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
        if (parts[3] === "research" && parts.length === 4 && ["GET", "PUT"].includes(req.method)) {
          const current = store.getResearch(episodeId);
          if (requestedChannel) store.assertEpisodeChannel(episodeId, requestedChannel);
          if (req.method === "GET") return send(res, 200, current);
          const body = await jsonBody(req, RESEARCH_TRANSPORT_BYTES);
          if (!body || typeof body !== "object" || Array.isArray(body)) throw new StoreError("Research must contain expectedResearchRevision, summary and links");
          const value = store.saveResearch(episodeId, body.expectedResearchRevision, body, "human");
          notify(episodeId);
          return send(res, 200, value);
        }
        // Every episode-scoped route validates the caller's channel together with the episode ID.
        if (!store.getEpisode(episodeId)) throw new StoreError("Episode not found", 404);
        if (requestedChannel) store.assertEpisodeChannel(episodeId, requestedChannel);
        if (parts[3] === 'events' && parts.length === 4 && req.method === 'GET') {
          res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
          eventStreams.add(res);
          const emit = () => res.write(`data: ${JSON.stringify({ episodeId })}\n\n`);
          const subscribers = listeners.get(episodeId) || new Set();
          subscribers.add(emit); listeners.set(episodeId, subscribers);
          emit();
          const keep = setInterval(() => res.write(': keepalive\n\n'), 20000);
          req.on('close', () => {
            clearInterval(keep); eventStreams.delete(res); subscribers.delete(emit);
            if (!subscribers.size) listeners.delete(episodeId);
          });
          return;
        }
        if (parts.length === 3 && req.method === "GET") {
          const value = store.getEpisode(episodeId);
          if (!value) throw new StoreError("Episode not found", 404);
          return send(res, 200, value);
        }
        if (parts[3] === 'deck-build' && parts.length === 4 && req.method === 'POST') {
          return send(res,202,decks.enqueue({expectedRevision:(await jsonBody(req)).expectedRevision,episodeId,requestId:null}));
        }
        if (parts[3] === "slides" && parts.length === 4) {
          if (req.method === "GET") return send(res, 200, store.getDeck(episodeId));
          if (req.method === "PUT") {
            const body = await jsonBody(req);
            const value = store.saveDeck(episodeId, body.expectedRevision, body.slides);
            notify(episodeId); return send(res, 200, value);
          }
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
          if (parts[4] && parts.length === 5 && req.method === "DELETE") {
            const body = await jsonBody(req);
            const value = store.deleteLibraryItem(episodeId, parts[4], body.expectedRevision, body.expectedEpisodeRevision);
            notify(episodeId);
            return send(res, 200, value);
          }
          if (parts[4] && parts[5] === "file" && parts.length === 6 && ["GET", "HEAD"].includes(req.method)) {
            const item = store.getLibraryItem(episodeId, parts[4]);
            if (!item) throw new StoreError("Library item not found", 404);
            const actual = await realpath(contained(workspace, item.asset.path));
            const workspaceReal = await realpath(workspace);
            contained(workspaceReal, path.relative(workspaceReal, actual));
            return await streamProjectFile(req, res, actual, item.asset, item.label);
          }
          if (parts[4] && parts[5] === "thumbnail" && parts.length === 6 && ["GET", "HEAD"].includes(req.method)) {
            const item = store.getLibraryItem(episodeId, parts[4]);
            if (!item?.asset.thumbnailPath) throw new StoreError("Thumbnail unavailable", 404);
            const actual = await realpath(contained(workspace, item.asset.thumbnailPath));
            const workspaceReal = await realpath(workspace);
            contained(workspaceReal, path.relative(workspaceReal, actual));
            return await streamProjectFile(req, res, actual);
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
          const value = (store.getEpisode(episodeId)?.kind === 'deck' ? decks : renders).cancelJob(episodeId, parts[4]); notify(episodeId); return send(res, 200, value);
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
        if (!asset || (requestedChannel && asset.channelId !== requestedChannel)) throw new StoreError("Asset not found", 404);
        const rel = parts[3] === "file" ? asset.path : asset.thumbnailPath;
        if (!rel) throw new StoreError("Thumbnail unavailable", 404);
        const file = contained(workspace, rel);
        const actual = await realpath(file);
        const workspaceReal = await realpath(workspace);
        contained(workspaceReal, path.relative(workspaceReal, actual));
        return await streamProjectFile(
          req,
          res,
          actual,
          parts[3] === "file" ? asset : undefined,
        );
      }
      if (parts[0] === 'api' && parts[1] === 'jobs' && parts[2] && parts[3] === 'deck' && ['GET','HEAD'].includes(req.method)) {
        const job = store.getJob(parts[2]);
        if (!job || job.kind !== 'deck' || job.state !== 'completed') throw new StoreError('Completed deck not found',404);
        if (requestedChannel) store.assertEpisodeChannel(job.episodeId,requestedChannel);
        const name = decodeURIComponent(parts.slice(4).join('/')) || 'index.html';
        if (name !== 'bundle.zip' && !job.snapshot.manifest.files.includes(name)) throw new StoreError('Bundle file not found',404);
        const base = path.dirname(contained(workspace,job.outputPath)), file = contained(base,name);
        const actual = await realpath(file);
        if (actual !== file) throw new StoreError('Unsafe bundle path',403);
        // A CSP sandbox forces an opaque origin even if opened directly. The app iframe
        // adds the same boundary. No app storage, network or app-origin script authority.
        res.setHeader('Content-Security-Policy', "sandbox allow-scripts; default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; media-src 'self'; connect-src 'none'");
        res.setHeader('X-Content-Type-Options','nosniff');
        // Sandboxed previews have an opaque origin; bundled fonts need anonymous CORS.
        if (path.extname(name) === '.ttf') res.setHeader('Access-Control-Allow-Origin', '*');
        if (name === 'bundle.zip') res.setHeader('Content-Disposition','attachment; filename="deck-bundle.zip"');
        return await streamProjectFile(req,res,file, { metadata: { contentType: mime[path.extname(file)] } });
      }
      if (
        parts[0] === "api" &&
        parts[1] === "jobs" &&
        parts[2] &&
        parts[3] === "file"
      ) {
        const job = store.getJob(parts[2]);
        if (job && requestedChannel && store.getEpisode(job.episodeId)?.channelId !== requestedChannel)
          throw new StoreError("Completed artifact not found", 404);
        if (job && job.deletionState !== "present")
          throw new StoreError(job.deletionState === "deleted" ? "This output was deleted" : "This output is being deleted", 410);
        if (!job || job.state !== "completed" || !job.outputPath)
          throw new StoreError("Completed artifact not found", 404);
        const workspaceReal = await realpath(workspace);
        const actual = await realpath(contained(workspace, job.outputPath));
        contained(workspaceReal, path.relative(workspaceReal, actual));
        const asset = job.snapshot?.assetId ? store.getAsset(job.snapshot.assetId) : undefined;
        const label = job.outputClass === 'graphic' ? asset?.name : `${job.outputClass === 'final' ? 'Final' : 'Draft'} — ${job.createdAt}`;
        return await streamProjectFile(req, res, actual, asset, label);
      }
      if (!["GET", "HEAD"].includes(req.method))
        throw new StoreError("Route not found", 404);
      const relative =
        ["/", "/episodes", "/branding", "/models", "/providers"].includes(url.pathname)
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
    } finally {
      if (mutating) activeMutations--;
    }
  });
  const close = () =>
    (closePromise ||= (async () => {
      closing = true;
      for (const response of eventStreams) response.end();
      const stopped = server.listening
        ? new Promise((resolve) => server.close(resolve))
        : Promise.resolve();
      await Promise.allSettled([stopped, decks.close(), renders.close("Job cancelled during server shutdown"), chat.close()]);
      store.close();
    })());
  return { server, store, chat, renders, decks, close, health };
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

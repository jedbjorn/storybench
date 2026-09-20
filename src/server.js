import http from "node:http";
import { stat, realpath } from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Store, StoreError } from "./store.js";
import { importMedia } from "./media.js";
import { createChatService } from "./chat.js";
import { createLibraryService } from "./library.js";
import { renderGraphic, validateGraphicRecipe } from "./graphics.js";
import { createRenderService } from "./render-service.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = path.join(root, "public");
const mime = {
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

function options(argv) {
  const out = {
    workspace: process.env.STORYBENCH_WORKSPACE,
    port: Number(process.env.SC_DEV_PORT || process.env.PORT || 4173),
  };
  for (let i = 2; i < argv.length; i++)
    if (argv[i] === "--workspace") out.workspace = argv[++i];
    else if (argv[i] === "--port") out.port = Number(argv[++i]);
  if (!out.workspace || !path.isAbsolute(out.workspace))
    throw new Error("Start with --workspace /absolute/channel/path");
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

export async function createApp({ workspace, onListen, storeOptions } = {}) {
  const store = new Store(workspace, storeOptions);
  const listeners = new Map();
  const notify = (episodeId) => listeners.get(episodeId)?.forEach((fn) => fn());
  const chat = createChatService({ store, onChange: notify });
  const library = createLibraryService({ workspace, store });
  const renders = createRenderService({ workspace, store, renderGraphic, validateGraphicRecipe });
  const eventStreams = new Set();
  let closing = false;
  let closePromise;

  const server = http.createServer(async (req, res) => {
    try {
      ensureLocal(req);
      const url = new URL(req.url, `http://${req.headers.host}`);
      const parts = url.pathname.split("/").filter(Boolean);
      if (req.method === "GET" && url.pathname === "/api/state")
        return send(res, 200, {
          episodes: store.listEpisodes(),
          assets: store.listAssets(),
          jobs: store.listJobs().map((job) => {
            try { return renders.getJob(job.episodeId, job.id); } catch { return job; }
          }),
        });
      if (req.method === "POST" && url.pathname === "/api/episodes")
        return send(res, 201, store.createEpisode(await jsonBody(req)));
      if (req.method === "GET" && url.pathname === "/api/branding")
        return send(res, 200, store.listBrandingTemplates());
      if (parts[0] === "api" && parts[1] === "branding" && parts[2] && req.method === "PUT") {
        const body = await jsonBody(req);
        return send(res, 200, store.setBrandingRole(parts[2], body.role ?? null));
      }
      if (parts[0] === "api" && parts[1] === "episodes" && parts[2]) {
        const episodeId = parts[2];
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
            const value = renders.enqueueGraphic({ episodeId, recipeId: parts[4], expectedRecipeRevision: body.expectedRecipeRevision });
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
          return send(res, 202, renders.enqueueRender({ episodeId, outputClass,
            expectedRenderRevision,
            finalGrantId: body.finalGrantId, conversationId: body.conversationId ?? null, requestId: body.requestId ?? null }));
        }
        if (parts[3] === "final-authorizations" && req.method === "POST") {
          const body = await jsonBody(req);
          return send(res, 201, renders.mintFinalGrant({ episodeId,
            expectedRenderRevision: body.expectedRenderRevision,
            conversationId: body.conversationId ?? null, requestId: body.requestId ?? null }));
        }
        if (parts[3] === "jobs" && parts[4] && parts[5] === "cancel" && req.method === "POST") {
          const value = renders.cancelJob(episodeId, parts[4]); notify(episodeId); return send(res, 200, value);
        }
        if (parts[3] === "chat") {
          if (parts.length === 4 && req.method === "GET")
            return send(res, 200, await chat.get(episodeId));
          if (parts.length === 4 && req.method === "POST") {
            const body = await jsonBody(req);
            if (!String(body.text || "").trim())
              throw new StoreError("Chat message is required");
            return send(
              res,
              202,
              await chat.send(episodeId, String(body.text)),
            );
          }
          if (parts[4] === "interrupt" && req.method === "POST")
            return send(res, 202, await chat.interrupt(episodeId));
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
                `data: ${JSON.stringify(await chat.get(episodeId))}\n\n`,
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
        const candidate = await importMedia({
          workspace,
          sourcePath: body.path,
        });
        return send(res, 201, store.saveAsset(candidate));
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
        url.pathname === "/"
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
  return { server, store, chat, renders, close };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const config = options(process.argv);
  const { server, close } = await createApp(config);
  server.listen(config.port, "127.0.0.1", () =>
    console.log(
      `Storybench: http://127.0.0.1:${server.address().port} — workspace ${config.workspace}`,
    ),
  );
  const shutdown = async () => {
    await close();
    process.exitCode = 0;
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

import http from "node:http";
import { stat, mkdir, realpath } from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Store, StoreError } from "./store.js";
import { importMedia, renderEpisode } from "./media.js";
import { createChatService } from "./chat.js";

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
    if (bytes > 1_000_000) throw new StoreError("Request body too large", 413);
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
  const headers = {
    "content-type":
      contentType ||
      mime[path.extname(file).toLowerCase()] ||
      "application/octet-stream",
    "accept-ranges": "bytes",
    "cache-control": "private, max-age=3600",
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

export async function createApp({ workspace, onListen } = {}) {
  const store = new Store(workspace);
  const listeners = new Map();
  const notify = (episodeId) => listeners.get(episodeId)?.forEach((fn) => fn());
  const chat = createChatService({ store, onChange: notify });
  let renderTail = Promise.resolve();
  const activeRenders = new Set();
  const eventStreams = new Set();
  let closing = false;
  let closePromise;
  const enqueue = (episode, kind) => {
    const assets = store.listAssets();
    let job = store.saveJob({
      episodeId: episode.id,
      kind,
      state: "queued",
      progress: 0,
      revision: episode.revision,
      snapshot: { episode, assets },
    });
    renderTail = renderTail
      .catch(() => {})
      .then(async () => {
        if (closing) {
          store.saveJob({
            ...job,
            state: "failed",
            error: "Render cancelled during server shutdown",
          });
          return;
        }
        job = store.saveJob({ ...job, state: "running" });
        const controller = new AbortController();
        activeRenders.add(controller);
        try {
          const folder = path.join(workspace, "exports");
          await mkdir(folder, { recursive: true });
          const outputPath = path.join(
            folder,
            `${episode.id}-${job.id}-${kind}.mp4`,
          );
          const result = await renderEpisode({
            workspace,
            episode,
            assets,
            outputPath,
            preview: kind === "preview",
            signal: controller.signal,
            onProgress: (progress) => {
              job = store.saveJob({
                ...job,
                state: "running",
                progress: Math.max(0, Math.min(1, Number(progress) || 0)),
              });
            },
          });
          const rel = path.relative(
            workspace,
            path.resolve(result.path || outputPath),
          );
          contained(workspace, rel);
          job = store.saveJob({
            ...job,
            state: "completed",
            progress: 1,
            outputPath: rel,
            error: null,
          });
        } catch (error) {
          job = store.saveJob({
            ...job,
            state: "failed",
            error: error.message || String(error),
            outputPath: null,
          });
        } finally {
          activeRenders.delete(controller);
        }
      });
    return job;
  };

  const server = http.createServer(async (req, res) => {
    try {
      ensureLocal(req);
      const url = new URL(req.url, `http://${req.headers.host}`);
      const parts = url.pathname.split("/").filter(Boolean);
      if (req.method === "GET" && url.pathname === "/api/state")
        return send(res, 200, {
          episodes: store.listEpisodes(),
          assets: store.listAssets(),
          jobs: store.listJobs(),
        });
      if (req.method === "POST" && url.pathname === "/api/episodes")
        return send(res, 201, store.createEpisode(await jsonBody(req)));
      if (parts[0] === "api" && parts[1] === "episodes" && parts[2]) {
        const episodeId = parts[2];
        if (parts.length === 3 && req.method === "GET") {
          const value = store.getEpisode(episodeId);
          if (!value) throw new StoreError("Episode not found", 404);
          return send(res, 200, value);
        }
        if (parts[3] === "history" && req.method === "GET")
          return send(res, 200, store.listEpisodeHistory(episodeId));
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
          if (!["preview", "export"].includes(body.kind))
            throw new StoreError("kind must be preview or export");
          const episode = store.getEpisode(episodeId);
          if (!episode) throw new StoreError("Episode not found", 404);
          return send(res, 202, enqueue(episode, body.kind));
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
        return streamFile(
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
        return streamFile(req, res, actual);
      }
      if (!["GET", "HEAD"].includes(req.method))
        throw new StoreError("Route not found", 404);
      const relative =
        url.pathname === "/"
          ? "index.html"
          : decodeURIComponent(url.pathname.slice(1));
      return streamFile(req, res, contained(publicDir, relative));
    } catch (error) {
      if (!res.headersSent)
        send(res, error.statusCode || (error.code === "ENOENT" ? 404 : 500), {
          error: error.message || "Internal error",
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
      for (const controller of activeRenders) controller.abort();
      await Promise.allSettled([stopped, renderTail, chat.close()]);
      store.close();
    })());
  return { server, store, chat, close };
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

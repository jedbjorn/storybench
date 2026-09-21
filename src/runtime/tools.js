// Scoped app tools for an episode worker request. The app binds each tool set to one
// episode / conversation / request; the worker cannot choose another scope. The same
// implementations serve Codex (app-server dynamic tools) and Claude (MCP via the
// request bridge). Storage/mutation rules stay in the existing app services.
import { spawn } from "node:child_process";
import { rm, stat } from "node:fs/promises";
import path from "node:path";
import { importMedia } from "../media.js";
import { PROJECT_ROOTS } from "./layout.js";
import { RuntimeError, resolveProjectFile, resolveWorkFile } from "./validate.js";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

function ffmpegFrame(file, atSeconds, { maxWidth = 1024, signal } = {}) {
  const args = ["-v", "error", "-nostdin"];
  if (atSeconds != null) args.push("-ss", String(atSeconds));
  args.push("-i", file, "-frames:v", "1", "-vf", `scale='min(${maxWidth},iw)':-2`, "-f", "image2pipe", "-vcodec", "png", "-");
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"], signal });
    const chunks = [];
    let size = 0, stderr = "";
    child.stdout.on("data", (chunk) => { size += chunk.length; if (size <= MAX_IMAGE_BYTES) chunks.push(chunk); });
    child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-2000); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new RuntimeError("FRAME_FAILED", `Could not decode an image: ${stderr.trim() || `ffmpeg exit ${code}`}`));
      if (!size) return reject(new RuntimeError("FRAME_FAILED", "No frame exists at that timestamp"));
      if (size > MAX_IMAGE_BYTES) return reject(new RuntimeError("FRAME_TOO_LARGE", "Decoded frame is too large"));
      resolve(Buffer.concat(chunks));
    });
  });
}

async function waitForStableFile(file, expected, { settleMs = 300 } = {}) {
  await new Promise((resolve) => setTimeout(resolve, settleMs));
  const after = await stat(file);
  if (after.size !== expected.size || after.mtimeMs !== expected.mtimeMs || after.ino !== expected.ino)
    throw new RuntimeError("FILE_NOT_COMPLETE", "The work file is still changing; register it after it is completely written", { status: 409 });
  if (!after.size) throw new RuntimeError("FILE_EMPTY", "The work file is empty", { status: 409 });
}

export const TOOL_DEFINITIONS = Object.freeze([
  {
    name: "register_work_file",
    description: "Register a completed media file from this episode's work/ directory as a Storybench library item. Returns the library asset ID. Only files inside work/ can be registered; symlinks and partially written files are rejected.",
    inputSchema: {
      type: "object", additionalProperties: false, required: ["path"],
      properties: {
        path: { type: "string", description: "Path to the file, relative to the episode directory (for example work/title.png) or absolute." },
        name: { type: "string", description: "Optional display name for the library item." },
      },
    },
  },
  {
    name: "inspect_image",
    description: "Look at an image file, or a video frame at a timestamp, from any Storybench project directory. Returns the actual image so you can see it.",
    inputSchema: {
      type: "object", additionalProperties: false, required: ["path"],
      properties: {
        path: { type: "string", description: "Path relative to the episode directory, or an absolute project path." },
        atSeconds: { type: "number", minimum: 0, maximum: 86400, description: "For video: the timestamp in seconds of the frame to view." },
      },
    },
  },
]);

const CATEGORY_BY_KIND = { image: "Graphics", video: "B-roll", audio: "Narration" };

// scope: { requestId, conversationId, harness, channelId, episodeId, dataRoot, episodeDir, workDir }
// (all resolved by the app from the store path API). `store` is the app's open Store:
// registration uses the existing import/storage rules (channel media directory,
// channel-scoped dedup, episode library membership); nothing is reimplemented here.
export function createScopedTools(scope, { store }) {
  const handlers = {
    async register_work_file(args = {}) {
      const file = await resolveWorkFile(scope.workDir, args.path, { base: scope.episodeDir });
      await waitForStableFile(file.path, file);
      const workspace = store.workspace;
      const imported = await importMedia({ workspace, sourcePath: file.path, mediaDirectory: store.channelMediaDirectory(scope.channelId) });
      const provenance = {
        tool: "register_work_file",
        requestId: scope.requestId, conversationId: scope.conversationId, harness: scope.harness,
        channelId: scope.channelId, episodeId: scope.episodeId,
        workPath: path.relative(scope.episodeDir, file.path),
        sourceSha256: imported.hash, sourceSize: file.size, registeredAt: new Date().toISOString(),
      };
      const name = typeof args.name === "string" && args.name.trim() ? args.name.trim().slice(0, 200) : imported.name;
      const deduplicated = Boolean(store.getAssetByHash(imported.hash, scope.channelId));
      const asset = store.saveAsset({ ...imported, channelId: scope.channelId, name, metadata: { ...imported.metadata, provenance } });
      // Same bytes already registered in this channel: keep that asset, drop the redundant copy.
      if (imported.createdFile && asset.path !== imported.path) await rm(path.join(workspace, imported.path), { force: true });
      const category = CATEGORY_BY_KIND[asset.kind] ?? "B-roll";
      const item = store.attachLibraryItem(scope.episodeId, asset.id, { category, label: name, sourceKind: "file", provenance });
      return { text: JSON.stringify({ registered: true, assetId: asset.id, libraryItemId: item?.id ?? null, category, kind: asset.kind, sha256: asset.hash, deduplicated, width: asset.width, height: asset.height, duration: asset.duration }) };
    },
    async inspect_image(args = {}) {
      const at = args.atSeconds;
      if (at != null && (typeof at !== "number" || !Number.isFinite(at) || at < 0 || at > 86400)) throw new RuntimeError("INVALID_TIMESTAMP", "atSeconds must be a number of seconds");
      const lexical = path.resolve(scope.episodeDir, String(args.path ?? ""));
      const file = await resolveProjectFile(scope.dataRoot, lexical, { projectRoots: PROJECT_ROOTS });
      const png = await ffmpegFrame(file, at);
      return {
        text: `Image of ${path.relative(scope.dataRoot, file)}${at != null ? ` at ${at}s` : ""} (${png.length} bytes PNG).`,
        images: [{ mimeType: "image/png", data: png.toString("base64") }],
      };
    },
  };
  return {
    definitions: TOOL_DEFINITIONS,
    async call(name, args) {
      if (!Object.hasOwn(handlers, name)) throw new RuntimeError("UNKNOWN_TOOL", `Unknown Storybench tool: ${String(name)}`, { status: 404 });
      return handlers[name](args && typeof args === "object" ? args : {});
    },
  };
}

// Tool output adapters: one internal result shape, two provider encodings.
export function toMcpResult(output) {
  return { content: [{ type: "text", text: output.text }, ...(output.images ?? []).map((image) => ({ type: "image", data: image.data, mimeType: image.mimeType }))] };
}

export function toCodexContentItems(output) {
  return [{ type: "inputText", text: output.text }, ...(output.images ?? []).map((image) => ({ type: "inputImage", imageUrl: `data:${image.mimeType};base64,${image.data}` }))];
}

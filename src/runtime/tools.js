// Scoped app tools for an episode worker request. The app binds each tool set to one
// episode / conversation / request; the worker cannot choose another scope. The same
// implementations serve Codex (app-server dynamic tools) and Claude (MCP via the
// request bridge). Storage/mutation rules stay in the existing app services.
import { randomUUID } from "node:crypto";
import { constants, createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { mkdir, open, rm } from "node:fs/promises";
import path from "node:path";
import { importMedia } from "../media.js";
import { StoreError } from "../store.js";
import { describeCapabilities } from "./capabilities.js";
import { CONTACT_SHEET_LIMITS, assertTimestamp, contactSheet, frameAt, mediaSummary, sheetTimestamps } from "./media-inspect.js";
import { getItem, isReferenceItem, originOf, readExcerpt, resolveTarget, searchProject } from "./project-catalog.js";
import { RuntimeError, resolveWorkFile } from "./validate.js";

// Copy a validated work file into an app-only staging directory through ONE file
// descriptor opened with O_NOFOLLOW, after checking it is still the exact inode that
// resolveWorkFile validated. Nothing after this point reads the worker-writable path, so
// a later swap of the path (e.g. to a symlink at the database) cannot change what is
// imported. Returns the staged file path (caller removes its directory).
export async function stageWorkFile(file, stagingRoot, { settleMs = 300 } = {}) {
  let handle;
  try { handle = await open(file.path, constants.O_RDONLY | constants.O_NOFOLLOW); }
  catch (error) {
    if (error.code === "ELOOP") throw new RuntimeError("PATH_SYMLINK", "Symlinks cannot be registered; write the completed file into the work area", { status: 403 });
    throw new RuntimeError("PATH_MISSING", "Work file could not be opened", { status: 404, cause: error });
  }
  const staged = path.join(stagingRoot, randomUUID(), path.basename(file.path));
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.ino !== file.ino || before.dev !== file.dev)
      throw new RuntimeError("FILE_CHANGED", "The work file changed after validation; register it again", { status: 409 });
    await new Promise((resolve) => setTimeout(resolve, settleMs));
    const settled = await handle.stat();
    if (settled.size !== before.size || settled.mtimeMs !== before.mtimeMs)
      throw new RuntimeError("FILE_NOT_COMPLETE", "The work file is still changing; register it after it is completely written", { status: 409 });
    if (!settled.size) throw new RuntimeError("FILE_EMPTY", "The work file is empty", { status: 409 });
    await mkdir(path.dirname(staged), { recursive: true, mode: 0o700 });
    await pipeline(handle.createReadStream({ start: 0, autoClose: false }), createWriteStream(staged, { flags: "wx", mode: 0o600 }));
    const after = await handle.stat();
    if (after.size !== settled.size || after.mtimeMs !== settled.mtimeMs)
      throw new RuntimeError("FILE_NOT_COMPLETE", "The work file changed while it was being copied", { status: 409 });
    return staged;
  } catch (error) {
    await rm(path.dirname(staged), { recursive: true, force: true });
    throw error;
  } finally { await handle.close(); }
}

const targetProps = {
  itemId: { type: "string", description: "Library item ID (from search_project or the episode library)." },
  episodeId: { type: "string", description: "Episode that owns itemId; defaults to the current episode. Any channel/episode in this installation may be read." },
  path: { type: "string", description: "Alternatively a file path, relative to the current episode directory or an absolute project path." },
};
const cardProps = {
  cardId: { type: "string", description: "Optional card in the current episode to receive the result." },
  expectedRevision: { type: "integer", minimum: 1, description: "The episode (board) revision you last read; required with cardId. If the board changed, the item stays in the library and the card is not changed." },
  assign: { type: "string", enum: ["item", "reference"], description: "Set as the card's media (item, default) or add to the card's references." },
};
const directionProp = {
  type: "object", additionalProperties: false, required: ["messageId"],
  description: "Optional provenance: cite the creator's chat instruction to use or edit reference material.",
  properties: {
    messageId: { type: "integer", description: "ID of the creator's message in this conversation that gives the direction." },
    use: { type: "string", enum: ["direct-use", "edit"], description: "direct-use (default) or edit." },
    note: { type: "string", description: "Short note of what was directed." },
  },
};

export const TOOL_DEFINITIONS = Object.freeze([
  {
    name: "inspect_image",
    description: "See a still image, or one video frame at an explicit timestamp, from any Storybench project (current episode, other episodes or channels). Returns the actual image plus its origin (channel/episode/item).",
    inputSchema: { type: "object", additionalProperties: false, properties: { ...targetProps, atSeconds: { type: "number", minimum: 0, maximum: 86400, description: "For video: timestamp in seconds of the frame to view." } } },
  },
  {
    name: "inspect_contact_sheet",
    description: `See a contact sheet of ${CONTACT_SHEET_LIMITS.minFrames}-${CONTACT_SHEET_LIMITS.maxFrames} evenly spaced frames from a video between two timestamps, each tile labelled with its time (read left to right, top to bottom). Returns one image plus the frame times.`,
    inputSchema: { type: "object", additionalProperties: false, required: ["startSeconds", "endSeconds"], properties: {
      ...targetProps,
      startSeconds: { type: "number", minimum: 0, description: "Range start in seconds." },
      endSeconds: { type: "number", minimum: 0, description: "Range end in seconds (greater than start)." },
      count: { type: "integer", minimum: CONTACT_SHEET_LIMITS.minFrames, maximum: CONTACT_SHEET_LIMITS.maxFrames, description: "Number of frames (default 8)." },
      columns: { type: "integer", minimum: 1, maximum: 8, description: "Tiles per row (default up to 4)." },
    } },
  },
  {
    name: "inspect_media",
    description: "Read media metadata (ffprobe): kind, duration, dimensions, frame rate, codecs, audio streams. No image.",
    inputSchema: { type: "object", additionalProperties: false, properties: targetProps },
  },
  {
    name: "read_reference_excerpt",
    description: "Read a bounded excerpt of extracted text (pasted text, PDF, web page) from a library item in any project, with its origin.",
    inputSchema: { type: "object", additionalProperties: false, required: ["itemId"], properties: {
      itemId: targetProps.itemId, episodeId: targetProps.episodeId,
      offset: { type: "integer", minimum: 0 }, limit: { type: "integer", minimum: 1, maximum: 20000 },
    } },
  },
  {
    name: "search_project",
    description: "Browse or search the installation's channels, episodes and library items. Every result is labelled with channel, episode and item; `current` marks this episode. Empty query lists everything (bounded).",
    inputSchema: { type: "object", additionalProperties: false, properties: {
      query: { type: "string", description: "Words to match in item labels/names, episode titles or channel names." },
      channelId: { type: "string" }, episodeId: { type: "string" },
      kind: { type: "string", enum: ["image", "video", "audio", "reference"] },
      category: { type: "string", enum: ["Reference", "B-roll", "Narration", "Graphics"] },
      limit: { type: "integer", minimum: 1, maximum: 200 },
    } },
  },
  {
    name: "register_work_file",
    description: "Register a completed media file you created in this episode's work/ directory as a library item (validated path inside work/, no symlinks, completed bytes, decodable image/video/audio). Records provenance, the editable source file and derivation. Optionally assigns it to a card, respecting the board revision: on conflict the item stays in the library and the conflict is reported.",
    inputSchema: { type: "object", additionalProperties: false, required: ["path"], properties: {
      path: { type: "string", description: "The finished file, e.g. work/title.png (relative to the episode directory) or absolute." },
      name: { type: "string", description: "Display name for the library item." },
      category: { type: "string", enum: ["Graphics", "B-roll", "Narration"], description: "Library category (default: Graphics for images, B-roll for video, Narration for audio)." },
      sourcePath: { type: "string", description: "Editable source in work/ that produced it (script, SVG, project file), recorded for later revision." },
      derivedFrom: { type: "array", maxItems: 20, items: { type: "object", additionalProperties: false, required: ["itemId"], properties: { itemId: { type: "string" }, episodeId: { type: "string" } } },
        description: "Library items this was made from." },
      direction: directionProp,
      ...cardProps,
    } },
  },
  {
    name: "reuse_project_item",
    description: "Reuse an item from another episode or channel in this episode when the creator asks: registers it in this episode's library with origin provenance, deduplicated within this channel, without changing the source. A creator chat instruction may be cited in `direction` for provenance. Optionally assigns it to a card (revision-checked).",
    inputSchema: { type: "object", additionalProperties: false, required: ["sourceEpisodeId", "sourceItemId"], properties: {
      sourceEpisodeId: { type: "string" }, sourceItemId: { type: "string" },
      sourceChannelId: { type: "string", description: "Optional check that the source episode is in this channel." },
      category: { type: "string", enum: ["Reference", "B-roll", "Narration", "Graphics"] },
      label: { type: "string" },
      direction: directionProp,
      ...cardProps,
    } },
  },
  {
    name: "get_capabilities",
    description: "List what is actually available in this request: harness, served Storybench tools, image input route, command execution and verified media tools, work area, and what is not available.",
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
  },
]);

const CATEGORY_BY_KIND = { image: "Graphics", video: "B-roll", audio: "Narration" };
const KINDS_FOR_CATEGORY = { Graphics: ["image", "video"], "B-roll": ["video"], Narration: ["audio"] };
const png = (bytes) => ({ mimeType: "image/png", data: bytes.toString("base64") });
const json = (value) => ({ text: JSON.stringify(value) });
const label = (origin) => [origin.channel && `channel ${origin.channel.name ?? ""} (${origin.channel.id})`, origin.episode && `episode ${origin.episode.title ?? ""} (${origin.episode.id})`, origin.item && `item ${origin.item.label} (${origin.item.id}, ${origin.item.category})`].filter(Boolean).join(" / ") || origin.path;

// Messages produced by a UI shortcut (Create draft / Create final ...) never count as creator
// direction for reference use. The store binds message origin to the role and marks only the
// app's own shortcut handler's messages as 'button' (schema v9).
export function defaultIsShortcutMessage(row) {
  return row?.origin === "button";
}

// Validate a cited creator message for reference use/edit: it must be a user message in
// this request's conversation (and so in this episode) and not a UI shortcut.
export function validateDirection(store, scope, direction, { isShortcutMessage = defaultIsShortcutMessage } = {}) {
  if (!direction || !Number.isInteger(direction.messageId))
    throw new RuntimeError("INVALID_DIRECTION", "direction.messageId must cite a creator chat message");
  const use = direction.use ?? "direct-use";
  if (!["direct-use", "edit"].includes(use)) throw new RuntimeError("INVALID_DIRECTION", "direction.use must be direct-use or edit");
  const row = store.db.prepare(`SELECT m.* FROM conversation_messages m JOIN conversations c ON c.id=m.conversation_id
    WHERE m.id=? AND c.id=? AND c.episode_id=?`).get(direction.messageId, scope.conversationId, scope.episodeId);
  if (!row) throw new RuntimeError("DIRECTION_NOT_FOUND", "The cited message is not in this conversation", { status: 404 });
  if (row.role !== "user") throw new RuntimeError("DIRECTION_NOT_CREATOR", "Only the creator's own message can direct reference use or edit", { status: 403 });
  if (isShortcutMessage(row)) throw new RuntimeError("DIRECTION_SHORTCUT", "A Create draft/final shortcut is not an explicit instruction to use reference material", { status: 403 });
  return { messageId: direction.messageId, use, note: typeof direction.note === "string" ? direction.note.slice(0, 500) : "" };
}

function recordDirection(store, scope, itemId, direction, fallbackNote = "") {
  if (!direction) return null;
  return store.recordReferenceDirection({ episodeId: scope.episodeId, itemId, use: direction.use, conversationId: scope.conversationId,
    messageId: direction.messageId, requestId: scope.requestId, note: direction.note || fallbackNote });
}

// Revision-checked card assignment of an episode library item. Never overwrites a board the
// agent did not read: a stale revision, a missing card or an incompatible card type leaves
// the card unchanged and is reported; the item always stays in the library.
export function assignToCard(store, episodeId, itemId, { cardId, expectedRevision, assign = "item" }) {
  if (!cardId) return { appliedToCard: false, conflict: null };
  const current = store.getEpisode(episodeId);
  if (!Number.isInteger(expectedRevision)) return { appliedToCard: false, conflict: { reason: "expectedRevision is required with cardId", currentRevision: current.revision } };
  if (expectedRevision !== current.revision) return { appliedToCard: false, conflict: { reason: "The board changed since you read it; the card was not updated", expectedRevision, currentRevision: current.revision } };
  const card = current.cards.find((value) => value.id === cardId);
  if (!card) return { appliedToCard: false, conflict: { reason: "The target card no longer exists", currentRevision: current.revision } };
  const cards = current.cards.map((value) => value.id !== cardId ? value : assign === "reference"
    ? { ...value, referenceItemIds: [...new Set([...(value.referenceItemIds || []), itemId])] }
    : { ...value, itemId });
  try {
    const updated = store.updateEpisode(episodeId, current.revision, { cards }, "agent");
    return { appliedToCard: true, conflict: null, revision: updated.revision };
  } catch (error) {
    if (!(error instanceof StoreError)) throw error;
    return { appliedToCard: false, conflict: { reason: error.message, currentRevision: store.getEpisode(episodeId).revision } };
  }
}

// scope: { requestId, conversationId, harness, model, channelId, episodeId, dataRoot, episodeDir, workDir, requestWorkDir }
// (resolved by the app from the store path API). `store` is the app's open Store and
// `library` its library service; storage/mutation rules stay in those services.
export function createScopedTools(scope, { store, library = null, isShortcutMessage = defaultIsShortcutMessage, release = null } = {}) {
  let served = TOOL_DEFINITIONS;
  const handlers = {
    async inspect_image(args = {}) {
      const at = args.atSeconds == null ? null : assertTimestamp(args.atSeconds);
      const target = await resolveTarget(store, scope, args);
      let bytes;
      try { bytes = await frameAt(target.handle, at); } finally { await target.handle.close(); }
      return { text: JSON.stringify({ origin: target.origin, reference: target.reference, atSeconds: at, image: `${bytes.length} bytes PNG`, note: `Image of ${label(target.origin)}${at != null ? ` at ${at}s` : ""}` }), images: [png(bytes)] };
    },
    async inspect_contact_sheet(args = {}) {
      const times = sheetTimestamps(args.startSeconds, args.endSeconds, args.count ?? 8);
      const columns = Number.isInteger(args.columns) && args.columns >= 1 && args.columns <= 8 ? args.columns : undefined;
      const target = await resolveTarget(store, scope, args);
      let sheet;
      try { sheet = await contactSheet(target.handle, times, { columns }); } finally { await target.handle.close(); }
      const layout = times.map((at, index) => ({ tile: index + 1, row: Math.floor(index / sheet.columns) + 1, column: (index % sheet.columns) + 1, atSeconds: at }));
      return { text: JSON.stringify({ origin: target.origin, reference: target.reference, columns: sheet.columns, rows: sheet.rows, labelled: sheet.labelled, frames: layout }), images: [png(sheet.png)] };
    },
    async inspect_media(args = {}) {
      const target = await resolveTarget(store, scope, args);
      try { return json({ origin: target.origin, reference: target.reference, ...(await mediaSummary(target.handle)) }); }
      finally { await target.handle.close(); }
    },
    async read_reference_excerpt(args = {}) {
      return json(readExcerpt(store, scope, args));
    },
    async search_project(args = {}) {
      return json(searchProject(store, scope, args));
    },
    async register_work_file(args = {}) {
      const file = await resolveWorkFile(scope.workDir, args.path, { base: scope.episodeDir });
      if (args.category != null && !Object.hasOwn(KINDS_FOR_CATEGORY, args.category)) throw new RuntimeError("INVALID_CATEGORY", "category must be Graphics, B-roll or Narration");
      if (args.cardId != null && typeof args.cardId !== "string") throw new RuntimeError("INVALID_CARD", "cardId must be a string");
      const editable = args.sourcePath == null ? null : await resolveWorkFile(scope.workDir, args.sourcePath, { base: scope.episodeDir });
      const derived = [];
      const direction = args.direction ? validateDirection(store, scope, args.direction, { isShortcutMessage }) : null;
      for (const entry of Array.isArray(args.derivedFrom) ? args.derivedFrom : []) {
        const episodeId = entry.episodeId ?? scope.episodeId;
        const item = getItem(store, episodeId, entry.itemId);
        const reference = isReferenceItem(store, episodeId, item);
        derived.push({ ...originOf(store, episodeId, item), reference });
      }
      const workspace = store.workspace;
      // imports/ is app-only: it is never mounted into workers.
      const staged = await stageWorkFile(file, path.join(workspace, "imports", ".agent-staging"));
      let imported;
      try { imported = await importMedia({ workspace, sourcePath: staged, mediaDirectory: store.channelMediaDirectory(scope.channelId) }); }
      catch (error) { throw new RuntimeError("UNSUPPORTED_MEDIA", `Not a decodable image, video or audio file: ${error.message}`, { status: 422 }); }
      finally { await rm(path.dirname(staged), { recursive: true, force: true }); }
      const category = args.category ?? CATEGORY_BY_KIND[imported.kind] ?? "B-roll";
      if (!KINDS_FOR_CATEGORY[category].includes(imported.kind)) {
        if (imported.createdFile && !store.getAssetByHash(imported.hash, scope.channelId)) await rm(path.join(workspace, imported.path), { force: true });
        throw new RuntimeError("CATEGORY_MISMATCH", `A ${imported.kind} file cannot be registered as ${category}`, { status: 422 });
      }
      const provenance = {
        tool: "register_work_file",
        requestId: scope.requestId, conversationId: scope.conversationId, harness: scope.harness,
        channelId: scope.channelId, episodeId: scope.episodeId, cardId: args.cardId ?? null,
        workPath: path.relative(scope.episodeDir, file.path),
        editableSource: editable ? path.relative(scope.episodeDir, editable.path) : null,
        derivedFrom: derived, referenceDirection: direction,
        sourceSha256: imported.hash, sourceSize: file.size, registeredAt: new Date().toISOString(),
      };
      const name = typeof args.name === "string" && args.name.trim() ? args.name.trim().slice(0, 200) : imported.name;
      const deduplicated = Boolean(store.getAssetByHash(imported.hash, scope.channelId));
      const asset = store.saveAsset({ ...imported, channelId: scope.channelId, name, metadata: { ...imported.metadata, originPath: file.path, provenance } });
      // Same bytes already registered in this channel: keep that asset, drop the redundant copy.
      if (imported.createdFile && asset.path !== imported.path) await rm(path.join(workspace, imported.path), { force: true });
      const item = store.attachLibraryItem(scope.episodeId, asset.id, { category, label: name, sourceKind: "file", provenance });
      const recorded = direction ? derived.filter((entry) => entry.reference && entry.episode.id === scope.episodeId)
        .map((entry) => recordDirection(store, scope, entry.item.id, direction).id) : [];
      const card = assignToCard(store, scope.episodeId, item.id, args);
      return json({ registered: true, libraryItemId: item.id, assetId: asset.id, category, kind: asset.kind, sha256: asset.hash, deduplicated,
        width: asset.width, height: asset.height, duration: asset.duration, editableSource: provenance.editableSource, referenceDirections: recorded, ...card });
    },
    async reuse_project_item(args = {}) {
      if (!library) throw new RuntimeError("UNAVAILABLE", "Project reuse is not available in this request", { status: 501 });
      const sourceItem = getItem(store, args.sourceEpisodeId, args.sourceItemId);
      const reference = isReferenceItem(store, args.sourceEpisodeId, sourceItem);
      const direction = args.direction ? validateDirection(store, scope, args.direction, { isShortcutMessage }) : null;
      const result = await library.reuseItem({
        source: { channelId: args.sourceChannelId ?? null, episodeId: args.sourceEpisodeId, itemId: args.sourceItemId },
        destination: { channelId: scope.channelId, episodeId: scope.episodeId },
        category: args.category ?? null, label: args.label ?? null, requestId: scope.requestId, actor: "agent",
      });
      // Each directed request records its own direction, even when the item was reused before.
      const recorded = reference && direction ? recordDirection(store, scope, result.item.id, direction, `Reused from ${label(originOf(store, args.sourceEpisodeId, sourceItem))}`) : null;
      const card = assignToCard(store, scope.episodeId, result.item.id, args);
      return json({ reused: true, libraryItemId: result.item.id, assetId: result.item.assetId, category: result.item.category, copiedBytes: result.copied,
        deduplicated: result.deduplicated, alreadyPresent: result.alreadyPresent, from: originOf(store, args.sourceEpisodeId, sourceItem), reference, referenceDirection: recorded?.id ?? null, ...card });
    },
    async get_capabilities() {
      return json(describeCapabilities({ scope, served, release }));
    },
  };
  return {
    definitions: TOOL_DEFINITIONS,
    // The request tells the tool set which definitions are actually served to the harness
    // (runtime tools plus any merged app operations), so capabilities never over-report.
    setServedDefinitions(definitions) { served = definitions; },
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

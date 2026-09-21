// Scoped media tools: inspection, catalogue, registration, reuse, reference direction and
// capabilities. Real ffmpeg on temp fixtures; no Docker or providers.
import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { initDataRoot, openDataRoot } from "../src/services/data-root.js";
import { createChannel } from "../src/services/channels.js";
import { createChatService } from "../src/chat.js";
import { createLibraryService } from "../src/library.js";
import { importMedia } from "../src/media.js";
import { createScopedTools, TOOL_DEFINITIONS } from "../src/runtime/tools.js";
import { contactSheet, frameAt, sheetTimestamps } from "../src/runtime/media-inspect.js";
import { describeCapabilities } from "../src/runtime/capabilities.js";
import { mergeTools } from "../src/runtime/app-runtime.js";

const exec = promisify(execFile);
const sha = async (file) => createHash("sha256").update(await readFile(file)).digest("hex");

// Average colour of a PNG/frame, via ffmpeg scaling to 1x1.
async function averageColor(bytes, dir) {
  const file = path.join(dir, `px-${Math.random().toString(16).slice(2)}.png`);
  await writeFile(file, bytes);
  const { stdout } = await exec("ffmpeg", ["-v", "error", "-nostdin", "-i", file, "-vf", "scale=1:1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { encoding: "buffer" });
  return [...stdout.subarray(0, 3)];
}

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "sb-media-"));
  const scratch = await mkdtemp(path.join(os.tmpdir(), "sb-media-src-"));
  t.after(() => Promise.all([rm(root, { recursive: true, force: true }), rm(scratch, { recursive: true, force: true })]));
  initDataRoot(root);
  const a = createChannel(root, "Alpha"), b = createChannel(root, "Beta");
  const store = openDataRoot(root);
  t.after(() => store.close());
  const epA = store.createEpisode({ title: "Current", channelId: a.id });
  const epB = store.createEpisode({ title: "Elsewhere", channelId: b.id });
  for (const episode of [epA, epB]) store.ensureEpisodeDirectories(episode.id);
  // Clip: 0-2s purple, 2-4s yellow, 4-6s red.
  const clip = path.join(scratch, "clip.mp4");
  await exec("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=c=0x8000a0:s=160x120:d=2", "-f", "lavfi", "-i", "color=c=0xffe600:s=160x120:d=2", "-f", "lavfi", "-i", "color=c=0xdc0000:s=160x120:d=2",
    "-filter_complex", "[0][1][2]concat=n=3:v=1:a=0,format=yuv420p[v]", "-map", "[v]", "-r", "24", clip]);
  const still = path.join(scratch, "still.png");
  await exec("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=c=0x008080:s=64x48:d=1", "-frames:v", "1", still]);
  const attach = async (episode, file, category, label) => {
    const imported = await importMedia({ workspace: root, sourcePath: file, mediaDirectory: store.channelMediaDirectory(episode.channelId) });
    const asset = store.saveAsset({ ...imported, channelId: episode.channelId });
    return store.attachLibraryItem(episode.id, asset.id, { category, label });
  };
  const clipItem = await attach(epA, clip, "B-roll", "Scenes clip");
  const ordinary = await attach(epB, still, "Graphics", "Teal square");
  await writeFile(path.join(scratch, "note.png"), "not an image");
  const refStill = path.join(scratch, "ref.png");
  await exec("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=c=0x2040ff:s=64x48:d=1", "-frames:v", "1", refStill]);
  const reference = await attach(epB, refStill, "Reference", "Blue mood");
  const chat = createChatService({ store, codexFactory: async () => { throw new Error("unused"); } });
  t.after(() => chat.close());
  const conversation = chat.create(epA.id);
  const other = chat.create(epA.id);
  const now = new Date().toISOString();
  const message = (conversationId, role, text) => Number(store.db.prepare("INSERT INTO conversation_messages(conversation_id,role,text,state,created_at,updated_at) VALUES(?,?,?,'completed',?,?)").run(conversationId, role, text, now, now).lastInsertRowid);
  const scope = { requestId: "request_test1", conversationId: conversation.id, harness: "codex", model: "gpt-5.6-terra", channelId: a.id, episodeId: epA.id,
    dataRoot: root, episodeDir: store.episodeDirectory(epA.id), workDir: store.episodeWorkDirectory(epA.id), requestWorkDir: path.join(store.episodeWorkDirectory(epA.id), "request_test1") };
  const library = createLibraryService({ workspace: root, store });
  return { root, scratch, store, a, b, epA, epB, clipItem, ordinary, reference, conversation, other, message, scope, library,
    tools: (options = {}) => createScopedTools(scope, { store, library, ...options }) };
}

const call = async (tools, name, args) => JSON.parse((await tools.call(name, args)).text);

test("frames and contact sheets deliver real pixels that distinguish scenes at known times", async (t) => {
  const f = await fixture(t);
  const tools = f.tools();
  const at3 = await tools.call("inspect_image", { itemId: f.clipItem.id, atSeconds: 3 });
  const [r, g, bl] = await averageColor(Buffer.from(at3.images[0].data, "base64"), f.scratch);
  assert.ok(r > 200 && g > 200 && bl < 80, `yellow at 3s, got ${[r, g, bl]}`);
  assert.equal(JSON.parse(at3.text).origin.item.id, f.clipItem.id);
  assert.deepEqual(sheetTimestamps(0, 6, 3), [1, 3, 5]);
  assert.throws(() => sheetTimestamps(4, 2, 3), { code: "INVALID_RANGE" });
  assert.throws(() => sheetTimestamps(0, 6, 40), { code: "INVALID_COUNT" });
  const sheet = await tools.call("inspect_contact_sheet", { itemId: f.clipItem.id, startSeconds: 0, endSeconds: 6, count: 3, columns: 3 });
  const meta = JSON.parse(sheet.text);
  assert.deepEqual(meta.frames.map((frame) => frame.atSeconds), [1, 3, 5]);
  const sheetFile = path.join(f.scratch, "sheet.png");
  await writeFile(sheetFile, Buffer.from(sheet.images[0].data, "base64"));
  const { stdout } = await exec("ffprobe", ["-v", "error", "-show_entries", "stream=width,height", "-of", "csv=p=0", sheetFile]);
  const [width] = stdout.trim().split(",").map(Number);
  assert.ok(width > 3 * 160, `three tiles across (${width}px)`);
  const info = await call(tools, "inspect_media", { itemId: f.clipItem.id });
  assert.equal(info.kind, "video");
  assert.ok(Math.abs(info.duration - 6) < 0.2);
  assert.equal(info.streams[0].width, 160);
  await assert.rejects(frameAt(path.join(f.scratch, "note.png")), { code: "FRAME_FAILED" });
});

test("cross-project reads are allowed and labelled; the database is never readable", async (t) => {
  const f = await fixture(t);
  const tools = f.tools();
  const other = JSON.parse((await tools.call("inspect_image", { episodeId: f.epB.id, itemId: f.ordinary.id })).text);
  assert.deepEqual([other.origin.channel.name, other.origin.episode.title, other.origin.item.label], ["Beta", "Elsewhere", "Teal square"]);
  const found = await call(tools, "search_project", { query: "teal" });
  assert.equal(found.items.length, 1);
  assert.equal(found.items[0].channel.name, "Beta");
  assert.equal(found.items[0].current, false);
  assert.equal((await call(tools, "search_project", {})).episodes.length, 2);
  assert.equal((await call(tools, "search_project", { category: "Reference" })).items[0].item.reference, true);
  await assert.rejects(tools.call("inspect_image", { path: path.join(f.root, "storybench.sqlite") }), { code: "PATH_NOT_PROJECT" });
  await assert.rejects(tools.call("inspect_image", { itemId: "missing" }), { code: "ITEM_NOT_FOUND" });
  const excerpt = await call(tools, "read_reference_excerpt", { episodeId: f.epB.id, itemId: f.reference.id });
  assert.equal(excerpt.origin.channel.name, "Beta");
  assert.equal(excerpt.reference, true);
});

test("registration validates format, category and editable source, records provenance and respects the board revision", async (t) => {
  const f = await fixture(t);
  const tools = f.tools();
  await exec("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=c=white:s=64x48:d=1", "-frames:v", "1", path.join(f.scope.workDir, "title.png")]);
  await writeFile(path.join(f.scope.workDir, "title.py"), "# editable source\n");
  await writeFile(path.join(f.scope.workDir, "notes.txt"), "plain text");
  await assert.rejects(tools.call("register_work_file", { path: "work/notes.txt" }), { code: "UNSUPPORTED_MEDIA" });
  const mediaBefore = await readdir(f.store.channelMediaDirectory(f.a.id));
  await assert.rejects(tools.call("register_work_file", { path: "work/title.png", category: "B-roll" }), { code: "CATEGORY_MISMATCH" });
  assert.deepEqual(await readdir(f.store.channelMediaDirectory(f.a.id)), mediaBefore, "no orphaned managed copy");
  await assert.rejects(tools.call("register_work_file", { path: "work/title.png", sourcePath: "../../../../storybench.sqlite" }), { code: "PATH_OUTSIDE_WORK" });
  await symlink(path.join(f.root, "storybench.sqlite"), path.join(f.scope.workDir, "link.png"));
  await assert.rejects(tools.call("register_work_file", { path: "work/link.png" }), { code: "PATH_SYMLINK" });
  // A card, then a stale-revision assignment: the item stays in the library, the card is untouched.
  const cardId = "card_title";
  const withCard = f.store.updateEpisode(f.epA.id, f.store.getEpisode(f.epA.id).revision, { cards: [{ id: cardId, title: "Title", type: "Static Graphic", prompt: "title", sectionId: null, itemId: null, referenceItemIds: [], order: 0, enabled: true }] });
  const stale = await call(tools, "register_work_file", { path: "work/title.png", name: "Title", sourcePath: "work/title.py", cardId, expectedRevision: withCard.revision - 1 });
  assert.equal(stale.registered, true);
  assert.equal(stale.appliedToCard, false);
  assert.match(stale.conflict.reason, /board changed/);
  assert.equal(f.store.getEpisode(f.epA.id).cards[0].itemId, null, "creator's card untouched");
  const item = f.store.getLibraryItem(f.epA.id, stale.libraryItemId);
  assert.equal(item.category, "Graphics");
  assert.equal(item.provenance.editableSource, "work/title.py");
  assert.equal(item.provenance.requestId, "request_test1");
  assert.equal(item.provenance.cardId, cardId);
  // Same bytes, current revision: assigned.
  const ok = await call(tools, "register_work_file", { path: "work/title.png", cardId, expectedRevision: withCard.revision });
  assert.equal(ok.appliedToCard, true);
  assert.equal(f.store.getEpisode(f.epA.id).cards[0].itemId, ok.libraryItemId);
  assert.equal(ok.deduplicated, true);
  // Incompatible card type (Video card, image item): reported, not applied.
  const video = f.store.updateEpisode(f.epA.id, f.store.getEpisode(f.epA.id).revision, { cards: [...f.store.getEpisode(f.epA.id).cards, { id: "card_video", title: "V", type: "Video", prompt: "v", sectionId: null, itemId: null, referenceItemIds: [], order: 1, enabled: true }] });
  const wrongType = await call(tools, "register_work_file", { path: "work/title.png", cardId: "card_video", expectedRevision: video.revision });
  assert.equal(wrongType.appliedToCard, false);
  assert.match(wrongType.conflict.reason, /video/i);
});

test("reuse preserves the source, records provenance and requires cited creator direction for references", async (t) => {
  const f = await fixture(t);
  const tools = f.tools();
  const sourceFile = path.join(f.root, f.ordinary.asset.path);
  const before = await sha(sourceFile);
  const reused = await call(tools, "reuse_project_item", { sourceEpisodeId: f.epB.id, sourceItemId: f.ordinary.id });
  assert.equal(reused.reused, true);
  assert.equal(reused.from.channel.name, "Beta");
  const item = f.store.getLibraryItem(f.epA.id, reused.libraryItemId);
  assert.equal(item.provenance.reusedFrom.itemId, f.ordinary.id);
  assert.equal(item.provenance.requestId, "request_test1");
  assert.equal(item.provenance.actor, "agent");
  assert.equal(await sha(sourceFile), before, "source bytes unchanged");
  assert.ok(f.store.getLibraryItem(f.epB.id, f.ordinary.id), "source membership kept");
  // Reference material: refused without a direction, with a non-creator or foreign message, or a shortcut.
  const args = { sourceEpisodeId: f.epB.id, sourceItemId: f.reference.id };
  await assert.rejects(tools.call("reuse_project_item", args), { code: "DIRECTION_REQUIRED" });
  const assistant = f.message(f.conversation.id, "assistant", "I will use it");
  await assert.rejects(tools.call("reuse_project_item", { ...args, direction: { messageId: assistant } }), { code: "DIRECTION_NOT_CREATOR" });
  const elsewhere = f.message(f.other.id, "user", "use the blue mood still directly");
  await assert.rejects(tools.call("reuse_project_item", { ...args, direction: { messageId: elsewhere } }), { code: "DIRECTION_NOT_FOUND" });
  const shortcut = f.message(f.conversation.id, "user", "Create a draft from the current story, cards and available material.");
  await assert.rejects(f.tools({ isShortcutMessage: (row) => row.id === shortcut }).call("reuse_project_item", { ...args, direction: { messageId: shortcut } }), { code: "DIRECTION_SHORTCUT" });
  assert.equal(f.store.listEpisodeLibrary(f.epA.id).filter((entry) => entry.provenance?.reusedFrom?.itemId === f.reference.id).length, 0, "nothing reused while refused");
  const direct = f.message(f.conversation.id, "user", "Use the Blue mood still from Beta directly as the opening image.");
  const allowed = await call(tools, "reuse_project_item", { ...args, direction: { messageId: direct, use: "direct-use" } });
  assert.equal(allowed.reference, true);
  const direction = f.store.referenceDirectionFor(f.epA.id, allowed.libraryItemId, "direct-use");
  assert.equal(direction.messageId, direct);
  assert.equal(direction.requestId, "request_test1");
  // A later directed request for the same item records its own direction even though the item is already present.
  const again = f.message(f.conversation.id, "user", "Use the Blue mood still again for the closing card.");
  const second = await call(tools, "reuse_project_item", { ...args, direction: { messageId: again } });
  assert.equal(second.alreadyPresent, true);
  assert.ok(second.referenceDirection);
  assert.equal(f.store.referenceDirectionFor(f.epA.id, allowed.libraryItemId, "direct-use").messageId, again);
});

test("deriving from a reference needs direction; the direction is recorded with the result", async (t) => {
  const f = await fixture(t);
  const tools = f.tools();
  const direct = f.message(f.conversation.id, "user", "Use the Blue mood still directly and make a title from it.");
  const local = await call(tools, "reuse_project_item", { sourceEpisodeId: f.epB.id, sourceItemId: f.reference.id, direction: { messageId: direct } });
  await exec("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=c=0x2040ff:s=80x48:d=1", "-frames:v", "1", path.join(f.scope.workDir, "from-ref.png")]);
  await assert.rejects(tools.call("register_work_file", { path: "work/from-ref.png", derivedFrom: [{ itemId: local.libraryItemId }] }), { code: "DIRECTION_REQUIRED" });
  await assert.rejects(tools.call("register_work_file", { path: "work/from-ref.png", derivedFrom: [{ episodeId: f.epB.id, itemId: f.reference.id }], direction: { messageId: direct } }), { code: "REUSE_FIRST" });
  const done = await call(tools, "register_work_file", { path: "work/from-ref.png", derivedFrom: [{ itemId: local.libraryItemId }], direction: { messageId: direct, use: "edit" } });
  assert.equal(done.referenceDirections.length, 1);
  const item = f.store.getLibraryItem(f.epA.id, done.libraryItemId);
  assert.equal(item.provenance.derivedFrom[0].item.id, local.libraryItemId);
  assert.equal(item.provenance.referenceDirection.messageId, direct);
});

test("capabilities list only what is served and verified", () => {
  const scope = { harness: "claude", model: "sonnet", episodeDir: "/storybench/data/channels/c/episodes/e", workDir: "/storybench/data/channels/c/episodes/e/work", requestWorkDir: null };
  const noImages = describeCapabilities({ scope, served: TOOL_DEFINITIONS.filter((definition) => !definition.name.startsWith("inspect_")) });
  assert.equal(describeCapabilities({ scope: { ...scope, harness: "other" }, served: TOOL_DEFINITIONS }).imageInput.verified, false, "an unverified route is not advertised");
  assert.equal(noImages.imageInput.available, false);
  assert.equal(noImages.commandExecution.commands.verified, false);
  // The image route is verified only for the harness version the proof passed on.
  const full = describeCapabilities({ scope, served: TOOL_DEFINITIONS, release: { tools: { ffmpeg: "7.1.5", claude: "2.1.278" } } });
  assert.equal(full.imageInput.verified, true);
  assert.match(full.imageInput.via, /MCP/);
  assert.deepEqual(full.commandExecution.commands.versions, { ffmpeg: "7.1.5", claude: "2.1.278" });
  const upgraded = describeCapabilities({ scope, served: TOOL_DEFINITIONS, release: { tools: { claude: "2.2.0" } } });
  assert.equal(upgraded.imageInput.verified, false);
  assert.match(upgraded.imageInput.reason, /2\.2\.0 differs from 2\.1\.278/);
  const unknown = describeCapabilities({ scope: { ...scope, harness: "codex" }, served: TOOL_DEFINITIONS });
  assert.match(unknown.imageInput.reason, /running codex version is unknown/);
  assert.deepEqual(full.tools.map((tool) => tool.name), TOOL_DEFINITIONS.map((definition) => definition.name));
  assert.ok(full.notAvailable.some((entry) => /image generation/.test(entry)));
});

test("served capabilities include merged app operations and runtime tools win name collisions", async (t) => {
  const f = await fixture(t);
  const scoped = f.tools();
  const merged = mergeTools(scoped, { read_reference_excerpt: () => ({ from: "chat" }), get_context: () => ({ ok: true }) });
  scoped.setServedDefinitions(merged.definitions);
  const caps = JSON.parse((await merged.call("get_capabilities", {})).text);
  assert.ok(caps.tools.some((tool) => tool.name === "get_context"));
  assert.equal(caps.tools.filter((tool) => tool.name === "read_reference_excerpt").length, 1);
  const excerpt = JSON.parse((await merged.call("read_reference_excerpt", { episodeId: f.epB.id, itemId: f.reference.id })).text);
  assert.ok(excerpt.origin, "runtime (cross-project) excerpt serves the name");
});

test("contact sheet helper tiles and labels frames", async (t) => {
  const f = await fixture(t);
  const sheet = await contactSheet(path.join(f.root, f.clipItem.asset.path), [1, 3, 5, 1.5], { columns: 2, tileWidth: 120 });
  assert.deepEqual([sheet.columns, sheet.rows], [2, 2]);
  assert.equal(sheet.png.subarray(1, 4).toString(), "PNG");
});

test("reads use the validated descriptor: a path swapped after validation is never read and tool errors never quote file bytes", async (t) => {
  const f = await fixture(t);
  const { resolveTarget } = await import("../src/runtime/project-catalog.js");
  const { mediaSummary } = await import("../src/runtime/media-inspect.js");
  const { unlink } = await import("node:fs/promises");
  await exec("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=c=0x00ff00:s=16x16:d=1", "-frames:v", "1", path.join(f.scope.workDir, "x.png")]);
  await mkdir(path.join(f.root, "imports"), { recursive: true });
  await exec("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=c=0xff0000:s=16x16:d=1", "-frames:v", "1", path.join(f.root, "imports", "secret.png")]);
  const target = await resolveTarget(f.store, f.scope, { path: "work/x.png" });
  await unlink(target.file);
  await symlink(path.join(f.root, "imports", "secret.png"), target.file);
  const [r, g] = await averageColor(await frameAt(target.handle), f.scratch);
  assert.ok(g > 200 && r < 50, `the validated (green) file was read, got ${[r, g]}`);
  await target.handle.close();
  // Opening through the swapped symlink is refused outright.
  await assert.rejects(f.tools().call("inspect_image", { path: "work/x.png" }), { code: "PATH_NOT_PROJECT" });
  // A validated file swapped to the database: the descriptor still points at the old inode.
  await unlink(target.file);
  await writeFile(target.file, "not media but not secret either");
  const second = await resolveTarget(f.store, f.scope, { path: "work/x.png" });
  await unlink(second.file);
  await symlink(path.join(f.root, "storybench.sqlite"), second.file);
  const failure = await frameAt(second.handle).catch((error) => error);
  assert.equal(failure.code, "FRAME_FAILED");
  assert.doesNotMatch(failure.message, /SQLite|not media/);
  const probe = await mediaSummary(second.handle).catch((error) => error);
  assert.doesNotMatch(probe.message, /SQLite|not media/);
  await second.handle.close();
});

test("media tools time out instead of hanging", async (t) => {
  const f = await fixture(t);
  const fifo = path.join(f.scratch, "stall.fifo");
  await exec("mkfifo", [fifo]);
  await assert.rejects(frameAt(fifo, null, { timeoutMs: 300 }), { code: "FRAME_TIMEOUT" });
});

test("a shortcut-originated creator message is refused as reference direction; a typed one is accepted", async (t) => {
  const f = await fixture(t);
  const tools = f.tools();
  const button = f.store.addConversationMessage({ conversationId: f.conversation.id, role: "user", text: "Create a draft from the current story, cards and available material.", shortcut: true });
  assert.equal(button.origin, "button");
  const args = { sourceEpisodeId: f.epB.id, sourceItemId: f.reference.id };
  await assert.rejects(tools.call("reuse_project_item", { ...args, direction: { messageId: button.id } }), { code: "DIRECTION_SHORTCUT" });
  const typed = f.store.addConversationMessage({ conversationId: f.conversation.id, role: "user", text: "Use the Blue mood still directly." });
  assert.equal(typed.origin, "typed");
  assert.equal(JSON.parse((await tools.call("reuse_project_item", { ...args, direction: { messageId: typed.id } })).text).reference, true);
});

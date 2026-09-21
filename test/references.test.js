import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { JSDOM } from "jsdom";
import { Store, SCHEMA_VERSION, REFERENCE_RULE } from "../src/store.js";
import { createChatService } from "../src/chat.js";
import { getOperationGuide } from "../src/agent-guides.js";
import { referencePanelHTML, linkReference, unlinkReference } from "../public/reference-workspace.js";
import { duplicateCard } from "../public/card-workspace.js";

const CARD_TYPES = ["Video/Audio", "Video", "Audio", "Static Graphic", "Video Graphic"];
function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), "storybench-references-"));
  const store = new Store(root);
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
  const episode = store.createEpisode({ title: "Refs" });
  mkdirSync(path.join(root, "media"), { recursive: true });
  const asset = (name, kind, extra = {}) => (writeFileSync(path.join(root, "media", name), `bytes ${name}`), store.saveAsset({ name, hash: `hash-${name}`, kind, path: `media/${name}`, duration: kind === "image" ? null : 3, metadata: { hasAudio: kind !== "image" }, ...extra }));
  const attach = (episodeId, name, kind, category) => store.attachLibraryItem(episodeId, asset(name, kind).id, { category, label: name });
  return { root, store, episode, attach };
}
const card = (id, type, extra = {}) => ({ id, title: id, type, prompt: "make it", sectionId: null, itemId: null, referenceItemIds: [], order: 0, enabled: true, ...extra });

test("episode and card references accept text, media, both or neither independently for every card type", (t) => {
  const { store, episode, attach } = fixture(t);
  const broll = attach(episode.id, "broll.mp4", "video", "B-roll");
  const still = attach(episode.id, "still.png", "image", "Graphics");
  const voice = attach(episode.id, "voice.wav", "audio", "Narration");
  const cases = [["neither", "", []], ["text", "match this warmth", []], ["media", "", [broll.id]], ["both", "slow like this", [still.id, voice.id]]];
  const cards = [];
  for (const type of CARD_TYPES) for (const [label, referencePrompt, referenceItemIds] of cases)
    cards.push(card(`${type}-${label}`, type, { referencePrompt, referenceItemIds }));
  // A card's selected output media is independent of its references.
  cards[cards.findIndex((value) => value.id === "Static Graphic-both")].itemId = still.id;
  let current = store.updateEpisode(episode.id, episode.revision, { cards });
  for (const [label, referencePrompt, referenceItemIds] of cases) {
    current = store.updateEpisode(episode.id, current.revision, { referencePrompt, referenceItemIds });
    const reopened = store.getEpisode(episode.id);
    assert.deepEqual({ prompt: reopened.referencePrompt, ids: reopened.referenceItemIds }, { prompt: referencePrompt, ids: referenceItemIds }, `episode ${label}`);
  }
  const saved = store.getEpisode(episode.id).cards;
  for (const type of CARD_TYPES) for (const [label, referencePrompt, referenceItemIds] of cases) {
    const value = saved.find((entry) => entry.id === `${type}-${label}`);
    assert.deepEqual({ prompt: value.referencePrompt, ids: value.referenceItemIds }, { prompt: referencePrompt, ids: referenceItemIds }, `${type} ${label}`);
  }
  assert.equal(saved.find((value) => value.id === "Static Graphic-both").itemId, still.id);
  // Episode-level ordering is preserved exactly, and a prompt-only save needs no attachment.
  current = store.updateEpisode(episode.id, store.getEpisode(episode.id).revision, { referenceItemIds: [voice.id, broll.id, still.id], referencePrompt: "only text is fine" });
  assert.deepEqual(current.referenceItemIds, [voice.id, broll.id, still.id]);
});

test("reference updates validate membership and revisions; unlink keeps the item; unavailable links stay visible", (t) => {
  const { store, episode, attach } = fixture(t);
  const other = store.createEpisode({ title: "Other" });
  const foreign = attach(other.id, "foreign.png", "image", "Reference");
  const mine = attach(episode.id, "mine.png", "image", "Reference");
  assert.throws(() => store.updateEpisode(episode.id, episode.revision, { referenceItemIds: [foreign.id] }), /not found for this episode/);
  assert.throws(() => store.updateEpisode(episode.id, episode.revision, { cards: [card("c", "Video", { referenceItemIds: [foreign.id] })] }), /not found for this episode/);
  assert.throws(() => store.updateEpisode(episode.id, episode.revision, { referenceItemIds: "nope" }), /array/);
  assert.throws(() => store.updateEpisode(episode.id, episode.revision + 5, { referencePrompt: "late" }), (error) => error.statusCode === 409);
  let current = store.updateEpisode(episode.id, episode.revision, { referenceItemIds: [mine.id], cards: [card("c", "Video", { referenceItemIds: [mine.id] })] });
  current = store.updateEpisode(episode.id, current.revision, { referenceItemIds: [], cards: [card("c", "Video")] });
  assert.ok(store.getLibraryItem(episode.id, mine.id), "unlinking never deletes the library item");
  assert.ok(store.getAsset(mine.assetId));
  // A link whose item is no longer resolvable is reported, can be kept while saving other fields, and unlinked.
  store.db.prepare("UPDATE episodes SET reference_item_ids=? WHERE id=?").run(JSON.stringify([mine.id, "library_gone"]), episode.id);
  const context = store.getReferenceContext(episode.id);
  assert.deepEqual(context.episode.items.map((item) => [item.itemId, item.available]), [[mine.id, true], ["library_gone", false]]);
  current = store.updateEpisode(episode.id, store.getEpisode(episode.id).revision, { referencePrompt: "still saves", referenceItemIds: [mine.id, "library_gone"] });
  current = store.updateEpisode(episode.id, current.revision, { referenceItemIds: [mine.id] });
  assert.deepEqual(current.referenceItemIds, [mine.id]);
  assert.throws(() => store.updateEpisode(episode.id, current.revision, { referenceItemIds: [mine.id, "library_gone"] }), /not found/);
});

test("undo, duplication and branding promotion/application preserve prompts and reference dependencies", (t) => {
  const { store, episode, attach } = fixture(t);
  const look = attach(episode.id, "look.png", "image", "Graphics");
  let current = store.updateEpisode(episode.id, episode.revision, { referencePrompt: "v1", referenceItemIds: [look.id],
    cards: [card("intro", "Static Graphic", { itemId: look.id, referencePrompt: "card v1", referenceItemIds: [look.id], referenceUrls: ["https://example.com/legacy"] })] });
  current = store.updateEpisode(episode.id, current.revision, { referencePrompt: "v2", referenceItemIds: [],
    cards: [card("intro", "Static Graphic", { itemId: look.id, referencePrompt: "card v2", referenceItemIds: [] })] });
  current = store.undoEpisode(episode.id, current.revision);
  assert.deepEqual({ prompt: current.referencePrompt, ids: current.referenceItemIds }, { prompt: "v1", ids: [look.id] });
  assert.deepEqual({ prompt: current.cards[0].referencePrompt, ids: current.cards[0].referenceItemIds, urls: current.cards[0].referenceUrls },
    { prompt: "card v1", ids: [look.id], urls: ["https://example.com/legacy"] });

  const cards = structuredClone(current.cards);
  const copy = duplicateCard(cards, "intro", "intro-copy");
  assert.deepEqual({ prompt: copy.referencePrompt, ids: copy.referenceItemIds, urls: copy.referenceUrls, itemId: copy.itemId },
    { prompt: "card v1", ids: [look.id], urls: ["https://example.com/legacy"], itemId: look.id });
  copy.referenceItemIds.push("changed");
  assert.deepEqual(cards[0].referenceItemIds, [look.id], "the copy does not share arrays with its source");
  copy.referenceItemIds.pop();
  current = store.updateEpisode(episode.id, current.revision, { cards });
  assert.equal(current.cards[1].referencePrompt, "card v1");

  const template = store.promoteCard(episode.id, "intro", { name: "Intro look" });
  assert.equal(template.card.referencePrompt, "card v1");
  const target = store.createEpisode({ title: "Target" });
  const applied = store.applyBrandingTemplate(target.id, template.id);
  const added = applied.cards.at(-1);
  const targetItems = store.listEpisodeLibrary(target.id);
  assert.equal(added.referencePrompt, "card v1");
  assert.equal(added.referenceItemIds.length, 1);
  assert.notEqual(added.referenceItemIds[0], look.id, "reference links are remapped to the target episode's items");
  assert.ok(targetItems.some((item) => item.id === added.referenceItemIds[0] && item.assetId === look.assetId));
  assert.equal(added.itemId, added.referenceItemIds[0], "one source item maps to one target item");
});

function v6Root(t) {
  const { root, store, episode, attach } = fixture(t);
  const ref1 = attach(episode.id, "ref1.txt", "reference", "Reference");
  const broll = attach(episode.id, "clip.mp4", "video", "B-roll");
  const ref2 = attach(episode.id, "ref2.png", "image", "Reference");
  const legacyCards = [{ ...card("c1", "Video", { itemId: broll.id, referenceItemIds: [broll.id], referenceUrls: ["https://example.invalid/never-fetched", "not even a url"] }) }];
  delete legacyCards[0].referencePrompt;
  store.db.prepare("UPDATE episodes SET cards=? WHERE id=?").run(JSON.stringify(legacyCards), episode.id);
  store.db.exec(`DROP TABLE reference_directions; ALTER TABLE episodes DROP COLUMN reference_prompt; ALTER TABLE episodes DROP COLUMN reference_item_ids;
    ALTER TABLE episode_history DROP COLUMN reference_prompt; ALTER TABLE episode_history DROP COLUMN reference_item_ids;
    DELETE FROM migration_log WHERE version=7; PRAGMA user_version=6;`);
  const cardsJson = store.db.prepare("SELECT cards FROM episodes WHERE id=?").get(episode.id).cards;
  store.close();
  return { root, episode, ref1, ref2, broll, cardsJson };
}

test("schema 7 initializes the episode reference set once from Reference items and leaves card links untouched", (t) => {
  const { root, episode, ref1, ref2, broll, cardsJson } = v6Root(t);
  let store = new Store(root);
  t.after(() => store.close());
  assert.equal(Number(store.db.prepare("PRAGMA user_version").get().user_version), SCHEMA_VERSION);
  assert.equal(SCHEMA_VERSION, 7);
  assert.ok(existsSync(path.join(root, "storybench.pre-v7.sqlite")));
  const backup = new DatabaseSync(path.join(root, "storybench.pre-v7.sqlite"), { readOnly: true });
  assert.equal(Number(backup.prepare("PRAGMA user_version").get().user_version), 6);
  backup.close();
  let migrated = store.getEpisode(episode.id);
  const libraryOrder = store.listEpisodeLibrary(episode.id).filter((item) => item.category === "Reference").map((item) => item.id);
  assert.deepEqual([...libraryOrder].sort(), [ref1.id, ref2.id].sort());
  assert.deepEqual(migrated.referenceItemIds, libraryOrder, "Reference-category items become the explicit episode set, in library order");
  const initialSet = migrated.referenceItemIds;
  assert.equal(migrated.referencePrompt, "");
  assert.equal(store.db.prepare("SELECT cards FROM episodes WHERE id=?").get(episode.id).cards, cardsJson, "card JSON, links and URL strings are byte-identical");
  assert.deepEqual(migrated.cards[0].referenceUrls, ["https://example.invalid/never-fetched", "not even a url"]);
  assert.equal(store.listEpisodeLibrary(episode.id).length, 3, "no URL was fetched or registered");
  assert.equal(store.listReferenceDirections(episode.id).length, 0, "migration never manufactures creator direction");
  // After migration, category is organization only: recategorizing never changes scope, even on a forced re-run.
  store.updateLibraryItem(episode.id, broll.id, broll.revision, { category: "Reference" });
  store.updateLibraryItem(episode.id, ref2.id, ref2.revision, { category: "Graphics" });
  store.db.exec("PRAGMA user_version=6");
  store.close();
  store = new Store(root);
  migrated = store.getEpisode(episode.id);
  assert.deepEqual(migrated.referenceItemIds, initialSet);
  assert.equal(store.listReferenceDirections(episode.id).length, 0);
  // A card saved later gains an explicit (empty) reference prompt without losing its links.
  const saved = store.updateEpisode(episode.id, migrated.revision, { cards: migrated.cards });
  assert.deepEqual({ prompt: saved.cards[0].referencePrompt, ids: saved.cards[0].referenceItemIds }, { prompt: "", ids: [broll.id] });
});

test("creator direction for reference use/edit is recorded only from a creator message in this episode", async (t) => {
  const { store, episode, attach } = fixture(t);
  const other = store.createEpisode({ title: "Other" });
  const ref = attach(episode.id, "mood.mp4", "video", "Reference");
  const current = store.updateEpisode(episode.id, episode.revision, { referenceItemIds: [ref.id], referencePrompt: "keep this pace",
    cards: [card("open", "Video", { referencePrompt: "card feel", referenceItemIds: [ref.id] })] });
  let options;
  const factory = async (value) => { options = value; return { startThread: async () => "thread", startTurn: async () => "turn", interrupt: async () => {}, close() {} }; };
  const chat = createChatService({ store, renders: {}, codexFactory: factory });
  t.after(() => chat.close());
  const conversation = chat.create(episode.id);
  await chat.send(episode.id, conversation.id, "use this clip as the opening shot");
  for (let i = 0; i < 100 && !options; i++) await new Promise((resolve) => setTimeout(resolve, 5));
  const messages = chat.get(episode.id, conversation.id).messages;
  const userMessage = messages.find((message) => message.role === "user");
  const context = options.tools.get_context({});
  assert.equal(context.references.rule, REFERENCE_RULE);
  assert.deepEqual(context.references.episode, { scope: "episode", prompt: "keep this pace", items: [{ itemId: ref.id, available: true, label: "mood.mp4", category: "Reference",
    kind: "video", sourceKind: "file", sourceUrl: null, extractionStatus: "not-applicable", hasText: false, directions: [] }] });
  assert.deepEqual(context.references.cards.map((value) => [value.scope, value.cardId, value.prompt, value.items.map((item) => item.itemId)]), [["card", "open", "card feel", [ref.id]]]);
  assert.match(getOperationGuide("read_references").instructions, /read-only feel context/);

  assert.equal(store.referenceDirectionFor(episode.id, ref.id, "direct-use"), null);
  const direction = store.recordReferenceDirection({ episodeId: episode.id, itemId: ref.id, use: "direct-use", conversationId: conversation.id,
    messageId: userMessage.id, requestId: "req-1", note: "opening shot" });
  assert.equal(store.referenceDirectionFor(episode.id, ref.id, "direct-use", { requestId: "req-1" }).id, direction.id);
  assert.equal(store.referenceDirectionFor(episode.id, ref.id, "edit"), null, "use and edit are distinct directions");
  assert.deepEqual(store.getReferenceContext(episode.id).episode.items[0].directions, [{ id: direction.id, use: "direct-use", messageId: userMessage.id, requestId: "req-1" }]);
  const stamp = new Date().toISOString();
  const assistantId = Number(store.db.prepare("INSERT INTO conversation_messages(conversation_id,role,text,state,created_at,updated_at) VALUES(?,'assistant','sure','completed',?,?)").run(conversation.id, stamp, stamp).lastInsertRowid);
  assert.throws(() => store.recordReferenceDirection({ episodeId: episode.id, itemId: ref.id, use: "edit", conversationId: conversation.id, messageId: assistantId }), (error) => error.statusCode === 403);
  const otherConversation = chat.create(other.id);
  assert.throws(() => store.recordReferenceDirection({ episodeId: episode.id, itemId: ref.id, use: "edit", conversationId: otherConversation.id, messageId: userMessage.id }), (error) => error.statusCode === 404);
  assert.throws(() => store.recordReferenceDirection({ episodeId: episode.id, itemId: ref.id, use: "remix", conversationId: conversation.id, messageId: userMessage.id }), /use must be/);
  assert.throws(() => store.recordReferenceDirection({ episodeId: episode.id, itemId: "library_missing", use: "edit", conversationId: conversation.id, messageId: userMessage.id }), (error) => error.statusCode === 404);
  assert.throws(() => store.recordReferenceDirection({ episodeId: episode.id, itemId: ref.id, use: "edit" }), (error) => error.statusCode === 400);
  // Recategorizing or relinking creates no direction.
  store.updateLibraryItem(episode.id, ref.id, ref.revision, { category: "B-roll" });
  store.updateEpisode(episode.id, current.revision, { referenceItemIds: [] });
  assert.equal(store.listReferenceDirections(episode.id).length, 1);
  assert.equal(store.listReferenceDirections(episode.id, { requestId: "req-2" }).length, 0);
});

test("reference panel offers any library item, reports unavailable links and escapes labels", () => {
  const items = [
    { id: "a", label: "<b>clip</b>", category: "B-roll", sourceKind: "file", extractionStatus: "not-applicable", asset: { kind: "video" } },
    { id: "b", label: "notes", category: "Reference", sourceKind: "url", extractionStatus: "failed", asset: { kind: "reference" } },
    { id: "c", label: "logo", category: "Graphics", sourceKind: "file", extractionStatus: "not-applicable", asset: { kind: "image" } },
  ];
  const dom = new JSDOM(referencePanelHTML({ scope: "card", cardId: "card-1", episodeId: "ep", prompt: "feel", itemIds: ["b", "gone"], items }));
  const document = dom.window.document;
  assert.equal(document.querySelector("[data-ref-scope]").dataset.refCard, "card-1");
  assert.equal(document.querySelector("[data-ref-prompt]").value, "feel");
  assert.deepEqual([...document.querySelectorAll("[data-ref-add] option")].slice(1).map((option) => option.value), ["a", "c"], "every category is offered");
  assert.match(document.querySelector('[data-ref-item="b"]').textContent, /text failed/);
  assert.match(document.querySelector('[data-ref-item="gone"]').textContent, /Unavailable reference/);
  assert.ok(document.querySelector('[data-ref-unlink="gone"]'));
  assert.equal(document.querySelectorAll("[data-ref-add] option b").length, 0);
  assert.match(document.querySelector("[data-ref-add]").innerHTML, /&lt;b&gt;clip/);
  const empty = new JSDOM(referencePanelHTML({ scope: "episode", episodeId: "ep", items: null })).window.document;
  assert.match(empty.querySelector(".reference-empty").textContent, /neither are all fine/);
  assert.equal(empty.querySelector("[data-ref-add]").disabled, true);
  assert.deepEqual(linkReference(["a"], "b"), ["a", "b"]);
  assert.deepEqual(linkReference(["a"], "a"), ["a"]);
  assert.deepEqual(unlinkReference(["a", "b"], "a"), ["b"]);
});

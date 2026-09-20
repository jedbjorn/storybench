import test from "node:test";
import assert from "node:assert/strict";
import { episodeNavigatorHTML, filesFromDataTransfer, runImportBatch, uploadLibraryFile } from "../public/library-workspace.js";
import { attachMediaToCard, categoryForCardMedia, setCardType } from "../public/card-workspace.js";
import { buildRenderPlan } from "../src/composition-plan.js";

test("episode navigator groups states, applies filters, and keeps dropdown alternative", () => {
  const episodes = [
    { id: "one", title: "One", state: "Scaffold" },
    { id: "two", title: "Two", state: "Final" },
  ];
  const all = episodeNavigatorHTML(episodes, "All", "two");
  assert.match(all, /data-episode-state="Scaffold"/);
  assert.match(all, /data-episode-state="Final"/);
  assert.match(all, /data-episode-state-select/);
  assert.match(all, /data-id="two"[\s\S]*class="active"/);
  const filtered = episodeNavigatorHTML(episodes, "Scaffold", "two");
  assert.match(filtered, />One</);
  assert.doesNotMatch(filtered, />Two</);
  assert.doesNotMatch(filtered, /data-episode-state="Final"/);
});

test("episode navigator escapes user labels", () => {
  const html = episodeNavigatorHTML([{ id: "safe", title: "<img onerror=alert(1)>", state: "Draft" }], "All", null);
  assert.match(html, /&lt;img onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html, /<img/);
});

test("import batch keeps its captured episode and cancels remaining files", async () => {
  const controller = new AbortController();
  const rows = [{ file: { name: "one" }, state: "Waiting" }, { file: { name: "two" }, state: "Waiting" }];
  const seen = [];
  await runImportBatch({ rows, episodeId: "captured", signal: controller.signal, upload: async (row, _signal, episodeId) => {
    seen.push([row.file.name, episodeId]);
    controller.abort();
  }});
  assert.deepEqual(seen, [["one", "captured"]]);
  assert.deepEqual(rows.map((row) => row.state), ["Imported", "Cancelled"]);
});

test("dropped folders are flattened into the same file queue", async () => {
  const fileEntry = (name) => ({ isFile: true, isDirectory: false, file(resolve) { resolve({ name }); } });
  const directoryEntry = (...entries) => ({
    isFile: false,
    isDirectory: true,
    createReader() {
      let read = false;
      return { readEntries(resolve) { resolve(read ? [] : (read = true, entries)); } };
    },
  });
  const files = await filesFromDataTransfer({
    items: [
      { webkitGetAsEntry: () => fileEntry("one.mp4") },
      { webkitGetAsEntry: () => directoryEntry(fileEntry("two.png"), directoryEntry(fileEntry("three.wav"))) },
    ],
  });
  assert.deepEqual(files.map((file) => file.name), ["one.mp4", "two.png", "three.wav"]);
});

test("card and library uploads stay beat-neutral at the media boundary", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return { ok: true, json: async () => ({ id: "item" }) };
  };
  const item = await uploadLibraryFile({
    episodeId: "episode",
    file: { name: "clip.webm", type: "video/webm" },
    category: "B-roll",
  });
  assert.equal(item.id, "item");
  assert.equal(request.url, "/api/episodes/episode/library/files");
  assert.equal(request.options.headers["x-story-section-id"], undefined);
});

test("changing a card to Audio stores the role displayed by the UI", () => {
  const visual = { id: "visual", title: "Visual", type: "Video", sectionId: "section", itemId: "visual-item", in: 0, out: 2 };
  const audio = { id: "audio", title: "QA Voice", type: "Video", sectionId: "section", itemId: "audio-item", anchorVisualCardId: "visual", in: 0, out: 1 };

  setCardType(audio, "Audio");

  assert.equal(audio.role, "voiceover");
  const plan = buildRenderPlan({
    sections: [{ id: "section" }],
    cards: [visual, audio],
    libraryItems: [
      { id: "visual-item", assetId: "visual-asset", asset: { kind: "video", duration: 2 } },
      { id: "audio-item", assetId: "audio-asset", asset: { kind: "audio", duration: 1 } },
    ],
  });
  assert.equal(plan.audioPlacements[0].role, "voiceover");
});

test("direct card imports use the card as the media-to-beat relationship", () => {
  const cards = [{ id: "beat-card", type: "Video", sectionId: "beat", itemId: null }];
  assert.equal(categoryForCardMedia(cards[0], { type: "video/webm" }), "B-roll");
  assert.equal(categoryForCardMedia({ type: "Audio" }, { type: "" }), "Narration");
  assert.equal(attachMediaToCard(cards, "beat-card", "library-item"), cards[0]);
  assert.equal(cards[0].itemId, "library-item");
  assert.equal(cards[0].sectionId, "beat");
  assert.equal(attachMediaToCard(cards, "missing", "other"), null);
});

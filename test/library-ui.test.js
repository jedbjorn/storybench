import test from "node:test";
import assert from "node:assert/strict";
import { episodeNavigatorHTML, runImportBatch } from "../public/library-workspace.js";
import { setCardType } from "../public/card-workspace.js";
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

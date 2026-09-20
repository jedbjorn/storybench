import test from "node:test";
import assert from "node:assert/strict";
import { createStoryRenderer, mappingChangeSummary, STARTER_STORY, StoryEditor } from "../src/story-editor.js";

test("story renderer supports the agreed markdown without executing document HTML", () => {
  const render = createStoryRenderer();
  const html = render(`# Heading

~~cut~~ **bold**

| A | B |
| - | - |
| 1 | 2 |

<script>alert(1)</script>`);
  assert.match(html, /<h1>Heading<\/h1>/);
  assert.match(html, /<s>cut<\/s>/);
  assert.match(html, /<table>/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});

test("story renderer hides reserved section metadata and never loads remote images", () => {
  const render = createStoryRenderer();
  const html = render(`<!-- storybench:section 123e4567-e89b-12d3-a456-426614174000 -->
## Intro
![tracking](https://example.com/pixel.png)`);
  assert.doesNotMatch(html, /storybench:section/);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /tracking unavailable/);
  assert.match(STARTER_STORY, /# Overview[\s\S]*# Hook[\s\S]*# Sections[\s\S]*## Intro[\s\S]*## Outro/);
});

test("story renderer preserves invalid and inline section-like comments", () => {
  const render = createStoryRenderer();
  const html = render(`<!-- storybench:section deadbeef -->

Text <!-- storybench:section 123e4567-e89b-12d3-a456-426614174000 --> stays`);
  assert.match(html, /storybench:section deadbeef/);
  assert.match(html, /Text &lt;!-- storybench:section 123e4567-e89b-12d3-a456-426614174000 --&gt; stays/);
});

test("story renderer neutralizes unsafe link schemes", () => {
  const html = createStoryRenderer()(`[safe](https://example.com) [unsafe](javascript:alert(1))`);
  assert.match(html, /href="https:\/\/example.com"/);
  assert.doesNotMatch(html, /href="javascript:/);
});

test("out-of-order story reads cannot cross episode identity", async () => {
  const pending = new Map();
  const editor = Object.assign(Object.create(StoryEditor.prototype), {
    episodeId: null,
    story: null,
    view: null,
    mode: "read",
    api: (url) => new Promise((resolve) => pending.set(url, resolve)),
    destroyView() {},
    drawRead() {},
    showLoading() {},
    showLoadError() {},
    showMappingChanges() {},
  });
  const first = editor.open("episode-a");
  const second = editor.open("episode-b");
  pending.get("/api/episodes/episode-b/story")({ storyRevision: 8, source: "B" });
  assert.equal(await second, true);
  pending.get("/api/episodes/episode-a/story")({ storyRevision: 8, source: "A" });
  assert.equal(await first, false);
  assert.equal(editor.episodeId, "episode-b");
  assert.equal(editor.story.source, "B");
});

test("mapping changes produce a persistent user-facing reassignment summary", () => {
  assert.equal(mappingChangeSummary({ retiredSectionIds: ["section"], unassignedCardIds: ["a", "b"] }),
    "2 cards are now unassigned because 1 story section was removed. Open Storyboard to reassign them.");
  assert.equal(mappingChangeSummary({ retiredSectionIds: [], unassignedCardIds: [] }), "");
});

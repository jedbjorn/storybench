import test from "node:test";
import assert from "node:assert/strict";
import { createStoryRenderer, STARTER_STORY } from "../src/story-editor.js";

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

test("story renderer neutralizes unsafe link schemes", () => {
  const html = createStoryRenderer()(`[safe](https://example.com) [unsafe](javascript:alert(1))`);
  assert.match(html, /href="https:\/\/example.com"/);
  assert.doesNotMatch(html, /href="javascript:/);
});

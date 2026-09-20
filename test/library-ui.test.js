import test from "node:test";
import assert from "node:assert/strict";
import { episodeNavigatorHTML } from "../public/library-workspace.js";

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

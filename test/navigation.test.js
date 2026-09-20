import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";

test("episode navigation exposes the five accepted workspace tabs in order", async () => {
  const dom = new JSDOM(await readFile(new URL("../public/index.html", import.meta.url), "utf8"));
  const labels = [...dom.window.document.querySelectorAll(".tabs > button")].map((button) => button.childNodes[0].textContent.trim());
  assert.deepEqual(labels, ["Storyboard", "Story.md", "Media Library", "Drafts", "Final"]);
  for (const tab of ["board", "story", "media", "drafts", "final"]) assert.ok(dom.window.document.querySelector(`#${tab}Panel`));
  dom.window.close();
});

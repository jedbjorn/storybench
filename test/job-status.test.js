import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { refreshJobStatus, renderJobList } from "../public/job-status.js";

test("job refresh uses server status without clobbering concurrent local episode drafts", async () => {
  let release;
  const response = new Promise((resolve) => { release = resolve; });
  let current = { episodes: [{ id: "episode", notes: "saved" }], assets: [{ id: "old" }], jobs: [{ id: "job", stale: false }] };
  const refreshing = refreshJobStatus(async (url) => {
    assert.equal(url, "/api/state");
    return response;
  }, () => current);
  const localEpisodes = [{ id: "episode", notes: "unsaved local notes" }];
  current = { ...current, episodes: localEpisodes, assets: [{ id: "new" }] };
  release({ episodes: [{ id: "episode", notes: "server" }], assets: [], jobs: [{ id: "job", stale: true }] });

  const next = await refreshing;
  assert.equal(next.episodes, localEpisodes);
  assert.deepEqual(next.assets, [{ id: "new" }]);
  assert.deepEqual(next.jobs, [{ id: "job", stale: true }]);
});

test("job updates preserve completed playback across stale and sibling refreshes", () => {
  const dom = new JSDOM('<div id="jobs"></div>');
  const container = dom.window.document.querySelector("#jobs");
  const completed = { id: "done", kind: "render", state: "completed", progress: 1, revision: 2, outputClass: "draft", createdAt: "2026-09-20T12:00:00.000Z", stale: false, error: null };
  const active = { id: "active", kind: "graphic", state: "running", progress: 0.1, revision: 1, outputClass: null, createdAt: "2026-09-20T12:01:00.000Z", stale: false, error: null };
  renderJobList(container, [completed, active]);
  const video = container.querySelector("video");
  const activeRow = container.querySelector('[data-job-id="active"]');
  let rowMoves = 0;
  const insertBefore = container.insertBefore.bind(container);
  container.insertBefore = (...args) => { rowMoves++; return insertBefore(...args); };

  renderJobList(container, [completed, active]);
  assert.equal(container.querySelector("video"), video);
  assert.equal(rowMoves, 0);
  renderJobList(container, [{ ...completed, stale: true }, { ...active, progress: 0.6 }]);
  assert.equal(container.querySelector("video"), video);
  assert.equal(video.isConnected, true);
  assert.match(container.querySelector('[data-job-id="done"]').textContent, /out of date/);
  assert.equal(container.querySelector('[data-job-id="active"]'), activeRow);
  assert.match(container.querySelector('[data-job-id="active"]').textContent, /60%/);
  assert.equal(rowMoves, 0);
  dom.window.close();
});

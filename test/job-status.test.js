import test from "node:test";
import assert from "node:assert/strict";
import { refreshJobStatus } from "../public/job-status.js";

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

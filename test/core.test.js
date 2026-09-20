import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, symlink } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { Store } from "../src/store.js";
import { createApp } from "../src/server.js";

async function fixture(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "storybench-core-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test("workspace persists episodes, assets, and jobs", async (t) => {
  const dir = await fixture(t);
  let store = new Store(dir);
  const asset = store.saveAsset({
    name: "clip.mp4",
    hash: "abc",
    kind: "video",
    path: "media/abc",
    duration: 10,
    width: 1920,
    height: 1080,
    metadata: { hasAudio: true },
  });
  let episode = store.createEpisode({ title: "Pilot", notes: "A first pass" });
  episode = store.updateEpisode(episode.id, episode.revision, {
    cards: [
      {
        id: "one",
        title: "Open",
        purpose: "",
        notes: "",
        missing: "",
        visual: { assetId: asset.id, in: 1, out: 4, offset: 0, gain: 1 },
        narration: null,
      },
    ],
  });
  store.saveJob({
    episodeId: episode.id,
    kind: "preview",
    state: "completed",
    progress: 1,
    revision: episode.revision,
    outputPath: "exports/a.mp4",
  });
  store.close();
  store = new Store(dir);
  t.after(() => store.close());
  assert.equal(store.getEpisode(episode.id).cards[0].visual.in, 1);
  assert.equal(store.listAssets()[0].path, "media/abc");
  assert.equal(store.listJobs()[0].state, "completed");
});

test("stale update fails and repeated undo traverses edits without toggling", async (t) => {
  const store = new Store(await fixture(t));
  t.after(() => store.close());
  let episode = store.createEpisode({ title: "A" });
  const stale = episode.revision;
  episode = store.updateEpisode(episode.id, episode.revision, { title: "B" });
  assert.throws(
    () => store.updateEpisode(episode.id, stale, { title: "lost" }),
    (e) => e.statusCode === 409,
  );
  episode = store.updateEpisode(episode.id, episode.revision, { title: "C" });
  episode = store.undoEpisode(episode.id, episode.revision);
  assert.equal(episode.title, "B");
  episode = store.undoEpisode(episode.id, episode.revision);
  assert.equal(episode.title, "A");
  assert.equal(episode.revision, 5);
  assert.throws(
    () => store.undoEpisode(episode.id, episode.revision),
    (e) => e.statusCode === 409,
  );
});

test("editing after undo creates a branch with the visible state as its parent", async (t) => {
  const store = new Store(await fixture(t));
  t.after(() => store.close());
  let episode = store.createEpisode({ title: "A" });
  episode = store.updateEpisode(episode.id, episode.revision, { title: "B" });
  episode = store.updateEpisode(episode.id, episode.revision, { title: "C" });
  episode = store.undoEpisode(episode.id, episode.revision);
  assert.equal(episode.title, "B");
  episode = store.updateEpisode(episode.id, episode.revision, { title: "D" });
  episode = store.undoEpisode(episode.id, episode.revision);
  assert.equal(episode.title, "B");
  episode = store.undoEpisode(episode.id, episode.revision);
  assert.equal(episode.title, "A");
});

test("card validation rejects unknown, wrong-kind, and out-of-range sources", async (t) => {
  const store = new Store(await fixture(t));
  t.after(() => store.close());
  const episode = store.createEpisode({});
  const audio = store.saveAsset({
    name: "voice.wav",
    hash: "voice",
    kind: "audio",
    path: "media/voice",
    duration: 2,
    metadata: { hasAudio: true },
  });
  const card = (visual) => [
    {
      id: "c",
      title: "",
      purpose: "",
      notes: "",
      missing: "",
      visual,
      narration: null,
    },
  ];
  assert.throws(
    () =>
      store.updateEpisode(episode.id, 1, {
        cards: card({ assetId: "missing", in: 0, out: 1, offset: 0, gain: 1 }),
      }),
    /not found/,
  );
  assert.throws(
    () =>
      store.updateEpisode(episode.id, 1, {
        cards: card({ assetId: audio.id, in: 0, out: 1, offset: 0, gain: 1 }),
      }),
    /video or image/,
  );
  assert.throws(
    () =>
      store.updateEpisode(episode.id, 1, {
        cards: [
          {
            ...card(null)[0],
            narration: { assetId: audio.id, in: 0, out: 3, offset: 0, gain: 1 },
          },
        ],
      }),
    /exceeds/,
  );
});

test("HTTP shutdown closes SSE and completed job files cannot escape through symlinks", async (t) => {
  const dir = await fixture(t);
  const outside = path.join(
    os.tmpdir(),
    `storybench-secret-${process.pid}-${Date.now()}`,
  );
  await writeFile(outside, "secret");
  t.after(() => rm(outside, { force: true }));
  const app = await createApp({ workspace: dir });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const port = app.server.address().port;
  await symlink(outside, path.join(dir, "exports", "escape"));
  const episode = app.store.createEpisode({ title: "Boundary" });
  const job = app.store.saveJob({
    episodeId: episode.id,
    kind: "export",
    state: "completed",
    progress: 1,
    revision: 1,
    outputPath: "exports/escape",
  });
  const escaped = await fetch(
    `http://127.0.0.1:${port}/api/jobs/${job.id}/file`,
  );
  assert.equal(escaped.status, 403);
  const stream = await fetch(
    `http://127.0.0.1:${port}/api/episodes/${episode.id}/chat/events`,
  );
  assert.equal(stream.status, 200);
  await Promise.race([
    app.close(),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("shutdown did not close SSE")), 1500),
    ),
  ]);
});

test("missing static routes return 404 repeatedly without crashing the HTTP service", async (t) => {
  const dir = await fixture(t);
  const app = await createApp({ workspace: dir });
  t.after(() => app.close());
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const episode = app.store.createEpisode({ title: "Recovery" });
  const outputPath = path.join(dir, "exports", "known.mp4");
  await writeFile(outputPath, "registered output");
  const job = app.store.saveJob({
    episodeId: episode.id,
    kind: "export",
    state: "completed",
    progress: 1,
    revision: episode.revision,
    outputPath: "exports/known.mp4",
  });

  for (let attempt = 0; attempt < 5; attempt++)
    assert.equal((await fetch(`${base}/favicon.ico`)).status, 404);
  assert.equal((await fetch(`${base}/unknown-static-path`)).status, 404);
  assert.equal((await fetch(`${base}/api/not-a-route`)).status, 404);

  const [state, page, output] = await Promise.all([
    fetch(`${base}/api/state`),
    fetch(`${base}/`),
    fetch(`${base}/api/jobs/${job.id}/file`),
  ]);
  assert.equal(state.status, 200);
  assert.equal(page.status, 200);
  assert.equal(output.status, 200);
  assert.equal(await output.text(), "registered output");
});

test("shutdown leaves no queued or running render state", async (t) => {
  const dir = await fixture(t);
  const app = await createApp({ workspace: dir });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const port = app.server.address().port;
  const episode = app.store.createEpisode({ title: "Queue" });
  const request = () =>
    fetch(`http://127.0.0.1:${port}/api/episodes/${episode.id}/render`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"kind":"export"}',
    }).then((response) => response.json());
  const [first, second] = await Promise.all([request(), request()]);
  await app.close();
  const reopened = new Store(dir);
  t.after(() => reopened.close());
  assert.equal(reopened.getJob(first.id).state, "failed");
  assert.equal(reopened.getJob(second.id).state, "failed");
});

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createApp } from "../src/server.js";

test("HTTP draft/final flow requires request-bound intent and retires timed grants", async (t) => {
  const workspace = await mkdtemp(path.join(tmpdir(), "storybench-render-http-"));
  const app = await createApp({ workspace, renderOptions: { renderCompositionImpl: async ({ outputPath }) => {
    await writeFile(outputPath, "rendered"); return { path: outputPath };
  } } });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { await app.close(); await rm(workspace, { recursive: true, force: true }); });
  const origin = `http://127.0.0.1:${app.server.address().port}`;
  let episode = app.store.createEpisode({ title: "HTTP intent" });
  const story = app.store.saveStory(episode.id, 1, "# Sections\n\n## Main");
  await writeFile(path.join(workspace, "media", "source.mp4"), "source");
  const asset = app.store.saveAsset({ name: "source.mp4", hash: "http-source", kind: "video", path: "media/source.mp4", duration: 1, metadata: {} });
  const item = app.store.attachLibraryItem(episode.id, asset.id, { category: "B-roll" });
  episode = app.store.updateEpisode(episode.id, episode.revision, { cards: [{ id: "visual", title: "Visual", type: "Video",
    sectionId: story.sections[0].id, itemId: item.id, in: 0, out: 1 }] });
  const request = (pathname, body, method = "POST") => fetch(`${origin}${pathname}`, { method,
    headers: { origin, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });

  const planResponse = await request(`/api/episodes/${episode.id}/render-plan`, null, "GET");
  assert.equal(planResponse.status, 200);
  const plan = await planResponse.json();
  const missing = await request(`/api/episodes/${episode.id}/render`, { outputClass: "final", expectedRenderRevision: plan.renderRevision });
  assert.equal(missing.status, 403);

  const retired = await request(`/api/episodes/${episode.id}/final-authorizations`, {
    expectedRenderRevision: plan.renderRevision, requestId: "human-click",
  });
  assert.equal(retired.status, 410);
  const conversation = app.chat.create(episode.id, { name: "HTTP Final" });
  const message = app.store.addConversationMessage({ conversationId: conversation.id, role: "user", text: "Create final", shortcut: true });
  const run = app.store.createProductionRun({ id: "request_http_final", conversationId: conversation.id, kind: "final", origin: "button",
    originatingMessageId: message.id, harness: "codex" }).run;
  const accepted = await request(`/api/episodes/${episode.id}/render`, { outputClass: "final",
    expectedRenderRevision: plan.renderRevision, conversationId: conversation.id, requestId: run.id });
  assert.equal(accepted.status, 202);
  const acceptedJob = await accepted.json();
  const reused = await request(`/api/episodes/${episode.id}/render`, { outputClass: "final",
    expectedRenderRevision: plan.renderRevision, conversationId: conversation.id, requestId: run.id });
  assert.equal(reused.status, 202);
  assert.equal((await reused.json()).id, acceptedJob.id);
  for (let attempt = 0; attempt < 100 && app.store.getProductionRun(run.id).finalIntent !== "published"; attempt++)
    await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(app.store.getProductionRun(run.id).finalIntent, "published");

  const draft = await request(`/api/episodes/${episode.id}/render`, { outputClass: "draft", expectedRenderRevision: plan.renderRevision });
  assert.equal(draft.status, 202);
});

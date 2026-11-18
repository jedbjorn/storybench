// Shared fixtures for the agent job tests: a fixture catalogue, a scripted launcher and an
// app with one production and two conversations.
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createApp } from "../src/server.js";
import { createAgentJobService } from "../src/agent-jobs.js";

export const CATALOG = [
  { source: "codex-login", harness: "codex", available: true, models: [{ id: "gpt-5.5", isDefault: true, efforts: ["low", "medium", "high"], inputModalities: ["text", "image"] }, { id: "gpt-text", efforts: ["low"], inputModalities: ["text"] }] },
  { source: "claude-login", harness: "claude", available: true, efforts: ["low", "high"], models: [{ id: "sonnet", efforts: ["low", "high"] }] },
  { id: "gateway", source: "gateway", harness: "opencode", available: true, models: [{ id: "fixture-model", efforts: [] }] },
];

// A scripted harness connection. Each launch takes the next behaviour; the default completes.
export function fakeLauncher(behaviours = []) {
  const launches = [];
  const launcher = async (job, { onEvent, onError, supportsImages }) => {
    const behaviour = behaviours.shift() ?? "complete";
    if (behaviour === "launch-fails") throw new Error("worker.start refused");
    const emit = (method, params = {}) => onEvent({ method, params: { turnId: "turn-1", ...params } });
    const connection = {
      job, supportsImages, onError, closed: 0, resumed: null, prompts: [], emit,
      async startThread() { if (behaviour === "no-session") throw new Error("thread/start failed"); return randomUUID(); },
      async resumeThread(id) { connection.resumed = id; if (behaviour === "resume-lost") { connection.segmentTransition = { previousThreadId: id }; return randomUUID(); } return id; },
      async startTurn(threadId, text) {
        connection.prompts.push(text);
        queueMicrotask(async () => {
          if (behaviour === "hang") return;
          emit("turn/started", { turn: { id: "turn-1" } });
          if (typeof behaviour === "function") return behaviour(connection);
          emit("item/agentMessage/delta", { itemId: "a", delta: "Looking at the references." });
          emit("item/agentMessage/delta", { itemId: "b", delta: "Report: wrote " });
          emit("item/agentMessage/delta", { itemId: "b", delta: "notes.md in the pad." });
          emit("turn/completed", { turn: { id: "turn-1", status: behaviour === "fail" ? "failed" : "completed", ...(behaviour === "fail" ? { error: "model refused" } : {}) } });
        });
        return "turn-1";
      },
      close() { connection.closed++; },
    };
    launches.push(connection);
    return connection;
  };
  return { launcher, launches, behaviours };
}

export async function jobFixture(t, { behaviours = [], catalog = CATALOG, kind = "video" } = {}) {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "sb-agent-jobs-"));
  const app = await createApp({ workspace });
  const episode = app.store.createEpisode({ title: "Jobs fixture", kind });
  const conversation = app.chat.create(episode.id, { name: "Jobs" });
  const other = app.chat.create(episode.id, { name: "Other" });
  for (const id of [conversation.id, other.id])
    app.store.db.prepare("UPDATE conversations SET harness='codex',inference_source='codex-login',model='gpt-5.5',effort='medium' WHERE id=?").run(id);
  const fake = fakeLauncher(behaviours);
  const changes = [];
  const service = createAgentJobService({ store: app.store, launcher: fake.launcher, catalog: async () => catalog, onChange: (job) => changes.push(job.state) });
  t.after(async () => { await service.close(); await app.close(); await rm(workspace, { recursive: true, force: true }); });
  const start = (input = {}, conversationId = conversation.id) => service.start({ conversationId, requestId: "request_parent", brief: "Collect three facts about the topic.", label: "Research", ...input });
  return { app, episode, conversation, other, fake, service, start, changes, workspace };
}

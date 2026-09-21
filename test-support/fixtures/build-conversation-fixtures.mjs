// Rebuilds the committed schema fixtures from the historical application code (not from current code):
//   v8-conversations.sqlite  <- origin/main at 0fcda47 (schema 8)
//   v5-conversations.sqlite  <- 833608a (schema 5, before channels)
// Each fixture holds an episode with two conversations whose messages and events were produced by that release's
// own chat service (a scripted Codex connection stands in for the provider), one of them with a thread id.
// Usage: node test-support/fixtures/build-conversation-fixtures.mjs   (needs git history and node_modules)
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const here = path.dirname(fileURLToPath(import.meta.url));

const driver = (legacy) => `
import { createChatService } from "./src/chat.js";
import { Store } from "./src/store.js";
import { DatabaseSync } from "node:sqlite";
const root = process.argv[2];
const store = new Store(root);
${legacy ? "" : "const channel = store.listChannels()[0];"}
const episode = store.createEpisode({ title: "Fixture episode"${legacy ? "" : ", channelId: channel.id"} });
let turn = 0;
const codexFactory = async ({ onEvent }) => ({
  async startThread() { return "thread_fixture_" + (++turn); },
  async resumeThread(id) { return id; },
  async startTurn(threadId) {
    const turnId = "turn_" + threadId + "_" + Date.now();
    setTimeout(() => {
      onEvent({ method: "turn/started", params: { threadId, turnId } });
      onEvent({ method: "item/agentMessage/delta", params: { threadId, turnId, delta: "Fixture reply." } });
      onEvent({ method: "turn/completed", params: { threadId, turn: { id: turnId, status: "completed" } } });
    }, 5);
    return turnId;
  },
  async interrupt() {}, close() {},
});
const chat = createChatService({ store, renders: { validateRender: () => ({}) }, codexFactory });
const first = chat.create(episode.id, { name: "With thread" });
await chat.send(episode.id, first.id, "Please outline the opening.");
for (let i = 0; i < 200 && chat.get(episode.id, first.id).state !== "idle"; i++) await new Promise((r) => setTimeout(r, 10));
await chat.send(episode.id, first.id, "Now tighten it.");
for (let i = 0; i < 200 && chat.get(episode.id, first.id).state !== "idle"; i++) await new Promise((r) => setTimeout(r, 10));
chat.create(episode.id, { name: "Never sent" });
await chat.close();
store.close();
const db = new DatabaseSync(root + "/storybench.sqlite");
db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
console.log(JSON.stringify({ version: db.prepare("PRAGMA user_version").get().user_version,
  conversations: db.prepare("SELECT COUNT(*) n FROM conversations").get().n, messages: db.prepare("SELECT COUNT(*) n FROM conversation_messages").get().n,
  events: db.prepare("SELECT COUNT(*) n FROM conversation_events").get().n }));
db.close();
`;

for (const [rev, name, legacy] of [["0fcda47", "v8-conversations.sqlite", false], ["833608a", "v5-conversations.sqlite", true]]) {
  const work = mkdtempSync(path.join(os.tmpdir(), `storybench-fixture-${rev}-`));
  try {
    execFileSync("sh", ["-c", `git -C "$1" archive "$2" src package.json | tar -x -C "$3"`, "sh", repo, rev, work]);
    symlinkSync(path.join(repo, "node_modules"), path.join(work, "node_modules"));
    writeFileSync(path.join(work, "driver.mjs"), driver(legacy));
    const root = path.join(work, "root");
    const summary = execFileSync(process.execPath, [path.join(work, "driver.mjs"), root], { cwd: work, encoding: "utf8" }).trim();
    copyFileSync(path.join(root, "storybench.sqlite"), path.join(here, name));
    console.log(`${name} from ${rev}: ${summary}`);
  } finally { rmSync(work, { recursive: true, force: true }); }
}

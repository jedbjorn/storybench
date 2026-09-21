// Lifecycle foundation tests: release manifest, health redaction, orphan reconciliation,
// session transfer, request render guard and chat wiring. No Docker, providers or real
// credential/CLI-home paths are used.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Store, SCHEMA_VERSION } from "../src/store.js";
import { createChatService } from "../src/chat.js";
import { createApp } from "../src/server.js";
import { initDataRoot, openDataRoot } from "../src/services/data-root.js";
import { createChannel } from "../src/services/channels.js";
import {
  LEGACY_SUPPORTED_SCHEMA, MANIFEST_SCHEMA, RUNTIME_PROTOCOL, checkCompatibility, createManifest, manifestId, releaseIdentity, supportedSchemaOf, validateManifest,
} from "../src/runtime/manifest.js";
import { createHealth, releaseFromEnv } from "../src/runtime/health.js";
import { createHost } from "../src/runtime/host.js";
import { appRunArgs, validateHostConfig } from "../src/runtime/layout.js";
import { listConversationThreads, transferCodexSessions } from "../src/runtime/session-migrate.js";
import { mergeTools } from "../src/runtime/app-runtime.js";
import { activeRenderHolder, claimEpisodeRenders } from "../src/runtime/request.js";

const A = `sha256:${"a".repeat(64)}`, B = `sha256:${"b".repeat(64)}`;
const manifest = () => createManifest({ packageName: "storybench", packageVersion: "0.1.0", commit: "5049150abcdef", ref: "main", builtAt: "2026-09-21T00:00:00Z", images: { app: A, worker: B }, tools: { codex: "0.155.1" }, schema: { min: 0, max: SCHEMA_VERSION } });

async function tempDir(t, prefix = "sb-life-") {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test("release manifests pin exact paired images, protocol and schema range", () => {
  const value = manifest();
  assert.equal(value.schema, MANIFEST_SCHEMA);
  assert.equal(value.id, manifestId(value));
  assert.equal(manifestId({ ...value, builtAt: value.builtAt }), value.id);
  assert.equal(validateManifest(JSON.parse(JSON.stringify(value))).id, value.id);
  assert.throws(() => validateManifest({ ...value, images: { app: { id: "storybench-app:latest" }, worker: { id: B } } }), /exact sha256/);
  assert.throws(() => validateManifest({ ...value, images: { app: { id: A }, worker: { id: A } } }), /distinct/);
  assert.throws(() => validateManifest({ ...value, source: { commit: "main" } }), /git commit/);
  assert.throws(() => validateManifest({ ...value, database: { supportedSchema: { min: 5, max: 3 } } }), /supportedSchema/);
  assert.throws(() => validateManifest({ ...value, images: { ...value.images, worker: { id: `sha256:${"c".repeat(64)}` } } }), /id does not match/);
  assert.deepEqual(checkCompatibility(value, { schemaVersion: SCHEMA_VERSION }), { compatible: true, problems: [] });
  assert.equal(checkCompatibility(value, { schemaVersion: SCHEMA_VERSION + 1 }).compatible, false);
  assert.equal(checkCompatibility(value, { hostProtocol: RUNTIME_PROTOCOL + 1 }).compatible, false);
  assert.deepEqual(supportedSchemaOf(null), { min: 0, max: 5 });
  assert.equal(LEGACY_SUPPORTED_SCHEMA.max, 5);
  assert.deepEqual(releaseIdentity(value).images, { app: A, worker: B });
});

test("host config takes image identity from the manifest and passes release identity to the app", () => {
  const base = { installId: "t1", dataRoot: "/srv/d", stateRoot: "/srv/s", runtimeRoot: "/run/u/sb", port: 18850, credentials: { codex: "/h/.codex/auth.json", claude: "/h/.claude/.credentials.json" } };
  const config = validateHostConfig({ ...base, manifest: manifest(), codexModel: "gpt-5.6-terra" });
  assert.deepEqual(config.images, { app: A, worker: B });
  const args = appRunArgs(config);
  const release = JSON.parse(args[args.findIndex((arg) => arg.startsWith("STORYBENCH_RELEASE="))].slice("STORYBENCH_RELEASE=".length));
  assert.equal(release.manifestId, manifest().id);
  assert.ok(args.includes("STORYBENCH_CODEX_MODEL=gpt-5.6-terra"));
  assert.throws(() => validateHostConfig({ ...base, manifest: manifest(), images: { app: A, worker: B } }), /not both/);
  assert.throws(() => validateHostConfig({ ...base, manifest: { ...manifest(), schema: "x" } }), /INVALID|schema/);
  assert.throws(() => validateHostConfig({ ...base, manifest: manifest(), codexModel: "gpt --flag" }), /plain model/);
});

test("health reports bounded facts aggregated across channels and never paths, names or content", async (t) => {
  const root = await tempDir(t);
  initDataRoot(root);
  const a = createChannel(root, "Secret Channel Alpha"), b = createChannel(root, "Secret Channel Beta");
  const store = openDataRoot(root);
  t.after(() => store.close());
  const epA = store.createEpisode({ title: "Private Episode Title", channelId: a.id });
  store.createEpisode({ title: "Other", channelId: b.id });
  createChatService({ store, codexFactory: async () => { throw new Error("unused"); } });
  const now = new Date().toISOString();
  store.db.prepare("INSERT INTO conversations(id,episode_id,name,state,created_at,updated_at) VALUES('conversation_x',?,'Chat','running',?,?)").run(epA.id, now, now);
  const epB = store.listEpisodes({ channelId: b.id })[0];
  store.saveJob({ episodeId: epA.id, kind: "render", state: "running", revision: 1, outputPath: `${root}/channels/${a.id}/draft-secret.mp4` });
  store.saveJob({ episodeId: epB.id, kind: "graphic", state: "queued", revision: 1 });
  store.saveJob({ episodeId: epB.id, kind: "render", state: "completed", revision: 1 });
  const release = releaseFromEnv({ STORYBENCH_RELEASE: JSON.stringify({ ...releaseIdentity(manifest()), extra: "/home/secret/path" }) });
  const snapshot = createHealth({ store, release }).snapshot();
  assert.equal(snapshot.status, "ready");
  assert.equal(snapshot.activity.agents.active, 1);
  assert.deepEqual(snapshot.activity.renders, { queued: 1, running: 1 }, "render jobs in both channels are counted");
  assert.deepEqual(snapshot.schema, { current: SCHEMA_VERSION, supported: { min: 0, max: SCHEMA_VERSION } });
  assert.equal(snapshot.database.id, store.dataRootIdentity().id);
  assert.equal(snapshot.release.manifestId, manifest().id);
  const text = JSON.stringify(snapshot);
  for (const secret of [root, "Secret Channel", "Private Episode", "/home/secret", "conversation_x", "draft-secret", a.id, epA.id]) assert.ok(!text.includes(secret), secret);
  assert.equal(releaseFromEnv({ STORYBENCH_RELEASE: "not json" }), null);
  assert.equal(createHealth({ store, getState: () => "draining" }).snapshot().shuttingDown, true);
});

test("GET /api/health keeps the loopback Host protection and reports draining", async (t) => {
  const root = await tempDir(t);
  initDataRoot(root);
  createChannel(root, "One");
  const app = await createApp({ dataRoot: root, chatOptions: { codexFactory: async () => { throw new Error("unused"); } } });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const port = app.server.address().port;
  const ok = await fetch(`http://127.0.0.1:${port}/api/health`);
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).ready, true);
  const { request } = await import("node:http");
  const status = await new Promise((resolve) => request({ host: "127.0.0.1", port, path: "/api/health", headers: { host: "evil.example" } }, (res) => { res.resume(); resolve(res.statusCode); }).end());
  assert.equal(status, 403);
  await app.close();
});

function fakeDocker(containers) {
  const calls = [];
  return {
    calls,
    docker: async (args) => { calls.push(args); if (args[0] === "rm") containers.delete(args.at(-1)); return ""; },
    listByLabels: async (labels) => [...containers.keys()].filter((id) => Object.entries(labels).every(([key, value]) => containers.get(id).Config.Labels[key] === value)),
    inspectContainer: async (id) => containers.get(id) ?? null,
    ensureNetwork: async () => {},
  };
}

test("reconciliation removes this installation's orphans only and reports their requests", async (t) => {
  const runtimeRoot = await tempDir(t, "sb-rt-");
  const label = (install, role, request) => ({ Config: { Labels: { "io.storybench.install": install, "io.storybench.role": role, ...(request ? { "io.storybench.request": request, "io.storybench.harness": "codex" } : {}) } }, State: { Status: "running" } });
  const containers = new Map([["c2".padEnd(64, "0"), label("inst1", "worker", "request_orphan")], ["c1".padEnd(64, "0"), label("inst1", "app")], ["c3".padEnd(64, "0"), label("other", "worker", "request_foreign")]]);
  const api = fakeDocker(containers);
  const events = [];
  await mkdir(path.join(runtimeRoot, "credentials", "request_orphan"), { recursive: true });
  await writeFile(path.join(runtimeRoot, "credentials", "request_orphan", "auth.json"), "{}");
  const host = createHost({ installId: "inst1", dataRoot: "/srv/d", stateRoot: "/srv/s", runtimeRoot, port: 18851, images: { app: A, worker: B },
    credentials: { codex: "/h/a.json", claude: "/h/c.json" } }, { dockerApi: api, log: (event) => events.push(event) });
  const result = await host.reconcile();
  assert.deepEqual(result.orphanRequests, ["request_orphan"]);
  assert.deepEqual([...containers.keys()], ["c3".padEnd(64, "0")], "another installation's container is untouched");
  const removals = api.calls.filter((args) => args[0] === "rm").map((args) => args.at(-1).slice(0, 2));
  assert.deepEqual(removals, ["c1", "c2"], "the surviving app is removed before its workers");
  assert.ok(events.some((event) => event.event === "reconcile.remove" && event.role === "worker" && event.requestId === "request_orphan"));
  await assert.rejects(stat(path.join(runtimeRoot, "credentials")));
});

test("the app marks turns left unfinished by a crash interrupted and never replays them", async (t) => {
  const root = await tempDir(t);
  const store = new Store(root);
  t.after(() => store.close());
  const episode = store.createEpisode();
  let launches = 0;
  let chat = createChatService({ store, codexFactory: async () => { launches++; throw new Error("unused"); } });
  const conversation = chat.create(episode.id);
  const now = new Date().toISOString();
  store.db.prepare("UPDATE conversations SET state='running',active_turn_id='turn_lost' WHERE id=?").run(conversation.id);
  store.db.prepare("INSERT INTO conversation_messages(conversation_id,role,text,state,created_at,updated_at) VALUES(?,'user','do it','running',?,?)").run(conversation.id, now, now);
  chat = createChatService({ store, codexFactory: async () => { launches++; throw new Error("must not launch"); } });
  const recovered = chat.get(episode.id, conversation.id);
  assert.equal(recovered.state, "interrupted");
  assert.equal(recovered.messages[0].state, "interrupted");
  assert.match(recovered.error, /not replayed/);
  assert.equal(launches, 0);
  await chat.close();
});

test("an unresumable native thread continues visibly in a fresh segment with a bounded transcript", async (t) => {
  const root = await tempDir(t);
  const store = new Store(root);
  t.after(() => store.close());
  const episode = store.createEpisode();
  let factoryOptions, turnText;
  const factory = async (options) => {
    factoryOptions = options;
    return {
      segmentTransition: null,
      async resumeThread(id) { this.segmentTransition = { previousThreadId: id, threadId: "thread_new", reason: "CODEX_SESSION_LOST" }; return "thread_new"; },
      async startThread() { return "thread_new"; },
      async startTurn(_thread, text) { turnText = text; queueMicrotask(() => options.onEvent({ method: "turn/completed", params: { turn: { id: "turn_1", status: "completed" } } })); return "turn_1"; },
      close() {},
    };
  };
  const chat = createChatService({ store, codexFactory: factory });
  const conversation = chat.create(episode.id);
  const now = new Date().toISOString();
  store.db.prepare("UPDATE conversations SET thread_id='thread_old' WHERE id=?").run(conversation.id);
  for (const [role, text] of [["user", "earlier question"], ["assistant", "earlier answer"]])
    store.db.prepare("INSERT INTO conversation_messages(conversation_id,role,text,state,created_at,updated_at) VALUES(?,?,?,'completed',?,?)").run(conversation.id, role, text, now, now);
  await chat.send(episode.id, conversation.id, "continue please");
  const deadline = Date.now() + 2000;
  while (chat.get(episode.id, conversation.id).state !== "idle" && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5));
  const after = chat.get(episode.id, conversation.id);
  const segment = after.events.find((event) => event.type === "segment.started");
  assert.equal(segment.payload.previousThreadId, "thread_old");
  assert.equal(segment.payload.threadId, "thread_new");
  assert.equal(after.threadId, "thread_new");
  assert.match(turnText, /Earlier visible conversation[\s\S]*earlier question[\s\S]*earlier answer[\s\S]*User request:\ncontinue please/);
  assert.deepEqual(after.messages.slice(0, 2).map((message) => message.text), ["earlier question", "earlier answer"], "transcript preserved");
  assert.equal(factoryOptions.episodeId, episode.id);
  assert.equal(factoryOptions.conversationId, conversation.id);
  assert.match(factoryOptions.requestId, /^request_[0-9a-f-]{36}$/);
  await chat.close();
});

test("session transfer copies only referenced rollout records, never overwrites and reports missing threads", async (t) => {
  const dir = await tempDir(t);
  const codexHome = path.join(dir, "fixture-codex-home");
  const stateRoot = path.join(dir, "state");
  const thread = "01a0c098-66a3-7821-b74d-da00a1274723", other = "01a0bd8b-707f-71a0-b58c-fcc15c322fac";
  await mkdir(path.join(codexHome, "sessions/2026/09/20"), { recursive: true });
  await writeFile(path.join(codexHome, "sessions/2026/09/20", `rollout-2026-09-20T22-53-28-${thread}.jsonl`), '{"type":"session_meta"}\n');
  await writeFile(path.join(codexHome, "sessions/2026/09/20", `rollout-2026-09-20T08-40-27-${other}.jsonl`), "unrelated\n");
  await writeFile(path.join(codexHome, "auth.json"), "{}");
  const threads = [{ conversationId: "conversation_a", threadId: thread }, { conversationId: "conversation_b", threadId: "01a0c098-0000-0000-0000-000000000000" }];
  const first = await transferCodexSessions({ stateRoot, threads, codexHome });
  assert.equal(first.transferred.length, 1);
  assert.equal(first.missing.length, 1);
  const target = path.join(stateRoot, "harnesses/codex/conversation_a/sessions/2026/09/20", `rollout-2026-09-20T22-53-28-${thread}.jsonl`);
  assert.equal(await readFile(target, "utf8"), '{"type":"session_meta"}\n');
  await assert.rejects(stat(path.join(stateRoot, "harnesses/codex/conversation_a/auth.json")), "credentials never copied");
  await assert.rejects(stat(path.join(stateRoot, "harnesses/codex/conversation_a/sessions/2026/09/20", `rollout-2026-09-20T08-40-27-${other}.jsonl`)), "unreferenced records never copied");
  assert.equal((await transferCodexSessions({ stateRoot, threads, codexHome })).alreadyPresent.length, 1);
  await writeFile(target, "changed");
  const again = await transferCodexSessions({ stateRoot, threads, codexHome });
  assert.equal(again.conflicts.length, 1);
  assert.equal(await readFile(target, "utf8"), "changed");
  await assert.rejects(transferCodexSessions({ stateRoot, threads: [{ conversationId: "../x", threadId: thread }], codexHome }), /conversationId/);
});

test("listing conversation threads reads the database without changing it", async (t) => {
  const root = await tempDir(t);
  const store = new Store(root);
  const episode = store.createEpisode();
  const chat = createChatService({ store, codexFactory: async () => { throw new Error("unused"); } });
  const conversation = chat.create(episode.id);
  store.db.prepare("UPDATE conversations SET thread_id='01a0c098-66a3-7821-b74d-da00a1274723' WHERE id=?").run(conversation.id);
  await chat.close();
  store.close();
  assert.deepEqual(await listConversationThreads(root), [{ conversationId: conversation.id, threadId: "01a0c098-66a3-7821-b74d-da00a1274723" }]);
});

test("merged tools expose runtime tools and the chat's app operations as one scoped set", async () => {
  const runtime = { definitions: [{ name: "register_work_file", inputSchema: {} }], call: async (name) => ({ text: `runtime ${name}` }) };
  const merged = mergeTools(runtime, { get_context: () => ({ ok: true }), not_advertised: () => 1 });
  const names = merged.definitions.map((definition) => definition.name);
  assert.deepEqual(names, ["register_work_file", "get_context"]);
  assert.equal((await merged.call("get_context", {})).text, '{"ok":true}');
  assert.equal((await merged.call("register_work_file", {})).text, "runtime register_work_file");
  await assert.rejects(merged.call("drop_everything", {}), /Unknown Storybench tool/);
});

test("a request never replaces another active request's boot renders on the same episode", () => {
  const releaseOne = claimEpisodeRenders("/storybench/data/channels/c/episodes/e", "request_1");
  assert.equal(activeRenderHolder("/storybench/data/channels/c/episodes/e"), "request_1");
  assert.throws(() => claimEpisodeRenders("/storybench/data/channels/c/episodes/e", "request_2"), { code: "EPISODE_BUSY" });
  const releaseOther = claimEpisodeRenders("/storybench/data/channels/c/episodes/other", "request_2");
  releaseOne();
  const releaseTwo = claimEpisodeRenders("/storybench/data/channels/c/episodes/e", "request_2");
  releaseTwo(); releaseOther();
  assert.equal(activeRenderHolder("/storybench/data/channels/c/episodes/e"), null);
});

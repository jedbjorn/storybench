import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { DatabaseSync } from "node:sqlite";
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { main } from "../src/cli/main.js";
import { SCHEMA_VERSION } from "../src/store.js";
import { resolveXdg } from "../src/cli/xdg.js";
import { readConfig, writeConfigAtomic } from "../src/cli/config.js";
import { acquireLock, readLockOwner } from "../src/cli/lock.js";
import { probeService } from "../src/cli/service.js";
import { createApp } from "../src/server.js";
import { initDataRoot } from "../src/services/data-root.js";
import { listenInRange } from "../test-support/loopback-port.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const stopped = async () => ({ state: "stopped" });
// A systemd user manager with no Storybench unit loaded; lifecycle tests use their own fakes.
const idleSystem = { unitState: async () => ({ load: "not-found", active: "inactive", sub: "dead", pid: null }), containers: async () => [] };

function sandbox(t) {
  const home = mkdtempSync(path.join(os.tmpdir(), "storybench-cli-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const env = { HOME: home, XDG_CONFIG_HOME: path.join(home, "cfg"), XDG_DATA_HOME: path.join(home, "data"), XDG_STATE_HOME: path.join(home, "state"), XDG_RUNTIME_DIR: path.join(home, "run") };
  mkdirSync(env.XDG_RUNTIME_DIR, { recursive: true });
  const run = async (args, overrides = {}) => {
    let stdout = "", stderr = "";
    const code = await main(args, { env, home, cwd: overrides.cwd ?? home, lockTimeoutMs: 300, probeService: overrides.probeService ?? stopped, system: overrides.system ?? idleSystem,
      stdout: { write: (text) => { stdout += text; } }, stderr: { write: (text) => { stderr += text; } }, ...overrides });
    return { code, stdout, stderr };
  };
  return { home, env, run, xdg: resolveXdg({ env, home }) };
}

function legacyWorkspace(root) {
  mkdirSync(path.join(root, "media"), { recursive: true });
  const db = new DatabaseSync(path.join(root, "storybench.sqlite"));
  db.exec(`CREATE TABLE episodes (id TEXT PRIMARY KEY,title TEXT NOT NULL,notes TEXT NOT NULL DEFAULT '',revision INTEGER NOT NULL,cards TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE episode_history (episode_id TEXT NOT NULL,revision INTEGER NOT NULL,title TEXT NOT NULL,notes TEXT NOT NULL,cards TEXT NOT NULL,actor TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(episode_id,revision));
    CREATE TABLE assets (id TEXT PRIMARY KEY,name TEXT NOT NULL,hash TEXT NOT NULL UNIQUE,kind TEXT NOT NULL,path TEXT NOT NULL,duration REAL,width INTEGER,height INTEGER,metadata TEXT NOT NULL,thumbnail_path TEXT,created_at TEXT NOT NULL);
    CREATE TABLE jobs (id TEXT PRIMARY KEY,episode_id TEXT NOT NULL,kind TEXT NOT NULL,state TEXT NOT NULL,progress REAL NOT NULL DEFAULT 0,revision INTEGER NOT NULL,output_path TEXT,error TEXT,snapshot TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);`);
  const stamp = "2026-01-01T00:00:00.000Z";
  db.prepare("INSERT INTO episodes VALUES(?,?,?,?,?,?,?)").run("episode-a", "Pilot", "", 1, "[]", stamp, stamp);
  db.prepare("INSERT INTO episode_history VALUES(?,?,?,?,?,?,?)").run("episode-a", 1, "Pilot", "", "[]", "human", stamp);
  writeFileSync(path.join(root, "media", "clip"), "clip bytes");
  db.prepare("INSERT INTO assets VALUES(?,?,?,?,?,?,?,?,?,?,?)").run("asset-1", "clip", "hash-clip", "video", "media/clip", 1, null, null, "{}", null, stamp);
  db.close();
}

async function installReleasePointer(xdg, commit = "a".repeat(40)) {
  const { createManifest } = await import("../src/runtime/manifest.js");
  const manifest = createManifest({ packageName: "storybench", packageVersion: "0.1.0", commit, ref: "main", builtAt: "2026-09-21T00:00:00Z",
    images: { app: `sha256:${"c".repeat(64)}`, worker: `sha256:${"d".repeat(64)}` }, schema: { min: 0, max: SCHEMA_VERSION } });
  const directory = path.join(xdg.releases, commit);
  mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(directory, "manifest.json"), JSON.stringify(manifest));
  mkdirSync(path.dirname(xdg.current), { recursive: true });
  symlinkSync(directory, xdg.current);
  return { directory, manifest };
}

test("XDG locations use standard defaults, honour absolute overrides and fall back for the lock directory", () => {
  const defaults = resolveXdg({ env: {}, home: "/home/ada" });
  assert.deepEqual({ configFile: defaults.configFile, share: defaults.share, state: defaults.state, lockDir: defaults.lockDir, fallback: defaults.lockFallback },
    { configFile: "/home/ada/.config/storybench/config.json", share: "/home/ada/.local/share/storybench", state: "/home/ada/.local/state/storybench",
      lockDir: "/home/ada/.local/state/storybench/run", fallback: true });
  const custom = resolveXdg({ env: { XDG_CONFIG_HOME: "/cfg", XDG_DATA_HOME: "relative/ignored", XDG_RUNTIME_DIR: "/run/user/1000" }, home: "/home/ada" });
  assert.equal(custom.configFile, "/cfg/storybench/config.json");
  assert.equal(custom.share, "/home/ada/.local/share/storybench", "relative XDG values are ignored");
  assert.equal(custom.lockDir, "/run/user/1000/storybench");
});

test("config writes are atomic: a failure before rename leaves the previous file intact and no temporary behind", (t) => {
  const { xdg } = sandbox(t);
  const first = writeConfigAtomic(xdg.configFile, { version: 1, dataRoot: "/srv/one", dataRootId: "root_1", port: 4173 });
  assert.equal((statSync(xdg.configFile).mode & 0o777), 0o600);
  assert.throws(() => writeConfigAtomic(xdg.configFile, { version: 1, dataRoot: "/srv/two", port: 4173 }, { beforeRename: () => { throw new Error("power cut"); } }), /power cut/);
  assert.deepEqual(readConfig(xdg.configFile), first);
  assert.deepEqual(readdirSync(path.dirname(xdg.configFile)), ["config.json"]);
  assert.throws(() => writeConfigAtomic(xdg.configFile, { version: 1, dataRoot: "relative", port: 1 }), /absolute/);
  assert.throws(() => writeConfigAtomic(xdg.configFile, { version: 1, dataRoot: "/srv/x", port: 70000 }), /port/);
  writeFileSync(xdg.configFile, "{ not json");
  assert.throws(() => readConfig(xdg.configFile), /not valid JSON/);
});

const LOCK_CHILD = `
  import { acquireLock } from ${JSON.stringify(path.join(REPO, "src/cli/lock.js"))};
  import { appendFileSync } from "node:fs";
  const [lockDir, log, mode] = process.argv.slice(1);
  const release = await acquireLock(lockDir, { operation: "test " + process.pid, timeoutMs: 60000, pollMs: 5 });
  if (mode === "hold") { console.log("locked"); setInterval(() => {}, 1000); }
  else {
    appendFileSync(log, "enter " + process.pid + " " + performance.timeOrigin + performance.now() + "\\n");
    const end = Date.now() + 15; while (Date.now() < end) {}
    appendFileSync(log, "exit " + process.pid + " " + performance.timeOrigin + performance.now() + "\\n");
    release();
  }`;

function assertNoOverlap(lines) {
  let holder = null, holds = 0;
  for (const line of lines) {
    const [event, pid] = line.split(" ");
    if (event === "enter") { assert.equal(holder, null, `overlapping holds: ${holder} and ${pid}`); holder = pid; holds++; }
    else { assert.equal(holder, pid); holder = null; }
  }
  return holds;
}

test("the lifecycle lock is exclusive and names its owner on timeout", async (t) => {
  const { xdg, run } = sandbox(t);
  const release = await acquireLock(xdg.lockDir, { operation: "init --adopt" });
  await assert.rejects(acquireLock(xdg.lockDir, { operation: "channel create", timeoutMs: 150, pollMs: 20 }), (error) =>
    /storybench init --adopt/.test(error.message) && /process \d+/.test(error.message) && /released automatically/.test(error.hint));
  const blocked = await run(["init", path.join(xdg.home, "root")]);
  assert.equal(blocked.code, 1);
  assert.match(blocked.stderr, /holds the installation lock: `storybench init --adopt`/);
  release();
  release();
  assert.deepEqual(readdirSync(xdg.lockDir).sort(), ["lifecycle.sqlite"], "no owner description or stale directories remain");
  // A waiting acquirer gets the lock as soon as the holder releases it (bounded wait).
  const holder = await acquireLock(xdg.lockDir, { operation: "init" });
  setTimeout(holder, 100);
  const waited = await acquireLock(xdg.lockDir, { operation: "channel list", timeoutMs: 2000, pollMs: 10 });
  waited();
});

test("30 concurrent in-process acquirers never hold the lock at the same time", async (t) => {
  const { xdg } = sandbox(t);
  const events = [];
  await Promise.all(Array.from({ length: 30 }, async (_, index) => {
    const release = await acquireLock(xdg.lockDir, { operation: `worker ${index}`, timeoutMs: 30_000, pollMs: 1 });
    events.push(`enter ${index}`);
    await new Promise((resolve) => setTimeout(resolve, 2));
    events.push(`exit ${index}`);
    release();
  }));
  assert.equal(assertNoOverlap(events), 30);
});

test("12 concurrent processes never overlap, and a kill -9 of the holder frees the lock immediately", { timeout: 60_000 }, async (t) => {
  const { xdg, home } = sandbox(t);
  const log = path.join(home, "holds.log");
  writeFileSync(log, "");
  const children = Array.from({ length: 12 }, () => spawn(process.execPath, ["--input-type=module", "-e", LOCK_CHILD, xdg.lockDir, log, "work"], { stdio: "ignore" }));
  await Promise.all(children.map((child) => new Promise((resolve) => child.on("exit", resolve))));
  const lines = readFileSync(log, "utf8").trim().split("\n").map((line) => line.split(" ").slice(0, 2).join(" "));
  assert.equal(assertNoOverlap(lines), 12);

  const holder = spawn(process.execPath, ["--input-type=module", "-e", LOCK_CHILD, xdg.lockDir, log, "hold"], { stdio: ["ignore", "pipe", "ignore"] });
  await new Promise((resolve) => holder.stdout.on("data", (chunk) => { if (String(chunk).includes("locked")) resolve(); }));
  await assert.rejects(acquireLock(xdg.lockDir, { operation: "channel list", timeoutMs: 100, pollMs: 10 }), /holds the installation lock: `storybench test \d+`/);
  holder.kill("SIGKILL");
  await new Promise((resolve) => holder.on("exit", resolve));
  const started = Date.now();
  const release = await acquireLock(xdg.lockDir, { operation: "after kill", timeoutMs: 200, pollMs: 5 });
  assert.ok(Date.now() - started < 200, "no reclaim delay");
  release();
});

test("help works at every level with exit 0; invalid invocations exit 2; recovery commands are documented", async (t) => {
  const { run } = sandbox(t);
  for (const args of [[], ["--help"], ["-h"], ["help"], ["help", "init"], ["help", "channel"], ["help", "channel", "use"], ["init", "--help"], ["channel", "--help"],
    ["channel", "create", "--help"], ["channel", "list", "--help"], ["channel", "current", "-h"], ["channel", "use", "--help"], ["version", "--help"], ["help", "version"],
    ["doctor", "--help"], ["help", "doctor"], ["backup", "--help"], ["help", "backup"], ["update", "--help"], ["help", "update"],
    ["rollback", "--help"], ["help", "rollback"], ["uninstall", "--help"], ["help", "uninstall"], ["__install", "--help"]]) {
    const result = await run(args);
    assert.equal(result.code, 0, args.join(" "));
    assert.match(result.stdout, /Usage: storybench/, args.join(" "));
    assert.equal(result.stderr, "");
  }
  const top = (await run(["help"])).stdout;
  for (const name of ["init", "channel", "version", "up", "down", "restart", "status", "open", "logs", "doctor", "backup", "update", "rollback", "uninstall", "help"]) assert.match(top, new RegExp(`\\n  ${name} `));
  assert.doesNotMatch(top, /\n  __install /, "internal installer stays hidden");
  assert.match((await run(["channel", "use", "--help"])).stdout, /open views keep their channel/);
  for (const args of [["bogus"], ["init", "--bogus"], ["init", "a", "b"], ["channel"], ["channel", "delete"], ["channel", "create"], ["channel", "use", "a", "b"],
    ["channel", "list", "extra"], ["version", "x"], ["help", "bogus"], ["help", "channel", "bogus"], ["init", "--adopt=yes"], ["init", "--channel-name"], ["init", "--channel-name", "X"]]) {
    const result = await run(args);
    assert.equal(result.code, 2, args.join(" "));
    assert.match(result.stderr, /^storybench: /);
  }
});

test("init is explicit and idempotent, writes canonical config, and refuses conflicts without creating state", async (t) => {
  const { home, xdg, run } = sandbox(t);
  const root = path.join(home, "Storybench");
  assert.match((await run(["channel", "list"])).stderr, /not initialized/);
  const created = await run(["init", "Storybench"], { cwd: home });
  assert.equal(created.code, 0, created.stderr);
  assert.match(created.stdout, /Initialized a Storybench data root/);
  const config = readConfig(xdg.configFile);
  assert.deepEqual({ dataRoot: config.dataRoot, port: config.port }, { dataRoot: root, port: 4173 });
  assert.match(config.dataRootId, /^root_/);
  const again = await run(["init", root]);
  assert.equal(again.code, 0);
  assert.match(again.stdout, /already initialized; nothing changed/);
  assert.deepEqual(readConfig(xdg.configFile), config);
  const other = await run(["init", path.join(home, "Other")]);
  assert.equal(other.code, 1);
  assert.match(other.stderr, /already configured for the data root/);
  assert.equal(existsSync(path.join(home, "Other")), false, "a refused init creates nothing");
  // Conflicting state and prototype workspaces are refused by a fresh configuration too.
  const fresh = sandbox(t);
  const half = path.join(fresh.home, "half");
  mkdirSync(path.join(half, "episodes"), { recursive: true });
  const conflict = await fresh.run(["init", half]);
  assert.equal(conflict.code, 1);
  assert.match(conflict.stderr, /Refusing to initialize/);
  const legacy = path.join(fresh.home, "legacy");
  mkdirSync(legacy);
  legacyWorkspace(legacy);
  const needsAdopt = await fresh.run(["init", legacy]);
  assert.equal(needsAdopt.code, 1);
  assert.match(needsAdopt.stderr, /adopt it instead[\s\S]*storybench init .*legacy --adopt/);
  assert.equal(readConfig(fresh.xdg.configFile), null, "no configuration after a refusal");
  const unrelated = path.join(fresh.home, "unrelated");
  mkdirSync(unrelated);
  writeFileSync(path.join(unrelated, "notes.txt"), "mine");
  assert.equal((await fresh.run(["init", unrelated])).code, 0);
  assert.equal(readFileSync(path.join(unrelated, "notes.txt"), "utf8"), "mine");
});

test("init --adopt on a legacy workspace twice: migrates once, then changes nothing; a running service blocks it", async (t) => {
  const { home, xdg, run } = sandbox(t);
  const legacy = path.join(home, "prototype");
  mkdirSync(legacy);
  legacyWorkspace(legacy);
  const blocked = await run(["init", legacy, "--adopt"], { probeService: async () => ({ state: "running", dataRootId: "x", schemaVersion: 8 }) });
  assert.equal(blocked.code, 1);
  assert.match(blocked.stderr, /answering on port 4173[\s\S]*Stop it before adopting/);
  const unitActive = await run(["init", legacy, "--adopt"], { system: { unitState: async () => ({ load: "loaded", active: "active", sub: "running", pid: 42 }) } });
  assert.equal(unitActive.code, 1);
  assert.match(unitActive.stderr, /Storybench service \(storybench\.service\) is active[\s\S]*storybench down/);
  const first = await run(["init", legacy, "--adopt", "--channel-name", "Prototype"]);
  assert.equal(first.code, 0, first.stderr);
  assert.match(first.stdout, new RegExp(`Adopted the prototype workspace .* \\(schema 0 -> ${SCHEMA_VERSION}\\)`));
  assert.match(first.stdout, /Metadata backup: .*storybench\.pre-v6\.sqlite/);
  assert.match(first.stdout, /Channels: Prototype \(default\)/);
  const second = await run(["init", legacy, "--adopt"]);
  assert.equal(second.code, 0);
  assert.match(second.stdout, /already adopted and current; nothing changed/);
  const list = await run(["channel", "list"]);
  assert.equal(list.stdout.match(/^\* channel_/gm).length, 1);
  assert.equal(readFileSync(path.join(legacy, "media", "clip"), "utf8"), "clip bytes");
  const db = new DatabaseSync(path.join(legacy, "storybench.sqlite"), { readOnly: true });
  assert.deepEqual(db.prepare("SELECT id FROM episodes").all().map((row) => row.id), ["episode-a"]);
  assert.deepEqual(db.prepare("SELECT id,path FROM assets").all().map((row) => ({ ...row })), [{ id: "asset-1", path: "media/clip" }]);
  db.close();
  assert.equal(readConfig(xdg.configFile).dataRoot, legacy);
});

test("channel create/list/current/use run offline through the shared services", async (t) => {
  const { home, run } = sandbox(t);
  await run(["init", path.join(home, "root")]);
  assert.match((await run(["status"])).stdout, /Stopped data commands: development checkout \(host Node fallback\)/);
  assert.match((await run(["channel", "current"])).stdout, /No channel exists yet/);
  assert.match((await run(["channel", "list"])).stdout, /No channels yet/);
  const cooking = await run(["channel", "create", "Cooking"]);
  assert.match(cooking.stdout, /Created channel Cooking \(channel_[0-9a-f-]+\); it is the default channel/);
  assert.equal((await run(["channel", "create", "Travel Diaries"])).code, 0);
  const duplicate = await run(["channel", "create", "cooking"]);
  assert.equal(duplicate.code, 1);
  assert.match(duplicate.stderr, /already exists/);
  assert.match((await run(["channel", "current"])).stdout, /^Cooking \(channel_/);
  const switched = await run(["channel", "use", "travel diaries"]);
  assert.match(switched.stdout, /Default channel is now Travel Diaries .*Running work and open views are unaffected/);
  const list = (await run(["channel", "list"])).stdout;
  assert.match(list, /^\* channel_\S+  Travel Diaries$/m);
  assert.match(list, /^  channel_\S+  Cooking$/m);
  const id = list.match(/^  (channel_\S+)  Cooking$/m)[1];
  assert.match((await run(["channel", "use", id])).stdout, /now Cooking/);
  const unknown = await run(["channel", "use", "Nope"]);
  assert.deepEqual({ code: unknown.code, message: unknown.stderr.split("\n")[0] }, { code: 1, message: "storybench: Unknown channel: Nope" });
});

test("a missing or replaced data root is refused and never recreated", async (t) => {
  const { home, run } = sandbox(t);
  const root = path.join(home, "root");
  await run(["init", root]);
  await run(["channel", "create", "Main"]);
  renameSync(root, path.join(home, "moved"));
  const missing = await run(["channel", "list"]);
  assert.equal(missing.code, 1);
  assert.match(missing.stderr, /configured data root .* is missing[\s\S]*Restore or remount the configured data root/);
  assert.equal(existsSync(root), false, "not recreated");
  // init on the configured-but-missing path refuses before creating anything.
  const reinitMissing = await run(["init", root]);
  assert.equal(reinitMissing.code, 1);
  assert.match(reinitMissing.stderr, /configured data root .* is missing[\s\S]*Restore or remount/);
  assert.equal(existsSync(root), false, "init did not create a replacement");
  mkdirSync(root);
  const empty = await run(["init", root]);
  assert.equal(empty.code, 1);
  assert.match(empty.stderr, /not a Storybench data root any more/);
  assert.deepEqual(readdirSync(root), [], "an empty directory at the configured path is not initialized");
  rmSync(root, { recursive: true });
  initDataRoot(root);
  const replaced = await run(["channel", "list"]);
  assert.equal(replaced.code, 1);
  assert.match(replaced.stderr, /different Storybench installation/);
  const before = readFileSync(path.join(root, "storybench.sqlite"));
  const reinit = await run(["init", root]);
  assert.equal(reinit.code, 1, "init will not silently re-point the configuration at a different installation");
  assert.match(reinit.stderr, /different Storybench installation/);
  assert.deepEqual(readFileSync(path.join(root, "storybench.sqlite")), before, "refused before any mutation");
});

test("version works while stopped, reads a release manifest defensively and reports served mismatches", async (t) => {
  const { home, env, run } = sandbox(t);
  const dev = await run(["version"]);
  assert.equal(dev.code, 0);
  assert.match(dev.stdout, new RegExp(`storybench 0\\.1\\.0[\\s\\S]*Release: development checkout \\(no release manifest\\)[\\s\\S]*Supported database schema: 0-${SCHEMA_VERSION}[\\s\\S]*not configured`));
  const manifest = path.join(home, "manifest.json");
  const { createManifest } = await import("../src/runtime/manifest.js");
  const release = createManifest({ packageName: "storybench", packageVersion: "0.1.0", commit: "71d30a6", ref: "main", builtAt: "2026-09-21T00:00:00Z",
    images: { app: `sha256:${"a".repeat(64)}`, worker: `sha256:${"b".repeat(64)}` }, schema: { min: 0, max: 8 } });
  writeFileSync(manifest, JSON.stringify(release));
  env.STORYBENCH_RELEASE_MANIFEST = manifest;
  await run(["init", path.join(home, "root")]);
  const shown = await run(["version"], { probeService: async () => ({ state: "running", dataRootId: "root_other", schemaVersion: 9 }) });
  assert.match(shown.stdout, new RegExp(`Release: ${release.id}\\nCommit: 71d30a6 \\(main\\)`));
  assert.match(shown.stdout, /Images: app sha256:a{64}, worker sha256:b{64}\nRuntime protocol: 1/);
  assert.match(shown.stdout, /Supported database schema: 0-8/);
  assert.match(shown.stdout, /Mismatch: the running service uses schema 9/);
  assert.match(shown.stdout, /Mismatch: the running service serves a different data root/);
  writeFileSync(manifest, JSON.stringify({ ...release, images: { app: { id: "sha256:app" }, worker: { id: "sha256:worker" } } }));
  assert.match((await run(["version"])).stdout, /release manifest is not valid \(Invalid release manifest: images\.app\.id/);
  writeFileSync(manifest, "{ broken");
  assert.match((await run(["version"])).stdout, /not valid \(Release manifest is not valid JSON\)/);
  assert.equal((await run(["--version"])).code, 0);
});

test("the service probe distinguishes Storybench, another program and nothing on the port", async (t) => {
  const base = mkdtempSync(path.join(os.tmpdir(), "storybench-cli-probe-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = path.join(base, "root");
  initDataRoot(root);
  const app = await createApp({ dataRoot: root });
  const port = await listenInRange(app.server);
  t.after(() => app.close());
  const running = await probeService(port);
  assert.equal(running.state, "running");
  const other = http.createServer((request, response) => response.end("hello"));
  const otherPort = await listenInRange(other);
  t.after(() => other.close());
  assert.equal((await probeService(otherPort)).state, "other");
  await new Promise((resolve) => other.close(resolve));
  assert.equal((await probeService(otherPort)).state, "stopped");
});

test("the installed bin entry runs as a process with only the environment it is given", (t) => {
  const { env, home } = sandbox(t);
  const bin = path.join(REPO, JSON.parse(readFileSync(path.join(REPO, "package.json"), "utf8")).bin.storybench);
  const run = (...args) => spawnSync(process.execPath, [bin, ...args], { env: { ...env, PATH: process.env.PATH }, cwd: home, encoding: "utf8" });
  assert.equal(run("help").status, 0);
  assert.equal(run("doctor").status, 1);
  assert.equal(run("init", "root").status, 0);
  assert.equal(run("channel", "create", "Main").status, 0);
  const current = run("channel", "current");
  assert.equal(current.status, 0);
  assert.match(current.stdout, /^Main \(channel_/);
  assert.ok(existsSync(path.join(env.XDG_CONFIG_HOME, "storybench", "config.json")));
  assert.equal(existsSync(path.join(home, ".config")), false, "XDG overrides are honoured");
});

test("init refuses a data root, config or lock location that is not writable by this user, before writing anything", { skip: process.getuid?.() === 0 }, async (t) => {
  const { home, xdg, run } = sandbox(t);
  const locked = path.join(home, "locked");
  mkdirSync(locked);
  chmodSync(locked, 0o555);
  const result = await run(["init", path.join(locked, "root")]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /Refusing to use the data root: .*locked \(where .*root would be created\) is not writable/);
  assert.equal(existsSync(xdg.configFile), false, "no configuration was written");
  assert.equal(existsSync(path.join(locked, "root")), false);
  chmodSync(locked, 0o755);
  // A read-only configuration directory is refused the same way, after nothing else was created.
  mkdirSync(path.dirname(xdg.configFile), { recursive: true });
  chmodSync(path.dirname(xdg.configFile), 0o555);
  const config = await run(["init", path.join(home, "root")]);
  assert.equal(config.code, 1);
  assert.match(config.stderr, /Refusing to use the configuration directory: .* is not writable/);
  assert.equal(existsSync(path.join(home, "root")), false, "the data root was not created");
  chmodSync(path.dirname(xdg.configFile), 0o755);
  chmodSync(xdg.lockDir.replace(/\/storybench$/, ""), 0o555);
  const lock = await run(["init", path.join(home, "root")]);
  assert.equal(lock.code, 1);
  chmodSync(xdg.lockDir.replace(/\/storybench$/, ""), 0o755);
  assert.match(lock.stderr, /Refusing to use the lifecycle lock directory/);
  assert.equal(existsSync(xdg.configFile), false);
});

test("offline commands never migrate: an older or newer database schema is refused with the upgrade path", async (t) => {
  const { home, run } = sandbox(t);
  const root = path.join(home, "root");
  await run(["init", root]);
  await run(["channel", "create", "Main"]);
  const setVersion = (version) => { const db = new DatabaseSync(path.join(root, "storybench.sqlite")); db.exec(`PRAGMA user_version=${version}`); db.close(); };
  const version = () => { const db = new DatabaseSync(path.join(root, "storybench.sqlite"), { readOnly: true }); const value = db.prepare("PRAGMA user_version").get().user_version; db.close(); return value; };
  setVersion(7);
  for (const args of [["channel", "list"], ["channel", "current"], ["channel", "create", "Other"], ["channel", "use", "Main"], ["init", root]]) {
    const result = await run(args);
    assert.equal(result.code, 1, args.join(" "));
    assert.match(result.stderr, new RegExp(`uses database schema 7; this release uses schema ${SCHEMA_VERSION}[\\s\\S]*storybench init .*root --adopt`));
  }
  assert.equal(version(), 7, "nothing was migrated as a side effect");
  const upgraded = await run(["init", root, "--adopt"]);
  assert.equal(upgraded.code, 0, upgraded.stderr);
  assert.match(upgraded.stdout, new RegExp(`already adopted; upgraded its database from schema 7 to ${SCHEMA_VERSION}\\.\\nMetadata backup: .*root\\/storybench\\.pre-v8\\.sqlite`));
  assert.doesNotMatch(upgraded.stdout, /nothing changed/);
  assert.equal(version(), SCHEMA_VERSION);
  assert.ok(existsSync(path.join(root, "storybench.pre-v8.sqlite")), "the explicit upgrade kept a backup");
  assert.equal((await run(["channel", "list"])).code, 0);
  setVersion(99);
  const newer = await run(["channel", "list"]);
  assert.equal(newer.code, 1);
  assert.match(newer.stderr, /(newer than this|not a usable Storybench data root \(newer\))/);
  assert.equal(version(), 99);
});

test("the executor seam picks the running app, selected image, or development host fallback", async (t) => {
  const { appImageExecutor, selectExecutor } = await import("../src/cli/executor.js");
  const s = sandbox(t);
  const root = path.join(s.home, "root");
  const initialized = initDataRoot(root);
  const release = await installReleasePointer(s.xdg);
  const calls = [];
  const imageResult = { channels: [], defaultChannelId: null };
  const runCommand = async (command, args) => {
    assert.equal(readLockOwner(s.xdg.lockDir)?.operation, "channel list", "Docker starts while the lifecycle lock is held");
    calls.push({ command, args });
    return { code: 0, stdout: JSON.stringify({ schema: "storybench.data-command/1", ok: true, result: imageResult }), stderr: "" };
  };
  const base = { dataRoot: root, dataRootId: initialized.identity.id, lockDir: s.xdg.lockDir, lockTimeoutMs: 300, port: 4173,
    unit: "storybench-test-image.service", xdg: s.xdg, installId: "sb_image_test", runCommand };
  const unitIs = (active) => ({ unitState: async () => ({ active }) });
  const running = await selectExecutor({ ...base, probeService: async () => ({ state: "running", dataRootId: initialized.identity.id }), system: unitIs("active") });
  assert.equal(running.kind, "running-app", "the healthy app wins even when an installed release exists");
  for (const state of [{ active: "inactive", load: "loaded" }, { active: "failed", load: "loaded" }, { active: "inactive", load: "not-found" }]) {
    const selected = await selectExecutor({ ...base, probeService: async () => ({ state: "stopped" }), system: { unitState: async () => state } });
    assert.equal(selected.kind, "app-image");
  }
  const selected = await selectExecutor({ ...base, probeService: async () => ({ state: "stopped" }), system: unitIs("inactive") });
  assert.deepEqual(await selected.listChannels(), imageResult);
  assert.equal(calls.length, 1);
  const [{ command, args }] = calls;
  assert.equal(command, "docker");
  assert.deepEqual(args.slice(0, 11), ["run", "--rm", "--network", "none", "--user", "0:0", "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--label"]);
  assert.equal(args[args.indexOf("--network") + 1], "none");
  assert.equal(args[args.indexOf("--user") + 1], "0:0");
  assert.ok(args.includes("io.storybench.install=sb_image_test"));
  assert.ok(args.includes("io.storybench.role=data-command"));
  const mounts = args.flatMap((value, index) => value === "--mount" ? [args[index + 1]] : []);
  assert.deepEqual(mounts, [`type=bind,source=${root},target=/storybench/data`], "only the guarded data root is mounted");
  const imageAt = args.indexOf(release.manifest.images.app.id);
  assert.ok(imageAt > 0);
  assert.deepEqual(args.slice(imageAt), [release.manifest.images.app.id, "node", "src/cli/data-image.js", "channel-list"]);

  let dockerStarted = false;
  const unsafe = appImageExecutor({ ...base, dataRoot: path.join(s.home, "bad,root"), runCommand: async () => { dockerStarted = true; } }, release);
  await assert.rejects(unsafe.listChannels(), /cannot be mounted safely/);
  assert.equal(dockerStarted, false, "the guarded path is rejected before Docker starts");

  const mapped = appImageExecutor({ ...base, runCommand: async () => ({ code: 1, stderr: "", stdout: JSON.stringify({ schema: "storybench.data-command/1", ok: false,
    error: { message: "The data root /storybench/data is unavailable", exitCode: 1, statusCode: 409, hint: "Restore /storybench/data first." } }) }) }, release);
  await assert.rejects(mapped.createChannel("Main"), (error) => error instanceof Error && error.message === `The data root ${root} is unavailable`
    && error.hint === `Restore ${root} first.` && error.exitCode === 1 && error.statusCode === 409);

  const { runImageDataCommand } = await import("../src/cli/executor.js");
  const adopted = await runImageDataCommand({ ...base, runCommand: async () => ({ code: 0, stderr: "", stdout: JSON.stringify({ schema: "storybench.data-command/1", ok: true,
    result: { dataRoot: "/storybench/data", backupPath: "/storybench/data/storybench.pre-v6.sqlite",
      upgraded: { from: 8, to: 9, backupPath: "/storybench/data/storybench.pre-v9.sqlite" } } }) }) }, release, "adopt", ["Main"]);
  assert.deepEqual(adopted, { dataRoot: root, backupPath: path.join(root, "storybench.pre-v6.sqlite"),
    upgraded: { from: 8, to: 9, backupPath: path.join(root, "storybench.pre-v9.sqlite") } });

  const dev = sandbox(t);
  const devRoot = path.join(dev.home, "root");
  const devInfo = initDataRoot(devRoot);
  const offline = await selectExecutor({ ...base, dataRoot: devRoot, dataRootId: devInfo.identity.id, xdg: dev.xdg, lockDir: dev.xdg.lockDir,
    probeService: async () => ({ state: "stopped" }), system: unitIs("inactive") });
  assert.equal(offline.kind, "offline");
  await assert.rejects(selectExecutor({ ...base, probeService: async () => ({ state: "stopped" }), system: unitIs("activating") }), /service is activating/);
  await assert.rejects(selectExecutor({ ...base, probeService: async () => ({ state: "running", dataRootId: "root_other" }), system: unitIs("active") }), /different data root/);
});

test("installed init is delegated to the selected image and image results configure the same root", async (t) => {
  const s = sandbox(t);
  const release = await installReleasePointer(s.xdg, "b".repeat(40));
  const root = path.join(s.home, "image-root");
  const calls = [];
  const result = await s.run(["init", root], { runCommand: async (command, args) => {
    assert.equal(readLockOwner(s.xdg.lockDir)?.operation, "init", "image init remains inside the init lifecycle lock");
    calls.push({ command, args });
    return { code: 0, stderr: "", stdout: JSON.stringify({ schema: "storybench.data-command/1", ok: true,
      result: { dataRoot: "/storybench/data", identity: { id: "root_from_image", schemaVersion: SCHEMA_VERSION }, channels: [], created: true } }) };
  } });
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Initialized a Storybench data root/);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].args.includes(release.manifest.images.app.id));
  assert.deepEqual(calls[0].args.slice(-3), ["node", "src/cli/data-image.js", "init"]);
  assert.equal(readConfig(s.xdg.configFile).dataRootId, "root_from_image");
  assert.match((await s.run(["version"])).stdout, new RegExp(`Stopped data commands: selected app image ${release.manifest.images.app.id}`));
});

test("the in-image entry point runs shared init and channel services and serializes errors", async (t) => {
  const { executeDataCommand, runDataImage } = await import("../src/cli/data-image.js");
  const s = sandbox(t);
  const root = path.join(s.home, "direct-image-root");
  const initialized = executeDataCommand("init", [], root);
  assert.equal(initialized.created, true);
  const channel = executeDataCommand("channel-create", ["Main"], root);
  assert.equal(channel.name, "Main");
  assert.equal(executeDataCommand("channel-current", [], root).id, channel.id);
  let output = "";
  const code = runDataImage(["not-an-operation"], (value) => { output += value; });
  assert.equal(code, 2);
  const envelope = JSON.parse(output);
  assert.deepEqual({ schema: envelope.schema, ok: envelope.ok, exitCode: envelope.error.exitCode },
    { schema: "storybench.data-command/1", ok: false, exitCode: 2 });
  assert.equal(typeof envelope.error.message, "string");
});

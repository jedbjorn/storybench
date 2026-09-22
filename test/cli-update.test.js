import { SCHEMA_VERSION } from "../src/store.js";
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { backupDatabase, restoreDatabase } from "../src/cli/backup-image.js";
import { writeConfigAtomic } from "../src/cli/config.js";
import { main } from "../src/cli/main.js";
import { readReceipts, writeJsonAtomic } from "../src/cli/receipts.js";
import { retainReleases, selectRetainedCommits, verifyActivation, verifyIsolated } from "../src/cli/update.js";
import { resolveXdg } from "../src/cli/xdg.js";
import { createManifest, manifestId } from "../src/runtime/manifest.js";
import { initDataRoot } from "../src/services/data-root.js";

const OLD = "a".repeat(40), NEW = "c".repeat(40), OTHER = "d".repeat(40);
const image = (letter) => `sha256:${letter.repeat(64)}`;

function manifest(commit, app, worker, range = { min: 0, max: SCHEMA_VERSION }) {
  const value = createManifest({ packageName: "storybench", packageVersion: "0.1.0", commit, ref: "main",
    images: { app: image(app), worker: image(worker) }, schema: range });
  value.source.remote = "/private/origin.git";
  value.id = manifestId(value);
  return value;
}

function health(value, rootId, schema, { renders = 0, agents = 0 } = {}) {
  return { status: "ready", ready: true, release: { manifestId: value.id, version: value.package.version, commit: value.source.commit,
    images: { app: value.images.app.id, worker: value.images.worker.id }, protocol: value.runtime.protocol },
    schema: { current: schema, supported: value.database.supportedSchema }, database: { id: rootId },
    activity: { renders: { queued: 0, running: renders }, agents: { active: agents } } };
}

function databaseInfo(root) {
  const db = new DatabaseSync(path.join(root, "storybench.sqlite"), { readOnly: true });
  try {
    return { schema: Number(db.prepare("PRAGMA user_version").get().user_version),
      id: db.prepare("SELECT id FROM data_root WHERE singleton=1").get().id,
      name: db.prepare("SELECT name FROM channels ORDER BY created_at LIMIT 1").get()?.name ?? null };
  } finally { db.close(); }
}

async function fixture(t, { active = true, busy = false, oldRange, newRange } = {}) {
  const home = mkdtempSync(path.join(os.tmpdir(), "storybench-update-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const env = { HOME: home, PATH: process.env.PATH, XDG_CONFIG_HOME: path.join(home, "config"), XDG_DATA_HOME: path.join(home, "data"),
    XDG_STATE_HOME: path.join(home, "state"), XDG_RUNTIME_DIR: path.join(home, "run"), STORYBENCH_UNIT_DIR: path.join(home, "units"),
    STORYBENCH_UNIT_NAME: "storybench-test-update.service" };
  mkdirSync(env.XDG_RUNTIME_DIR, { recursive: true });
  const xdg = resolveXdg({ env, home });
  const root = path.join(home, "root");
  const initialized = initDataRoot(root);
  const db = new DatabaseSync(path.join(root, "storybench.sqlite"));
  db.prepare("INSERT INTO channels(id,name,name_key,created_at,updated_at) VALUES(?,?,?,?,?)")
    .run("channel_test", "Sentinel", "sentinel", "2026-09-21T00:00:00.000Z", "2026-09-21T00:00:00.000Z");
  db.prepare("UPDATE data_root SET default_channel_id='channel_test' WHERE singleton=1").run();
  db.close();
  writeConfigAtomic(xdg.configFile, { version: 1, dataRoot: root, dataRootId: initialized.identity.id, port: 18842, installId: "sb-update-test" });
  mkdirSync(xdg.releases, { recursive: true });
  mkdirSync(xdg.mirror, { recursive: true });
  const oldManifest = manifest(OLD, "1", "2", oldRange);
  const newManifest = manifest(NEW, "3", "4", newRange);
  const releases = new Map([[OLD, oldManifest], [NEW, newManifest]]);
  for (const [commit, value] of releases) {
    const directory = path.join(xdg.releases, commit); mkdirSync(directory); writeFileSync(path.join(directory, "manifest.json"), JSON.stringify(value));
  }
  symlinkSync(path.join(xdg.releases, OLD), xdg.current);
  let isActive = active;
  const calls = [];
  const system = {
    calls,
    async unitState() { return { load: "loaded", active: isActive ? "active" : "inactive", sub: isActive ? "running" : "dead", result: "success" }; },
    async stop() { calls.push("stop"); isActive = false; return { code: 0, stdout: "", stderr: "" }; },
    async start() { calls.push("start"); isActive = true; return { code: 0, stdout: "", stderr: "" }; },
    async daemonReload() { calls.push("reload"); return { code: 0, stdout: "", stderr: "" }; },
    async resetFailed() { isActive = false; return { code: 0 }; },
    async containers() { return []; },
  };
  const currentManifest = () => releases.get(path.basename(path.resolve(path.dirname(xdg.current), readlinkSync(xdg.current))));
  const probeService = async () => {
    if (!isActive) return { state: "stopped" };
    const info = databaseInfo(root), value = currentManifest();
    const body = health(value, info.id, info.schema, busy ? { renders: 1, agents: 1 } : {});
    return { state: "running", health: body, dataRootId: info.id, schemaVersion: info.schema };
  };
  const adapters = {
    async checkFreeSpace() {},
    async fetchAvailable() { return { local: OLD, current: OLD, available: NEW, ref: "main" }; },
    async stageRelease() { return { release: path.join(xdg.releases, NEW), manifest: newManifest, reused: true }; },
    async verifyRelease() {},
    async databaseOperation({ operation, sourceDirectory, destinationDirectory }) {
      return operation === "backup"
        ? backupDatabase(path.join(sourceDirectory, "storybench.sqlite"), path.join(destinationDirectory, "storybench.sqlite"))
        : restoreDatabase(path.join(destinationDirectory, "storybench.sqlite"), path.join(sourceDirectory, "storybench.sqlite"));
    },
    async verifyIsolated({ release }) {
      const info = databaseInfo(root); return health(release.manifest, info.id, info.schema);
    },
  };
  const run = async (args, overrides = {}) => {
    let stdout = "", stderr = "";
    const code = await main(args, { env, home, cwd: home, system, probeService, recoveryAdapters: adapters,
      lockTimeoutMs: 500, healthTimeoutMs: 500, pollMs: 5, stdout: { write: (text) => { stdout += text; } },
      stderr: { write: (text) => { stderr += text; } }, ...overrides });
    return { code, stdout, stderr };
  };
  return { home, env, xdg, root, releases, oldManifest, newManifest, adapters, system, run, active: () => isActive };
}

test("receipt writes are atomic and a selected-image SQLite backup is consistent", async (t) => {
  const s = await fixture(t, { active: false });
  const file = path.join(s.home, "receipt.json");
  writeJsonAtomic(file, { value: "old" });
  assert.throws(() => writeJsonAtomic(file, { value: "new" }, { beforeRename: () => { throw new Error("injected"); } }), /injected/);
  assert.deepEqual(JSON.parse(readFileSync(file)), { value: "old" });
  const result = await s.run(["backup"]);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /media excluded/);
  const directories = readdirSync(path.join(s.xdg.state, "backups"));
  const receipt = JSON.parse(readFileSync(path.join(s.xdg.state, "backups", directories[0], "receipt.json")));
  assert.equal(receipt.media.included, false);
  assert.equal(receipt.database.identity, databaseInfo(s.root).id);
});

test("update --check reports exact commits without activation", async (t) => {
  const s = await fixture(t, { active: false });
  const before = readlinkSync(s.xdg.current);
  const result = await s.run(["update", "--check"]);
  assert.equal(result.code, 0, result.stderr);
  for (const value of ["Local commit", "Current commit", "Available commit", NEW]) assert.match(result.stdout, new RegExp(value));
  assert.equal(readlinkSync(s.xdg.current), before);
  assert.equal(readReceipts(path.join(s.xdg.state, "updates")).length, 0);
});

test("update Git calls disable terminal and SSH prompting", async (t) => {
  const s = await fixture(t, { active: false });
  delete s.adapters.fetchAvailable;
  const calls = [];
  const result = await s.run(["update", "--check"], { runCommand: async (command, args, options) => {
    calls.push({ command, args, options });
    if (args.includes("get-url")) return { code: 0, stdout: "/private/origin.git\n", stderr: "" };
    if (args.includes("fetch")) return { code: 0, stdout: "", stderr: "" };
    if (args.includes("refs/storybench/update-candidate^{commit}")) return { code: 0, stdout: `${NEW}\n`, stderr: "" };
    return { code: 0, stdout: `${OLD}\n`, stderr: "" };
  } });
  assert.equal(result.code, 0, result.stderr);
  assert.ok(calls.length >= 4);
  for (const call of calls) {
    assert.equal(call.command, "git");
    assert.equal(call.options.env.GIT_TERMINAL_PROMPT, "0");
    assert.equal(call.options.env.GIT_SSH_COMMAND, "ssh -oBatchMode=yes");
  }
});

test("interrupted transitions surface in status and doctor, clear stale ownership, and restore running intent on rerun", async (t) => {
  const s = await fixture(t, { active: false });
  const updates = path.join(s.xdg.state, "updates"); mkdirSync(updates, { recursive: true });
  const receiptFile = path.join(updates, "2026-09-21T00-00-00-000Z-interrupted.json");
  writeJsonAtomic(receiptFile, { schema: "storybench.update/1", attemptedAt: "2026-09-21T00:00:00.000Z", completedAt: null,
    outcome: "in-progress", failureStep: null, pid: 999_999_999, from: { commit: OLD }, to: { commit: NEW },
    backup: { path: "/tmp/backup" }, serviceWasRunning: true });
  mkdirSync(s.xdg.lockDir, { recursive: true });
  writeFileSync(path.join(s.xdg.lockDir, "owner.json"), JSON.stringify({ pid: 999_999_999, token: "stale", operation: "update" }));
  s.env.STORYBENCH_RELEASE_MANIFEST = path.join(s.xdg.current, "manifest.json");
  let result = await s.run(["status"]);
  assert.equal(result.code, 0, result.stderr); assert.match(result.stdout, /Recovery: An interrupted storybench update.*storybench update.*storybench up/s);
  assert.equal(existsSync(path.join(s.xdg.lockDir, "owner.json")), false);
  result = await s.run(["doctor"], { runCommand: async (command, args) => {
    if (command === "node") return { code: 0, stdout: "v24.21.0\n", stderr: "" };
    if (command === "npm") return { code: 0, stdout: "11.0.0\n", stderr: "" };
    if (command === "git" && args.includes("cat-file")) return { code: 0, stdout: "", stderr: "" };
    if (command === "git") return { code: 1, stdout: "", stderr: "offline" };
    if (command === "docker" && args[0] === "info") return { code: 0, stdout: "29.7.2\n", stderr: "" };
    return { code: 1, stdout: "", stderr: "not needed" };
  } });
  assert.match(result.stdout, /WARN recovery: An interrupted storybench update/);
  assert.match(result.stdout, /WARN editor readiness: installation needs interrupted-transition recovery/);
  assert.doesNotMatch(result.stdout, /PASS editor readiness/);
  result = await s.run(["update"]);
  assert.equal(result.code, 0, result.stderr); assert.match(result.stdout, /previously running service is running again/);
  assert.equal(s.active(), true);
  const interrupted = JSON.parse(readFileSync(receiptFile));
  assert.equal(interrupted.outcome, "interrupted"); assert.equal(interrupted.failureStep, "after-backup");
  assert.equal(interrupted.recoveryAction, "restarted"); assert.ok(interrupted.recoveryHandledAt);
});

test("rollback rerun also restores the running-state intent from an interrupted receipt", async (t) => {
  const s = await fixture(t);
  assert.equal((await s.run(["update"])).code, 0);
  assert.equal((await s.run(["down"])).code, 0);
  const file = path.join(s.xdg.state, "updates", "2026-09-22T00-00-00-000Z-interrupted-rollback.json");
  writeJsonAtomic(file, { schema: "storybench.rollback/1", attemptedAt: "2026-09-22T00:00:00.000Z", completedAt: null,
    outcome: "in-progress", pid: 999_999_999, from: { commit: NEW }, to: { commit: OLD }, backup: null, serviceWasRunning: true });
  const result = await s.run(["rollback"]);
  assert.equal(result.code, 0, result.stderr); assert.match(result.stdout, /previously running service is running again/);
  assert.equal(s.active(), true); assert.equal(path.basename(readlinkSync(s.xdg.current)), OLD);
  assert.equal(JSON.parse(readFileSync(file)).recoveryAction, "restarted");
});

test("update refuses insufficient staging space before service downtime", async (t) => {
  const s = await fixture(t);
  delete s.adapters.checkFreeSpace;
  const result = await s.run(["update"], { runCommand: async (command, args) => {
    if (command === "docker" && args[0] === "info") return { code: 0, stdout: "/var/lib/docker\n", stderr: "" };
    if (command === "df") return { code: 0, stdout: "Filesystem 1024-blocks Used Available Capacity Mounted on\nfixture 100 99 1 99% /\n", stderr: "" };
    return { code: 1, stdout: "", stderr: "unexpected" };
  } });
  assert.equal(result.code, 1); assert.match(result.stderr, /Insufficient free space.*update staging/);
  assert.deepEqual(s.system.calls.filter((call) => call === "stop"), []);
  assert.equal(readReceipts(path.join(s.xdg.state, "updates")).length, 0);
});

test("isolated verification rejects Docker mount-delimiter paths before running a container", async () => {
  let called = false;
  await assert.rejects(verifyIsolated({ healthTimeoutMs: 10, runCommand: async () => { called = true; return { code: 1, stdout: "", stderr: "" }; } },
    { installId: "sb-test", dataRoot: "/tmp/root,comma", dataRootId: "root_test" },
    { identity: { images: { app: image("1"), worker: image("2") } } }), /data root cannot be mounted safely/i);
  assert.equal(called, false);
});

test("activation reads database identity even when the schema is newer than this CLI", async (t) => {
  const s = await fixture(t, { active: false });
  const db = new DatabaseSync(path.join(s.root, "storybench.sqlite"));
  db.prepare("UPDATE data_root SET id='root_wrong' WHERE singleton=1").run(); db.exec("PRAGMA user_version=10"); db.close();
  const release = { root: path.join(s.xdg.releases, NEW), file: path.join(s.xdg.releases, NEW, "manifest.json"), manifest: s.newManifest,
    identity: { manifestId: s.newManifest.id, version: s.newManifest.package.version, commit: NEW,
      images: { app: s.newManifest.images.app.id, worker: s.newManifest.images.worker.id }, protocol: s.newManifest.runtime.protocol } };
  await assert.rejects(verifyActivation({ ...{ xdg: s.xdg }, healthTimeoutMs: 10 }, { dataRoot: s.root, dataRootId: "root_expected" }, release, false, {
    verifyIsolated: async () => health(s.newManifest, "root_expected", 10),
  }), /different database identity/);
});

test("same-commit update refuses to re-stage a missing image pair while the unit is active", async (t) => {
  const s = await fixture(t);
  s.adapters.fetchAvailable = async () => ({ local: OLD, current: OLD, available: OLD, ref: "main" });
  let staged = false;
  s.adapters.stageRelease = async () => { staged = true; return { release: path.join(s.xdg.releases, OLD), manifest: s.oldManifest, reused: false }; };
  const result = await s.run(["update"], { runCommand: async (command, args) => {
    if (command === "docker" && args[0] === "image" && args[1] === "inspect") return { code: 1, stdout: "", stderr: "missing" };
    return { code: 0, stdout: "", stderr: "" };
  } });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /Cannot replace the active release directory while .* is active/);
  assert.equal(staged, false);
  assert.equal(path.basename(readlinkSync(s.xdg.current)), OLD);
});

test("running and stopped updates preserve metadata, exact pairs and service state", async (t) => {
  for (const active of [true, false]) await t.test(active ? "running" : "stopped", async (t) => {
    const s = await fixture(t, { active });
    const result = await s.run(["update"]);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(path.basename(path.resolve(path.dirname(s.xdg.current), readlinkSync(s.xdg.current))), NEW);
    assert.equal(databaseInfo(s.root).name, "Sentinel");
    assert.equal(s.active(), active);
    assert.match(result.stdout, active ? /running and healthy/ : /isolated container and left stopped/);
    const receipt = readReceipts(path.join(s.xdg.state, "updates"), "storybench.update/1")[0].value;
    assert.equal(receipt.outcome, "success");
    assert.deepEqual(receipt.to.images, { app: s.newManifest.images.app.id, worker: s.newManifest.images.worker.id });
    assert.ok(receipt.backup.path);
  });
});

test("the all-channel busy gate refuses unless --force and force bypasses no later check", async (t) => {
  const s = await fixture(t, { busy: true });
  let result = await s.run(["update"]);
  assert.equal(result.code, 1); assert.match(result.stderr, /1 render job.*1 agent turn.*--force/s);
  assert.equal(path.basename(readlinkSync(s.xdg.current)), OLD); assert.deepEqual(s.system.calls.filter((call) => call === "stop"), []);
  s.adapters.injectFailure = (name) => { if (name === "backup") throw new Error("backup still enforced"); };
  result = await s.run(["update", "--force"]);
  assert.equal(result.code, 1); assert.match(result.stderr, /backup still enforced/);
  assert.equal(path.basename(readlinkSync(s.xdg.current)), OLD);
});

test("failure injection records the exact step and restores pointer, metadata and prior running state", async (t) => {
  for (const injected of ["fetch", "build", "verify", "stop", "backup", "switch", "health"]) await t.test(injected, async (t) => {
    const s = await fixture(t);
    s.adapters.injectFailure = (name) => {
      if (name !== injected) return;
      if (name === "health") {
        const db = new DatabaseSync(path.join(s.root, "storybench.sqlite"));
        db.prepare("UPDATE channels SET name='Changed by failed release' WHERE id='channel_test'").run(); db.close();
      }
      throw new Error(`injected ${name}`);
    };
    const result = await s.run(["update"]);
    assert.equal(result.code, 1); assert.match(result.stderr, new RegExp(`injected ${injected}`));
    assert.equal(path.basename(readlinkSync(s.xdg.current)), OLD);
    assert.equal(databaseInfo(s.root).name, "Sentinel");
    assert.equal(s.active(), true);
    const receipts = readReceipts(path.join(s.xdg.state, "updates"), "storybench.update/1");
    assert.equal(receipts.length, 1); assert.equal(receipts[0].value.failureStep, injected);
    assert.notEqual(receipts[0].value.outcome, "success");
  });
});

test("rollback uses the previous exact pair and refuses an incompatible schema with an exact boundary", async (t) => {
  await t.test("compatible", async (t) => {
    const s = await fixture(t);
    assert.equal((await s.run(["update"])).code, 0);
    const result = await s.run(["rollback"]);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(path.basename(readlinkSync(s.xdg.current)), OLD);
    const receipt = readReceipts(path.join(s.xdg.state, "updates"), "storybench.rollback/1")[0].value;
    assert.equal(receipt.outcome, "success");
  });
  await t.test("incompatible", async (t) => {
    const s = await fixture(t, { active: false, oldRange: { min: 0, max: 8 } });
    assert.equal((await s.run(["update"])).code, 0);
    const updateReceipt = readReceipts(path.join(s.xdg.state, "updates"), "storybench.update/1")[0].value;
    const result = await s.run(["rollback"]);
    assert.equal(result.code, 1); assert.match(result.stderr, new RegExp(`schema ${SCHEMA_VERSION} is outside the supported range 0-8`));
    assert.match(result.stderr, /recorded transition backup/); assert.doesNotMatch(result.stderr, /pre-update backup/);
    assert.ok(result.stderr.includes(updateReceipt.backup.path));
    assert.equal(path.basename(readlinkSync(s.xdg.current)), NEW);
  });
});

test("retention keeps proven activations and never ranks a failed build by builtAt", async (t) => {
  const values = [
    { commit: OLD, proven: true, activatedAt: "2026-09-19", manifest: manifest(OLD, "1", "2", { min: 0, max: 9 }) },
    { commit: NEW, proven: false, activatedAt: null, manifest: manifest(NEW, "3", "4", { min: 0, max: 9 }) },
    { commit: OTHER, proven: true, activatedAt: "2026-09-21", manifest: manifest(OTHER, "5", "6", { min: 0, max: 9 }) },
  ];
  assert.deepEqual(selectRetainedCommits(values, { currentCommit: OTHER, previousCommit: OLD, schemaVersion: 9 }), new Set([OTHER, OLD]));

  const s = await fixture(t, { active: false });
  const failed = manifest(OTHER, "5", "6");
  const failedDirectory = path.join(s.xdg.releases, OTHER); mkdirSync(failedDirectory); writeFileSync(path.join(failedDirectory, "manifest.json"), JSON.stringify(failed));
  const updates = path.join(s.xdg.state, "updates"); mkdirSync(updates, { recursive: true });
  writeJsonAtomic(path.join(updates, "success.json"), { schema: "storybench.update/1", outcome: "success", attemptedAt: "2026-09-20T00:00:00Z",
    completedAt: "2026-09-20T00:01:00Z", from: { commit: OLD }, to: { commit: NEW } });
  writeJsonAtomic(path.join(updates, "failed.json"), { schema: "storybench.update/1", outcome: "failed", attemptedAt: "2026-09-21T00:00:00Z",
    completedAt: "2026-09-21T00:01:00Z", from: { commit: NEW }, to: { commit: OTHER }, failureStep: "health" });
  const removed = [];
  await retainReleases({ xdg: s.xdg, env: s.env, runCommand: async (command, args) => {
    if (command === "docker" && args[0] === "ps") return { code: 0, stdout: "", stderr: "" };
    if (command === "docker" && args[0] === "image" && args[1] === "inspect") return { code: 0, stdout: "sb-update-test\n", stderr: "" };
    if (command === "docker" && args[0] === "image" && args[1] === "rm") { removed.push(args[2]); return { code: 0, stdout: args[2], stderr: "" }; }
    throw new Error(`unexpected command ${command} ${args.join(" ")}`);
  } }, NEW, OLD, 9);
  assert.equal(existsSync(failedDirectory), false);
  assert.deepEqual(new Set(removed), new Set([failed.images.app.id, failed.images.worker.id]));
  assert.equal(existsSync(path.join(s.xdg.releases, OLD)), true); assert.equal(existsSync(path.join(s.xdg.releases, NEW)), true);
});

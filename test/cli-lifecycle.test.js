import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { EventEmitter } from "node:events";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { main } from "../src/cli/main.js";
import { readConfig } from "../src/cli/config.js";
import { acquireLock } from "../src/cli/lock.js";
import { generateUnit, quoteArg, unitName } from "../src/cli/unit.js";
import { probeService } from "../src/cli/service.js";
import { servicePath } from "../src/cli/lifecycle.js";
import { createManifest } from "../src/runtime/manifest.js";
import { createApp } from "../src/server.js";
import { listenInRange } from "../test-support/loopback-port.js";

const release = createManifest({ packageName: "storybench", packageVersion: "0.1.0", commit: "0fcda47", ref: "main", builtAt: "2026-09-21T00:00:00Z",
  images: { app: `sha256:${"a".repeat(64)}`, worker: `sha256:${"b".repeat(64)}` }, schema: { min: 0, max: 8 } });

function healthBody({ databaseId, manifest = release, renders = 0, agents = 0, ready = true }) {
  return { status: ready ? "ready" : "starting", ready, package: { name: "storybench", version: "0.1.0" },
    release: { manifestId: manifest.id, version: manifest.package.version, commit: manifest.source.commit, images: { app: manifest.images.app.id, worker: manifest.images.worker.id }, protocol: 1 },
    schema: { current: 8, supported: { min: 0, max: 8 } }, database: { id: databaseId },
    activity: { renders: { queued: 0, running: renders }, agents: { active: agents } } };
}

// A fake user manager: start() launches a fake Storybench health server on the configured port, stop() closes it.
function fakeSystem(t, { health = {}, startFails = false, portOf }) {
  const calls = [];
  let server = null, active = "inactive", pid = null;
  const system = {
    calls,
    health,
    async unitState(unit) { calls.push(["show", unit]); return { load: "loaded", active, sub: active === "active" ? "running" : "dead", pid, startedAt: pid ? "Mon 2026-09-21 09:00:00 CEST" : null, result: active === "failed" ? "exit-code" : "success" }; },
    async daemonReload() { calls.push(["daemon-reload"]); return { code: 0, stdout: "", stderr: "" }; },
    async resetFailed(unit) { calls.push(["reset-failed", unit]); active = "inactive"; return { code: 0 }; },
    async start(unit) {
      calls.push(["start", unit]);
      if (startFails) { active = "failed"; return { code: 0, stdout: "", stderr: "" }; }
      const port = portOf();
      server = http.createServer((request, response) => {
        const body = request.url === "/api/health" ? healthBody(system.health)
          : request.url === "/api/channels/default" ? { channel: { id: "channel_default", name: "Alpha" } } : null;
        response.writeHead(body ? 200 : 404, { "content-type": "application/json" });
        response.end(JSON.stringify(body ?? { error: "not found" }));
      });
      await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
      active = "active"; pid = 4242;
      return { code: 0, stdout: "", stderr: "" };
    },
    async stop(unit) { calls.push(["stop", unit]); if (server) await new Promise((resolve) => server.close(resolve)); server = null; active = "inactive"; pid = null; return { code: 0 }; },
    async containers() { return pid ? [{ id: "c".repeat(64), role: "app" }] : []; },
    journal(unit, options) { calls.push(["journal", unit, options.follow]); const child = new EventEmitter(); setImmediate(() => child.emit("close", 0)); return child; },
    async open(url) { calls.push(["open", url]); },
  };
  t.after(() => server?.close());
  return system;
}

async function sandbox(t, systemOptions = {}) {
  const home = mkdtempSync(path.join(os.tmpdir(), "storybench-life-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const manifestFile = path.join(home, "manifest.json");
  writeFileSync(manifestFile, JSON.stringify(release));
  const env = { HOME: home, PATH: process.env.PATH, XDG_CONFIG_HOME: path.join(home, "cfg"), XDG_DATA_HOME: path.join(home, "data"), XDG_STATE_HOME: path.join(home, "state"),
    XDG_RUNTIME_DIR: path.join(home, "run"), STORYBENCH_RELEASE_MANIFEST: manifestFile, STORYBENCH_UNIT_DIR: path.join(home, "units"), STORYBENCH_UNIT_NAME: "storybench-test-life.service" };
  mkdirSync(env.XDG_RUNTIME_DIR, { recursive: true });
  // Reserve a free port in range for the fake service, then release it.
  const probe = http.createServer();
  const port = await listenInRange(probe);
  await new Promise((resolve) => probe.close(resolve));
  let config = null;
  const system = fakeSystem(t, { ...systemOptions, portOf: () => readConfig(path.join(env.XDG_CONFIG_HOME, "storybench", "config.json")).port });
  const run = async (args, overrides = {}) => {
    let stdout = "", stderr = "";
    const code = await main(args, { env, home, cwd: home, lockTimeoutMs: 300, system, healthTimeoutMs: 3000, pollMs: 20, nodePath: "/usr/bin/node",
      stdout: { write: (text) => { stdout += text; } }, stderr: { write: (text) => { stderr += text; } }, ...overrides });
    return { code, stdout, stderr };
  };
  const root = path.join(home, "root");
  assert.equal((await run(["init", root])).code, 0);
  config = readConfig(path.join(env.XDG_CONFIG_HOME, "storybench", "config.json"));
  system.health.databaseId ??= config.dataRootId;
  return { home, env, run, port, system, root, config };
}

test("the unit is generated with quoted absolute paths, bounded restarts, drain time and no login startup", () => {
  const unit = generateUnit({ node: "/usr/bin/node", hostEntry: "/opt/story bench/src/runtime/host.js", hostConfig: "/home/a/.local/state/storybench/host-50%.json",
    workingDirectory: "/opt/story bench", stopTimeoutS: 90, environment: { PATH: "/usr/bin:/bin", DOCKER_HOST: "unix:///run/user/1000/docker.sock" } });
  assert.match(unit, /^ExecStart="\/usr\/bin\/node" "\/opt\/story bench\/src\/runtime\/host\.js" "--config" "\/home\/a\/\.local\/state\/storybench\/host-50%%\.json"$/m);
  assert.match(unit, /^WorkingDirectory=\/opt\/story bench$/m);
  for (const line of ["Restart=on-failure", "StartLimitBurst=3", "StartLimitIntervalSec=300", "KillSignal=SIGTERM", "KillMode=mixed", "TimeoutStopSec=90", "Type=simple"])
    assert.ok(unit.split("\n").includes(line), line);
  assert.doesNotMatch(unit, /\[Install\]|WantedBy/, "the unit cannot be enabled at login");
  assert.equal(quoteArg('a"b\\c$d%e'), '"a\\"b\\\\c$$d%%e"');
  for (const bad of [{ node: "node" }, { hostConfig: "/tmp/x\nExecStartPre=/bin/rm" }, { workingDirectory: "/tmp/../etc" }, { stopTimeoutS: 1 }])
    assert.throws(() => generateUnit({ node: "/usr/bin/node", hostEntry: "/opt/h.js", hostConfig: "/opt/c.json", workingDirectory: "/opt", ...bad }));
  assert.throws(() => generateUnit({ node: "/usr/bin/node", hostEntry: "/opt/h.js", hostConfig: "/opt/c.json", workingDirectory: "/opt", environment: { "BAD NAME": "x" } }));
  assert.equal(unitName({}), "storybench.service");
  assert.equal(unitName({ STORYBENCH_UNIT_NAME: "storybench-test-1.service" }), "storybench-test-1.service");
  assert.throws(() => unitName({ STORYBENCH_UNIT_NAME: "../evil.service" }));
  const verify = spawnSync("systemd-analyze", ["--version"], { encoding: "utf8" });
  if (verify.status === 0) {
    const dir = mkdtempSync(path.join(os.tmpdir(), "storybench-unit-"));
    writeFileSync(path.join(dir, "storybench-verify.service"), generateUnit({ node: process.execPath, hostEntry: "/opt/story bench/host.js", hostConfig: "/opt/c.json", workingDirectory: "/", environment: { PATH: "/usr/bin" } }));
    const result = spawnSync("systemd-analyze", ["--user", "verify", path.join(dir, "storybench-verify.service")], { encoding: "utf8" });
    rmSync(dir, { recursive: true, force: true });
    assert.doesNotMatch(result.stderr, /Unknown key|Failed to parse|Invalid|Missing/i, result.stderr);
  }
});

test("up writes the host config and unit, starts it, waits for matching health, and is idempotent", async (t) => {
  const s = await sandbox(t);
  assert.equal((await s.run(["channel", "create", "Alpha"])).code, 0);
  const up = await s.run(["up", "--port", String(s.port)]);
  assert.equal(up.code, 0, up.stderr);
  assert.match(up.stdout, new RegExp(`running: http://127\\.0\\.0\\.1:${s.port}/\\nRelease ${release.id} \\(commit 0fcda47\\)`));
  const config = readConfig(path.join(s.env.XDG_CONFIG_HOME, "storybench", "config.json"));
  assert.equal(config.port, s.port);
  assert.match(config.installId, /^sb[0-9a-f]{10}$/);
  const unit = readFileSync(path.join(s.env.STORYBENCH_UNIT_DIR, "storybench-test-life.service"), "utf8");
  assert.match(unit, /ExecStart="\/usr\/bin\/node" ".*\/src\/runtime\/host\.js" "--config" ".*\/state\/storybench\/host-storybench-test-life\.json"/);
  const host = JSON.parse(readFileSync(path.join(s.env.XDG_STATE_HOME, "storybench", "host-storybench-test-life.json"), "utf8"));
  assert.deepEqual({ installId: host.installId, dataRoot: host.dataRoot, port: host.port, manifestPath: host.manifestPath, stateRoot: host.stateRoot, runtimeRoot: host.runtimeRoot },
    { installId: config.installId, dataRoot: s.root, port: s.port, manifestPath: s.env.STORYBENCH_RELEASE_MANIFEST, stateRoot: path.join(s.env.XDG_STATE_HOME, "storybench"),
      runtimeRoot: path.join(s.env.XDG_RUNTIME_DIR, "storybench", `host-${config.installId}`) });
  assert.deepEqual(s.system.calls.filter(([name]) => ["daemon-reload", "start"].includes(name)), [["daemon-reload"], ["start", "storybench-test-life.service"]]);
  // The unit's PATH is minimal: docker's directory, Node's, and the standard ones — not the caller's shell PATH.
  const dockerHome = path.join(s.home, "tools");
  mkdirSync(dockerHome);
  writeFileSync(path.join(dockerHome, "docker"), "#!/bin/sh\n", { mode: 0o755 });
  assert.equal(servicePath(`/home/me/.personal/bin:${dockerHome}:/usr/bin`, "/opt/node/bin/node"), `${dockerHome}:/opt/node/bin:/usr/local/bin:/usr/bin:/bin`);
  assert.match(unit, /^Environment="PATH=(?:[^"]*:)?\/usr\/local\/bin:\/usr\/bin:\/bin"$/m);
  const again = await s.run(["up"]);
  assert.equal(again.code, 0);
  assert.match(again.stdout, /already running/);
  assert.equal(s.system.calls.filter(([name]) => name === "start").length, 1, "no second start");
  const otherPort = await s.run(["up", "--port", String(s.port + 1)]);
  assert.equal(otherPort.code, 1);
  assert.match(otherPort.stderr, /running on port \d+[\s\S]*storybench down/);
  // down is graceful and idempotent and leaves channels alone.
  const down = await s.run(["down"]);
  assert.match(down.stdout, /stopped\. Channels, episodes and the default channel are unchanged/);
  assert.match((await s.run(["down"])).stdout, /already stopped/);
  assert.match((await s.run(["channel", "current"])).stdout, /^Alpha/);
});

test("up refuses a port held by another program or another Storybench, and reports failure and mismatch", async (t) => {
  const s = await sandbox(t);
  const other = http.createServer((request, response) => response.end("not storybench"));
  await new Promise((resolve) => other.listen(s.port, "127.0.0.1", resolve));
  let result = await s.run(["up", "--port", String(s.port)]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /Port \d+ is already in use by another program/);
  await new Promise((resolve) => other.close(resolve));
  const foreign = http.createServer((request, response) => { response.setHeader("content-type", "application/json"); response.end(JSON.stringify(healthBody({ databaseId: "root_other" }))); });
  await new Promise((resolve) => foreign.listen(s.port, "127.0.0.1", resolve));
  result = await s.run(["up", "--port", String(s.port)]);
  assert.match(result.stderr, /Another Storybench server \(not storybench-test-life\.service\) answers/);
  await new Promise((resolve) => foreign.close(resolve));
  assert.equal(s.system.calls.filter(([name]) => name === "start").length, 0);
  const mismatched = await sandbox(t, { health: { databaseId: "root_somebody_else" } });
  result = await mismatched.run(["up", "--port", String(mismatched.port)]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /started but it serves a different data root/);
  const failing = await sandbox(t, { startFails: true });
  result = await failing.run(["up", "--port", String(failing.port)]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /did not start \(failed, exit-code\)[\s\S]*storybench logs/);
  const noManifest = await sandbox(t);
  rmSync(noManifest.env.STORYBENCH_RELEASE_MANIFEST);
  result = await noManifest.run(["up"]);
  assert.match(result.stderr, /No release manifest is installed[\s\S]*release\.js build --out/);
});

test("restart refuses while any channel is busy unless forced, and verifies the same release and root", async (t) => {
  const s = await sandbox(t);
  await s.run(["up", "--port", String(s.port)]);
  s.system.health.renders = 1;
  s.system.health.agents = 2;
  const refused = await s.run(["restart"]);
  assert.equal(refused.code, 1);
  assert.match(refused.stderr, /busy: 1 render job\(s\) and 2 agent turn\(s\) are active across all channels[\s\S]*--force/);
  assert.equal(s.system.calls.filter(([name]) => name === "stop").length, 0, "nothing was stopped");
  const forced = await s.run(["restart", "--force"]);
  assert.equal(forced.code, 0, forced.stderr);
  assert.match(forced.stdout, /restarted[\s\S]*\(same release\); data root .* \(same as configured\)/);
  s.system.health.renders = 0; s.system.health.agents = 0;
  assert.equal((await s.run(["restart"])).code, 0);
});

test("status reports state, URL, release, identities, process, containers and default channel; open and logs", async (t) => {
  const s = await sandbox(t);
  let status = await s.run(["status"]);
  assert.match(status.stdout, /^Status: stopped$/m);
  const closed = await s.run(["open"]);
  assert.deepEqual({ code: closed.code }, { code: 1 });
  assert.match(closed.stderr, /not running \(stopped\)[\s\S]*storybench up/);
  await s.run(["up", "--port", String(s.port)]);
  status = await s.run(["status"]);
  for (const line of [/^Status: healthy$/m, /^Unit: storybench-test-life\.service \(loaded, active\/running\)$/m, /^Process: host PID 4242/m, /^Containers: app cccccccccccc$/m,
    new RegExp(`^URL: http://127\\.0\\.0\\.1:${s.port}/\\?channel=channel_default$`, "m"), new RegExp(`^Release expected: ${release.id}`, "m"), new RegExp(`^Release served: ${release.id}`, "m"),
    /^Activity: 0 render job\(s\), 0 agent turn\(s\) across all channels$/m, new RegExp(`^Data root: configured ${s.config.dataRootId}, served ${s.config.dataRootId}$`, "m"), /^Default channel: Alpha \(channel_default\)$/m])
    assert.match(status.stdout, line);
  s.system.health.databaseId = "root_replaced";
  status = await s.run(["status"]);
  assert.match(status.stdout, /^Status: mismatched$[\s\S]*^Mismatch: it serves a different data root than the configured one$/m);
  s.system.health.databaseId = s.config.dataRootId;
  const opened = await s.run(["open"]);
  assert.equal(opened.code, 0);
  assert.deepEqual(s.system.calls.find(([name]) => name === "open"), ["open", `http://127.0.0.1:${s.port}/?channel=channel_default`]);
  assert.equal((await s.run(["logs", "-f"])).code, 0);
  assert.deepEqual(s.system.calls.find(([name]) => name === "journal"), ["journal", "storybench-test-life.service", true]);
});

test("adopt refuses while the unit runs or any Storybench answers on the configured or default port", async (t) => {
  const s = await sandbox(t);
  await s.run(["up", "--port", String(s.port)]);
  const result = await s.run(["init", s.root, "--adopt"]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /storybench-test-life\.service\) is active[\s\S]*storybench down/);
});

test("while the service is healthy, channel changes go through the running app, not the offline path", async (t) => {
  const home = mkdtempSync(path.join(os.tmpdir(), "storybench-life-app-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const env = { HOME: home, XDG_CONFIG_HOME: path.join(home, "cfg"), XDG_STATE_HOME: path.join(home, "state"), XDG_DATA_HOME: path.join(home, "data"), XDG_RUNTIME_DIR: path.join(home, "run") };
  mkdirSync(env.XDG_RUNTIME_DIR, { recursive: true });
  const run = async (args) => {
    let stdout = "", stderr = "";
    const code = await main(args, { env, home, cwd: home, lockTimeoutMs: 200, system: { unitState: async () => ({ active: "active" }) },
      stdout: { write: (text) => { stdout += text; } }, stderr: { write: (text) => { stderr += text; } } });
    return { code, stdout, stderr };
  };
  const root = path.join(home, "root");
  assert.equal((await run(["init", root])).code, 0);
  const app = await createApp({ dataRoot: root });
  const port = await listenInRange(app.server);
  t.after(() => app.close());
  const configFile = path.join(env.XDG_CONFIG_HOME, "storybench", "config.json");
  writeFileSync(configFile, JSON.stringify({ ...readConfig(configFile), port }));
  // Hold the lifecycle lock: an offline operation would time out; the running-app path does not need it.
  const release = await acquireLock(path.join(env.XDG_RUNTIME_DIR, "storybench"), { operation: "up" });
  t.after(release);
  const created = await run(["channel", "create", "Live"]);
  assert.equal(created.code, 0, created.stderr);
  assert.equal((await run(["channel", "create", "Second"])).code, 0);
  assert.match((await run(["channel", "use", "second"])).stdout, /now Second/);
  assert.equal(app.store.getDefaultChannel().name, "Second", "the running app's store made the change");
  assert.match((await run(["channel", "list"])).stdout, /^\* channel_\S+  Second$/m);
  const unknown = await run(["channel", "use", "Nope"]);
  assert.match(unknown.stderr, /Unknown channel: Nope/);
  const duplicate = await run(["channel", "create", "live"]);
  assert.equal(duplicate.code, 1);
  assert.match(duplicate.stderr, /already exists/);
  assert.equal((await probeService(port)).state, "running");
});

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { EventEmitter } from "node:events";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { main } from "../src/cli/main.js";
import { readConfig } from "../src/cli/config.js";
import { acquireLock } from "../src/cli/lock.js";
import { generateUnit, quoteArg, quoteEnvironment, unitName } from "../src/cli/unit.js";
import { hostSystem } from "../src/cli/system.js";
import { readLockOwner } from "../src/cli/lock.js";
import { probeService } from "../src/cli/service.js";
import { servicePath } from "../src/cli/lifecycle.js";
import { createManifest } from "../src/runtime/manifest.js";
import { createApp } from "../src/server.js";
import { listenInRange } from "../test-support/loopback-port.js";

// A Node path no real host uses, so the unit assertions cannot pass by matching the machine's own node.
const FAKE_NODE = "/opt/storybench-test-node/bin/node";
const release = createManifest({ packageName: "storybench", packageVersion: "0.1.0", commit: "0fcda47", ref: "main", builtAt: "2026-09-21T00:00:00Z",
  images: { app: `sha256:${"a".repeat(64)}`, worker: `sha256:${"b".repeat(64)}` }, schema: { min: 0, max: 8 } });

function healthBody({ databaseId, manifest = release, renders = 0, agents = 0, ready = true }) {
  return { status: ready ? "ready" : "starting", ready, package: { name: "storybench", version: "0.1.0" },
    release: { manifestId: manifest.id, version: manifest.package.version, commit: manifest.source.commit, images: { app: manifest.images.app.id, worker: manifest.images.worker.id }, protocol: 1 },
    schema: { current: 8, supported: { min: 0, max: 8 } }, database: { id: databaseId },
    activity: { renders: { queued: 0, running: renders }, agents: { active: agents } } };
}

// One loopback port per sandbox, bound for the sandbox's whole life so no other process or test can take it between
// "reserve" and "use". Whoever plays the service (the fake unit, or a test's "other program") attaches a request
// handler to this same socket; nothing ever rebinds. While no handler is attached the port counts as free.
async function reservePort(t) {
  const reservation = { handler: null, server: http.createServer((request, response) => {
    if (reservation.handler) return reservation.handler(request, response);
    response.writeHead(503); response.end();
  }) };
  reservation.port = await listenInRange(reservation.server);
  t.after(() => new Promise((resolve) => reservation.server.close(resolve)));
  return reservation;
}

// A fake user manager: start() makes the reserved port answer as a Storybench app, stop() detaches it.
function fakeSystem(t, { health = {}, startFails = false, portOf, reservation }) {
  const calls = [];
  let active = "inactive", pid = null;
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
      if (port !== reservation.port) throw new Error(`the fake unit only serves its reserved port ${reservation.port}, not ${port}`);
      reservation.handler = (request, response) => {
        const body = request.url === "/api/health" ? healthBody(system.health)
          : request.url === "/api/channels/default" ? { channel: { id: "channel_default", name: "Alpha" } } : null;
        response.writeHead(body ? 200 : 404, { "content-type": "application/json" });
        response.end(JSON.stringify(body ?? { error: "not found" }));
      };
      active = "active"; pid = 4242;
      return { code: 0, stdout: "", stderr: "" };
    },
    async stop(unit) { calls.push(["stop", unit]); reservation.handler = null; active = "inactive"; pid = null; return { code: 0 }; },
    async containers() { return pid ? [{ id: "c".repeat(64), role: "app" }] : []; },
    journal(unit, options) { calls.push(["journal", unit, options.follow]); const child = new EventEmitter(); setImmediate(() => child.emit("close", 0)); return child; },
    async open(url) { calls.push(["open", url]); },
  };
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
  const reservation = await reservePort(t);
  const port = reservation.port;
  let config = null;
  const system = fakeSystem(t, { ...systemOptions, reservation, portOf: () => readConfig(path.join(env.XDG_CONFIG_HOME, "storybench", "config.json")).port });
  // The reserved port with nothing attached is "free" to the CLI; everything else is probed for real.
  const probe = (target, options) => (target === port && !reservation.handler ? Promise.resolve({ state: "stopped" }) : probeService(target, options));
  const run = async (args, overrides = {}) => {
    let stdout = "", stderr = "";
    const code = await main(args, { env, home, cwd: home, lockTimeoutMs: 300, system, probeService: probe, healthTimeoutMs: 3000, pollMs: 20, nodePath: FAKE_NODE,
      stdout: { write: (text) => { stdout += text; } }, stderr: { write: (text) => { stderr += text; } }, ...overrides });
    return { code, stdout, stderr };
  };
  const root = path.join(home, "root");
  assert.equal((await run(["init", root])).code, 0);
  config = readConfig(path.join(env.XDG_CONFIG_HOME, "storybench", "config.json"));
  system.health.databaseId ??= config.dataRootId;
  // occupy(): make the reserved port answer as some other program (null releases it again).
  return { home, env, run, port, system, root, config, occupy: (handler) => { reservation.handler = handler; } };
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
    // Only unit-file parse problems count; a runner without a user bus may report that separately.
    const parseProblems = result.stderr.split("\n").filter((line) => /storybench-verify\.service/.test(line) && /Unknown key|Failed to parse|Invalid|Missing|not absolute/i.test(line));
    assert.deepEqual(parseProblems, [], result.stderr);
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
  assert.ok(unit.includes(`ExecStart="${FAKE_NODE}" "${path.join(path.resolve(import.meta.dirname, ".."), "src", "runtime", "host.js")}" "--config" "${path.join(s.env.XDG_STATE_HOME, "storybench", "host-storybench-test-life.json")}"`), unit);
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
  const unitPath = unit.match(/^Environment="PATH=([^"]*)"$/m)[1].split(":");
  assert.ok(unitPath.includes(path.dirname(FAKE_NODE)), "the unit PATH includes the injected Node's directory");
  assert.deepEqual(unitPath.slice(-3), ["/usr/local/bin", "/usr/bin", "/bin"]);
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
  s.occupy((request, response) => response.end("not storybench"));
  let result = await s.run(["up", "--port", String(s.port)]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /Port \d+ is already in use by another program/);
  s.occupy((request, response) => { response.setHeader("content-type", "application/json"); response.end(JSON.stringify(healthBody({ databaseId: "root_other" }))); });
  result = await s.run(["up", "--port", String(s.port)]);
  assert.match(result.stderr, /Another Storybench server \(not storybench-test-life\.service\) answers/);
  s.occupy(null);
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

// A system adapter frozen in one unit state, recording calls.
function stateSystem(active, extra = {}) {
  const calls = [];
  return { calls, async unitState(unit) { calls.push(["show", unit]); if (extra.fail) throw new Error(extra.fail); return { load: "loaded", active, sub: extra.sub ?? active, pid: active === "inactive" ? null : 77, fragment: extra.fragment ?? null }; },
    async stop(unit) { calls.push(["stop", unit]); return { code: 0 }; }, async start(unit) { calls.push(["start", unit]); return { code: 0 }; }, async daemonReload() { return { code: 0 }; },
    async resetFailed() { return { code: 0 }; }, async containers() { return []; }, journal(unit) { calls.push(["journal", unit]); const child = new EventEmitter(); setImmediate(() => child.emit("close", 0)); return child; } };
}

test("R1: channel commands never fall back to offline while the unit is active, starting, restarting or stopping", async (t) => {
  const s = await sandbox(t);
  const stoppedProbe = async () => ({ state: "stopped" });
  for (const [active, sub] of [["active", "running"], ["activating", "auto-restart"], ["activating", "start"], ["reloading", "reload"], ["deactivating", "stop-sigterm"]]) {
    const result = await s.run(["channel", "create", `X-${active}-${sub}`], { system: stateSystem(active, { sub }), probeService: stoppedProbe });
    assert.equal(result.code, 1, `${active}/${sub}`);
    assert.match(result.stderr, new RegExp(`service is ${active}[\\s\\S]*storybench down\` to manage channels offline`));
  }
  const unknown = await s.run(["channel", "list"], { system: stateSystem("active", { fail: "Access denied" }), probeService: stoppedProbe });
  assert.match(unknown.stderr, /Cannot determine whether the Storybench service is running \(Access denied\)/);
  for (const active of ["inactive", "failed"]) assert.equal((await s.run(["channel", "create", `Y-${active}`], { system: stateSystem(active), probeService: stoppedProbe })).code, 0, active);
  const list = await s.run(["channel", "list"], { system: stateSystem("inactive"), probeService: stoppedProbe });
  assert.doesNotMatch(list.stdout, /X-/, "no refused create reached the database");
  assert.match(list.stdout, /Y-inactive[\s\S]*Y-failed|Y-failed[\s\S]*Y-inactive/);
});

test("R1: an unavailable user manager means not running; other systemctl failures are surfaced", async (t) => {
  const bin = mkdtempSync(path.join(os.tmpdir(), "storybench-fake-systemctl-"));
  t.after(() => rmSync(bin, { recursive: true, force: true }));
  const script = (text, code) => { writeFileSync(path.join(bin, "systemctl"), `#!/bin/sh\necho '${text}' >&2\nexit ${code}\n`, { mode: 0o755 }); };
  script("Failed to connect to bus: No medium found", 1);
  assert.deepEqual(await hostSystem({ env: { PATH: bin } }).unitState("storybench.service"), { load: "not-found", active: "inactive", sub: "dead", pid: null, managerUnavailable: true });
  script("Failed to get properties: Access denied", 1);
  await assert.rejects(hostSystem({ env: { PATH: bin } }).unitState("storybench.service"), /Access denied/);
  await assert.doesNotReject(hostSystem({ env: { PATH: path.join(bin, "none") } }).unitState("storybench.service"));
});

test("R2: restart fails closed when the service is up but reports no activity", async (t) => {
  const s = await sandbox(t);
  for (const active of ["active", "activating"]) {
    const system = stateSystem(active);
    const refused = await s.run(["restart"], { system, probeService: async () => ({ state: "unreachable" }) });
    assert.equal(refused.code, 1);
    assert.match(refused.stderr, new RegExp(`Cannot confirm the Storybench service is idle: it is ${active}[\\s\\S]*restart --force`));
    assert.equal(system.calls.filter(([name]) => name === "stop").length, 0, "nothing was stopped");
  }
  const system = stateSystem("active");
  await s.run(["restart", "--force"], { system, probeService: async () => ({ state: "unreachable" }) });
  assert.equal(system.calls.filter(([name]) => name === "stop").length, 1, "--force proceeds to stop");
  let seen = null;
  await s.run(["restart"], { system: stateSystem("inactive"), probeService: async (port, options) => { seen ??= options; return { state: "stopped" }; } });
  assert.deepEqual(seen, { timeoutMs: 10_000 }, "restart waits longer for the busy check");
});

test("R3: down, status and logs work when the configured data root is missing; up and restart refuse", async (t) => {
  const s = await sandbox(t);
  await s.run(["up", "--port", String(s.port)]);
  renameSync(s.root, `${s.root}-moved`);
  const status = await s.run(["status"]);
  assert.equal(status.code, 0);
  assert.match(status.stdout, /^Status: healthy$/m);
  assert.match(status.stdout, /^Data root problem: The configured data root .* is missing — Restore or remount/m);
  assert.equal((await s.run(["logs"])).code, 0);
  const down = await s.run(["down"]);
  assert.equal(down.code, 0, down.stderr);
  assert.match(down.stdout, /Storybench stopped/);
  assert.match((await s.run(["up"])).stderr, /is missing/);
  assert.match((await s.run(["restart"])).stderr, /is missing/);
  assert.equal(existsSync(s.root), false);
});

test("R4: Environment= values keep $ (only Exec* lines expand variables)", () => {
  assert.equal(quoteEnvironment('PATH=/a$b:/c%d"e\\f'), '"PATH=/a$b:/c%%d\\"e\\\\f"');
  const unit = generateUnit({ node: "/usr/bin/node", hostEntry: "/opt/h$x.js", hostConfig: "/opt/c.json", workingDirectory: "/opt", environment: { DOCKER_HOST: "unix:///run/user/1000/do$cker.sock" } });
  assert.match(unit, /^Environment="DOCKER_HOST=unix:\/\/\/run\/user\/1000\/do\$cker\.sock"$/m);
  assert.match(unit, /"\/opt\/h\$\$x\.js"/, "Exec* still escapes $");
});

test("R5: adopt checks the service under the lifecycle lock and surfaces unit-state failures", async (t) => {
  const s = await sandbox(t);
  let ownerDuringCheck = null;
  const system = { ...stateSystem("inactive"), async unitState() { ownerDuringCheck = readLockOwner(path.join(s.env.XDG_RUNTIME_DIR, "storybench")); return { active: "inactive" }; } };
  assert.equal((await s.run(["init", s.root, "--adopt"], { system, probeService: async () => ({ state: "stopped" }) })).code, 0);
  assert.equal(ownerDuringCheck?.operation, "init --adopt", "the stopped check ran while holding the lock");
  const failed = await s.run(["init", s.root, "--adopt"], { system: stateSystem("inactive", { fail: "Connection timed out" }) });
  assert.equal(failed.code, 1);
  assert.match(failed.stderr, /Cannot determine whether the Storybench service is running \(Connection timed out\)/);
});

test("R6: one port rule (1024-65535): invalid --port is a usage error, a bad configured port is refused", async (t) => {
  const s = await sandbox(t);
  for (const value of ["80", "0", "70000", "abc", "1023"]) {
    const result = await s.run(["up", "--port", value]);
    assert.deepEqual({ code: result.code, message: result.stderr.split("\n")[0] }, { code: 2, message: "storybench: The port must be an integer from 1024 to 65535" }, value);
  }
  const configFile = path.join(s.env.XDG_CONFIG_HOME, "storybench", "config.json");
  writeFileSync(configFile, JSON.stringify({ ...readConfig(configFile), port: 80 }));
  const result = await s.run(["status"]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /1024 to 65535/);
});

test("status notes an app container that predates the current host start", async (t) => {
  const s = await sandbox(t);
  const hostStart = "2026-09-21T09:00:10.000Z";
  const system = { ...stateSystem("active"), async unitState() { return { load: "loaded", active: "active", sub: "running", pid: 91, startedAt: hostStart }; },
    async containers() { return [{ id: "d".repeat(64), role: "app", startedAt: "2026-09-21T08:59:00.000Z" }]; } };
  const answering = async () => ({ state: "running", health: healthBody({ databaseId: s.config.dataRootId }), dataRootId: s.config.dataRootId, schemaVersion: 8 });
  const configFile = path.join(s.env.XDG_CONFIG_HOME, "storybench", "config.json");
  writeFileSync(configFile, JSON.stringify({ ...readConfig(configFile), installId: "sbtest" }));
  let status = await s.run(["status"], { system, probeService: answering });
  assert.match(status.stdout, /Note: the app container predates the current host start/);
  system.containers = async () => [{ id: "d".repeat(64), role: "app", startedAt: "2026-09-21T09:00:11.000Z" }];
  status = await s.run(["status"], { system, probeService: answering });
  assert.doesNotMatch(status.stdout, /predates/);
});

test("R7 and notes: logs help is accurate; status words other answers by unit state and flags a foreign unit file", async (t) => {
  const s = await sandbox(t);
  assert.match((await s.run(["logs", "--help"])).stdout, /container output is not forwarded to the journal in this build/);
  const answering = async () => ({ state: "running", health: healthBody({ databaseId: s.config.dataRootId }), dataRootId: s.config.dataRootId, schemaVersion: 8 });
  let status = await s.run(["status"], { system: stateSystem("deactivating", { sub: "stop-sigterm" }), probeService: answering });
  assert.match(status.stdout, /Note: the service's own app is answering while the unit is deactivating \(stop-sigterm\)/);
  status = await s.run(["status"], { system: stateSystem("inactive"), probeService: answering });
  assert.match(status.stdout, /Note: a Storybench server not managed by storybench-test-life\.service answers/);
  status = await s.run(["status"], { system: stateSystem("active", { fragment: "/etc/systemd/user/storybench-test-life.service" }), probeService: answering });
  assert.match(status.stdout, /Mismatch: systemd loads storybench-test-life\.service from \/etc\/systemd\/user\/storybench-test-life\.service, not from .*units\/storybench-test-life\.service/);
  const busy = await s.run(["up"], { system: stateSystem("activating", { sub: "auto-restart" }), probeService: async () => ({ state: "stopped" }) });
  assert.match(busy.stderr, /service is activating \(auto-restart\)[\s\S]*Wait for it to settle/);
});

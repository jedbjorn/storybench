import test from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createManifest, readReleaseManifest } from "../src/runtime/manifest.js";
import { SCHEMA_VERSION } from "../src/store.js";
import { initDataRoot } from "../src/services/data-root.js";
import { writeConfigAtomic } from "../src/cli/config.js";
import { activateSymlink, installFromSource, launcherText, readInstallReceipt } from "../src/cli/install.js";
import { main } from "../src/cli/main.js";
import { runCommand } from "../src/cli/system.js";
import { resolveXdg } from "../src/cli/xdg.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APP = `sha256:${"a".repeat(64)}`;
const WORKER = `sha256:${"b".repeat(64)}`;

function command(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  assert.equal(result.status, 0, `${command} ${args.join(" ")}\n${result.stderr}`);
  return result.stdout.trim();
}

function fixture(t) {
  const base = mkdtempSync(path.join(os.tmpdir(), "storybench-install-test-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const source = path.join(base, "source"), remote = path.join(base, "origin.git"), home = path.join(base, "home");
  mkdirSync(source); mkdirSync(home);
  for (const entry of ["package.json", "package-lock.json", ".dockerignore", ".gitignore", "bin", "src", "docker", "public", "agent"])
    cpSync(path.join(REPO, entry), path.join(source, entry), { recursive: true });
  command("git", ["init", "--bare", remote]);
  command("git", ["init", "-b", "main", source]);
  command("git", ["-C", source, "config", "user.email", "test@example.invalid"]);
  command("git", ["-C", source, "config", "user.name", "Storybench Test"]);
  command("git", ["-C", source, "add", "."]);
  command("git", ["-C", source, "commit", "-m", "fixture"]);
  command("git", ["-C", source, "remote", "add", "origin", remote]);
  command("git", ["-C", source, "push", "-u", "origin", "main"]);
  const commit = command("git", ["-C", source, "rev-parse", "HEAD"]);
  const env = {
    HOME: home, XDG_CONFIG_HOME: path.join(home, "config"), XDG_DATA_HOME: path.join(home, "data"),
    XDG_STATE_HOME: path.join(home, "state"), XDG_RUNTIME_DIR: path.join(home, "run"),
    STORYBENCH_UNIT_NAME: "storybench-test-install.service", STORYBENCH_UNIT_DIR: path.join(home, "units"),
    DOCKER_HOST: "unix:///run/user/1000/docker.sock",
    PATH: `${path.join(home, ".local", "bin")}:${process.env.PATH}`,
  };
  mkdirSync(env.XDG_RUNTIME_DIR, { recursive: true });
  return { base, source, remote, home, commit, env, xdg: resolveXdg({ env, home }) };
}

test("atomic current pointer and launcher are idempotent and safely quote paths", async (t) => {
  const base = mkdtempSync(path.join(os.tmpdir(), "storybench-pointer-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const one = path.join(base, "release one's"), two = path.join(base, "release two"), current = path.join(base, "current");
  mkdirSync(one); mkdirSync(two);
  assert.equal(activateSymlink(current, one), true);
  const first = lstatSync(current).mtimeMs;
  assert.equal(activateSymlink(current, one), false);
  assert.equal(lstatSync(current).mtimeMs, first);
  assert.equal(activateSymlink(current, two), true);
  assert.equal(path.resolve(path.dirname(current), readlinkSync(current)), two);
  assert.match(launcherText("/opt/node's/bin/node", current), /^#!\/bin\/sh\nexec '\/opt\/node'\\''s\/bin\/node'/);
  await assert.rejects(installFromSource({}, { source: "/tmp/source", commit: "a".repeat(40), remote: "https://token:secret@example.invalid/repo.git", ref: "main" }),
    /embedded credentials/);
});

test("exact install, doctor, idempotent rerun and uninstall preserve configuration, data and state", async (t) => {
  const s = fixture(t);
  const calls = [], systemCalls = [];
  let builds = 0;
  const fakeRun = async (executable, args, options = {}) => {
    calls.push([executable, ...args]);
    if (executable === "docker") {
      if (args[0] === "image" && args[1] === "inspect") return { code: 0, stdout: `${args[2]}\n`, stderr: "" };
      if (args[0] === "info") return { code: 0, stdout: "29.7.2\n", stderr: "" };
      if (args[0] === "run") {
        const image = args.find((value) => value === APP || value === WORKER);
        const installing = String(args.at(-1)).includes("printf 'node='");
        const stdout = installing
          ? (image === WORKER
              ? "node=v24.21.0\nffmpeg=ffmpeg version 7\nffprobe=ffprobe version 7\ncodex=codex-cli 0.155.1\nclaude=2.1.278\n"
              : "node=v24.21.0\nffmpeg=ffmpeg version 7\nffprobe=ffprobe version 7\n")
          : (image === WORKER
              ? "v24.21.0\nffmpeg version 7\nffprobe version 7\ncodex-cli 0.155.1\n2.1.278\n"
              : "v24.21.0\nffmpeg version 7\nffprobe version 7\n");
        return { code: 0, stdout, stderr: "" };
      }
      if (args[0] === "ps") {
        if (args.includes(`label=io.storybench.install=sb-test`)) return { code: 0, stdout: "owned-container\n", stderr: "" };
        return { code: 0, stdout: "", stderr: "" };
      }
      if (args[0] === "network" && args[1] === "ls") return { code: 0, stdout: "", stderr: "" };
      return { code: 0, stdout: "", stderr: "" };
    }
    if (executable === "node" && args[0] === "--version") return { code: 0, stdout: "v24.21.0\n", stderr: "" };
    if (executable === "git" && args[0] === "--version") return { code: 0, stdout: "git version 2.51.0\n", stderr: "" };
    if (executable === "git" && args[0] === "ls-remote") return { code: 0, stdout: `${s.commit}\trefs/heads/main\n`, stderr: "" };
    return runCommand(executable, args, options);
  };
  let unitActive = true;
  const system = {
    async daemonReload() { systemCalls.push("reload"); return { code: 0, stdout: "", stderr: "" }; },
    async unitState() { return { load: "loaded", active: unitActive ? "active" : "inactive", sub: unitActive ? "running" : "dead", pid: unitActive ? 123 : null }; },
    async stop() { systemCalls.push("stop"); unitActive = false; return { code: 0, stdout: "", stderr: "" }; },
  };
  let output = "";
  const context = { env: s.env, home: s.home, xdg: s.xdg, nodePath: process.execPath, runCommand: fakeRun, system,
    probeService: async () => ({ state: "stopped" }), out: (line) => { output += `${line}\n`; } };
  const buildRelease = async ({ repo }) => {
    builds++;
    assert.equal(path.basename(repo).startsWith(".stage-"), true, "the image context is the materialized release tree");
    assert.equal(command("git", ["-C", repo, "status", "--porcelain", "--untracked-files=no"]), "", "the archive export is the exact clean commit");
    return createManifest({ packageName: "storybench", packageVersion: "0.1.0", commit: s.commit, ref: "HEAD",
      images: { app: APP, worker: WORKER }, tools: {}, schema: { min: 0, max: SCHEMA_VERSION } });
  };
  const metadata = { source: s.source, commit: s.commit, remote: s.remote, ref: "main", dockerVersion: "29.7.2" };
  const cleanHelp = spawnSync(process.execPath, [path.join(s.source, "bin", "storybench.mjs"), "__install", "--help"], { env: s.env, encoding: "utf8" });
  assert.equal(cleanHelp.status, 0, cleanHelp.stderr);
  assert.match(cleanHelp.stdout, /Internal exact-release installer handoff/);
  assert.equal(await installFromSource(context, metadata, { runCommand: fakeRun, buildRelease }), 0);
  assert.equal(builds, 1);
  assert.equal(realpath(s.xdg.current), path.join(s.xdg.releases, s.commit));
  assert.equal(statSync(s.xdg.executable).mode & 0o777, 0o755);
  const unitText = readFileSync(path.join(s.env.STORYBENCH_UNIT_DIR, s.env.STORYBENCH_UNIT_NAME), "utf8");
  assert.match(unitText, new RegExp(`^WorkingDirectory=${path.join(s.xdg.releases, s.commit)}$`, "m"));
  assert.match(unitText, /^Environment="DOCKER_HOST=unix:\/\/\/run\/user\/1000\/docker\.sock"$/m);
  const installed = await readReleaseManifest(path.join(s.xdg.releases, s.commit, "manifest.json"));
  assert.equal(installed.ok, true);
  assert.deepEqual({ remote: installed.manifest.source.remote, ref: installed.manifest.source.ref }, { remote: s.remote, ref: "main" });
  assert.equal(installed.manifest.images.app.id, APP);
  assert.equal(installed.manifest.images.worker.id, WORKER);
  assert.match(installed.manifest.images.app.base, /^node:24-/);
  assert.equal(installed.manifest.database.supportedSchema.max, SCHEMA_VERSION);
  const receipt = readInstallReceipt(path.join(s.xdg.releases, s.commit, "install.json"), installed.manifest);
  assert.equal(receipt.ok, true);
  assert.equal(receipt.receipt.packageVersion, "0.1.0");
  assert.deepEqual(receipt.receipt.source, { remote: s.remote, ref: "main" });
  assert.match(output, /Next: `storybench init \[DIR\]`, then `storybench up`/);
  const tracked = [path.join(s.xdg.releases, s.commit, "manifest.json"), s.xdg.current, s.xdg.executable, path.join(s.env.STORYBENCH_UNIT_DIR, s.env.STORYBENCH_UNIT_NAME)];
  const times = tracked.map((file) => lstatSync(file).mtimeMs);
  output = "";
  assert.equal(await installFromSource(context, metadata, { runCommand: fakeRun, buildRelease }), 0);
  assert.equal(builds, 1, "the same commit and manifest do not rebuild images");
  assert.deepEqual(tracked.map((file) => lstatSync(file).mtimeMs), times, "idempotent rerun changes no installation file");
  assert.match(output, /Already installed/);

  const root = path.join(s.home, "creator-data");
  const initialized = initDataRoot(root);
  writeFileSync(path.join(root, "sentinel"), "keep");
  writeConfigAtomic(s.xdg.configFile, { version: 1, dataRoot: root, dataRootId: initialized.identity.id, port: 18842, installId: "sb-test",
    credentials: { codex: path.join(s.home, ".codex", "auth.json"), claude: path.join(s.home, ".claude", ".credentials.json") } });
  mkdirSync(path.join(s.home, ".codex"), { recursive: true });
  mkdirSync(path.join(s.home, ".claude"), { recursive: true });
  writeFileSync(path.join(s.home, ".codex", "auth.json"), JSON.stringify({ OPENAI_API_KEY: "fixture-only" }), { mode: 0o600 });
  writeFileSync(path.join(s.home, ".claude", ".credentials.json"), JSON.stringify({ claudeAiOauth: { accessToken: "fixture-only" } }), { mode: 0o600 });
  mkdirSync(path.join(s.xdg.state, "backups"), { recursive: true });
  mkdirSync(path.join(s.xdg.state, "harnesses", "codex"), { recursive: true });
  writeFileSync(path.join(s.xdg.state, "backups", "sentinel"), "keep");
  s.env.STORYBENCH_RELEASE_MANIFEST = path.join(s.xdg.current, "manifest.json");
  let stdout = "", stderr = "";
  let code = await main(["doctor"], { env: s.env, home: s.home, system, runCommand: fakeRun, probeService: async () => ({ state: "stopped" }),
    stdout: { write: (text) => { stdout += text; } }, stderr: { write: (text) => { stderr += text; } } });
  assert.equal(code, 0, `${stdout}\n${stderr}`);
  for (const label of ["release manifest", "install receipt", "source access", "app image", "worker image", "data root", "codex production", "claude production", "editor readiness"])
    assert.match(stdout, new RegExp(`PASS ${label}`));
  assert.doesNotMatch(stdout, /fixture-only/, "doctor never prints credential content");

  stdout = ""; stderr = "";
  code = await main(["uninstall", "--yes"], { env: s.env, home: s.home, system, runCommand: fakeRun,
    stdout: { write: (text) => { stdout += text; } }, stderr: { write: (text) => { stderr += text; } } });
  assert.equal(code, 0, stderr);
  for (const removed of [s.xdg.executable, s.xdg.current, s.xdg.mirror, s.xdg.releases, path.join(s.env.STORYBENCH_UNIT_DIR, s.env.STORYBENCH_UNIT_NAME)])
    assert.equal(existsSync(removed), false, removed);
  for (const kept of [s.xdg.configFile, path.join(root, "sentinel"), path.join(s.xdg.state, "backups", "sentinel"), path.join(s.xdg.state, "harnesses"), path.join(s.home, ".codex", "auth.json"), path.join(s.home, ".claude", ".credentials.json")])
    assert.equal(existsSync(kept), true, kept);
  assert.deepEqual(systemCalls, ["reload", "stop", "reload"]);
  assert.ok(calls.some((call) => call.includes(`label=io.storybench.install=sb-test`)), "only the configured installation label is removed");
  assert.ok(!calls.some((call) => call[0] === "docker" && call[1] === "system"), "no global Docker prune/system operation");
});

test("install.sh refuses root and unsupported platforms before mutation", (t) => {
  const bin = mkdtempSync(path.join(os.tmpdir(), "storybench-install-refusal-"));
  t.after(() => rmSync(bin, { recursive: true, force: true }));
  const script = (name, body) => writeFileSync(path.join(bin, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  script("id", "echo 0");
  let result = spawnSync("bash", [path.join(REPO, "install.sh")], { env: { ...process.env, PATH: `${bin}:/usr/bin:/bin` }, encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /refusing to install as root/);
  script("id", "echo 1000"); script("uname", "echo Darwin");
  result = spawnSync("bash", [path.join(REPO, "install.sh")], { env: { ...process.env, PATH: `${bin}:/usr/bin:/bin` }, encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /unsupported platform Darwin/);
});

function realpath(file) {
  return path.resolve(path.dirname(file), readlinkSync(file));
}

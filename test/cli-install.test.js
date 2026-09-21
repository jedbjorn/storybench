import test from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createManifest, readReleaseManifest } from "../src/runtime/manifest.js";
import { SCHEMA_VERSION } from "../src/store.js";
import { initDataRoot } from "../src/services/data-root.js";
import { writeConfigAtomic } from "../src/cli/config.js";
import { activateSymlink, installFromSource, launcherText, readInstallReceipt } from "../src/cli/install.js";
import { acquireLock } from "../src/cli/lock.js";
import { main } from "../src/cli/main.js";
import { nonInteractiveGitEnv, runCommand } from "../src/cli/system.js";
import { resolveXdg } from "../src/cli/xdg.js";
import { ensureInstallationId } from "../src/cli/installation.js";
import { removeImagesIfUnused } from "../src/cli/images.js";
import { imageBuildLabels, imageBuildTag } from "../src/runtime/release.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APP = `sha256:${"a".repeat(64)}`;
const WORKER = `sha256:${"b".repeat(64)}`;
const ORPHAN = `sha256:${"e".repeat(64)}`;

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
  const calls = [], callRecords = [], systemCalls = [];
  let builds = 0;
  let missingImageInspects = 0;
  let failPointerVerification = false;
  let buildInstallId;
  let rootlessDocker = true;
  const fakeRun = async (executable, args, options = {}) => {
    calls.push([executable, ...args]);
    callRecords.push({ executable, args, options });
    if (executable === "docker") {
      if (args[0] === "image" && args[1] === "ls") return { code: 0, stdout: `${ORPHAN}\n`, stderr: "" };
      if (args[0] === "image" && args[1] === "inspect") {
        if (args.at(-1).includes(".Config.Labels")) return { code: 0, stdout: args[2] === ORPHAN ? `${buildInstallId}\n` : "\n", stderr: "" };
        if (missingImageInspects > 0) { missingImageInspects--; return { code: 1, stdout: "", stderr: "missing" }; }
        return { code: 0, stdout: `${args[2]}\n`, stderr: "" };
      }
      if (args[0] === "info" && args.includes("{{json .SecurityOptions}}"))
        return { code: 0, stdout: rootlessDocker ? '["name=seccomp","name=rootless"]\n' : '["name=seccomp"]\n', stderr: "" };
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
        if (args.includes(`label=io.storybench.install=${buildInstallId}`)) return { code: 0, stdout: "owned-container\n", stderr: "" };
        return { code: 0, stdout: "", stderr: "" };
      }
      if (args[0] === "network" && args[1] === "ls") return { code: 0, stdout: "", stderr: "" };
      return { code: 0, stdout: "", stderr: "" };
    }
    if (executable === "node" && args[0] === "--version") return { code: 0, stdout: "v24.21.0\n", stderr: "" };
    if (executable === "git" && args[0] === "--version") return { code: 0, stdout: "git version 2.51.0\n", stderr: "" };
    if (executable === "git" && args[0] === "ls-remote") return { code: 0, stdout: `${s.commit}\trefs/heads/main\n`, stderr: "" };
    if (failPointerVerification && executable === process.execPath && args[0] === path.join(s.xdg.current, "bin", "storybench.mjs"))
      return { code: 1, stdout: "", stderr: "verification fault" };
    return runCommand(executable, args, options);
  };
  let unitActive = false;
  let expectedActivationCommit = s.commit;
  const system = {
    async daemonReload() {
      systemCalls.push("reload");
      assert.equal(realpath(s.xdg.current), path.join(s.xdg.releases, expectedActivationCommit), "the release pointer is verified before daemon-reload");
      return { code: 0, stdout: "", stderr: "" };
    },
    async unitState() { return { load: "loaded", active: unitActive ? "active" : "inactive", sub: unitActive ? "running" : "dead", pid: unitActive ? 123 : null }; },
    async stop() { systemCalls.push("stop"); unitActive = false; return { code: 0, stdout: "", stderr: "" }; },
  };
  let output = "";
  let probeAnswer = { state: "stopped" };
  const context = { env: s.env, home: s.home, xdg: s.xdg, nodePath: process.execPath, runCommand: fakeRun, system,
    probeService: async () => probeAnswer, out: (line) => { output += `${line}\n`; } };
  const buildRelease = async ({ repo, installId }) => {
    builds++;
    if (buildInstallId) assert.equal(installId, buildInstallId, "re-staging reuses the installation identity");
    else buildInstallId = installId;
    assert.match(installId, /^sb[0-9a-f]{10}$/);
    assert.equal(path.basename(repo).startsWith(".stage-"), true, "the image context is the materialized release tree");
    assert.equal(command("git", ["-C", repo, "status", "--porcelain", "--untracked-files=no"]), "", "the archive export is the exact clean commit");
    const commit = command("git", ["-C", repo, "rev-parse", "HEAD"]);
    return createManifest({ packageName: "storybench", packageVersion: "0.1.0", commit, ref: "HEAD",
      images: { app: APP, worker: WORKER }, tools: { node: "v24.21.0", ffmpeg: "7", codex: "0.155.1" }, schema: { min: 0, max: SCHEMA_VERSION } });
  };
  const metadata = { source: s.source, commit: s.commit, remote: s.remote, ref: "main", dockerVersion: "29.7.2" };
  const cleanHelp = spawnSync(process.execPath, [path.join(s.source, "bin", "storybench.mjs"), "__install", "--help"], { env: s.env, encoding: "utf8" });
  assert.equal(cleanHelp.status, 0, cleanHelp.stderr);
  assert.match(cleanHelp.stdout, /Internal exact-release installer handoff/);
  failPointerVerification = true;
  await assert.rejects(installFromSource(context, metadata, { runCommand: fakeRun, buildRelease }), /previous release pointer was restored/);
  failPointerVerification = false;
  assert.equal(existsSync(s.xdg.current), false);
  assert.equal(existsSync(s.xdg.executable), false, "launcher is not written before pointer verification");
  assert.equal(existsSync(path.join(s.env.STORYBENCH_UNIT_DIR, s.env.STORYBENCH_UNIT_NAME)), false, "unit is not written before pointer verification");
  assert.deepEqual(systemCalls, []);
  assert.equal(await installFromSource(context, metadata, { runCommand: fakeRun, buildRelease }), 0);
  assert.equal(builds, 1);
  assert.equal(realpath(s.xdg.current), path.join(s.xdg.releases, s.commit));
  assert.equal(statSync(s.xdg.executable).mode & 0o777, 0o755);
  assert.equal(statSync(s.xdg.bin).mode & 0o777, 0o755);
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
  assert.deepEqual(installed.manifest.runtime.tools, { node: "v24.21.0", ffmpeg: "7", codex: "0.155.1" }, "the release's flat tool versions are preserved");
  assert.equal(Object.hasOwn(installed.manifest.runtime.tools, "app"), false);
  const receipt = readInstallReceipt(path.join(s.xdg.releases, s.commit, "install.json"), installed.manifest);
  assert.equal(receipt.ok, true);
  assert.equal(receipt.receipt.packageVersion, "0.1.0");
  assert.equal(receipt.receipt.installationId, buildInstallId);
  assert.deepEqual(receipt.receipt.source, { remote: s.remote, ref: "main" });
  assert.deepEqual(Object.keys(receipt.receipt.tools).sort(), ["app", "worker"], "per-role probes live only in the install receipt");
  assert.match(output, /Next: `storybench init \[DIR\]`, then `storybench up`/);

  // A same-commit rebuild must not retire the live WorkingDirectory while its unit is active.
  missingImageInspects = 1;
  unitActive = true;
  await assert.rejects(installFromSource(context, metadata, { runCommand: fakeRun, buildRelease }), /Cannot replace the active release directory while .* is active/);
  assert.equal(builds, 1, "the active release is refused before rebuilding");
  assert.equal(realpath(s.xdg.current), path.join(s.xdg.releases, s.commit));
  assert.deepEqual(readdirSync(s.xdg.releases).filter((name) => name.includes(".retired-")), []);
  unitActive = false;

  // Once stopped, the active commit can be rebuilt with retire-then-promote staging.
  missingImageInspects = 1;
  let retiredObserved = false;
  output = "";
  assert.equal(await installFromSource(context, metadata, { runCommand: fakeRun, buildRelease,
    afterRetire: ({ final, retired }) => {
      retiredObserved = true;
      assert.equal(final, path.join(s.xdg.releases, s.commit));
      assert.equal(existsSync(final), false);
      assert.equal(existsSync(path.join(retired, "manifest.json")), true);
      assert.equal(readlinkSync(s.xdg.current), final, "the current pointer itself is never deleted or rewritten");
    } }), 0);
  assert.equal(retiredObserved, true);
  assert.equal(builds, 2);
  assert.deepEqual(readdirSync(s.xdg.releases).filter((name) => name.includes(".retired-")), []);
  assert.equal(readFileSync(path.join(s.xdg.releases, s.commit, "manifest.json"), "utf8").includes(s.commit), true);

  const tracked = [path.join(s.xdg.releases, s.commit, "manifest.json"), s.xdg.current, s.xdg.executable, path.join(s.env.STORYBENCH_UNIT_DIR, s.env.STORYBENCH_UNIT_NAME)];
  const times = tracked.map((file) => lstatSync(file).mtimeMs);
  output = "";
  assert.equal(await installFromSource(context, metadata, { runCommand: fakeRun, buildRelease }), 0);
  assert.equal(builds, 2, "the same commit and manifest do not rebuild images");
  assert.deepEqual(tracked.map((file) => lstatSync(file).mtimeMs), times, "idempotent rerun changes no installation file");
  assert.match(output, /Already installed/);

  const root = path.join(s.home, "creator-data");
  const initialized = initDataRoot(root);
  writeFileSync(path.join(root, "sentinel"), "keep");
  writeConfigAtomic(s.xdg.configFile, { version: 1, dataRoot: root, dataRootId: initialized.identity.id, port: 18842, installId: buildInstallId,
    credentials: { codex: path.join(s.home, ".codex", "auth.json"), claude: path.join(s.home, ".claude", ".credentials.json") } });
  mkdirSync(path.join(s.home, ".codex"), { recursive: true });
  mkdirSync(path.join(s.home, ".claude"), { recursive: true });
  writeFileSync(path.join(s.home, ".codex", "auth.json"), JSON.stringify({ OPENAI_API_KEY: "fixture-only" }), { mode: 0o600 });
  writeFileSync(path.join(s.home, ".claude", ".credentials.json"), JSON.stringify({ claudeAiOauth: { accessToken: "fixture-only" } }), { mode: 0o600 });
  mkdirSync(path.join(s.xdg.state, "backups"), { recursive: true });
  mkdirSync(path.join(s.xdg.state, "harnesses", "codex"), { recursive: true });
  writeFileSync(path.join(s.xdg.state, "backups", "sentinel"), "keep");

  // A clean new commit may stage while running, but neither an active unit nor a responding app may move current.
  writeFileSync(path.join(s.source, "installer-second-commit.txt"), "second release\n");
  command("git", ["-C", s.source, "add", "installer-second-commit.txt"]);
  command("git", ["-C", s.source, "commit", "-m", "second fixture"]);
  command("git", ["-C", s.source, "push", "origin", "main"]);
  const secondCommit = command("git", ["-C", s.source, "rev-parse", "HEAD"]);
  const secondMetadata = { ...metadata, commit: secondCommit, ref: `commit/${secondCommit}` };
  unitActive = true;
  await assert.rejects(installFromSource(context, secondMetadata, { runCommand: fakeRun, buildRelease }), (error) => {
    assert.match(error.message, /Cannot activate the staged release while .* is active/);
    assert.match(error.hint, /storybench down.*staged in-place updates.*storybench update/);
    return true;
  });
  assert.equal(realpath(s.xdg.current), path.join(s.xdg.releases, s.commit));
  assert.match(readFileSync(path.join(s.env.STORYBENCH_UNIT_DIR, s.env.STORYBENCH_UNIT_NAME), "utf8"), new RegExp(s.commit));
  unitActive = false;
  probeAnswer = { state: "running", health: {}, dataRootId: initialized.identity.id, schemaVersion: SCHEMA_VERSION };
  await assert.rejects(installFromSource(context, secondMetadata, { runCommand: fakeRun, buildRelease }), (error) => {
    assert.match(error.message, /Storybench app is answering/);
    assert.match(error.hint, /storybench down.*storybench update/);
    return true;
  });
  assert.equal(realpath(s.xdg.current), path.join(s.xdg.releases, s.commit));
  probeAnswer = { state: "stopped" };
  expectedActivationCommit = secondCommit;
  output = "";
  assert.equal(await installFromSource(context, secondMetadata, { runCommand: fakeRun, buildRelease }), 0);
  assert.equal(realpath(s.xdg.current), path.join(s.xdg.releases, secondCommit));
  assert.match(output, /Next: `storybench up`/);
  assert.doesNotMatch(output, /storybench init/);

  s.env.STORYBENCH_RELEASE_MANIFEST = path.join(s.xdg.current, "manifest.json");
  const activeRelease = await readReleaseManifest(s.env.STORYBENCH_RELEASE_MANIFEST);
  assert.equal(activeRelease.ok, true);
  unitActive = true;
  let stdout = "", stderr = "";
  let code = await main(["doctor"], { env: s.env, home: s.home, system, runCommand: fakeRun, probeService: async () => ({
    state: "running", dataRootId: initialized.identity.id, schemaVersion: SCHEMA_VERSION,
    health: { status: "ready", ready: true, database: { id: initialized.identity.id },
      schema: { current: SCHEMA_VERSION, supported: { min: 0, max: SCHEMA_VERSION } }, release: activeRelease.identity },
  }),
    stdout: { write: (text) => { stdout += text; } }, stderr: { write: (text) => { stderr += text; } } });
  assert.equal(code, 0, `${stdout}\n${stderr}`);
  for (const label of ["release manifest", "install receipt", "source access", "app image", "worker image", "data root", "codex production", "claude production", "editor readiness"])
    assert.match(stdout, new RegExp(`PASS ${label}`));
  assert.match(stdout, /PASS health: healthy/);
  assert.doesNotMatch(stdout, /FAIL health/);
  assert.doesNotMatch(stdout, /fixture-only/, "doctor never prints credential content");
  rootlessDocker = false; stdout = ""; stderr = "";
  code = await main(["doctor"], { env: s.env, home: s.home, system, runCommand: fakeRun, probeService: async () => ({ state: "stopped" }),
    stdout: { write: (text) => { stdout += text; } }, stderr: { write: (text) => { stderr += text; } } });
  assert.equal(code, 1);
  assert.match(stdout, /FAIL Docker rootless: the selected daemon must report name=rootless/);
  rootlessDocker = true;
  const sourceCheck = callRecords.findLast((call) => call.executable === "git" && call.args[0] === "ls-remote");
  assert.equal(sourceCheck.args.at(-1), "HEAD", "detached commit refs probe a real remote ref");
  assert.equal(sourceCheck.options.env.GIT_TERMINAL_PROMPT, "0");
  assert.equal(sourceCheck.options.env.GIT_SSH_COMMAND, "ssh -oBatchMode=yes");
  for (const call of callRecords.filter((value) => value.executable === "git")) {
    assert.equal(call.options.env.GIT_TERMINAL_PROMPT, "0", call.args.join(" "));
    assert.equal(call.options.env.GIT_SSH_COMMAND, "ssh -oBatchMode=yes", call.args.join(" "));
  }

  const held = await acquireLock(s.xdg.lockDir, { operation: "test uninstall guard" });
  stdout = ""; stderr = "";
  code = await main(["uninstall", "--yes"], { env: s.env, home: s.home, system, runCommand: fakeRun, lockTimeoutMs: 50,
    stdout: { write: (text) => { stdout += text; } }, stderr: { write: (text) => { stderr += text; } } });
  assert.equal(code, 1);
  assert.match(stderr, /holds the installation lock/);
  assert.equal(existsSync(s.xdg.current), true, "locked uninstall removes nothing");
  held();
  stdout = ""; stderr = "";
  code = await main(["uninstall", "--yes"], { env: s.env, home: s.home, system, runCommand: fakeRun,
    stdout: { write: (text) => { stdout += text; } }, stderr: { write: (text) => { stderr += text; } } });
  assert.equal(code, 0, stderr);
  for (const removed of [s.xdg.executable, s.xdg.current, s.xdg.mirror, s.xdg.releases, path.join(s.env.STORYBENCH_UNIT_DIR, s.env.STORYBENCH_UNIT_NAME)])
    assert.equal(existsSync(removed), false, removed);
  for (const kept of [s.xdg.configFile, path.join(root, "sentinel"), path.join(s.xdg.state, "backups", "sentinel"), path.join(s.xdg.state, "harnesses"), path.join(s.home, ".codex", "auth.json"), path.join(s.home, ".claude", ".credentials.json")])
    assert.equal(existsSync(kept), true, kept);
  assert.deepEqual(systemCalls, ["reload", "reload", "stop", "reload"]);
  assert.ok(calls.some((call) => call.includes(`label=io.storybench.install=${buildInstallId}`)), "only the configured installation label is removed");
  assert.ok(calls.some((call) => call[0] === "docker" && call[1] === "image" && call[2] === "rm" && call[3] === ORPHAN), "orphaned installation-labeled images are removed");
  assert.ok(!calls.some((call) => call[0] === "docker" && call[1] === "system"), "no global Docker prune/system operation");
});

test("per-install image labels keep another installation's identical commit images", async (t) => {
  const base = mkdtempSync(path.join(os.tmpdir(), "storybench-image-owner-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const xdgA = resolveXdg({ env: { HOME: path.join(base, "a"), XDG_DATA_HOME: path.join(base, "a-data") }, home: path.join(base, "a") });
  const xdgB = resolveXdg({ env: { HOME: path.join(base, "b"), XDG_DATA_HOME: path.join(base, "b-data") }, home: path.join(base, "b") });
  const a = ensureInstallationId(xdgA), b = ensureInstallationId(xdgB);
  assert.notEqual(a, b);
  const commit = "1".repeat(40);
  assert.ok(imageBuildLabels(commit, a).includes(`io.storybench.install=${a}`));
  assert.ok(imageBuildLabels(commit, b).includes(`io.storybench.install=${b}`));
  assert.notEqual(imageBuildTag("storybench", "app", commit, a), imageBuildTag("storybench", "app", commit, b),
    "one installation's build cannot retag the other's image");

  const removed = [], owner = new Map([[APP, a], [WORKER, b]]);
  const run = async (_command, args) => {
    if (args[0] === "ps") return { code: 0, stdout: "", stderr: "" };
    if (args[0] === "image" && args[1] === "inspect") return { code: 0, stdout: `${owner.get(args[2]) ?? ""}\n`, stderr: "" };
    if (args[0] === "image" && args[1] === "rm") { removed.push(args[2]); return { code: 0, stdout: "", stderr: "" }; }
    throw new Error(`unexpected docker call: ${args.join(" ")}`);
  };
  await removeImagesIfUnused(run, [APP, WORKER], { installId: a, env: {} });
  assert.deepEqual(removed, [APP], "installation A cannot remove installation B's image");
});

test("non-interactive Git preserves an existing SSH command", () => {
  const env = nonInteractiveGitEnv({ GIT_SSH_COMMAND: "ssh -F /tmp/fixture-config" });
  assert.equal(env.GIT_TERMINAL_PROMPT, "0");
  assert.equal(env.GIT_SSH_COMMAND, "ssh -F /tmp/fixture-config -oBatchMode=yes");
});

test("version exits quietly when a pipeline closes stdout", () => {
  const result = spawnSync("bash", ["-o", "pipefail", "-c", `${JSON.stringify(process.execPath)} ${JSON.stringify(path.join(REPO, "bin", "storybench.mjs"))} version | head -n 1 >/dev/null`], {
    cwd: REPO, env: process.env, encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
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

test("install.sh refuses a rootful Docker daemon during preflight", (t) => {
  const bin = mkdtempSync(path.join(os.tmpdir(), "storybench-install-rootless-"));
  t.after(() => rmSync(bin, { recursive: true, force: true }));
  const script = (name, body) => writeFileSync(path.join(bin, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  script("id", "echo 1000");
  script("uname", "echo Linux");
  script("node", "echo v24.21.0");
  script("git", `case "$*" in
    *"rev-parse --show-toplevel"*) printf '%s\\n' "$STUB_REPO" ;;
    *"status --porcelain"*) ;;
    *"rev-parse HEAD"*) printf '%040d\\n' 1 ;;
    *"remote get-url origin"*) echo https://example.invalid/storybench.git ;;
    *"symbolic-ref --quiet --short HEAD"*) echo main ;;
    *) exit 1 ;;
  esac`);
  script("docker", `case "$*" in
    *"{{.ServerVersion}}"*) echo 29.7.2 ;;
    *"{{.DockerRootDir}}"*) echo /tmp/storybench-docker-root ;;
    *"{{json .SecurityOptions}}"*) echo '["name=seccomp"]' ;;
    *) exit 1 ;;
  esac`);
  const result = spawnSync("bash", [path.join(REPO, "install.sh")], {
    env: { ...process.env, STUB_REPO: REPO, PATH: `${bin}:/usr/bin:/bin` }, encoding: "utf8",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /rootless Docker is required/);
  assert.match(result.stderr, /Hint: configure and select a rootless Docker daemon/);
});

function realpath(file) {
  return path.resolve(path.dirname(file), readlinkSync(file));
}

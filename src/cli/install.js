// Exact-commit installation and release staging. The shell bootstrap only checks the host and
// passes immutable source facts here; this module owns every installation mutation.
import crypto from "node:crypto";
import {
  chmodSync, closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync,
  readlinkSync, renameSync, rmSync, symlinkSync, writeFileSync, writeSync,
} from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readReleaseManifest } from "../runtime/manifest.js";
import { CliError, EXIT } from "./errors.js";
import { ensurePrivateDirectory } from "./fs-safety.js";
import { withLock } from "./lock.js";
import { runCommand } from "./system.js";
import { generateUnit, unitName, writeUnitAtomic } from "./unit.js";

const COMMIT = /^[0-9a-f]{40}$/;
const MIN_FREE_BYTES = 5 * 1024 * 1024 * 1024;

function firstLine(value) { return String(value || "").trim().split("\n")[0]; }

function validateSourceFacts(metadata) {
  if (!path.isAbsolute(metadata.source) || !COMMIT.test(metadata.commit) || typeof metadata.remote !== "string" || !metadata.remote || typeof metadata.ref !== "string" || !metadata.ref)
    throw new CliError("The installer received incomplete source metadata");
  if (metadata.remote.length > 4096 || metadata.ref.length > 1024 || /[\0\r\n]/.test(`${metadata.remote}${metadata.ref}`))
    throw new CliError("The source remote/ref cannot be recorded safely");
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(metadata.remote)) {
    let parsed;
    try { parsed = new URL(metadata.remote); } catch { throw new CliError("The source origin URL is not valid"); }
    if (parsed.username || parsed.password || parsed.search || parsed.hash)
      throw new CliError("The source origin URL contains embedded credentials or parameters", { hint: "Use a credential helper or SSH configuration, then set origin to a credential-free URL." });
  }
}

async function checked(run, command, args, options = {}) {
  const result = await run(command, args, options);
  if (result.code !== 0) throw new CliError(`${command} ${args[0] || ""} failed: ${firstLine(result.stderr) || `exit ${result.code}`}`);
  return result.stdout.trim();
}

export function releasePath(xdg, commit) {
  if (!COMMIT.test(commit)) throw new CliError("The installer commit must be a full lowercase Git object ID");
  return path.join(xdg.releases, commit);
}

export function launcherText(node, current) {
  const quote = (value) => `'${value.replaceAll("'", `'\\''`)}'`;
  return `#!/bin/sh\nexec ${quote(node)} ${quote(path.join(current, "bin", "storybench.mjs"))} "$@"\n`;
}

function writeAtomic(file, content, mode = 0o600) {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  try {
    if (readFileSync(file, "utf8") === content) return false;
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  let descriptor = openSync(temporary, "wx", mode);
  try {
    writeSync(descriptor, content); fsyncSync(descriptor); closeSync(descriptor); descriptor = null;
    renameSync(temporary, file);
    const directory = openSync(path.dirname(file), "r");
    try { fsyncSync(directory); } finally { closeSync(directory); }
  } catch (error) {
    if (descriptor != null) closeSync(descriptor);
    rmSync(temporary, { force: true });
    throw error;
  }
  chmodSync(file, mode);
  return true;
}

export function activateSymlink(current, release) {
  try {
    if (lstatSync(current).isSymbolicLink() && path.resolve(path.dirname(current), readlinkSync(current)) === path.resolve(release)) return false;
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  mkdirSync(path.dirname(current), { recursive: true, mode: 0o700 });
  const temporary = path.join(path.dirname(current), `.current.${process.pid}.${crypto.randomUUID()}.tmp`);
  symlinkSync(release, temporary);
  try { renameSync(temporary, current); }
  catch (error) { rmSync(temporary, { force: true }); throw error; }
  return true;
}

async function imagesPresent(run, manifest) {
  for (const role of ["app", "worker"]) {
    const result = await run("docker", ["image", "inspect", manifest.images[role].id, "--format", "{{.Id}}"], { timeoutMs: 30_000 });
    if (result.code !== 0 || result.stdout.trim() !== manifest.images[role].id) return false;
  }
  return true;
}

export async function reusableRelease(file, commit, run = runCommand) {
  const found = await readReleaseManifest(file);
  return found.ok && found.manifest.source.commit === commit && await imagesPresent(run, found.manifest) ? found.manifest : null;
}

export function readInstallReceipt(file, manifest = null) {
  let value;
  try { value = JSON.parse(readFileSync(file, "utf8")); }
  catch (error) { return { ok: false, reason: error.code === "ENOENT" ? "No install receipt is present" : "The install receipt is not valid JSON" }; }
  if (value?.schema !== "storybench.install/1" || !COMMIT.test(value.commit ?? "") || !Number.isFinite(Date.parse(value.installedAt ?? "")))
    return { ok: false, reason: "The install receipt has invalid identity or time fields" };
  if (manifest && (value.commit !== manifest.source.commit || value.manifestId !== manifest.id || value.images?.app !== manifest.images.app.id || value.images?.worker !== manifest.images.worker.id))
    return { ok: false, reason: "The install receipt does not match the release manifest" };
  return { ok: true, receipt: value };
}

async function seedMirror(run, source, mirror, remote) {
  if (!existsSync(mirror)) await checked(run, "git", ["clone", "--mirror", "--no-hardlinks", source, mirror], { timeoutMs: 120_000 });
  const current = await checked(run, "git", ["--git-dir", mirror, "remote", "get-url", "origin"]).catch(() => "");
  if (current !== remote) await checked(run, "git", ["--git-dir", mirror, "remote", "set-url", "origin", remote]);
}

async function materialize(run, mirror, commit, stage) {
  mkdirSync(stage, { recursive: false, mode: 0o700 });
  const archive = path.join(path.dirname(stage), `.${commit}.archive.${crypto.randomUUID()}.tar`);
  try {
    await checked(run, "git", ["--git-dir", mirror, "archive", "--format=tar", "--output", archive, commit], { timeoutMs: 120_000 });
    await checked(run, "tar", ["-xf", archive, "-C", stage], { timeoutMs: 120_000 });
  } finally { rmSync(archive, { force: true }); }
}

async function attachDetachedMetadata(run, mirror, commit, stage) {
  const metadata = path.join(path.dirname(stage), `.git-${commit}.${crypto.randomUUID()}`);
  await checked(run, "git", ["init", "--quiet", metadata]);
  await checked(run, "git", ["-C", metadata, "fetch", "--quiet", "--no-tags", mirror, commit], { timeoutMs: 120_000 });
  await checked(run, "git", ["-C", metadata, "update-ref", "--no-deref", "HEAD", commit]);
  await checked(run, "git", ["-C", metadata, "read-tree", commit]);
  await checked(run, "git", ["-C", metadata, "config", "core.worktree", stage]);
  writeFileSync(path.join(stage, ".git"), `gitdir: ${path.join(metadata, ".git")}\n`, { mode: 0o600 });
  return () => { rmSync(path.join(stage, ".git"), { force: true }); rmSync(metadata, { recursive: true, force: true }); };
}

function parseProbe(stdout) {
  return Object.fromEntries(stdout.trim().split("\n").map((line) => line.split(/=(.*)/s, 2)).filter(([key, value]) => key && value));
}

async function probeImage(run, image, role) {
  const script = role === "worker"
    ? "printf 'node='; node --version; printf 'ffmpeg='; ffmpeg -version | head -1; printf 'ffprobe='; ffprobe -version | head -1; printf 'codex='; codex --version; printf 'claude='; claude --version"
    : "printf 'node='; node --version; printf 'ffmpeg='; ffmpeg -version | head -1; printf 'ffprobe='; ffprobe -version | head -1";
  const result = await run("docker", ["run", "--rm", "--network", "none", image, "sh", "-c", script], { timeoutMs: 120_000 });
  if (result.code !== 0) throw new CliError(`The ${role} image failed its packaged-binary verification: ${firstLine(result.stderr) || `exit ${result.code}`}`);
  const tools = parseProbe(result.stdout);
  if (!/^v(2[4-9]|[3-9]\d)\./.test(tools.node || "") || !tools.ffmpeg || !tools.ffprobe || (role === "worker" && (!tools.codex || !tools.claude)))
    throw new CliError(`The ${role} image does not contain the required Node 24+, ffmpeg/ffprobe${role === "worker" ? ", Codex and Claude" : ""} binaries`);
  return tools;
}

function nodeBaseIdentity(stage) {
  const dockerfile = readFileSync(path.join(stage, "docker", "Dockerfile"), "utf8");
  return /^ARG NODE_IMAGE=(\S+)$/m.exec(dockerfile)?.[1] ?? "unknown";
}

export async function stageRelease(context, metadata, adapters = {}) {
  const run = adapters.runCommand ?? context.runCommand ?? runCommand;
  const final = releasePath(context.xdg, metadata.commit);
  const manifestFile = path.join(final, "manifest.json");
  const reusable = await reusableRelease(manifestFile, metadata.commit, run);
  if (reusable) return { release: final, manifest: reusable, reused: true };
  const stage = path.join(context.xdg.releases, `.stage-${metadata.commit}.${crypto.randomUUID()}`);
  await materialize(run, context.xdg.mirror, metadata.commit, stage);
  let detach = () => {};
  try {
    detach = await attachDetachedMetadata(run, context.xdg.mirror, metadata.commit, stage);
    await checked(run, "npm", ["ci", "--omit=dev", "--ignore-scripts=false"], { cwd: stage, timeoutMs: 600_000 });
    const module = await import(`${pathToFileURL(path.join(stage, "src", "runtime", "release.js")).href}?install=${crypto.randomUUID()}`);
    const buildRelease = adapters.buildRelease ?? module.buildRelease;
    let manifest = await buildRelease({ repo: stage, tag: `storybench-${metadata.commit.slice(0, 12)}`, log: (line) => context.out(`  ${line}`) });
    const tools = {
      app: await probeImage(run, manifest.images.app.id, "app"),
      worker: await probeImage(run, manifest.images.worker.id, "worker"),
    };
    const manifestModule = await import(`${pathToFileURL(path.join(stage, "src", "runtime", "manifest.js")).href}?install=${crypto.randomUUID()}`);
    const installedAt = new Date().toISOString();
    const installer = { node: process.version, npm: firstLine(await checked(run, "npm", ["--version"])), git: firstLine(await checked(run, "git", ["--version"])), docker: metadata.dockerVersion ?? "unknown" };
    manifest = {
      ...manifest,
      source: { ...manifest.source, commit: metadata.commit, ref: metadata.ref, remote: metadata.remote },
      images: {
        app: { ...manifest.images.app, base: nodeBaseIdentity(stage) },
        worker: { ...manifest.images.worker, base: nodeBaseIdentity(stage) },
      },
      runtime: { ...manifest.runtime, tools },
    };
    manifest.id = manifestModule.manifestId(manifest);
    manifestModule.validateManifest(manifest);
    writeFileSync(path.join(stage, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
    const receipt = {
      schema: "storybench.install/1", installedAt, packageVersion: manifest.package.version, commit: metadata.commit,
      source: { remote: metadata.remote, ref: metadata.ref }, manifestId: manifest.id,
      supportedSchema: { ...manifest.database.supportedSchema },
      images: { app: manifest.images.app.id, worker: manifest.images.worker.id },
      baseImages: { app: manifest.images.app.base, worker: manifest.images.worker.base },
      tools, installer,
    };
    writeFileSync(path.join(stage, "install.json"), `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
    detach(); detach = () => {};
    if (existsSync(final)) rmSync(final, { recursive: true, force: true });
    renameSync(stage, final);
    return { release: final, manifest, reused: false };
  } catch (error) {
    rmSync(stage, { recursive: true, force: true });
    throw error;
  } finally { detach(); }
}

function unitFile(context) {
  const dir = context.env.STORYBENCH_UNIT_DIR ? path.resolve(context.env.STORYBENCH_UNIT_DIR) : path.join(path.dirname(context.xdg.config), "systemd", "user");
  return path.join(dir, unitName(context.env));
}

function installUnit(context) {
  const unit = unitName(context.env);
  const hostConfig = path.join(context.xdg.state, `host-${unit.replace(/\.service$/, "")}.json`);
  const content = generateUnit({
    node: context.nodePath ?? process.execPath,
    hostEntry: path.join(context.xdg.current, "src", "runtime", "host.js"),
    hostConfig,
    workingDirectory: context.xdg.current,
    environment: { PATH: [path.dirname(context.nodePath ?? process.execPath), "/usr/local/bin", "/usr/bin", "/bin"].filter((value, index, all) => all.indexOf(value) === index).join(":") },
  });
  return writeUnitAtomic(unitFile(context), content);
}

export async function installFromSource(context, metadata, adapters = {}) {
  const run = adapters.runCommand ?? context.runCommand ?? runCommand;
  if (typeof process.getuid === "function" && process.getuid() === 0) throw new CliError("Storybench must not be installed as root");
  if (process.platform !== "linux") throw new CliError(`Storybench installation supports Linux only (found ${process.platform})`);
  validateSourceFacts(metadata);
  const [head, status, remote] = await Promise.all([
    checked(run, "git", ["-C", metadata.source, "rev-parse", "HEAD"]),
    checked(run, "git", ["-C", metadata.source, "status", "--porcelain", "--untracked-files=all"]),
    checked(run, "git", ["-C", metadata.source, "remote", "get-url", "origin"]),
  ]);
  if (head !== metadata.commit) throw new CliError("The source checkout changed after installer preflight; retry ./install.sh");
  if (status) throw new CliError("The source checkout is not clean; commit, stash or remove every change before installing");
  if (remote !== metadata.remote) throw new CliError("The source origin changed after installer preflight; retry ./install.sh");
  return withLock(context.xdg.lockDir, "install", async () => {
  for (const directory of [context.xdg.share, context.xdg.releases, context.xdg.bin, context.xdg.state]) ensurePrivateDirectory(directory);
  await seedMirror(run, metadata.source, context.xdg.mirror, metadata.remote);
  if ((await run("git", ["--git-dir", context.xdg.mirror, "cat-file", "-e", `${metadata.commit}^{commit}`])).code !== 0)
    await checked(run, "git", ["--git-dir", context.xdg.mirror, "fetch", "--no-tags", metadata.source, metadata.commit], { timeoutMs: 120_000 });
  context.out(`Staging Storybench ${metadata.commit}...`);
  const staged = await stageRelease(context, metadata, adapters);
  const direct = await run(context.nodePath ?? process.execPath, [path.join(staged.release, "bin", "storybench.mjs"), "version"], {
    timeoutMs: 30_000, env: { ...context.env, STORYBENCH_RELEASE_MANIFEST: path.join(staged.release, "manifest.json") },
  });
  if (direct.code !== 0 || !direct.stdout.includes(metadata.commit)) throw new CliError("The staged Storybench CLI did not report its exact commit; activation was not changed");
  const launcherChanged = writeAtomic(context.xdg.executable, launcherText(context.nodePath ?? process.execPath, context.xdg.current), 0o755);
  const unitChanged = installUnit(context);
  if (unitChanged) {
    const result = await context.system.daemonReload();
    if (result.code !== 0) throw new CliError(`The systemd user manager could not reload units: ${firstLine(result.stderr) || `exit ${result.code}`}`);
  }
  let previous = null;
  try { if (lstatSync(context.xdg.current).isSymbolicLink()) previous = path.resolve(path.dirname(context.xdg.current), readlinkSync(context.xdg.current)); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  const pointerChanged = activateSymlink(context.xdg.current, staged.release);
  const verified = await run(context.xdg.executable, ["version"], { timeoutMs: 30_000, env: context.env });
  if (verified.code !== 0 || !verified.stdout.includes(metadata.commit)) {
    if (previous) activateSymlink(context.xdg.current, previous); else rmSync(context.xdg.current, { force: true });
    throw new CliError("The installed Storybench CLI did not report the staged commit; the previous release pointer was restored");
  }
  const pathReady = String(context.env.PATH || "").split(":").map((entry) => path.resolve(entry || ".")).includes(path.resolve(context.xdg.bin));
  context.out(`${staged.reused && !pointerChanged && !launcherChanged && !unitChanged ? "Already installed" : "Installed"}: ${staged.release}`);
  context.out(`Release: ${staged.manifest.id}\nImages: app ${staged.manifest.images.app.id}, worker ${staged.manifest.images.worker.id}`);
  context.out(pathReady ? `${context.xdg.bin} is on PATH.` : `PATH notice: add ${context.xdg.bin} to PATH in your preferred shell configuration.`);
  context.out("Next: `storybench init [DIR]`, then `storybench up`.");
  return EXIT.OK;
  }, { timeoutMs: context.lockTimeoutMs ?? 10_000 });
}

export function installerMinimumFreeBytes() { return MIN_FREE_BYTES; }

// Remove only installation-owned application material. User configuration, data roots,
// backups, native harness sessions and live provider credentials are deliberately untouched.
import { createInterface } from "node:readline/promises";
import { existsSync, readdirSync, readFileSync, rmSync, rmdirSync } from "node:fs";
import path from "node:path";
import { readReleaseManifest } from "../runtime/manifest.js";
import { readConfig } from "./config.js";
import { CliError, EXIT } from "./errors.js";
import { withLock } from "./lock.js";
import { runCommand } from "./system.js";
import { unitName } from "./unit.js";

function unitFile(context) {
  const dir = context.env.STORYBENCH_UNIT_DIR ? path.resolve(context.env.STORYBENCH_UNIT_DIR) : path.join(path.dirname(context.xdg.config), "systemd", "user");
  return path.join(dir, unitName(context.env));
}

async function confirm(context) {
  if (!process.stdin.isTTY) throw new CliError("Refusing non-interactive uninstall without --yes", { hint: "Run `storybench uninstall --yes` after reviewing what is preserved." });
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try { return /^y(es)?$/i.test((await prompt.question("Remove the Storybench application (preserving all user data and configuration)? [y/N] ")).trim()); }
  finally { prompt.close(); }
}

async function installedImages(xdg) {
  const images = new Set();
  if (!existsSync(xdg.releases)) return images;
  for (const name of readdirSync(xdg.releases)) {
    if (!/^[0-9a-f]{40}$/.test(name)) continue;
    const found = await readReleaseManifest(path.join(xdg.releases, name, "manifest.json"));
    if (found.ok) for (const role of ["app", "worker"]) images.add(found.manifest.images[role].id);
  }
  return images;
}

async function removeOwnedContainers(run, installId, env) {
  if (!installId) return 0;
  const listed = await run("docker", ["ps", "-a", "--no-trunc", "--filter", `label=io.storybench.install=${installId}`, "--format", "{{.ID}}"], { timeoutMs: 30_000, env });
  if (listed.code !== 0) throw new CliError("Cannot list installation-owned Docker containers; uninstall stopped before removing releases");
  const ids = listed.stdout.trim().split("\n").filter(Boolean);
  if (ids.length) {
    const removed = await run("docker", ["rm", "--force", "--volumes", ...ids], { timeoutMs: 120_000, env });
    if (removed.code !== 0) throw new CliError("Could not remove every installation-owned Docker container");
  }
  const networks = await run("docker", ["network", "ls", "--filter", `label=io.storybench.install=${installId}`, "--format", "{{.ID}}"], { timeoutMs: 30_000, env });
  if (networks.code === 0) for (const id of networks.stdout.trim().split("\n").filter(Boolean))
    await run("docker", ["network", "rm", id], { timeoutMs: 30_000, env });
  return ids.length;
}

export async function runUninstall(context, { options }) {
  return withLock(context.xdg.lockDir, "uninstall", async () => {
  if (!options.yes && !await confirm(context)) { context.out("Uninstall cancelled; nothing changed."); return EXIT.OK; }
  const run = context.runCommand ?? runCommand;
  const unit = unitName(context.env);
  let state;
  try { state = await context.system.unitState(unit); }
  catch (error) { throw new CliError(`Cannot determine whether ${unit} is running (${error.message}); nothing was removed`); }
  if (["active", "activating", "reloading", "deactivating", "failed"].includes(state.active)) {
    const stopped = await context.system.stop(unit, 120_000);
    if (stopped.code !== 0) throw new CliError(`Could not stop ${unit}; uninstall left application files in place`);
    const after = await context.system.unitState(unit);
    if (["active", "activating", "reloading", "deactivating"].includes(after.active))
      throw new CliError(`${unit} is still ${after.active}; uninstall left application files in place`);
  }
  let config = null;
  try { config = readConfig(context.xdg.configFile); } catch { /* preserve even invalid config */ }
  const images = await installedImages(context.xdg);
  const removedContainers = await removeOwnedContainers(run, config?.installId, context.env);

  const executable = context.xdg.executable;
  if (existsSync(executable)) {
    let owned = false;
    try { owned = readFileSync(executable, "utf8").includes(path.join(context.xdg.current, "bin", "storybench.mjs")); } catch { /* not ours */ }
    if (!owned) throw new CliError(`Refusing to remove ${executable} because it is not the Storybench launcher for this installation`);
    rmSync(executable);
  }
  const serviceFile = unitFile(context);
  rmSync(serviceFile, { force: true });
  const reload = await context.system.daemonReload();
  if (reload.code !== 0) throw new CliError("Removed the unit file, but systemd --user daemon-reload failed");
  rmSync(context.xdg.current, { force: true });
  rmSync(context.xdg.mirror, { recursive: true, force: true });
  rmSync(context.xdg.releases, { recursive: true, force: true });

  let removedImages = 0;
  for (const image of images) {
    const used = await run("docker", ["ps", "-a", "--filter", `ancestor=${image}`, "--format", "{{.ID}}"], { timeoutMs: 30_000, env: context.env });
    if (used.code !== 0 || used.stdout.trim()) continue;
    const removed = await run("docker", ["image", "rm", image], { timeoutMs: 120_000, env: context.env });
    if (removed.code === 0) removedImages++;
  }
  try { rmdirSync(context.xdg.share); } catch (error) { if (!["ENOENT", "ENOTEMPTY"].includes(error.code)) throw error; }
  context.out(`Uninstalled Storybench application (${removedContainers} container(s), ${removedImages} unreferenced image(s)).`);
  context.out(`Preserved configuration: ${context.xdg.configFile}`);
  context.out(`Preserved state/backups/sessions: ${context.xdg.state}`);
  context.out(`Preserved data root: ${config?.dataRoot ?? "not configured"}`);
  context.out("Host Codex and Claude login files were not read, changed or removed.");
  return EXIT.OK;
  }, { timeoutMs: context.lockTimeoutMs ?? 10_000 });
}

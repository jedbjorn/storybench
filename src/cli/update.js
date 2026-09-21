import crypto from "node:crypto";
import { existsSync, lstatSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { checkCompatibility, readReleaseManifest } from "../runtime/manifest.js";
import { inspectDataRoot } from "../services/data-root.js";
import { createMetadataBackup, currentRelease, restoreMetadataBackup, stopService } from "./backup.js";
import { CliError, EXIT } from "./errors.js";
import { activateSymlink, assertActivationStopped, reusableRelease, stageRelease } from "./install.js";
import { prepareService, startAndVerify } from "./lifecycle.js";
import { withLock } from "./lock.js";
import { readReceipts, receiptName, writeJsonAtomic } from "./receipts.js";
import { activeWork, healthProblems, serviceStatus } from "./service.js";
import { unitName } from "./unit.js";
import { configuredRoot } from "./root.js";
import { writeConfigAtomic } from "./config.js";

const COMMIT = /^[0-9a-f]{40}$/;
const UPDATE_SCHEMA = "storybench.update/1";
const ROLLBACK_SCHEMA = "storybench.rollback/1";

function firstLine(value) { return String(value || "").trim().split("\n")[0]; }
function releaseRecord(release) {
  return release ? { commit: release.identity.commit, manifestId: release.identity.manifestId,
    images: { app: release.identity.images.app, worker: release.identity.images.worker } } : null;
}
function step(adapters, name) { return adapters.injectFailure?.(name); }
function transitionDirectory(context) { return path.join(context.xdg.state, "updates"); }
function attemptFile(context, date = new Date()) { return path.join(transitionDirectory(context), receiptName(date)); }
function saveAttempt(file, receipt, adapters) { writeJsonAtomic(file, receipt, { beforeRename: adapters.beforeReceiptRename }); }

function validateOrigin(remote, ref) {
  if (typeof remote !== "string" || !remote || typeof ref !== "string" || !ref || /[\0\r\n]/.test(`${remote}${ref}`))
    throw new CliError("The active release does not record a usable update origin/ref");
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(remote)) {
    let parsed;
    try { parsed = new URL(remote); } catch { throw new CliError("The recorded update origin is not a valid URL"); }
    if (parsed.username || parsed.password || parsed.search || parsed.hash)
      throw new CliError("The recorded update origin contains embedded credentials or parameters", { hint: "Use the host Git credential helper or SSH configuration; credentials are never stored by Storybench." });
  }
  if (ref.startsWith("-") || ref.length > 1024) throw new CliError("The recorded update ref is not safe");
  return { remote, ref };
}

function remoteRef(ref) {
  if (COMMIT.test(ref)) return null;
  if (ref.startsWith("refs/heads/") || ref.startsWith("refs/tags/")) return ref;
  if (/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(ref) && !ref.includes("..") && !ref.endsWith("/")) return `refs/heads/${ref}`;
  throw new CliError("The recorded update ref is not a supported branch, tag or exact commit");
}

async function git(context, args, label) {
  const result = await context.runCommand("git", ["--git-dir", context.xdg.mirror, ...args], { timeoutMs: 120_000 });
  if (result.code !== 0) throw new CliError(`${label} failed`, { hint: "Check network access and the host's Git credential helper, then retry." });
  return result.stdout.trim();
}

export async function fetchAvailable(context, release, adapters = context.recoveryAdapters ?? {}) {
  if (adapters.fetchAvailable) return adapters.fetchAvailable({ context, release });
  const { remote, ref } = validateOrigin(release.manifest.source.remote, release.manifest.source.ref);
  if (!existsSync(context.xdg.mirror)) throw new CliError("The app-owned source mirror is missing", { hint: "Re-run the installer from a clean private clone." });
  const configured = await git(context, ["remote", "get-url", "origin"], "Reading the update origin");
  if (configured !== remote) throw new CliError("The app-owned mirror origin differs from the active release's recorded origin", { hint: "Re-run the installer from a trusted clean clone to repair the installation." });
  const sourceRef = remoteRef(ref);
  if (!sourceRef) return { local: release.identity.commit, current: release.identity.commit, available: release.identity.commit, ref };
  let local = null;
  const before = await context.runCommand("git", ["--git-dir", context.xdg.mirror, "rev-parse", "--verify", `${sourceRef}^{commit}`], { timeoutMs: 30_000 });
  if (before.code === 0 && COMMIT.test(before.stdout.trim())) local = before.stdout.trim();
  await git(context, ["fetch", "--no-tags", "--prune", "origin", `+${sourceRef}:refs/storybench/update-candidate`], "Fetching update metadata");
  const available = await git(context, ["rev-parse", "--verify", "refs/storybench/update-candidate^{commit}"], "Resolving the fetched update");
  if (!COMMIT.test(available)) throw new CliError("The fetched update did not resolve to an exact commit");
  return { local: local ?? "(not cached)", current: release.identity.commit, available, ref };
}

async function verifyStaged(context, staged, adapters) {
  if (adapters.verifyRelease) return adapters.verifyRelease(staged);
  if (staged.manifest.source.commit !== path.basename(staged.release)) throw new CliError("The staged release directory and manifest commit differ");
  for (const role of ["app", "worker"]) {
    const id = staged.manifest.images?.[role]?.id;
    const result = await context.runCommand("docker", ["image", "inspect", id, "--format", "{{.Id}}"], { timeoutMs: 30_000 });
    if (result.code !== 0 || result.stdout.trim() !== id) throw new CliError(`The staged ${role} image is missing or has the wrong immutable identity`);
  }
}

async function verifyIsolated(context, config, release, adapters) {
  if (adapters.verifyIsolated) return adapters.verifyIsolated({ context, config, release });
  const name = `storybench-${config.installId}-verify-${crypto.randomUUID().slice(0, 12)}`;
  const identity = JSON.stringify(release.identity);
  const run = await context.runCommand("docker", ["run", "--detach", "--name", name,
    "--label", `io.storybench.install=${config.installId}`, "--label", "io.storybench.role=verify",
    "--network", "none", "--user", "0:0", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
    "--mount", `type=bind,source=${config.dataRoot},target=/storybench/data`, "--env", `STORYBENCH_RELEASE=${identity}`,
    release.identity.images.app, "node", "src/server.js", "--data-root", "/storybench/data", "--port", "4173"], { timeoutMs: 60_000 });
  if (run.code !== 0) throw new CliError(`The isolated release container could not start: ${firstLine(run.stderr) || `exit ${run.code}`}`);
  const id = run.stdout.trim() || name;
  const deadline = Date.now() + context.healthTimeoutMs;
  let health = null;
  try {
    while (Date.now() < deadline) {
      const probe = await context.runCommand("docker", ["exec", id, "node", "-e",
        "fetch('http://127.0.0.1:4173/api/health').then(async r=>{if(!r.ok)process.exit(2);console.log(JSON.stringify(await r.json()))}).catch(()=>process.exit(3))"], { timeoutMs: 5000 });
      if (probe.code === 0) { try { health = JSON.parse(probe.stdout); } catch { /* retry */ } }
      if (health?.ready) break;
      await new Promise((resolve) => setTimeout(resolve, context.pollMs ?? 500));
    }
    if (!health?.ready) throw new CliError("The staged release did not become healthy in its isolated verification container");
    const problems = healthProblems(health, { identity: release.identity, dataRootId: config.dataRootId });
    if (problems.length) throw new CliError(`The isolated release is not exact: ${problems.join("; ")}`);
    return health;
  } finally {
    await context.runCommand("docker", ["stop", "--time", "30", id], { timeoutMs: 60_000 }).catch(() => null);
    await context.runCommand("docker", ["rm", "--force", id], { timeoutMs: 30_000 }).catch(() => null);
  }
}

async function verifyActivation(context, config, release, wasRunning, adapters) {
  if (adapters.verifyActivation) return adapters.verifyActivation({ context, config, release, wasRunning });
  let health;
  if (wasRunning) {
    const prepared = await prepareService(context, config, { releaseRoot: release.root, manifestPath: release.file });
    health = (await startAndVerify(context, config, prepared)).health;
  } else health = await verifyIsolated(context, config, release, adapters);
  const root = inspectDataRoot(config.dataRoot);
  if (!Number.isInteger(root.schemaVersion) || health.schema?.current !== root.schemaVersion)
    throw new CliError("Release health and the on-disk database schema do not match");
  if (root.identity?.id && root.identity.id !== config.dataRootId) throw new CliError("The activated release opened a different database identity");
  return health;
}

async function restorePrior(context, config, prior, backup, wasRunning, adapters) {
  const unit = unitName(context.env);
  const state = await context.system.unitState(unit);
  if (["active", "activating", "reloading", "deactivating", "failed"].includes(state.active)) await stopService(context, unit);
  else if (state.active !== "inactive") throw new CliError(`Cannot safely restore metadata while ${unit} is ${state.active}`);
  activateSymlink(context.xdg.current, prior.root);
  await prepareService(context, config, { releaseRoot: prior.root, manifestPath: prior.file });
  if (backup) await restoreMetadataBackup(context, backup, prior, adapters);
  if (wasRunning) await startAndVerify(context, config, await prepareService(context, config, { releaseRoot: prior.root, manifestPath: prior.file }));
}

function databaseSchema(config) {
  const info = inspectDataRoot(config.dataRoot);
  if (!Number.isInteger(info.schemaVersion)) throw new CliError(`Cannot read the configured database schema (${info.state})`);
  return info.schemaVersion;
}

async function releaseAt(directory) {
  const file = path.join(directory, "manifest.json");
  const found = await readReleaseManifest(file);
  return found.ok ? { root: directory, file, manifest: found.manifest, identity: found.identity } : null;
}

export async function selectPreviousRelease(context, currentCommit, schemaVersion) {
  const transitions = readReceipts(transitionDirectory(context)).map(({ file, value }) => ({ file, ...value }))
    .filter((value) => [UPDATE_SCHEMA, ROLLBACK_SCHEMA].includes(value.schema) && value.outcome === "success")
    .sort((a, b) => Date.parse(b.completedAt || b.attemptedAt) - Date.parse(a.completedAt || a.attemptedAt));
  const transition = transitions.find((value) => value.to?.commit === currentCommit && value.from?.commit && value.from.commit !== currentCommit);
  const candidates = [];
  if (transition) candidates.push({ commit: transition.from.commit, boundary: transition.backup?.path ?? null, transition });
  let names = [];
  try { names = readdirSync(context.xdg.releases).filter((name) => COMMIT.test(name) && name !== currentCommit); } catch { /* reported below */ }
  if (!transition) {
    const fallback = [];
    for (const commit of names) {
      const release = await releaseAt(path.join(context.xdg.releases, commit));
      if (release) fallback.push({ commit, release, installedAt: release.manifest.builtAt });
    }
    fallback.sort((a, b) => Date.parse(b.installedAt || 0) - Date.parse(a.installedAt || 0));
    for (const item of fallback) candidates.push({ commit: item.commit, release: item.release, boundary: null, transition: null });
  }
  for (const candidate of candidates) {
    const release = candidate.release ?? await releaseAt(path.join(context.xdg.releases, candidate.commit));
    if (release) return { ...candidate, release, compatibility: checkCompatibility(release.manifest, { schemaVersion }) };
  }
  return null;
}

export function selectRetainedCommits(releases, { currentCommit, previousCommit, schemaVersion, maximum = 3 }) {
  const ordered = [...releases].sort((a, b) => Date.parse(b.activatedAt || b.installedAt || 0) - Date.parse(a.activatedAt || a.installedAt || 0));
  const keep = new Set([currentCommit, previousCommit].filter(Boolean));
  const compatible = ordered.find(({ manifest }) => checkCompatibility(manifest, { schemaVersion }).compatible);
  if (compatible) keep.add(compatible.commit);
  for (const release of ordered) if (keep.size < maximum) keep.add(release.commit);
  return keep;
}

async function retainReleases(context, currentCommit, previousCommit, schemaVersion) {
  const releases = [];
  let names = [];
  try { names = readdirSync(context.xdg.releases).filter((name) => COMMIT.test(name)); } catch { return; }
  for (const commit of names) {
    const release = await releaseAt(path.join(context.xdg.releases, commit));
    if (release) releases.push({ commit, manifest: release.manifest, installedAt: release.manifest.builtAt });
  }
  const keep = selectRetainedCommits(releases, { currentCommit, previousCommit, schemaVersion });
  for (const release of releases) if (!keep.has(release.commit)) {
    const directory = path.join(context.xdg.releases, release.commit);
    if (lstatSync(directory).isDirectory() && !lstatSync(directory).isSymbolicLink()) rmSync(directory, { recursive: true, force: true });
  }
  // Image deletion is deliberately conservative: exact pairs can be shared by a stopped
  // installation that Docker cannot attribute. Unreferenced layers remain cache, never a
  // claimed retained release, and no global prune is used.
}

function beforeStateFailure(before, force) {
  if (before.problems.length) throw new CliError(`The running service does not match the installed release/data root: ${before.problems.join("; ")}`);
  if (before.unit.active === "unknown" || before.unit.managerUnavailable)
    throw new CliError("The systemd user service state is unavailable; activation was not started");
  if (!before.health && ["active", "activating", "reloading", "deactivating"].includes(before.unit.active) && !force)
    throw new CliError(`Cannot confirm Storybench is idle: the unit is ${before.unit.active} but activity is unavailable`, { hint: "Retry shortly, or use `storybench update --force` only if interrupting active work is acceptable." });
  if (before.health) {
    const work = activeWork(before.health);
    if (work.busy && !force) throw new CliError(`Storybench is busy: ${work.renders} render job(s) and ${work.agents} agent turn(s) are active across all channels`, {
      hint: "Wait for them to finish, or run `storybench update --force` to interrupt them. All other safety checks still apply." });
  }
}

export async function runUpdate(context, { options }) {
  const adapters = context.recoveryAdapters ?? {};
  const operation = options.check ? "update --check" : options.force ? "update --force" : "update";
  return withLock(context.xdg.lockDir, operation, async () => {
    const prior = await currentRelease(context);
    if (options.check) {
      const available = await fetchAvailable(context, prior, adapters);
      context.out(`Update ref: ${available.ref}\nLocal commit: ${available.local}\nCurrent commit: ${available.current}\nAvailable commit: ${available.available}\n${available.available === available.current ? "Storybench is current." : "An update is available."}`);
      return EXIT.OK;
    }
    let config = configuredRoot(context);
    if (!config.installId) {
      config = { ...config, installId: `sb${crypto.randomBytes(5).toString("hex")}` };
      writeConfigAtomic(context.xdg.configFile, config);
    }
    const unit = unitName(context.env);
    const receipt = { schema: UPDATE_SCHEMA, attemptedAt: new Date().toISOString(), completedAt: null, outcome: "in-progress", failureStep: null,
      from: releaseRecord(prior), to: null, backup: null, serviceWasRunning: null };
    const file = attemptFile(context);
    saveAttempt(file, receipt, adapters);
    let failureStep = "fetch", backup = null, downtime = false, wasRunning = false, target = null;
    try {
      step(adapters, "fetch");
      const available = await fetchAvailable(context, prior, adapters);
      receipt.to = { commit: available.available, manifestId: null, images: null };
      saveAttempt(file, receipt, adapters);
      const sameCommit = available.available === prior.identity.commit;
      if (sameCommit && await reusableRelease(prior.file, prior.identity.commit, context.runCommand)) {
        Object.assign(receipt, { outcome: "success", completedAt: new Date().toISOString(), noChange: true }); saveAttempt(file, receipt, adapters);
        context.out(`Storybench is already current at ${available.available}.`); return EXIT.OK;
      }
      failureStep = "build";
      if (sameCommit) await assertActivationStopped(context, prior.root, prior.root, { replacing: true });
      step(adapters, "build");
      const staged = adapters.stageRelease ? await adapters.stageRelease({ context, commit: available.available, prior })
        : await stageRelease(context, { commit: available.available, remote: prior.manifest.source.remote, ref: prior.manifest.source.ref }, context.installAdapters);
      target = { ...staged, root: staged.release, file: path.join(staged.release, "manifest.json"), identity: {
        manifestId: staged.manifest.id, version: staged.manifest.package.version, commit: staged.manifest.source.commit,
        images: { app: staged.manifest.images.app.id, worker: staged.manifest.images.worker.id }, protocol: staged.manifest.runtime.protocol,
        supportedSchema: { ...staged.manifest.database.supportedSchema }, tools: { ...(staged.manifest.runtime.tools ?? {}) },
      } };
      receipt.to = releaseRecord(target); saveAttempt(file, receipt, adapters);
      failureStep = "verify"; step(adapters, "verify"); await verifyStaged(context, target, adapters);
      failureStep = "busy-gate";
      const before = await serviceStatus({ system: context.system, unit, port: config.port, identity: prior.identity, dataRootId: config.dataRootId, probe: context.probeService });
      wasRunning = before.unit.active === "active";
      receipt.serviceWasRunning = wasRunning; saveAttempt(file, receipt, adapters);
      beforeStateFailure(before, Boolean(options.force)); step(adapters, "busy-gate");
      failureStep = "stop"; step(adapters, "stop");
      if (wasRunning || ["activating", "reloading", "deactivating", "failed"].includes(before.unit.active)) { downtime = true; await stopService(context, unit); }
      failureStep = "backup"; step(adapters, "backup");
      backup = await createMetadataBackup(context, config, prior, { reason: `pre-update:${prior.identity.commit}->${target.identity.commit}`, adapters });
      receipt.backup = { path: backup.directory, receipt: backup.receiptFile, schema: backup.receipt.database.schema }; saveAttempt(file, receipt, adapters);
      failureStep = "switch"; step(adapters, "switch");
      await assertActivationStopped(context, prior.root, target.root);
      activateSymlink(context.xdg.current, target.root); downtime = true;
      await prepareService(context, config, { releaseRoot: target.root, manifestPath: target.file });
      failureStep = "health"; step(adapters, "health");
      const health = await verifyActivation(context, config, target, wasRunning, adapters);
      Object.assign(receipt, { outcome: "success", completedAt: new Date().toISOString(), database: { identity: health.database.id, schema: health.schema.current } });
      saveAttempt(file, receipt, adapters);
      await retainReleases(context, target.identity.commit, prior.identity.commit, health.schema.current);
      context.out(`Updated Storybench ${prior.identity.commit} -> ${target.identity.commit}.\nRelease: ${target.identity.manifestId}\nImages: app ${target.identity.images.app}, worker ${target.identity.images.worker}\nMetadata backup: ${backup.directory}\nService: ${wasRunning ? "running and healthy" : "verified in an isolated container and left stopped"}.`);
      return EXIT.OK;
    } catch (error) {
      let recoveryFailed = null;
      if (downtime || backup) {
        try { await restorePrior(context, config, prior, backup, wasRunning, adapters); }
        catch (recoveryError) { recoveryFailed = recoveryError; }
      }
      Object.assign(receipt, { outcome: recoveryFailed ? "recovery-failed" : failureStep === "busy-gate" ? "refused" : "failed",
        completedAt: new Date().toISOString(), failureStep, recovery: { priorRestored: !recoveryFailed && (downtime || backup), errorStep: recoveryFailed ? "restore-prior" : null } });
      try { saveAttempt(file, receipt, adapters); } catch { /* preserve the original failure */ }
      if (recoveryFailed) error.message += `; automatic recovery also failed: ${recoveryFailed.message}. Backup: ${backup?.directory ?? "not created"}`;
      else if (backup) error.message += `; the prior release and metadata backup were restored (${backup.directory})`;
      throw error;
    }
  }, { timeoutMs: context.lockTimeoutMs });
}

export async function runRollback(context) {
  const adapters = context.recoveryAdapters ?? {};
  return withLock(context.xdg.lockDir, "rollback", async () => {
    let config = configuredRoot(context);
    if (!config.installId) {
      config = { ...config, installId: `sb${crypto.randomBytes(5).toString("hex")}` };
      writeConfigAtomic(context.xdg.configFile, config);
    }
    const prior = await currentRelease(context);
    const schemaVersion = databaseSchema(config);
    const selected = await selectPreviousRelease(context, prior.identity.commit, schemaVersion);
    const receipt = { schema: ROLLBACK_SCHEMA, attemptedAt: new Date().toISOString(), completedAt: null, outcome: "in-progress", failureStep: null,
      from: releaseRecord(prior), to: selected ? releaseRecord(selected.release) : null, backup: null, serviceWasRunning: null };
    const file = attemptFile(context); saveAttempt(file, receipt, adapters);
    if (!selected) {
      Object.assign(receipt, { outcome: "refused", completedAt: new Date().toISOString(), failureStep: "select" }); saveAttempt(file, receipt, adapters);
      throw new CliError("No previous retained release is available for rollback");
    }
    if (!selected.compatibility.compatible) {
      Object.assign(receipt, { outcome: "refused", completedAt: new Date().toISOString(), failureStep: "schema-gate",
        recoveryBoundary: { schema: schemaVersion, backup: selected.boundary } }); saveAttempt(file, receipt, adapters);
      throw new CliError(`Cannot roll back to ${selected.commit}: ${selected.compatibility.problems.join("; ")}`, {
        hint: `The recovery boundary is database schema ${schemaVersion}. The relevant pre-update backup is ${selected.boundary ?? "not recorded"}; restoring it would discard newer metadata and is a separate deliberate recovery action.` });
    }
    const target = selected.release, unit = unitName(context.env);
    let failureStep = "busy-gate", backup = null, downtime = false, wasRunning = false;
    try {
      const before = await serviceStatus({ system: context.system, unit, port: config.port, identity: prior.identity, dataRootId: config.dataRootId, probe: context.probeService });
      beforeStateFailure(before, false); step(adapters, "busy-gate");
      wasRunning = before.unit.active === "active"; receipt.serviceWasRunning = wasRunning; saveAttempt(file, receipt, adapters);
      failureStep = "stop"; step(adapters, "stop");
      if (wasRunning || ["activating", "reloading", "deactivating", "failed"].includes(before.unit.active)) { downtime = true; await stopService(context, unit); }
      failureStep = "backup"; step(adapters, "backup");
      backup = await createMetadataBackup(context, config, prior, { reason: `pre-rollback:${prior.identity.commit}->${target.identity.commit}`, adapters });
      receipt.backup = { path: backup.directory, receipt: backup.receiptFile, schema: backup.receipt.database.schema }; saveAttempt(file, receipt, adapters);
      failureStep = "switch"; step(adapters, "switch");
      await assertActivationStopped(context, prior.root, target.root);
      activateSymlink(context.xdg.current, target.root); downtime = true;
      await prepareService(context, config, { releaseRoot: target.root, manifestPath: target.file });
      failureStep = "health"; step(adapters, "health"); const health = await verifyActivation(context, config, target, wasRunning, adapters);
      Object.assign(receipt, { outcome: "success", completedAt: new Date().toISOString(), database: { identity: health.database.id, schema: health.schema.current } }); saveAttempt(file, receipt, adapters);
      await retainReleases(context, target.identity.commit, prior.identity.commit, health.schema.current);
      context.out(`Rolled back Storybench ${prior.identity.commit} -> ${target.identity.commit}.\nRelease: ${target.identity.manifestId}\nMetadata backup: ${backup.directory}\nService: ${wasRunning ? "running and healthy" : "verified in an isolated container and left stopped"}.`);
      return EXIT.OK;
    } catch (error) {
      let recoveryFailed = null;
      if (downtime || backup) try { await restorePrior(context, config, prior, backup, wasRunning, adapters); } catch (recoveryError) { recoveryFailed = recoveryError; }
      Object.assign(receipt, { outcome: recoveryFailed ? "recovery-failed" : failureStep === "busy-gate" ? "refused" : "failed",
        completedAt: new Date().toISOString(), failureStep, recovery: { priorRestored: !recoveryFailed && (downtime || backup), errorStep: recoveryFailed ? "restore-prior" : null } });
      try { saveAttempt(file, receipt, adapters); } catch { /* preserve original */ }
      if (recoveryFailed) error.message += `; automatic rollback recovery failed: ${recoveryFailed.message}. Backup: ${backup?.directory ?? "not created"}`;
      else if (backup) error.message += `; the prior release and metadata backup were restored (${backup.directory})`;
      throw error;
    }
  }, { timeoutMs: context.lockTimeoutMs });
}

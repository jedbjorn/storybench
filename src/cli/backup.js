import crypto from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { readConfig, validateConfig, writeConfigAtomic } from "./config.js";
import { CliError, EXIT } from "./errors.js";
import { mountPath } from "./fs-safety.js";
import { withLock } from "./lock.js";
import { lifecyclePaths, prepareService, startAndVerify } from "./lifecycle.js";
import { writeJsonAtomic } from "./receipts.js";
import { installedRelease } from "./release.js";
import { activeWork, serviceStatus } from "./service.js";
import { unitName } from "./unit.js";
import { configuredRoot } from "./root.js";

const STOP_TIMEOUT_MS = 120_000;

function firstLine(value) { return String(value || "").trim().split("\n")[0]; }
function inside(parent, child) { const relative = path.relative(parent, child); return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative)); }
export { mountPath } from "./fs-safety.js";

export async function currentRelease(context) {
  return installedRelease(context, { required: true });
}

export function backupLocation(xdg, date = new Date(), id = crypto.randomUUID()) {
  const name = `${date.toISOString().replace(/[:.]/g, "-")}-${id}`;
  return path.join(xdg.state, "backups", name);
}

async function imageDatabaseOperation(context, release, operation, sourceDirectory, destinationDirectory, adapters = {}) {
  if (adapters.databaseOperation) return adapters.databaseOperation({ operation, sourceDirectory, destinationDirectory, release });
  const source = operation === "backup" ? "/storybench/data/storybench.sqlite" : "/storybench/backup/storybench.sqlite";
  const destination = operation === "backup" ? "/storybench/backup/storybench.sqlite" : "/storybench/data/storybench.sqlite";
  const result = await context.runCommand("docker", [
    "run", "--rm", "--network", "none", "--user", "0:0", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
    "--mount", `type=bind,source=${mountPath(sourceDirectory, "The database directory")},target=/storybench/data`,
    "--mount", `type=bind,source=${mountPath(destinationDirectory, "The backup directory")},target=/storybench/backup`,
    release.manifest.images.app.id, "node", "src/cli/backup-image.js", operation, source, destination,
  ], { timeoutMs: 120_000 });
  if (result.code !== 0) throw new CliError(`The selected app image could not ${operation} metadata: ${firstLine(result.stderr) || `exit ${result.code}`}`);
  try { return JSON.parse(result.stdout); }
  catch { throw new CliError(`The selected app image returned an invalid ${operation} result`); }
}

export async function createMetadataBackup(context, config, release, { reason, adapters = context.recoveryAdapters ?? {}, date = new Date() } = {}) {
  const directory = backupLocation(context.xdg, date);
  if (inside(config.dataRoot, directory) || inside(directory, config.dataRoot))
    throw new CliError("The backup location and data root must be separate, non-nested directories");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  try {
    const info = await imageDatabaseOperation(context, release, "backup", config.dataRoot, directory, adapters);
    if (config.dataRootId && info.identity !== config.dataRootId)
      throw new CliError("The metadata backup has a different data-root identity; activation was not changed");
    const savedConfig = readConfig(context.xdg.configFile);
    if (!savedConfig) throw new CliError("The Storybench configuration disappeared during backup");
    writeJsonAtomic(path.join(directory, "config.json"), savedConfig);
    const receipt = {
      schema: "storybench.backup/1", createdAt: date.toISOString(), reason,
      release: { commit: release.identity.commit, manifestId: release.identity.manifestId,
        images: { app: release.identity.images.app, worker: release.identity.images.worker } },
      database: { file: path.join(directory, "storybench.sqlite"), identity: info.identity, schema: info.schema },
      config: { file: path.join(directory, "config.json") },
      media: { included: false, label: "Media is excluded; this backup contains shared SQLite metadata and app configuration only." },
    };
    writeJsonAtomic(path.join(directory, "receipt.json"), receipt, { beforeRename: adapters.beforeReceiptRename });
    return { directory, receipt, receiptFile: path.join(directory, "receipt.json") };
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

export async function restoreMetadataBackup(context, backup, release, adapters = context.recoveryAdapters ?? {}) {
  const receiptFile = path.join(backup.directory, "receipt.json");
  let receipt;
  try { receipt = JSON.parse(readFileSync(receiptFile, "utf8")); }
  catch { throw new CliError(`The metadata backup receipt is unreadable: ${receiptFile}`); }
  if (receipt.schema !== "storybench.backup/1" || receipt.database?.file !== path.join(backup.directory, "storybench.sqlite"))
    throw new CliError(`The metadata backup receipt is invalid: ${receiptFile}`);
  const config = validateConfig(JSON.parse(readFileSync(path.join(backup.directory, "config.json"), "utf8")));
  const current = readConfig(context.xdg.configFile);
  if (!current || current.dataRoot !== config.dataRoot || (current.dataRootId && current.dataRootId !== config.dataRootId))
    throw new CliError("The metadata backup belongs to a different configured data root");
  const info = await imageDatabaseOperation(context, release, "restore", config.dataRoot, backup.directory, adapters);
  if (receipt.database.identity && info.identity !== receipt.database.identity) throw new CliError("The restored database identity does not match its backup receipt");
  writeConfigAtomic(context.xdg.configFile, config);
  return info;
}

export async function stopService(context, unit) {
  const result = await context.system.stop(unit, STOP_TIMEOUT_MS);
  if (result.code !== 0) throw new CliError(`systemd could not stop ${unit}`, { hint: firstLine(result.stderr) || "See `storybench logs`." });
  const after = await context.system.unitState(unit);
  if (["active", "activating", "deactivating", "reloading"].includes(after.active)) throw new CliError(`${unit} is still ${after.active}`);
}

export async function runBackup(context) {
  const config = configuredRoot(context);
  return withLock(context.xdg.lockDir, "backup", async () => {
    const release = await currentRelease(context);
    const unit = unitName(context.env);
    const before = await serviceStatus({ system: context.system, unit, port: config.port, identity: release.identity,
      dataRootId: config.dataRootId, probe: context.probeService });
    if (before.problems.length) throw new CliError(`The running service cannot be backed up safely: ${before.problems.join("; ")}`);
    if (before.unit.active === "unknown" || before.unit.managerUnavailable)
      throw new CliError("The systemd user service state is unavailable; backup was not started");
    const wasRunning = before.unit.active === "active";
    if (["activating", "reloading", "deactivating"].includes(before.unit.active))
      throw new CliError(`The Storybench service is ${before.unit.active}; wait for it to settle before backup`);
    if (wasRunning && !before.health) throw new CliError("Cannot confirm the running Storybench service is idle for backup", { hint: "Retry shortly, or stop it with `storybench down` first." });
    if (before.health) {
      const work = activeWork(before.health);
      if (work.busy) throw new CliError(`Storybench is busy: ${work.renders} render job(s) and ${work.agents} agent turn(s) are active across all channels`, { hint: "Wait for them to finish, then retry the backup." });
    }
    if (wasRunning || before.unit.active === "failed") await stopService(context, unit);
    let backup;
    try { backup = await createMetadataBackup(context, config, release, { reason: "manual", adapters: context.recoveryAdapters }); }
    catch (error) {
      if (wasRunning) {
        try { await startAndVerify(context, config, await prepareService(context, config, { releaseRoot: release.root, manifestPath: release.file })); }
        catch (restartError) { error.message += `; the prior service could not be restarted: ${restartError.message}`; }
      }
      throw error;
    }
    if (wasRunning) await startAndVerify(context, config, await prepareService(context, config, { releaseRoot: release.root, manifestPath: release.file }));
    context.out(`Metadata backup: ${backup.directory}\nDatabase schema ${backup.receipt.database.schema}; media excluded.\nConfiguration: ${backup.receipt.config.file}`);
    return EXIT.OK;
  }, { timeoutMs: context.lockTimeoutMs });
}

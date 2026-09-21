import crypto from "node:crypto";
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, writeSync } from "node:fs";
import path from "node:path";
import { clearStaleLockOwner, processIsAlive } from "./lock.js";

const TRANSITION_SCHEMAS = new Set(["storybench.update/1", "storybench.rollback/1"]);

// Receipts are recovery records: write one complete JSON document to a private temporary
// sibling, sync it, rename it, then sync the directory. A crash can expose the old or the
// new document, never a partially written one.
export function writeJsonAtomic(file, value, { beforeRename = null } = {}) {
  const directory = path.dirname(file);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temporary = path.join(directory, `.${path.basename(file)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  let descriptor = openSync(temporary, "wx", 0o600);
  try {
    writeSync(descriptor, `${JSON.stringify(value, null, 2)}\n`);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = null;
    beforeRename?.(temporary);
    renameSync(temporary, file);
  } catch (error) {
    if (descriptor !== null) closeSync(descriptor);
    rmSync(temporary, { force: true });
    throw error;
  }
  const handle = openSync(directory, "r");
  try { fsyncSync(handle); } finally { closeSync(handle); }
  return file;
}

export function readJson(file) {
  try { return JSON.parse(readFileSync(file, "utf8")); } catch { return null; }
}

export function readReceipts(directory, schema = null) {
  let names;
  try { names = readdirSync(directory); } catch (error) { if (error.code === "ENOENT") return []; throw error; }
  return names.filter((name) => name.endsWith(".json")).map((name) => {
    const file = path.join(directory, name);
    return { file, value: readJson(file) };
  }).filter(({ value }) => value && (!schema || value.schema === schema));
}

export function receiptName(date = new Date(), id = crypto.randomUUID()) {
  return `${date.toISOString().replace(/[:.]/g, "-")}-${id}.json`;
}

export function transitionDirectory(xdg) { return path.join(xdg.state, "updates"); }

export function reconcileInterruptedTransition(context) {
  clearStaleLockOwner(context.xdg.lockDir);
  const attempts = readReceipts(transitionDirectory(context.xdg))
    .filter(({ value }) => TRANSITION_SCHEMAS.has(value.schema) && ["in-progress", "interrupted"].includes(value.outcome))
    .sort((a, b) => Date.parse(b.value.attemptedAt || 0) - Date.parse(a.value.attemptedAt || 0));
  const found = attempts.find(({ value }) => (value.outcome === "interrupted" && !value.recoveryHandledAt)
    || (value.outcome === "in-progress" && Number.isInteger(value.pid) && !processIsAlive(value.pid)));
  if (!found) return null;
  if (found.value.outcome === "in-progress") {
    found.value = { ...found.value, outcome: "interrupted", completedAt: new Date().toISOString(),
      failureStep: found.value.backup ? "after-backup" : found.value.failureStep ?? "unknown", interruptedPid: found.value.pid };
    writeJsonAtomic(found.file, found.value);
  }
  return found;
}

export function markTransitionRecoveryHandled(found, action) {
  const value = { ...found.value, recoveryHandledAt: new Date().toISOString(), recoveryAction: action };
  writeJsonAtomic(found.file, value);
  return value;
}

export function interruptedTransitionHint(found) {
  if (!found) return null;
  const command = found.value.schema === "storybench.rollback/1" ? "rollback" : "update";
  return `An interrupted storybench ${command} attempt was detected (${path.basename(found.file)}). Run \`storybench ${command}\` to reconcile it; if the service was intentionally left stopped, run \`storybench up\` when ready.`;
}

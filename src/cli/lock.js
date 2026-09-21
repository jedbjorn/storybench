// Installation-level lifecycle lock. It is a SQLite write lock: a connection to <lockDir>/lifecycle.sqlite holds
// BEGIN IMMEDIATE for the whole operation. The kernel owns the underlying file lock, so a crashed or killed holder
// releases it immediately and there is no stale-lock reclaim path (and no window where two commands both hold it).
// owner.json is only a description of the current holder for the timeout message; it never grants the lock.
import { DatabaseSync } from "node:sqlite";
import { closeSync, fsyncSync, openSync, readFileSync, renameSync, rmSync, writeSync } from "node:fs";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { CliError } from "./errors.js";
import { assertOwnedWritable, ensurePrivateDirectory } from "./fs-safety.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const isBusy = (error) => /database is locked|SQLITE_BUSY/i.test(error?.message || "") || error?.errcode === 5;

export function readLockOwner(lockDir) {
  try { return JSON.parse(readFileSync(path.join(lockDir, "owner.json"), "utf8")); }
  catch { return null; }
}

function writeOwner(lockDir, owner) {
  const file = path.join(lockDir, "owner.json");
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  const descriptor = openSync(temporary, "wx", 0o600);
  try { writeSync(descriptor, JSON.stringify(owner)); fsyncSync(descriptor); } finally { closeSync(descriptor); }
  renameSync(temporary, file);
}

export async function acquireLock(lockDir, { operation, timeoutMs = 10_000, pollMs = 50, now = () => Date.now() } = {}) {
  assertOwnedWritable(lockDir, "the lifecycle lock directory");
  ensurePrivateDirectory(lockDir);
  let db;
  try {
    db = new DatabaseSync(path.join(lockDir, "lifecycle.sqlite"));
    db.exec("PRAGMA busy_timeout=0");
  } catch (error) {
    db?.close();
    throw new CliError(`Cannot open the lifecycle lock (${error.code || error.message})`);
  }
  const deadline = now() + timeoutMs;
  for (;;) {
    try { db.exec("BEGIN IMMEDIATE"); break; }
    catch (error) {
      if (!isBusy(error)) { db.close(); throw new CliError(`Cannot take the lifecycle lock (${error.message})`); }
    }
    if (now() >= deadline) {
      db.close();
      const owner = readLockOwner(lockDir);
      const what = owner?.operation ? `\`storybench ${owner.operation}\` (process ${owner.pid}, since ${owner.startedAt})` : "another Storybench command";
      throw new CliError(`Another Storybench operation holds the installation lock: ${what}`, {
        hint: "Wait for it to finish and try again. The lock is released automatically when that command exits, even if it crashes." });
    }
    await sleep(pollMs);
  }
  const token = crypto.randomUUID();
  try { writeOwner(lockDir, { pid: process.pid, operation, host: os.hostname(), startedAt: new Date().toISOString(), token }); }
  catch { /* the description is optional; the lock itself is held */ }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    // Only remove the description if it is still ours; the lock itself is released by ending the transaction.
    if (readLockOwner(lockDir)?.token === token) rmSync(path.join(lockDir, "owner.json"), { force: true });
    try { db.exec("ROLLBACK"); } finally { db.close(); }
  };
}

export async function withLock(lockDir, operation, fn, options = {}) {
  const release = await acquireLock(lockDir, { ...options, operation });
  try { return await fn(); } finally { release(); }
}

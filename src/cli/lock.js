// Installation-level lifecycle lock: an atomically created directory holding owner.json. Mutating lifecycle,
// initialization and offline data operations take it. A lock whose owner process is gone is reclaimed.
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { CliError } from "./errors.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const alive = (pid) => {
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code === "EPERM"; }
};

export function readLockOwner(lockDir) {
  try { return JSON.parse(readFileSync(path.join(lockDir, "lifecycle.lock", "owner.json"), "utf8")); }
  catch { return null; }
}

export async function acquireLock(lockDir, { operation, timeoutMs = 10_000, pollMs = 100, now = () => Date.now() } = {}) {
  mkdirSync(lockDir, { recursive: true, mode: 0o700 });
  const lock = path.join(lockDir, "lifecycle.lock");
  const deadline = now() + timeoutMs;
  for (;;) {
    try {
      mkdirSync(lock, { mode: 0o700 });
      writeFileSync(path.join(lock, "owner.json"), JSON.stringify({ pid: process.pid, operation, host: os.hostname(), startedAt: new Date().toISOString() }), { mode: 0o600 });
      let released = false;
      return () => { if (!released) { released = true; rmSync(lock, { recursive: true, force: true }); } };
    } catch (error) {
      if (error.code !== "EEXIST") throw new CliError(`Cannot create the lifecycle lock (${error.code})`);
    }
    const owner = readLockOwner(lockDir);
    if (owner?.host === os.hostname() && Number.isInteger(owner.pid) && !alive(owner.pid)) {
      // The owning command exited without releasing the lock: set it aside and retry.
      try { renameSync(lock, `${lock}.stale-${owner.pid}-${Date.now()}`); } catch { /* another command reclaimed it */ }
      continue;
    }
    if (now() >= deadline) {
      const what = owner?.operation ? `\`storybench ${owner.operation}\` (process ${owner.pid}, since ${owner.startedAt})` : "another Storybench command";
      throw new CliError(`Another Storybench operation holds the installation lock: ${what}`, {
        hint: `Wait for it to finish and try again. If no Storybench command is running, remove ${lock}.` });
    }
    await sleep(pollMs);
  }
}

export async function withLock(lockDir, operation, fn, options = {}) {
  const release = await acquireLock(lockDir, { ...options, operation });
  try { return await fn(); } finally { release(); }
}

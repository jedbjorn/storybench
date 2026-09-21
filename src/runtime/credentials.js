// Host-side harness credential handling (decision #43).
//
// - The host's current login file is the only authority. It is read fresh at every
//   worker start and staged as a per-request copy in a host-only runtime directory;
//   only that single copied file is bind-mounted into the worker. A host-side
//   replace-by-rename therefore never pins a stale inode inside a later worker.
// - While a worker runs, a sync loop compares host, staged copy and the base both
//   started from. A host rotation is pushed into the running copy in place (keeping the
//   bind-mounted inode). A harness refresh inside the worker is written back to the host
//   atomically (temp + rename) only if the host file is still unchanged since the base;
//   otherwise it is a loud conflict and the host file is left alone.
// - Availability is derived from the live credential with a plain reason; there is no
//   cached token and no fallback to another harness or model.
//
// Token contents never leave these functions: results carry hashes and reasons only.
import { createHash, randomBytes } from "node:crypto";
import { lstat, mkdir, open, readFile, rename, rm, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { RuntimeError, assertHarness } from "./validate.js";

const MAX_BYTES = 256 * 1024;

export const CREDENTIAL_FILES = Object.freeze({ codex: "auth.json", claude: ".credentials.json" });

const LOGIN_HINT = {
  codex: "Run `codex login` on the host, then retry.",
  claude: "Run `claude` on the host and sign in, then retry.",
};

function validateCodex(value) {
  if (typeof value.OPENAI_API_KEY === "string" && value.OPENAI_API_KEY) return null;
  const tokens = value.tokens;
  if (!tokens || typeof tokens !== "object") return "Codex login contains neither ChatGPT tokens nor an API key.";
  if (typeof tokens.access_token !== "string" || !tokens.access_token) return "Codex login has no access token.";
  if (typeof tokens.refresh_token !== "string" || !tokens.refresh_token) return "Codex login has no refresh token.";
  return null;
}

function validateClaude(value, now) {
  const oauth = value.claudeAiOauth;
  if (!oauth || typeof oauth !== "object") return "Claude credentials contain no Claude.ai OAuth login.";
  if (typeof oauth.accessToken !== "string" || !oauth.accessToken) return "Claude login has no access token.";
  const hasRefresh = typeof oauth.refreshToken === "string" && oauth.refreshToken;
  if (!hasRefresh && Number.isFinite(oauth.expiresAt) && oauth.expiresAt <= now) return "Claude access token has expired and no refresh token is present.";
  if (hasRefresh && Number.isFinite(oauth.refreshTokenExpiresAt) && oauth.refreshTokenExpiresAt <= now) return "Claude refresh token has expired.";
  return null;
}

export function validateCredentialBytes(harness, bytes, { now = Date.now() } = {}) {
  assertHarness(harness);
  let value;
  try { value = JSON.parse(bytes.toString("utf8")); }
  catch { return "Credential file is not valid JSON."; }
  if (!value || typeof value !== "object" || Array.isArray(value)) return "Credential file is not a JSON object.";
  return harness === "codex" ? validateCodex(value) : validateClaude(value, now);
}

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

// Read one credential file without following symlinks. Never throws for an unusable
// credential: returns { ok:false, reason } with a plain, content-free reason.
export async function readCredential(harness, filePath, { now = Date.now() } = {}) {
  assertHarness(harness);
  const hint = LOGIN_HINT[harness];
  let info;
  try { info = await lstat(filePath); }
  catch (error) {
    return { ok: false, reason: error.code === "ENOENT" ? `No ${harness} login found at ${filePath}. ${hint}` : `Cannot read ${harness} login (${error.code}). ${hint}` };
  }
  if (info.isSymbolicLink() || !info.isFile()) return { ok: false, reason: `${harness} login at ${filePath} is not a regular file.` };
  if (info.size === 0 || info.size > MAX_BYTES) return { ok: false, reason: `${harness} login file has an unexpected size (${info.size} bytes). ${hint}` };
  let bytes;
  try { bytes = await readFile(filePath); }
  catch (error) { return { ok: false, reason: `Cannot read ${harness} login (${error.code}). ${hint}` }; }
  const invalid = validateCredentialBytes(harness, bytes, { now });
  if (invalid) return { ok: false, reason: `${invalid} ${hint}` };
  return { ok: true, bytes, hash: sha256(bytes), mode: info.mode & 0o777, mtimeMs: info.mtimeMs };
}

// Live availability for the model picker. One entry per harness, reason when unavailable.
export async function harnessAvailability(credentials, { now = Date.now() } = {}) {
  const result = {};
  for (const harness of ["codex", "claude"]) {
    const read = await readCredential(harness, credentials[harness], { now });
    result[harness] = read.ok
      ? { harness, available: true, reason: null, credentialSha256Prefix: read.hash.slice(0, 12) }
      : { harness, available: false, reason: read.reason };
  }
  return result;
}

async function hashOrNull(filePath) {
  try {
    const info = await lstat(filePath);
    if (!info.isFile()) return null;
    return sha256(await readFile(filePath));
  } catch { return null; }
}

// Pure decision table for one sync pass.
export function decideCredentialSync({ base, host, stage }) {
  if (host === null) return "host-missing";
  if (stage === null) return "stage-missing";
  const hostChanged = host !== base;
  const stageChanged = stage !== base;
  if (!hostChanged && !stageChanged) return "unchanged";
  if (hostChanged && stageChanged) return host === stage ? "converged" : "conflict";
  return stageChanged ? "write-back" : "refresh-worker";
}

const LOCK_STALE_MS = 30_000;

// Exclusive lock file next to the host credential. Serializes Storybench writers; a lock
// older than LOCK_STALE_MS (crashed writer) is removed once. Returns a release function,
// or null when another writer currently holds it.
export async function acquireLock(lockPath, { staleMs = LOCK_STALE_MS, now = Date.now } = {}) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const handle = await open(lockPath, "wx", 0o600);
      await handle.writeFile(String(process.pid));
      await handle.close();
      return () => unlink(lockPath).catch(() => {});
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const info = await stat(lockPath).catch(() => null);
      if (info && now() - info.mtimeMs < staleMs) return null;
      await unlink(lockPath).catch(() => {});
    }
  }
  return null;
}

// Replace the host file atomically without ever truncating it: the complete new bytes go
// to a temp file in the same directory and are fsynced first; then, under the lock file,
// the host hash is re-checked immediately before rename(2), and the directory is fsynced.
// Returns "written", "changed" (host no longer matches expectedHash: never clobbered) or
// "locked" (another Storybench writer holds the lock; retry on the next pass).
export async function atomicWriteBack(hostPath, bytes, expectedHash, { mode = 0o600, lockPath = `${hostPath}.storybench.lock` } = {}) {
  const dir = path.dirname(hostPath);
  const temp = path.join(dir, `.${path.basename(hostPath)}.storybench-${randomBytes(6).toString("hex")}.tmp`);
  const handle = await open(temp, "wx", mode);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally { await handle.close(); }
  try {
    const release = await acquireLock(lockPath);
    if (!release) return "locked";
    try {
      if ((await hashOrNull(hostPath)) !== expectedHash) return "changed";
      await rename(temp, hostPath);
      const dirHandle = await open(dir, "r");
      try { await dirHandle.sync(); } catch { /* directory fsync unsupported */ } finally { await dirHandle.close(); }
      return "written";
    } finally { await release(); }
  } finally { await unlink(temp).catch(() => {}); }
}

// Overwrite the staged copy in place so the worker's bind-mounted inode is preserved.
// The full new bytes are written at offset 0 before truncating to their length, so the
// file is never observed empty.
export async function writeInPlace(filePath, bytes) {
  const handle = await open(filePath, "r+");
  try {
    await handle.write(bytes, 0, bytes.length, 0);
    await handle.truncate(bytes.length);
    await handle.sync();
  } finally { await handle.close(); }
}

// Sync outcomes worth logging are logged on transition only (a persistent conflict is
// reported once, and again only after it clears and recurs).
export function shouldLogSyncAction(previous, action) {
  return action !== "unchanged" && action !== previous;
}

export class CredentialLink {
  constructor({ harness, hostPath, stagePath, baseHash, now }) {
    Object.assign(this, { harness, hostPath, stagePath, baseHash, now, conflict: false, lastAction: "staged" });
  }

  // Stage a fresh copy of the host's current login for one worker request.
  static async stage({ harness, hostPath, stageDir, now = () => Date.now() }) {
    const read = await readCredential(harness, hostPath, { now: now() });
    if (!read.ok) throw new RuntimeError("HARNESS_UNAVAILABLE", read.reason, { status: 409 });
    await mkdir(stageDir, { recursive: true, mode: 0o700 });
    const stagePath = path.join(stageDir, CREDENTIAL_FILES[harness]);
    const handle = await open(stagePath, "wx", 0o600);
    try { await handle.writeFile(read.bytes); } finally { await handle.close(); }
    return new CredentialLink({ harness, hostPath, stagePath, baseHash: read.hash, now });
  }

  async sync() {
    const host = await hashOrNull(this.hostPath);
    const stage = await hashOrNull(this.stagePath);
    const action = decideCredentialSync({ base: this.baseHash, host, stage });
    let outcome = action;
    if (action === "converged") this.baseHash = host;
    else if (action === "write-back") {
      const bytes = await readFile(this.stagePath);
      const invalid = validateCredentialBytes(this.harness, bytes, { now: this.now() });
      if (invalid) outcome = "invalid-worker-write";
      else {
        const written = await atomicWriteBack(this.hostPath, bytes, this.baseHash, { mode: (await stat(this.hostPath)).mode & 0o777 });
        if (written === "written") this.baseHash = sha256(bytes);
        else outcome = written === "locked" ? "write-back-deferred" : "conflict";
      }
    } else if (action === "refresh-worker") {
      const read = await readCredential(this.harness, this.hostPath, { now: this.now() });
      if (!read.ok) outcome = "host-invalid";
      else { await writeInPlace(this.stagePath, read.bytes); this.baseHash = read.hash; }
    }
    if (outcome === "conflict") this.conflict = true;
    this.lastAction = outcome;
    return outcome;
  }

  async dispose() {
    await rm(path.dirname(this.stagePath), { recursive: true, force: true });
  }
}

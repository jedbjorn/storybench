// Credential staging/sync tests use temp-dir fixtures only; they never touch real
// ~/.codex or ~/.claude files.
import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CredentialLink, decideCredentialSync, harnessAvailability, readCredential, validateCredentialBytes } from "../src/runtime/credentials.js";

const codexLogin = (access) => JSON.stringify({ auth_mode: "chatgpt", tokens: { access_token: access, refresh_token: `refresh-${access}`, id_token: "id" }, last_refresh: "2026-09-20T00:00:00Z" });
const claudeLogin = (access, extra = {}) => JSON.stringify({ claudeAiOauth: { accessToken: access, refreshToken: `refresh-${access}`, expiresAt: Date.now() + 3_600_000, ...extra } });

async function tempDir(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "sb-cred-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test("decision table covers every host/worker change combination", () => {
  assert.equal(decideCredentialSync({ base: "a", host: "a", stage: "a" }), "unchanged");
  assert.equal(decideCredentialSync({ base: "a", host: "b", stage: "a" }), "refresh-worker");
  assert.equal(decideCredentialSync({ base: "a", host: "a", stage: "b" }), "write-back");
  assert.equal(decideCredentialSync({ base: "a", host: "b", stage: "b" }), "converged");
  assert.equal(decideCredentialSync({ base: "a", host: "b", stage: "c" }), "conflict");
  assert.equal(decideCredentialSync({ base: "a", host: null, stage: "a" }), "host-missing");
  assert.equal(decideCredentialSync({ base: "a", host: "a", stage: null }), "stage-missing");
});

test("availability comes from the live credential with plain reasons and no token content", async (t) => {
  const dir = await tempDir(t);
  const files = { codex: path.join(dir, "auth.json"), claude: path.join(dir, ".credentials.json") };
  let result = await harnessAvailability(files);
  assert.equal(result.codex.available, false);
  assert.match(result.codex.reason, /No codex login found.*codex login/);
  assert.match(result.claude.reason, /No claude login found/);
  await writeFile(files.codex, "{not json");
  await writeFile(files.claude, claudeLogin("secret-claude-token", { refreshToken: undefined, expiresAt: Date.now() - 1000 }));
  result = await harnessAvailability(files);
  assert.match(result.codex.reason, /not valid JSON/);
  assert.match(result.claude.reason, /expired and no refresh token/);
  await writeFile(files.codex, JSON.stringify({ tokens: { access_token: "" } }));
  assert.match((await harnessAvailability(files)).codex.reason, /no access token/);
  await writeFile(files.codex, codexLogin("secret-codex-token"));
  await writeFile(files.claude, claudeLogin("secret-claude-token"));
  result = await harnessAvailability(files);
  assert.equal(result.codex.available, true);
  assert.equal(result.claude.available, true);
  assert.doesNotMatch(JSON.stringify(result), /secret-/);
  assert.equal(validateCredentialBytes("claude", Buffer.from(claudeLogin("x", { refreshTokenExpiresAt: Date.now() - 1 }))), "Claude refresh token has expired.");
});

test("symlinked or oversized credential files are unavailable", async (t) => {
  const dir = await tempDir(t);
  const real = path.join(dir, "real.json");
  await writeFile(real, codexLogin("t"));
  const { symlink } = await import("node:fs/promises");
  await symlink(real, path.join(dir, "auth.json"));
  assert.match((await readCredential("codex", path.join(dir, "auth.json"))).reason, /not a regular file/);
  await writeFile(path.join(dir, "big.json"), "x".repeat(300 * 1024));
  assert.match((await readCredential("codex", path.join(dir, "big.json"))).reason, /unexpected size/);
});

test("each staging reads the host's current file, so a host replace-by-rename reaches the next worker", async (t) => {
  const dir = await tempDir(t);
  const host = path.join(dir, "host-auth.json");
  await writeFile(host, codexLogin("v1"), { mode: 0o600 });
  const first = await CredentialLink.stage({ harness: "codex", hostPath: host, stageDir: path.join(dir, "req-1") });
  assert.equal(JSON.parse(await readFile(first.stagePath, "utf8")).tokens.access_token, "v1");
  // Host CLI rotates by writing a temp file and renaming it over the login.
  await writeFile(path.join(dir, "tmp"), codexLogin("v2"), { mode: 0o600 });
  await rename(path.join(dir, "tmp"), host);
  const second = await CredentialLink.stage({ harness: "codex", hostPath: host, stageDir: path.join(dir, "req-2") });
  assert.equal(JSON.parse(await readFile(second.stagePath, "utf8")).tokens.access_token, "v2");
  assert.equal((await stat(second.stagePath)).mode & 0o777, 0o600);
  // The running worker's copy follows the host in place (same inode as its bind mount).
  const inode = (await stat(first.stagePath)).ino;
  assert.equal(await first.sync(), "refresh-worker");
  assert.equal((await stat(first.stagePath)).ino, inode);
  assert.equal(JSON.parse(await readFile(first.stagePath, "utf8")).tokens.access_token, "v2");
  assert.equal(await first.sync(), "unchanged");
  await first.dispose();
  await assert.rejects(stat(first.stagePath));
});

test("a worker-side refresh is written back atomically only while the host is unchanged", async (t) => {
  const dir = await tempDir(t);
  const host = path.join(dir, ".credentials.json");
  await writeFile(host, claudeLogin("v1"), { mode: 0o600 });
  const link = await CredentialLink.stage({ harness: "claude", hostPath: host, stageDir: path.join(dir, "req") });
  const hostInode = (await stat(host)).ino;
  await writeFile(link.stagePath, claudeLogin("v2-from-worker")); // harness refresh (in-place write)
  assert.equal(await link.sync(), "write-back");
  assert.equal(JSON.parse(await readFile(host, "utf8")).claudeAiOauth.accessToken, "v2-from-worker");
  assert.notEqual((await stat(host)).ino, hostInode, "host file replaced by rename, not rewritten in place");
  assert.equal((await stat(host)).mode & 0o777, 0o600);
  assert.equal(await link.sync(), "unchanged");
  // A corrupt/partial worker write is never propagated.
  await writeFile(link.stagePath, "{partial");
  assert.equal(await link.sync(), "invalid-worker-write");
  assert.equal(JSON.parse(await readFile(host, "utf8")).claudeAiOauth.accessToken, "v2-from-worker");
});

test("host and worker refreshing differently is a loud conflict that never clobbers the host", async (t) => {
  const dir = await tempDir(t);
  const host = path.join(dir, "auth.json");
  await writeFile(host, codexLogin("v1"), { mode: 0o600 });
  const link = await CredentialLink.stage({ harness: "codex", hostPath: host, stageDir: path.join(dir, "req") });
  await writeFile(host, codexLogin("host-v2"));
  await writeFile(link.stagePath, codexLogin("worker-v2"));
  assert.equal(await link.sync(), "conflict");
  assert.equal(link.conflict, true);
  assert.equal(JSON.parse(await readFile(host, "utf8")).tokens.access_token, "host-v2");
  assert.equal(JSON.parse(await readFile(link.stagePath, "utf8")).tokens.access_token, "worker-v2");
});

test("staging fails loudly for an unusable login and a missing host file is reported", async (t) => {
  const dir = await tempDir(t);
  await assert.rejects(CredentialLink.stage({ harness: "claude", hostPath: path.join(dir, "none.json"), stageDir: path.join(dir, "req") }), { code: "HARNESS_UNAVAILABLE", message: /No claude login found/ });
  const host = path.join(dir, "auth.json");
  await writeFile(host, codexLogin("v1"));
  await chmod(host, 0o600);
  const link = await CredentialLink.stage({ harness: "codex", hostPath: host, stageDir: path.join(dir, "req2") });
  await rm(host);
  assert.equal(await link.sync(), "host-missing");
});

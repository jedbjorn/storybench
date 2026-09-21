#!/usr/bin/env node
// Transfer existing conversations' Codex threads into app-owned session storage
// (spec #11 "Migration and Compatibility").
//
// Only the referenced native session records move: for each conversation thread ID, the
// one Codex rollout file (`sessions/YYYY/MM/DD/rollout-*-<thread>.jsonl`, Codex's own
// session format) is copied into that conversation's segment directory
// `<stateRoot>/harnesses/codex/<segment>/sessions/...`, where the worker's CODEX_HOME
// resumes it through the supported thread/resume API. The host CLI home is only read, is
// never mounted, and credentials are never copied. Existing records are never overwritten.
// If a thread is missing or cannot be resumed, the app keeps the transcript and starts a
// visible fresh native segment (chat `segment.started`), never discarding or relabelling.
//
//   Inside the app image (lists conversations; read-only database access):
//     node src/runtime/session-migrate.js list --data-root /storybench/data > threads.json
//   On the host (copies the referenced records):
//     node src/runtime/session-migrate.js transfer --state-root <dir> --threads threads.json [--codex-home ~/.codex]
import { createHash } from "node:crypto";
import { copyFile, lstat, mkdir, readFile, readdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertId, assertSessionId } from "./validate.js";

export const segmentForConversation = (conversationId) => conversationId;

export async function listConversationThreads(dataRoot) {
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(path.join(dataRoot, "storybench.sqlite"), { readOnly: true });
  try {
    const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='conversations'").get();
    if (!exists) return [];
    return db.prepare("SELECT id conversationId, thread_id threadId FROM conversations WHERE thread_id IS NOT NULL ORDER BY created_at,id").all().map((row) => ({ ...row }));
  } finally { db.close(); }
}

async function findRollouts(sessionsRoot) {
  const found = new Map();
  const walk = async (dir, depth) => {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory() && depth < 4) await walk(full, depth + 1);
      else if (entry.isFile()) {
        const match = /^rollout-.*-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i.exec(entry.name);
        if (match) found.set(match[1].toLowerCase(), full);
      }
    }
  };
  await walk(sessionsRoot, 0);
  return found;
}

const sha256 = async (file) => createHash("sha256").update(await readFile(file)).digest("hex");

export async function transferCodexSessions({ stateRoot, threads, codexHome = path.join(os.homedir(), ".codex"), segmentFor = segmentForConversation }) {
  const sessionsRoot = path.join(codexHome, "sessions");
  const rollouts = await findRollouts(sessionsRoot);
  const report = { transferred: [], alreadyPresent: [], missing: [], conflicts: [] };
  for (const { conversationId, threadId } of threads) {
    assertId(conversationId, "conversationId");
    assertSessionId(threadId);
    const source = rollouts.get(threadId.toLowerCase());
    const entry = { conversationId, threadId };
    if (!source) { report.missing.push(entry); continue; }
    const info = await lstat(source);
    if (!info.isFile()) { report.missing.push(entry); continue; }
    const segmentDir = path.join(stateRoot, "harnesses", "codex", assertId(segmentFor(conversationId), "segment"));
    const target = path.join(segmentDir, "sessions", path.relative(sessionsRoot, source));
    const existing = await stat(target).catch(() => null);
    if (existing) {
      (await sha256(target)) === (await sha256(source)) ? report.alreadyPresent.push(entry) : report.conflicts.push({ ...entry, reason: "a different record already exists; left untouched" });
      continue;
    }
    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    await copyFile(source, target, 1 /* COPYFILE_EXCL */);
    report.transferred.push({ ...entry, bytes: info.size, segment: segmentFor(conversationId) });
  }
  return report;
}

async function main(argv) {
  const at = (name) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
  if (argv[0] === "list") {
    process.stdout.write(JSON.stringify(await listConversationThreads(at("data-root") ?? "/storybench/data")) + "\n");
    return;
  }
  if (argv[0] === "transfer" && at("state-root") && at("threads")) {
    const threads = JSON.parse(await readFile(at("threads"), "utf8"));
    const report = await transferCodexSessions({ stateRoot: path.resolve(at("state-root")), threads, codexHome: at("codex-home") ? path.resolve(at("codex-home")) : undefined });
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    return;
  }
  throw new Error("Usage: session-migrate.js list --data-root <dir> | transfer --state-root <dir> --threads <file> [--codex-home <dir>]");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(2));

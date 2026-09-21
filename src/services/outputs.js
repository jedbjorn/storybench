// Output management shared by the server, UI and (later) agent tools: Final-to-Draft reclassification and
// creator-selected draft cleanup. Deletion is explicit only; nothing here runs automatically.
import { lstat, realpath, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { StoreError } from "../store.js";

const ASSEMBLED = new Set(["draft", "legacy_draft", "final"]);
const PROTECTED_NAMES = /^storybench\.(sqlite|pre-v\d+\.sqlite)(-wal|-shm)?$/;

// The same shared operation the UI uses. Refuses an ambiguous or stale target instead of guessing.
export function moveFinalToDrafts(store, { episodeId, outputId = null, expectedRevision = null, actor = "human", requestId = null } = {}) {
  return store.moveFinalToDrafts({ episodeId, outputId, expectedRevision, actor, requestId });
}

async function resolveManaged(root, relativePath) {
  if (typeof relativePath !== "string" || !relativePath || path.isAbsolute(relativePath)) throw new StoreError("The output has no managed file path", 409);
  const absolute = path.resolve(root, relativePath);
  if (!absolute.startsWith(root + path.sep) || PROTECTED_NAMES.test(path.basename(absolute)))
    throw new StoreError("The recorded output path is outside managed storage", 403);
  const info = await lstat(absolute).catch((error) => (error.code === "ENOENT" ? null : Promise.reject(error)));
  if (!info) return { absolute, missing: true, size: 0 };
  if (info.isSymbolicLink() || !info.isFile()) throw new StoreError("The recorded output is not a regular managed file", 403);
  const actual = await realpath(absolute);
  if (!actual.startsWith((await realpath(root)) + path.sep)) throw new StoreError("The recorded output escapes the data root", 403);
  return { absolute, missing: false, size: info.size };
}

function blockersFor(store, job, excludeIds) {
  return store.outputPathOwners(job.outputPath, excludeIds).map((owner) => owner.kind === "asset"
    ? `The file is registered as library or branding media (${owner.id})`
    : owner.kind === "active-job" ? `The file is needed by an active job (${owner.id})` : `The file is shared with a retained output (${owner.id})`);
}

// Rows for the "Clean up drafts" dialog: every present, completed assembled output currently designated Draft.
export async function listDraftCleanup(store, episodeId) {
  if (!store.getEpisode(episodeId)) throw new StoreError("Episode not found", 404);
  const root = store.workspace;
  const rows = [];
  for (const job of store.listJobs(episodeId)) {
    if (job.designation !== "draft" || !ASSEMBLED.has(job.outputClass) || job.state !== "completed" || job.deletionState === "deleted") continue;
    let file = null, blockers = [];
    try { file = await resolveManaged(root, job.outputPath); } catch (error) { blockers.push(error.message); }
    if (job.deletionState === "deleting") blockers.push("A deletion is already in progress");
    blockers.push(...blockersFor(store, job, [job.id]));
    rows.push({ id: job.id, createdAt: job.createdAt, designation: job.designation, outputClass: job.outputClass, recordRevision: job.recordRevision,
      size: file && !file.missing ? file.size : null, missing: Boolean(file?.missing), fileKey: job.outputPath, eligible: blockers.length === 0, blockers });
  }
  return rows;
}

// Delete explicitly selected draft outputs. Each entry carries the output-record revision the creator saw; every
// check is repeated here. Files are removed by exact recorded path (never a glob), bytes shared by several selected
// outputs are counted once, and a failure leaves that output retained for retry.
export async function deleteDraftOutputs(store, { episodeId, outputs, actor = "human" } = {}, { fs = { unlink }, afterUnlink = null } = {}) {
  if (!store.getEpisode(episodeId)) throw new StoreError("Episode not found", 404);
  if (!Array.isArray(outputs) || !outputs.length) throw new StoreError("Select at least one draft to delete", 400);
  const root = store.workspace;
  const requested = [...new Map(outputs.map((entry) => [String(entry?.id ?? ""), entry])).values()];
  const results = new Map();
  const refuse = (id, reason, extra = {}) => results.set(id, { id, status: "refused", reason, bytesReclaimed: 0, ...extra });
  const candidates = [];
  for (const entry of requested) {
    const id = String(entry?.id ?? "");
    const job = id ? store.getJob(id) : null;
    if (!job || job.episodeId !== episodeId || !job.designation) { refuse(id, "Output not found in this episode"); continue; }
    if (job.deletionState === "deleted") { results.set(id, { id, status: "alreadyDeleted", reason: "Already deleted", bytesReclaimed: 0 }); continue; }
    if (job.deletionState === "deleting") { refuse(id, "A deletion is already in progress"); continue; }
    if (!Number.isInteger(entry.expectedRevision) || entry.expectedRevision !== job.recordRevision) { refuse(id, "The output changed since it was selected", { currentRevision: job.recordRevision }); continue; }
    if (job.state !== "completed" || !ASSEMBLED.has(job.outputClass)) { refuse(id, "Only completed assembled drafts can be deleted"); continue; }
    if (job.designation !== "draft") { refuse(id, "The output is currently designated Final"); continue; }
    let file;
    try { file = await resolveManaged(root, job.outputPath); } catch (error) { refuse(id, error.message); continue; }
    candidates.push({ job, expectedRevision: entry.expectedRevision, file });
  }
  const selectedIds = candidates.map((candidate) => candidate.job.id);
  const accepted = [];
  for (const candidate of candidates) {
    const blockers = blockersFor(store, candidate.job, selectedIds);
    if (blockers.length) refuse(candidate.job.id, blockers.join("; "));
    else accepted.push(candidate);
  }
  // Recoverable state first: a crash after this point is reconciled on reopen.
  const marked = accepted.filter((candidate) => {
    if (store.markOutputDeleting(candidate.job.id, candidate.expectedRevision)) return true;
    refuse(candidate.job.id, "The output changed since it was selected");
    return false;
  });
  const byPath = new Map();
  for (const candidate of marked) byPath.set(candidate.job.outputPath, [...(byPath.get(candidate.job.outputPath) || []), candidate]);
  let bytesReclaimed = 0;
  for (const [relativePath, group] of byPath) {
    const [first, ...others] = group;
    const sharedWith = group.length > 1 ? group.map((candidate) => candidate.job.id) : undefined;
    let removedBytes = 0, absent = false;
    try {
      const current = await resolveManaged(root, relativePath);
      if (current.missing) absent = true;
      else {
        try { await fs.unlink(current.absolute); removedBytes = current.size; }
        catch (error) { if (error.code === "ENOENT") absent = true; else throw error; }
      }
    } catch (error) {
      for (const candidate of group) {
        store.abortOutputDeletion(candidate.job.id, `Deletion failed: ${error.message}`);
        results.set(candidate.job.id, { id: candidate.job.id, status: "failed", reason: error.message, bytesReclaimed: 0, sharedWith });
      }
      continue;
    }
    // Test seam for an abrupt stop between file removal and the metadata update (left for reconciliation).
    await afterUnlink?.({ outputIds: group.map((candidate) => candidate.job.id), path: relativePath });
    const sidecarNotes = [];
    for (const sidecar of new Set(group.flatMap((candidate) => candidate.job.sidecarPaths))) {
      if (store.outputPathOwners(sidecar, selectedIds).length) { sidecarNotes.push(`${sidecar} kept: another record uses it`); continue; }
      try {
        const current = await resolveManaged(root, sidecar);
        if (!current.missing) { await fs.unlink(current.absolute); removedBytes += current.size; }
      } catch (error) { sidecarNotes.push(`${sidecar} could not be removed: ${error.message}`); }
    }
    bytesReclaimed += removedBytes;
    const note = [absent ? "The file was already absent; no space was reclaimed" : null, ...sidecarNotes].filter(Boolean).join("; ") || null;
    store.finishOutputDeletion(first.job.id, { bytes: removedBytes, note });
    results.set(first.job.id, { id: first.job.id, status: absent ? "absent" : "deleted", bytesReclaimed: removedBytes, sharedWith, ...(note ? { reason: note } : {}) });
    for (const candidate of others) {
      store.finishOutputDeletion(candidate.job.id, { bytes: 0, note: `Shared file counted with ${first.job.id}` });
      results.set(candidate.job.id, { id: candidate.job.id, status: absent ? "absent" : "deleted", bytesReclaimed: 0, sharedWith, reason: `Shared file counted with ${first.job.id}` });
    }
  }
  const ordered = requested.map((entry) => results.get(String(entry?.id ?? ""))).filter(Boolean);
  return {
    actor,
    results: ordered,
    bytesReclaimed,
    deleted: ordered.filter((result) => ["deleted", "absent"].includes(result.status)).length,
    failed: ordered.filter((result) => result.status === "failed").length,
    refused: ordered.filter((result) => result.status === "refused").length,
  };
}

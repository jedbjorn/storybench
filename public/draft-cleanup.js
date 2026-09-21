// "Clean up drafts": explicit multi-select that starts empty. The total counts each distinct file once.
import { formatBytes } from "./job-status.js";
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);

export function selectedTotal(rows, selectedIds) {
  const sizes = new Map();
  for (const row of rows) if (selectedIds.has(row.id) && Number.isFinite(row.size)) sizes.set(row.fileKey, row.size);
  return [...sizes.values()].reduce((sum, size) => sum + size, 0);
}

// Drafts that share one file are selected and unselected together, so the shared file can actually be removed.
export function toggleSelection(rows, selectedIds, id, checked) {
  const next = new Set(selectedIds);
  const row = rows.find((value) => value.id === id);
  const eligible = new Set(rows.filter((value) => value.eligible).map((value) => value.id));
  for (const target of [id, ...(row?.sharedWith || [])]) {
    if (!eligible.has(target)) continue;
    if (checked) next.add(target); else next.delete(target);
  }
  return next;
}

export function cleanupRowsHTML(rows, selectedIds = new Set(), outcomes = new Map()) {
  if (!rows.length) return '<p class="library-empty">No draft renders to clean up.</p>';
  return rows.map((row) => {
    const outcome = outcomes.get(row.id);
    const label = row.outputClass === "final" ? "Draft (rendered as Final)" : row.outputClass === "legacy_draft" ? "Legacy Draft" : "Draft";
    return `<label class="cleanup-row${row.eligible ? "" : " blocked"}" data-cleanup-row="${esc(row.id)}"><input type="checkbox" data-cleanup-select="${esc(row.id)}" ${selectedIds.has(row.id) ? "checked" : ""} ${row.eligible ? "" : "disabled"}>
<span><b>${esc(label)}</b> · ${esc(new Date(row.createdAt).toLocaleString())}<small>${row.missing ? "file already missing" : esc(formatBytes(row.size))} · designation ${esc(row.designation)}</small>
${row.note ? `<small class="cleanup-note">${esc(row.note)}</small>` : ""}${row.blockers.length ? `<small class="cleanup-blocker">${row.blockers.map(esc).join("; ")}</small>` : ""}${outcome ? `<small class="cleanup-outcome ${esc(outcome.status)}">${esc(outcome.status)}${outcome.reason ? `: ${esc(outcome.reason)}` : ""}</small>` : ""}</span></label>`;
  }).join("");
}

export { formatBytes };

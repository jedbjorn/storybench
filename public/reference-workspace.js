// Episode- and card-level reference panels. Scope comes from explicit links, never from library category:
// the picker offers every item in the current episode library, and unlinking never deletes the item.
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
const DONE = new Set(["complete", "not-applicable"]);

export function linkReference(ids = [], itemId) {
  return itemId ? [...new Set([...(ids || []), itemId])] : [...(ids || [])];
}

export function unlinkReference(ids = [], itemId) {
  return (ids || []).filter((value) => value !== itemId);
}

function previewHTML(episodeId, item) {
  const source = `/api/episodes/${encodeURIComponent(episodeId)}/library/${encodeURIComponent(item.id)}/file`;
  const kind = item.asset?.kind;
  if (kind === "image") return `<img class="reference-preview" src="${source}" alt="" loading="lazy">`;
  if (kind === "video") return `<video class="reference-preview" src="${source}" preload="metadata" muted></video>`;
  if (kind === "audio") return `<audio class="reference-preview" src="${source}" controls preload="none"></audio>`;
  return `<span class="reference-preview reference-doc" aria-hidden="true">${item.sourceKind === "url" ? "↗" : "¶"}</span>`;
}

function itemHTML(episodeId, itemId, library) {
  if (!library) return `<li class="reference-item" data-ref-item="${esc(itemId)}"><span class="reference-meta">Loading…</span></li>`;
  const item = library.get(itemId);
  if (!item) return `<li class="reference-item unavailable" data-ref-item="${esc(itemId)}"><span class="reference-preview reference-doc" aria-hidden="true">!</span><span class="reference-meta"><b>Unavailable reference</b><small>${esc(itemId)} is not in this episode's library</small></span><button type="button" data-ref-unlink="${esc(itemId)}">Unlink</button></li>`;
  const status = DONE.has(item.extractionStatus) ? "" : ` · text ${esc(item.extractionStatus)}`;
  return `<li class="reference-item" data-ref-item="${esc(item.id)}">${previewHTML(episodeId, item)}<span class="reference-meta"><b>${esc(item.label)}</b><small>${esc(item.category)} · ${esc(item.asset?.kind || item.sourceKind)}${status}</small></span><button type="button" data-ref-unlink="${esc(item.id)}" aria-label="Unlink ${esc(item.label)}">Unlink</button></li>`;
}

// items: the episode library array, or null while it is loading.
export function referencePanelHTML({ scope, cardId = null, episodeId, prompt = "", itemIds = [], items = null }) {
  const library = items ? new Map(items.map((item) => [item.id, item])) : null;
  const linked = new Set(itemIds || []);
  const choices = (items || []).filter((item) => !linked.has(item.id));
  const where = scope === "episode" ? "across this episode" : "for this card";
  if (scope === "card") {
    const addTile = `<li class="reference-add-tile reference-drop" data-ref-drop>
<button type="button" data-ref-pick>Upload</button><span>or</span>
<select data-ref-add aria-label="Choose a reference for this card" ${items ? "" : "disabled"}><option value="">${items ? "Choose…" : "Loading…"}</option>${choices.map((item) => `<option value="${esc(item.id)}">${esc(item.label)} · ${esc(item.category)} · ${esc(item.asset?.kind || item.sourceKind)}</option>`).join("")}</select>
</li>`;
    return `<section class="reference-panel card-reference-panel" data-ref-scope="card" data-ref-card="${esc(cardId)}" aria-label="References for this card">
<span class="reference-heading">References for this card <small>Optional</small></span>
<ul class="reference-list">${itemIds.map((itemId) => itemHTML(episodeId, itemId, library)).join("")}${addTile.repeat(Math.max(1, 2 - itemIds.length))}</ul>
<input type="file" data-ref-file multiple hidden>
<label class="reference-prompt">Reference prompt<textarea data-ref-prompt placeholder="What should these references inform for this card?">${esc(prompt)}</textarea></label>
<p class="reference-status" data-ref-status aria-live="polite"></p>
</section>`;
  }
  return `<section class="reference-panel" data-ref-scope="${scope}"${cardId ? ` data-ref-card="${esc(cardId)}"` : ""}>
<label class="reference-prompt">Reference prompt<textarea data-ref-prompt placeholder="Optional: how supporting material should inform the result ${where}">${esc(prompt)}</textarea></label>
${(itemIds || []).length ? `<ul class="reference-list">${itemIds.map((itemId) => itemHTML(episodeId, itemId, library)).join("")}</ul>` : `<p class="reference-empty">No reference attachments. Text, attachments, both or neither are all fine.</p>`}
<div class="reference-actions"><label>Add existing<select data-ref-add ${items ? "" : "disabled"}><option value="">${items ? (choices.length ? "Choose from this episode's library…" : "Every library item is already linked") : "Loading library…"}</option>${choices.map((item) => `<option value="${esc(item.id)}">${esc(item.label)} · ${esc(item.category)} · ${esc(item.asset?.kind || item.sourceKind)}</option>`).join("")}</select></label>
<div class="reference-drop" data-ref-drop tabindex="0">Drop reference files or <button type="button" data-ref-pick>upload</button><input type="file" data-ref-file multiple hidden></div></div>
<p class="reference-status" data-ref-status aria-live="polite"></p>
</section>`;
}

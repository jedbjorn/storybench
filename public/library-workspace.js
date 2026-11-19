import { libraryOpenUrl, withChannel } from "./preview-links.js";
import { icons } from "./icons.js";
import { createSegmentedChoice } from "./ui/segmented-choice.js";
import { addCandidate, bySlide, cleanupEligible, groupOf, notOnSlide, removeCandidate, slideNumber, slideOffers, tileState, TYPE_SECTIONS, typeOf, usage, usageText, useOnSlide, visualKind } from "./deck-library.js";
const categories = ["Reference", "B-roll", "Narration", "Graphics"];
// Deck productions do not show categories; an import is filed by what it is.
const deckCategory = (file) => file.type.startsWith("audio/") ? "Narration" : file.type.startsWith("image/") ? "Graphics" : file.type.startsWith("video/") ? "B-roll" : "Reference";
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);

async function readDirectoryEntries(directory) {
  const reader = directory.createReader();
  const entries = [];
  while (true) {
    const batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
    if (!batch.length) return entries;
    entries.push(...batch);
  }
}

async function filesFromEntry(entry) {
  if (entry.isFile)
    return [await new Promise((resolve, reject) => entry.file(resolve, reject))];
  if (!entry.isDirectory) return [];
  const entries = await readDirectoryEntries(entry);
  return (await Promise.all(entries.map(filesFromEntry))).flat();
}

export async function filesFromDataTransfer(dataTransfer) {
  const entries = [...(dataTransfer.items || [])]
    .map((item) => item.webkitGetAsEntry?.())
    .filter(Boolean);
  if (!entries.length) return [...(dataTransfer.files || [])];
  return (await Promise.all(entries.map(filesFromEntry))).flat();
}

export async function uploadLibraryFile({ episodeId, file, label = file.name, category, signal }) {
  const response = await fetch(`/api/episodes/${episodeId}/library/files`, {
    method: "POST",
    headers: {
      "x-file-name": encodeURIComponent(file.name),
      "x-library-label": encodeURIComponent(label),
      "x-library-category": category,
      "content-type": file.type || "application/octet-stream",
    },
    body: file,
    signal,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Import failed (${response.status})`);
  return data;
}

export class LibraryWorkspace {
  // beforeDelete flushes unsaved production edits before a delete or a slide change from the library.
  constructor({ api, toast, getEpisode, refreshState, preview, beforeDelete = () => {}, onMutation = () => {}, onAskForAnother = () => {} }) {
    this.preview = preview;
    this.api = api;
    this.toast = toast;
    this.getEpisode = getEpisode;
    this.refreshState = refreshState;
    this.beforeDelete = beforeDelete;
    this.onMutation = onMutation;
    this.onAskForAnother = onAskForAnother;
    this.items = [];
    this.groupBy = "slide";
    this.filter = "all";
    this.importQueue = Promise.resolve();
    this.groups = document.querySelector("#libraryGroups");
    this.progress = document.querySelector("#libraryProgress");
    this.importModal = document.querySelector("#libraryImportModal");
    this.deckBar = document.querySelector("#libraryDeckBar");
    this.assetPanel = document.querySelector("#libraryAssetDeck");
    this.cleanupModal = document.querySelector("#libraryCleanupModal");
    this.bind();
  }
  bind() {
    document.querySelector("#openLibraryImport").onclick = () => { document.querySelector("#libraryImportError").textContent = ""; this.importModal.showModal(); };
    document.querySelector("#pickLibraryFiles").onclick = () => document.querySelector("#libraryFiles").click();
    document.querySelector("#pickLibraryFolder").onclick = () => document.querySelector("#libraryFolder").click();
    for (const input of [document.querySelector("#libraryFiles"), document.querySelector("#libraryFolder")])
      input.onchange = (event) => { this.queueFiles([...event.target.files]); event.target.value = ""; };
    const dropzone = document.querySelector("#libraryDropzone");
    dropzone.ondragover = (event) => { event.preventDefault(); dropzone.classList.add("drag-over"); };
    dropzone.ondragleave = () => dropzone.classList.remove("drag-over");
    dropzone.ondrop = async (event) => {
      event.preventDefault(); dropzone.classList.remove("drag-over");
      try { this.queueFiles(await filesFromDataTransfer(event.dataTransfer)); }
      catch (error) { this.showImportError(`Could not read the dropped folder: ${error.message}`); }
    };
    dropzone.onkeydown = (event) => { if (["Enter", " "].includes(event.key)) document.querySelector("#libraryFiles").click(); };
    document.querySelector("#importLibraryText").onclick = () => this.addText();
    document.querySelector("#importLibraryUrl").onclick = () => this.addUrl();
    document.querySelector("#startLibraryFiles").onclick = () => this.startFiles();
    document.querySelector("#cancelLibraryFiles").onclick = () => this.cancelFiles();
    this.groups.onclick = (event) => {
      const use = event.target.closest("[data-library-use]");
      if (use) return this.changeSlide(use.dataset.librarySlide, (slide) => useOnSlide(slide, this.item(use.dataset.libraryUse)));
      const deleteId = event.target.closest("[data-library-delete]")?.dataset.libraryDelete;
      if (deleteId) return this.deleteItem(deleteId);
      const id = event.target.closest("[data-library-edit]")?.dataset.libraryEdit;
      if (id) this.openEdit(id);
    };
    // Only the grip is draggable; the whole card is the drag image.
    this.groups.ondragstart = (event) => {
      const item = event.target.closest?.("[data-library-grip]")?.closest("[data-library-item]");
      if (!item) return;
      event.dataTransfer.setData("text/library-item", item.dataset.libraryItem);
      event.dataTransfer.setDragImage(item, 20, 20);
    };
    this.groups.ondragover = (event) => { if (event.target.closest("[data-library-category]")) event.preventDefault(); };
    this.groups.ondrop = async (event) => {
      const group = event.target.closest("[data-library-category]");
      const id = event.dataTransfer.getData("text/library-item");
      if (!group || !id) return;
      event.preventDefault();
      await this.move(id, group.dataset.libraryCategory);
    };
    document.querySelector("#libraryEditForm").onsubmit = (event) => { event.preventDefault(); this.saveEdit(); };
    this.bindDeck();
  }
  // Deck productions (spec #46 'Media Library'): By slide or By type, the Not on a slide filter, Clean up,
  // and the asset preview's iterations and slides.
  bindDeck() {
    const groupBy = createSegmentedChoice({ label: "Group the library", value: this.groupBy, options: [{ value: "slide", label: "By slide" }, { value: "type", label: "By type" }],
      onChange: (value) => { this.groupBy = value; this.render(); } });
    const filter = createSegmentedChoice({ label: "Show", value: this.filter, options: [{ value: "all", label: "All" }, { value: "unused", label: "Not on a slide" }],
      onChange: (value) => { this.filter = value; this.render(); } });
    this.deckBar.prepend(groupBy.element, filter.element);
    document.querySelector("#openLibraryCleanup").onclick = () => this.openCleanup();
    const form = document.querySelector("#libraryCleanupForm");
    form.onchange = () => this.countCleanup();
    form.onsubmit = (event) => { event.preventDefault(); this.cleanUp(); };
    this.cleanupModal.addEventListener("click", (event) => { if (event.target.closest("[data-library-cleanup-close]")) this.cleanupModal.close(); });
    this.assetPanel.onclick = (event) => {
      const target = event.target.closest("button");
      if (!target || target.disabled || !this.editing) return;
      const item = this.editing, data = target.dataset;
      if (data.assetIteration) return this.openEdit(data.assetIteration);
      if ("assetAsk" in data) return this.askForAnother(item);
      if (data.assetUse) return this.changeSlide(data.assetUse, (slide) => useOnSlide(slide, item));
      if (data.assetRemove) return this.changeSlide(data.assetRemove, (slide) => removeCandidate(slide, item.id));
      if ("assetPick" in data) { const row = this.assetPanel.querySelector("[data-asset-add-row]"); row.hidden = !row.hidden; if (!row.hidden) row.querySelector("select").focus(); return; }
      if ("assetAdd" in data) return this.changeSlide(this.assetPanel.querySelector("[data-asset-slide]").value, (slide) => addCandidate(slide, item));
    };
  }
  item(id) { return this.items.find((candidate) => candidate.id === id); }
  isDeck() { return this.getEpisode()?.kind === "deck"; }
  async open() {
    const episode = this.getEpisode();
    if (!episode) return;
    const identity = episode.id;
    const items = await this.api(`/api/episodes/${identity}/library`);
    if (this.getEpisode()?.id !== identity) return;
    this.items = items;
    // An open asset preview follows the refreshed item (its revision, slides and iterations).
    if (this.editing && this.preview.dialog?.open) {
      const editing = this.item(this.editing.id);
      if (editing) { this.editing = editing; this.renderAssetPanel(editing); }
    }
    this.render();
  }
  // Items removed on the server (redline images when a new chat starts) leave the open panel without a reload.
  drop(episodeId, itemIds) {
    if (this.getEpisode()?.id !== episodeId || !this.items?.length) return;
    const removed = new Set(itemIds), remaining = this.items.filter((item) => !removed.has(item.id));
    if (remaining.length === this.items.length) return;
    this.items = remaining;
    this.render();
  }
  render() {
    const deck = this.isDeck();
    this.deckBar.hidden = !deck;
    document.querySelector("#libraryImportCategoryField").hidden = deck;
    if (deck) { this.groups.innerHTML = this.deckHTML(); return; }
    this.groups.innerHTML = categories.map((category) => {
      const items = this.items.filter((item) => item.category === category);
      return `<section class="library-group" data-library-category="${category}"><div class="library-group-heading"><h3>${category}</h3><span>${items.length}</span></div><div class="asset-grid">${items.map((item) => this.card(item)).join("") || '<p class="library-empty">Drop library items here, or import above.</p>'}</div></section>`;
    }).join("");
  }
  deckHTML() {
    const slides = this.getEpisode().cards ?? [], tiles = (items, options) => items.map((item) => this.card(item, this.deckTile(item, options))).join("");
    const section = (heading, count, body, key) => `<section class="library-group" data-library-section="${key}"><div class="library-group-heading"><h3>${heading}</h3><span>${count}</span></div><div class="asset-grid">${body || '<p class="library-empty">Nothing here.</p>'}</div></section>`;
    if (this.groupBy === "type") {
      const shown = this.filter === "unused" ? notOnSlide(slides, this.items) : this.items;
      return TYPE_SECTIONS.map(([type, heading]) => {
        const items = shown.filter((item) => typeOf(item) === type);
        return this.filter === "unused" && !items.length ? "" : section(heading, items.length, tiles(items, { slides }), type);
      }).join("") || section("Not on a slide", 0, "", "unused");
    }
    if (this.filter === "unused") { const items = notOnSlide(slides, this.items); return section("Not on any slide yet", items.length, tiles(items, { slides }), "unused"); }
    const { slides: used, unused, context } = bySlide(slides, this.items);
    return [
      ...used.map(({ slide, index, groups }) => section(`<span class="library-slide-number">${slideNumber(index)}</span> ${esc(slide.title)}`, groups.flat().length, groups.map((group) => tiles(group, { slide })).join(""), `slide-${esc(slide.id)}`)),
      section("Not on any slide yet", unused.flat().length, unused.map((group) => tiles(group, { slides })).join(""), "unused"),
      section("References and audio", context.length, tiles(context, {}), "context"),
    ].join("");
  }
  // A deck tile's extras: its iteration, and its state on `slide` (By slide) or where it is used (`slides`).
  deckTile(item, { slide = null, slides = null }) {
    const group = groupOf(this.items, item), label = esc(item.label);
    const version = group.length > 1 ? `<span class="library-version" title="Iteration ${item.iteration} of ${group.length}">v${item.iteration}</span>` : "";
    let status = "";
    if (slide) {
      const state = tileState(slide, item.id);
      status = state === "on" ? '<span class="library-state on">★ On slide</span>'
        : state === "candidate" ? `<span class="library-state candidate">Candidate</span><button type="button" data-library-use="${item.id}" data-library-slide="${esc(slide.id)}" aria-label="Use ${label} on slide ${esc(slide.title)}">Use on slide</button>`
        : '<span class="library-state">Not a candidate here</span>';
      return { grip: false, version, status: `<div class="library-status">${status}</div>`, className: ` library-${state}` };
    }
    if (slides && visualKind(item)) status = `<div class="library-status"><span class="library-state">${esc(usageText(slides, item.id) || "Not on a slide")}</span></div>`;
    return { grip: false, version, status, className: "" };
  }
  // Video productions call card(item); deck tiles pass their extras (no category grip).
  card(item, { grip = true, version = "", status = "", className = "" } = {}) {
    const base = `/api/episodes/${encodeURIComponent(item.episodeId)}/library/${encodeURIComponent(item.id)}`;
    const label = esc(item.label);
    let preview = '<div class="library-file-icon">◇</div>';
    if (item.asset.kind === "image") preview = `<img src="${base}/file" alt="">`;
    else if (item.asset.kind === "video") preview = `<video src="${base}/file" preload="metadata" muted></video>`;
    // A player is its own control, so an audio card opens from its Edit button only.
    const thumb = item.asset.kind === "audio" ? `<audio src="${base}/file" controls preload="metadata"></audio>`
      : `<button type="button" class="library-thumb" data-library-edit="${item.id}" aria-label="Open ${label}" title="Open">${preview}</button>`;
    const extraction = item.category === "Reference" ? `<span class="extraction ${item.extractionStatus}">${esc(item.extractionStatus)}</span>` : "";
    const handle = grip ? `<span class="library-grip" data-library-grip draggable="true" title="Drag to another category" aria-hidden="true">${icons.grip}</span>` : "";
    return `<article class="asset library-item${className}" data-library-item="${item.id}">${handle}${thumb}<div><b>${label}${version}</b><span>${esc(item.asset.kind)} ${extraction}</span>${status}<div class="library-card-actions"><div><button type="button" data-library-edit="${item.id}" aria-label="Edit ${label}">${icons.edit}Edit</button><a class="icon-button" href="${esc(this.downloadUrl(item))}" aria-label="Download ${label}" title="Download">${icons.download}</a></div><button type="button" class="icon-button danger" data-library-delete="${item.id}" aria-label="Delete ${label} from library" title="Delete">${icons.trash}</button></div></div></article>`;
  }
  downloadUrl(item) {
    const file = withChannel(`/api/episodes/${encodeURIComponent(item.episodeId)}/library/${encodeURIComponent(item.id)}/file`, item.asset.channelId || this.getEpisode()?.channelId);
    return `${file}${file.includes("?") ? "&" : "?"}download=1`;
  }
  // What the popup's viewer shows: the framed Preview page, or a player or file pane for anything it cannot show.
  viewer(item) {
    const channelId = item.asset.channelId || this.getEpisode()?.channelId;
    const open = libraryOpenUrl(item, channelId);
    if (open.startsWith("/preview/")) return { url: open };
    const download = `<a class="button" href="${esc(this.downloadUrl(item))}">${icons.download}Download</a>`;
    if (item.asset.kind === "audio") return { file: `<audio src="${esc(open)}" controls preload="metadata"></audio>${download}` };
    return { file: `<div class="library-file-icon" aria-hidden="true">◇</div><p>${esc(item.asset.name || item.label)}</p>${download}` };
  }
  queueFiles(files) {
    if (!files.length) return;
    if (this.importController) return this.showImportError("Wait for the current import or cancel it first.");
    const category = document.querySelector("#libraryImportCategory").value, deck = this.isDeck();
    const pending = this.pendingRows || [];
    this.pendingRows = [...pending, ...files.map((file, offset) => ({ file, index: pending.length + offset, label: file.name, category: deck ? deckCategory(file) : category, state: "Waiting" }))];
    const categoryField = (row) => deck ? "" : `<label>Category <select data-import-category>${categories.map((value) => `<option ${value === row.category ? "selected" : ""}>${value}</option>`).join("")}</select></label>`;
    document.querySelector("#libraryImportQueue").innerHTML = this.pendingRows.map((row) => `<fieldset data-import-row="${row.index}"><legend>${esc(row.file.webkitRelativePath || row.file.name)}</legend><label>Label <input data-import-label value="${esc(row.label)}"></label>${categoryField(row)}</fieldset>`).join("");
    document.querySelector("#startLibraryFiles").hidden = false;
  }
  startFiles() {
    if (!this.pendingRows?.length) return;
    const episodeId = this.getEpisode()?.id;
    if (!episodeId) return;
    for (const element of document.querySelectorAll("[data-import-row]")) {
      const row = this.pendingRows[Number(element.dataset.importRow)];
      row.label = element.querySelector("[data-import-label]").value;
      row.category = element.querySelector("[data-import-category]")?.value ?? row.category;
    }
    const rows = this.pendingRows;
    this.pendingRows = null;
    const controller = new AbortController();
    this.importController = controller;
    document.querySelector("#startLibraryFiles").hidden = true;
    document.querySelector("#cancelLibraryFiles").hidden = false;
    this.showProgress(rows);
    this.importQueue = this.importQueue.catch(() => {}).then(async () => {
      await runImportBatch({ rows, episodeId, signal: controller.signal, onChange: () => this.showProgress(rows), upload: (row, signal) => uploadLibraryFile({ episodeId, file: row.file, label: row.label, category: row.category, signal }) });
      document.querySelector("#cancelLibraryFiles").hidden = true;
      if (this.importController === controller) this.importController = null;
      document.querySelector("#libraryImportQueue").innerHTML = "";
      await this.refreshState?.();
      await this.onMutation();
      if (this.getEpisode()?.id === episodeId) await this.open();
      const failures = rows.filter((row) => row.state.startsWith("Failed") || row.state === "Cancelled");
      this.toast(failures.length ? `${rows.length - failures.length} imported; ${failures.length} failed or cancelled` : `${rows.length} imported`);
    });
  }
  cancelFiles() { this.importController?.abort(); }
  showProgress(rows) {
    this.progress.innerHTML = rows.map((row) => `<div><b>${esc(row.file.name)}</b><span class="${row.state.startsWith("Failed") ? "failed" : ""}">${esc(row.state)}</span></div>`).join("");
  }
  async addText() {
    const text = document.querySelector("#libraryText").value;
    if (!text) return this.showImportError("Paste reference text first.");
    await this.addReference("text", { title: document.querySelector("#libraryTextTitle").value, text });
  }
  async addUrl() {
    const url = document.querySelector("#libraryUrl").value;
    if (!url) return this.showImportError("Enter a public URL first.");
    await this.addReference("url", { url });
  }
  async addReference(kind, body) {
    try {
      await this.api(`/api/episodes/${this.getEpisode().id}/library/${kind}`, { method: "POST", body: JSON.stringify(body) });
      this.importModal.close(); await this.open(); await this.onMutation(); this.toast("Reference added");
    } catch (error) { this.showImportError(error.message); }
  }
  showImportError(message) { document.querySelector("#libraryImportError").textContent = message; }
  openEdit(id) {
    const item = this.items.find((candidate) => candidate.id === id);
    if (!item) return;
    this.editing = item;
    const form = document.querySelector("#libraryEditForm");
    form.elements.label.value = item.label;
    form.elements.category.value = item.category;
    form.elements.tags.value = item.tags.join(", ");
    form.elements.notes.value = item.notes;
    form.querySelector("[data-library-category-field]").hidden = this.isDeck();
    form.querySelector("[data-library-edit-error]").textContent = "";
    this.renderAssetPanel(item);
    this.preview.open({ ...this.viewer(item), title: item.label, aside: true });
  }
  // The asset preview for a deck (spec #46 'Asset preview'): the iteration strip and Ask for another; the
  // slides this iteration is on, with Use and remove; Candidate for a slide; a drawing's parts, read-only.
  renderAssetPanel(item) {
    const panel = this.assetPanel, deck = this.isDeck();
    panel.hidden = !deck;
    if (!deck) { panel.innerHTML = ""; return; }
    const slides = this.getEpisode().cards ?? [], group = groupOf(this.items, item), kind = visualKind(item);
    const strip = `<div class="library-iteration-strip" role="group" aria-label="Iterations">${group.map((value) => `<button type="button" data-asset-iteration="${value.id}" aria-pressed="${value.id === item.id}" aria-label="Iteration ${value.iteration}">v${value.iteration}</button>`).join("")}${kind ? '<button type="button" data-asset-ask>Ask for another</button>' : ""}</div>`;
    if (!kind) { panel.innerHTML = `<h3>Iterations</h3>${strip}<p class="help">References and audio are context for the assistant; they are never on a slide.</p>`; return; }
    const uses = usage(slides, item.id);
    const rows = uses.map(({ slide, index, state }) => `<li data-asset-slide-row="${esc(slide.id)}"><span><b>${slideNumber(index)}</b> ${esc(slide.title)}</span>${state === "on"
      ? `<span class="library-state on">★ On slide</span><button type="button" data-asset-remove="${esc(slide.id)}" disabled title="Starred on this slide: star another first">Remove</button>`
      : `<button type="button" data-asset-use="${esc(slide.id)}">Use</button><button type="button" data-asset-remove="${esc(slide.id)}">Remove</button>`}</li>`).join("");
    const offers = slides.map((slide, index) => ({ slide, index })).filter(({ slide }) => slideOffers(slide, item) && !uses.some((use) => use.slide === slide));
    const add = offers.length ? `<button type="button" data-asset-pick>Candidate for a slide…</button><div class="library-add-candidate" data-asset-add-row hidden><select data-asset-slide aria-label="Slide">${offers.map(({ slide, index }) => `<option value="${esc(slide.id)}">${slideNumber(index)} ${esc(slide.title)}</option>`).join("")}</select><button type="button" data-asset-add>Add</button></div>` : "";
    const parts = kind === "drawing" ? `<h3>Parts</h3><p class="help">The slide decides when each part appears.</p><ul class="library-parts">${(item.asset.metadata?.svgGroupIds ?? []).map((id) => `<li>${esc(id)}</li>`).join("") || "<li>No named parts</li>"}</ul>` : "";
    panel.innerHTML = `<h3>Iterations</h3>${strip}<h3>On slides</h3><ul class="library-on-slides">${rows || '<li class="library-empty">Not on any slide yet.</li>'}</ul>${add}${parts}`;
  }
  askForAnother(item) {
    this.preview.close();
    this.onAskForAnother(`Make another iteration of “${item.label}” (library item ${item.id}, v${item.iteration}). Register it with iterationOf ${item.id} so it joins this asset's iterations; do not add it to a slide. What to change: `);
  }
  // One slide change from the library, saved through the deck's revision check; the server validates it.
  async changeSlide(slideId, change) {
    const episode = this.getEpisode();
    if (!episode || episode.kind !== "deck") return;
    try {
      await this.beforeDelete();
      const current = this.getEpisode();
      if (current?.id !== episode.id) return;
      const slides = current.cards.map((slide) => slide.id === slideId ? change(slide) : slide);
      await this.api(`/api/episodes/${current.id}/slides`, { method: "PUT", body: JSON.stringify({ expectedRevision: current.revision, slides }) });
      await this.refreshState?.();
      if (this.getEpisode()?.id === episode.id) await this.open();
      await this.onMutation();
    } catch (error) { this.toast(error.message); }
  }
  openCleanup() {
    const episode = this.getEpisode();
    if (!episode) return;
    const eligible = cleanupEligible(episode, this.items);
    document.querySelector("#libraryCleanupRows").innerHTML = eligible.map((item) => `<label class="cleanup-row"><input type="checkbox" value="${item.id}"><span><b>${esc(item.label)} v${item.iteration}</b><small>${esc(typeOf(item))} · iteration ${item.iteration} of ${groupOf(this.items, item).length}</small></span></label>`).join("")
      || '<p class="library-empty">Nothing to clean up: every iteration is starred, a candidate or a reference.</p>';
    this.cleanupModal.querySelector("[data-library-cleanup-error]").textContent = "";
    this.countCleanup();
    this.cleanupModal.showModal();
  }
  countCleanup() {
    const selected = this.cleanupModal.querySelectorAll("#libraryCleanupRows input:checked").length, submit = document.querySelector("#libraryCleanupSubmit");
    submit.disabled = !selected;
    submit.textContent = selected ? `Delete ${selected} selected` : "Delete selected";
  }
  // Deletes only the ticked iterations, one at a time; each delete is checked by the server's guard.
  async cleanUp() {
    const episode = this.getEpisode(), error = this.cleanupModal.querySelector("[data-library-cleanup-error]");
    const ids = [...this.cleanupModal.querySelectorAll("#libraryCleanupRows input:checked")].map((input) => input.value);
    if (!episode || !ids.length) return;
    let deleted = 0;
    try {
      await this.beforeDelete();
      let revision = this.getEpisode().revision;
      for (const id of ids) {
        const item = this.item(id);
        if (!item) continue;
        revision = (await this.api(`/api/episodes/${episode.id}/library/${id}`, { method: "DELETE", body: JSON.stringify({ expectedRevision: item.revision, expectedEpisodeRevision: revision }) })).revision;
        deleted += 1;
      }
      this.cleanupModal.close();
    } catch (failure) { error.textContent = failure.message; }
    await this.refreshState?.();
    if (this.getEpisode()?.id === episode.id) await this.open();
    await this.onMutation();
    if (deleted) this.toast(`${deleted} ${deleted === 1 ? "iteration" : "iterations"} deleted`);
  }
  async saveEdit() {
    const form = document.querySelector("#libraryEditForm");
    const body = { expectedRevision: this.editing.revision, label: form.elements.label.value, category: form.elements.category.value, tags: form.elements.tags.value.split(",").map((tag) => tag.trim()).filter(Boolean), notes: form.elements.notes.value };
    try {
      await this.api(`/api/episodes/${this.getEpisode().id}/library/${this.editing.id}`, { method: "PUT", body: JSON.stringify(body) });
      this.preview.close(); await this.open(); await this.onMutation(); this.toast("Library item saved");
    } catch (error) { form.querySelector("[data-library-edit-error]").textContent = error.message; }
  }
  async deleteItem(id) {
    const item = this.items.find((candidate) => candidate.id === id);
    const episode = this.getEpisode();
    if (!item || !episode || item.episodeId !== episode.id) return;
    const uses = episode.kind === "deck" ? usage(episode.cards, id) : [], starred = uses.find((use) => use.state === "on");
    // The server refuses a starred asset too; saying so here skips a confirm that cannot succeed.
    if (starred) return this.toast(`“${item.label}” is starred on slide ${slideNumber(starred.index)}; star another there first`);
    const message = episode.kind !== "deck" ? `Delete “${item.label}” from this production’s library? It will also be removed from any cards and references using it. This cannot be undone.`
      : `Delete “${item.label}” from this deck’s library?${uses.length ? ` It is a candidate on slide ${uses.map((use) => slideNumber(use.index)).join(", ")} and will be removed from ${uses.length === 1 ? "it" : "them"}.` : ""} This cannot be undone.`;
    if (!window.confirm(message)) return;
    try {
      await this.beforeDelete();
      const current = this.getEpisode();
      if (current?.id !== episode.id) return;
      await this.api(`/api/episodes/${episode.id}/library/${id}`, { method: "DELETE",
        body: JSON.stringify({ expectedRevision: item.revision, expectedEpisodeRevision: current.revision }) });
      await this.refreshState?.();
      if (this.getEpisode()?.id === episode.id) await this.open();
      await this.onMutation();
      this.toast("Library item deleted");
    } catch (error) { this.toast(error.message); }
  }
  async move(id, category) {
    const item = this.items.find((candidate) => candidate.id === id);
    if (!item || item.category === category) return;
    try { await this.api(`/api/episodes/${item.episodeId}/library/${id}`, { method: "PUT", body: JSON.stringify({ expectedRevision: item.revision, category }) }); await this.open(); await this.onMutation(); }
    catch (error) { this.toast(error.message); }
  }
}

export async function runImportBatch({ rows, episodeId, upload, signal, onChange = () => {} }) {
  for (const row of rows) {
    if (signal?.aborted) { row.state = "Cancelled"; onChange(); continue; }
    row.state = "Importing"; onChange();
    try { await upload(row, signal, episodeId); row.state = "Imported"; }
    catch (error) { row.state = signal?.aborted || error.name === "AbortError" ? "Cancelled" : `Failed: ${error.message}`; }
    onChange();
  }
  return rows;
}

export function episodeNavigatorHTML(episodes, filter, selectedId) {
  const states = ["Scaffold", "Draft", "Final", "Published"];
  const options = (selected) => [...states, "Archived"].map((value) => `<option ${selected === value ? "selected" : ""}>${value}</option>`).join("");
  const rowsHTML = (rows, selected) => rows.map((episode) => `<div class="episode-row" draggable="true" data-id="${episode.id}"><button data-episode-select class="${selectedId === episode.id ? "active" : ""}"><span>${esc(episode.title)}</span> <small>${episode.kind === "deck" ? "Deck" : "Episode"}</small></button><select data-episode-state-select aria-label="Move ${esc(episode.title)}">${options(selected)}</select></div>`).join("");
  const active = states.map((state) => {
    if (filter !== "All" && filter !== state) return "";
    const rows = episodes.filter((episode) => !episode.archivedAt && episode.state === state);
    return `<section class="episode-group" data-episode-state="${state}"><h3>${state}<span>${rows.length}</span></h3>${rowsHTML(rows, state) || '<p class="episode-empty">Drop production here</p>'}</section>`;
  }).join("");
  if (filter !== "All" && filter !== "Archived") return active;
  const archived = episodes.filter((episode) => episode.archivedAt);
  const rows = filter === "Archived" ? rowsHTML(archived, "Archived") : "";
  const empty = filter === "Archived" || !archived.length ? "Drop production here to archive" : `${archived.length} ${archived.length === 1 ? "production" : "productions"} hidden`;
  return `${active}<section class="episode-group episode-group-archived" data-episode-state="Archived"><h3>Archived<span>${archived.length}</span></h3>${rows || `<p class="episode-empty">${empty}</p>`}</section>`;
}

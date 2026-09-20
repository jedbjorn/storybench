const categories = ["Reference", "B-roll", "Narration", "Graphics"];
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);

export class LibraryWorkspace {
  constructor({ api, toast, getEpisode, refreshState }) {
    this.api = api;
    this.toast = toast;
    this.getEpisode = getEpisode;
    this.refreshState = refreshState;
    this.items = [];
    this.sections = [];
    this.importQueue = Promise.resolve();
    this.groups = document.querySelector("#libraryGroups");
    this.progress = document.querySelector("#libraryProgress");
    this.importModal = document.querySelector("#libraryImportModal");
    this.editModal = document.querySelector("#libraryEditModal");
    this.bind();
  }
  bind() {
    document.querySelector("#openLibraryImport").onclick = () => { document.querySelector("#libraryImportError").textContent = ""; this.importModal.showModal(); };
    document.querySelector("#pickLibraryFiles").onclick = () => document.querySelector("#libraryFiles").click();
    document.querySelector("#libraryFiles").onchange = (event) => this.queueFiles([...event.target.files]);
    const dropzone = document.querySelector("#libraryDropzone");
    dropzone.ondragover = (event) => { event.preventDefault(); dropzone.classList.add("drag-over"); };
    dropzone.ondragleave = () => dropzone.classList.remove("drag-over");
    dropzone.ondrop = (event) => { event.preventDefault(); dropzone.classList.remove("drag-over"); this.queueFiles([...event.dataTransfer.files]); };
    dropzone.onkeydown = (event) => { if (["Enter", " "].includes(event.key)) document.querySelector("#libraryFiles").click(); };
    document.querySelector("#importLibraryText").onclick = () => this.addText();
    document.querySelector("#importLibraryUrl").onclick = () => this.addUrl();
    document.querySelector("#startLibraryFiles").onclick = () => this.startFiles();
    document.querySelector("#cancelLibraryFiles").onclick = () => this.cancelFiles();
    this.groups.onclick = (event) => {
      const id = event.target.closest("[data-library-edit]")?.dataset.libraryEdit;
      if (id) this.openEdit(id);
    };
    this.groups.ondragstart = (event) => {
      const item = event.target.closest("[data-library-item]");
      if (item) event.dataTransfer.setData("text/library-item", item.dataset.libraryItem);
    };
    this.groups.ondragover = (event) => { if (event.target.closest("[data-library-category]")) event.preventDefault(); };
    this.groups.ondrop = async (event) => {
      const group = event.target.closest("[data-library-category]");
      const id = event.dataTransfer.getData("text/library-item");
      if (!group || !id) return;
      event.preventDefault();
      await this.move(id, group.dataset.libraryCategory);
    };
    this.editModal.querySelectorAll("[data-library-close]").forEach((button) => button.onclick = () => this.editModal.close());
    document.querySelector("#libraryEditForm").onsubmit = (event) => { event.preventDefault(); this.saveEdit(); };
  }
  async open() {
    const episode = this.getEpisode();
    if (!episode) return;
    const identity = episode.id;
    const [items, story] = await Promise.all([this.api(`/api/episodes/${identity}/library`), this.api(`/api/episodes/${identity}/story`)]);
    if (this.getEpisode()?.id !== identity) return;
    this.items = items;
    this.sections = story.sections || [];
    this.render();
  }
  render() {
    this.groups.innerHTML = categories.map((category) => {
      const items = this.items.filter((item) => item.category === category);
      return `<section class="library-group" data-library-category="${category}"><div class="library-group-heading"><h3>${category}</h3><span>${items.length}</span></div><div class="asset-grid">${items.map((item) => this.card(item)).join("") || '<p class="library-empty">Drop items here or change their category.</p>'}</div></section>`;
    }).join("");
  }
  card(item) {
    const base = `/api/episodes/${encodeURIComponent(item.episodeId)}/library/${encodeURIComponent(item.id)}`;
    let preview = '<div class="library-file-icon">◇</div>';
    if (item.asset.kind === "image") preview = `<img src="${base}/file" alt="">`;
    else if (item.asset.kind === "video") preview = `<video src="${base}/file" preload="metadata" muted></video>`;
    else if (item.asset.kind === "audio") preview = `<audio src="${base}/file" controls preload="metadata"></audio>`;
    const extraction = item.category === "Reference" ? `<span class="extraction ${item.extractionStatus}">${esc(item.extractionStatus)}</span>` : "";
    return `<article class="asset library-item" draggable="true" data-library-item="${item.id}">${preview}<div><b>${esc(item.label)}</b><span>${esc(item.asset.kind)} ${extraction}</span>${item.sectionId ? `<span>Story section: ${esc(this.sections.find((section) => section.id === item.sectionId)?.title || "Unavailable")}</span>` : ""}<div class="library-card-actions"><a href="${base}/file" target="_blank">Open</a><button data-library-edit="${item.id}">Edit</button></div></div></article>`;
  }
  queueFiles(files) {
    if (!files.length) return;
    if (this.importController) return this.showImportError("Wait for the current import or cancel it first.");
    const category = document.querySelector("#libraryImportCategory").value;
    this.pendingRows = files.map((file, index) => ({ file, index, label: file.name, category, sectionId: "", state: "Waiting" }));
    const sectionOptions = `<option value="">No story section</option>${this.sections.map((section) => `<option value="${section.id}">${esc(section.title)}</option>`).join("")}`;
    document.querySelector("#libraryImportQueue").innerHTML = this.pendingRows.map((row) => `<fieldset data-import-row="${row.index}"><legend>${esc(row.file.name)}</legend><label>Label <input data-import-label value="${esc(row.label)}"></label><label>Category <select data-import-category>${categories.map((value) => `<option ${value === row.category ? "selected" : ""}>${value}</option>`).join("")}</select></label><label>Story section <select data-import-section>${sectionOptions}</select></label></fieldset>`).join("");
    document.querySelector("#startLibraryFiles").hidden = false;
  }
  startFiles() {
    if (!this.pendingRows?.length) return;
    const episodeId = this.getEpisode()?.id;
    if (!episodeId) return;
    for (const element of document.querySelectorAll("[data-import-row]")) {
      const row = this.pendingRows[Number(element.dataset.importRow)];
      row.label = element.querySelector("[data-import-label]").value;
      row.category = element.querySelector("[data-import-category]").value;
      row.sectionId = element.querySelector("[data-import-section]").value;
    }
    const rows = this.pendingRows;
    this.pendingRows = null;
    const controller = new AbortController();
    this.importController = controller;
    document.querySelector("#startLibraryFiles").hidden = true;
    document.querySelector("#cancelLibraryFiles").hidden = false;
    this.showProgress(rows);
    this.importQueue = this.importQueue.catch(() => {}).then(async () => {
      await runImportBatch({ rows, episodeId, signal: controller.signal, onChange: () => this.showProgress(rows), upload: async (row, signal) => {
        const response = await fetch(`/api/episodes/${episodeId}/library/files`, { method: "POST", headers: { "x-file-name": encodeURIComponent(row.file.name), "x-library-label": encodeURIComponent(row.label), "x-library-category": row.category, "x-story-section-id": row.sectionId, "content-type": row.file.type || "application/octet-stream" }, body: row.file, signal });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || `Import failed (${response.status})`);
      }});
      document.querySelector("#cancelLibraryFiles").hidden = true;
      if (this.importController === controller) this.importController = null;
      document.querySelector("#libraryImportQueue").innerHTML = "";
      await this.refreshState?.();
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
      this.importModal.close(); await this.open(); this.toast("Reference added");
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
    form.elements.sectionId.innerHTML = `<option value="">No story section</option>${this.sections.map((section) => `<option value="${section.id}" ${section.id === item.sectionId ? "selected" : ""}>${esc(section.title)}</option>`).join("")}`;
    form.querySelector("[data-library-edit-error]").textContent = "";
    this.editModal.showModal();
  }
  async saveEdit() {
    const form = document.querySelector("#libraryEditForm");
    const body = { expectedRevision: this.editing.revision, label: form.elements.label.value, category: form.elements.category.value, tags: form.elements.tags.value.split(",").map((tag) => tag.trim()).filter(Boolean), notes: form.elements.notes.value, sectionId: form.elements.sectionId.value || null };
    try {
      await this.api(`/api/episodes/${this.getEpisode().id}/library/${this.editing.id}`, { method: "PUT", body: JSON.stringify(body) });
      this.editModal.close(); await this.open(); this.toast("Library item saved");
    } catch (error) { form.querySelector("[data-library-edit-error]").textContent = error.message; }
  }
  async move(id, category) {
    const item = this.items.find((candidate) => candidate.id === id);
    if (!item || item.category === category) return;
    try { await this.api(`/api/episodes/${item.episodeId}/library/${id}`, { method: "PUT", body: JSON.stringify({ expectedRevision: item.revision, category }) }); await this.open(); }
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
  return ["Scaffold", "Draft", "Final", "Published"].map((state) => {
    const rows = episodes.filter((episode) => episode.state === state && (filter === "All" || filter === state));
    if (filter !== "All" && filter !== state) return "";
    return `<section class="episode-group" data-episode-state="${state}"><h3>${state}<span>${rows.length}</span></h3>${rows.map((episode) => `<div class="episode-row" draggable="true" data-id="${episode.id}"><button data-episode-select class="${selectedId === episode.id ? "active" : ""}">${esc(episode.title)}</button><select data-episode-state-select aria-label="Move ${esc(episode.title)}"><option ${state === "Scaffold" ? "selected" : ""}>Scaffold</option><option ${state === "Draft" ? "selected" : ""}>Draft</option><option ${state === "Final" ? "selected" : ""}>Final</option><option ${state === "Published" ? "selected" : ""}>Published</option></select></div>`).join("") || '<p class="episode-empty">Drop episode here</p>'}</section>`;
  }).join("");
}

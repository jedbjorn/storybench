const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const copy = (value) => structuredClone(value);
const content = (record) => ({ summary: record.summary, links: record.links });
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const httpUrl = (value) => {
  try { return /^https?:\/\//i.test(value) && ["http:", "https:"].includes(new URL(value).protocol) && !/\s/.test(value); }
  catch { return false; }
};

// One production-bound editor. All async results carry a generation; open drafts are never
// replaced by refresh. The shared server validator is authoritative for every manual save.
export class ResearchEditor {
  constructor({ root, api, renderMarkdown, confirm = (message) => root.ownerDocument.defaultView.confirm(message) }) {
    Object.assign(this, { root, api, renderMarkdown, confirm });
    this.episodeId = null;
    this.record = null;
    this.draft = null;
    this.generation = 0;
    this.version = 0;
    this.pending = null;
    this.leavePromise = null;
    root.addEventListener("click", (event) => this.click(event));
    root.addEventListener("input", (event) => {
      if (!this.draft) return;
      if (event.target.matches("[data-research-summary]")) this.draft.summary = event.target.value;
      else if (event.target.dataset.linkField) this.draft.links[Number(event.target.closest("[data-link-index]").dataset.linkIndex)][event.target.dataset.linkField] = event.target.value;
      else return;
      this.version++;
      this.status("Unsaved research changes. Save before sending them to the assistant.");
    });
    root.addEventListener("keydown", (event) => {
      if (this.draft && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") { event.preventDefault(); this.save(); }
    });
    this.draw();
  }
  isDirty() { return Boolean(this.draft && !same(this.draft, content(this.record))); }
  status(message, error = false) {
    const field = this.root.querySelector("[data-research-status]");
    if (field) { field.textContent = message; field.classList.toggle("error", error); }
  }
  async open(episodeId, { refresh = false } = {}) {
    if (this.episodeId === episodeId && (this.draft || this.pending || (this.record && !refresh))) return true;
    if (this.pending || this.isDirty()) return false;
    const generation = ++this.generation;
    if (this.episodeId !== episodeId) { this.record = null; this.draft = null; }
    this.episodeId = episodeId;
    this.loading = true;
    if (!this.record) this.draw();
    try {
      const record = await this.api(`/api/episodes/${encodeURIComponent(episodeId)}/research`);
      if (generation !== this.generation || this.draft) return false;
      if (this.record && same(record, this.record)) return true;
      this.record = record;
      this.draw();
      return true;
    } catch (error) {
      if (generation === this.generation) this.status(`Research could not be loaded: ${error.message}. Use Reload to retry.`, true);
      return false;
    } finally { if (generation === this.generation) this.loading = false; }
  }
  async refresh() {
    if (!this.episodeId || this.draft || this.pending || this.loading || this.root.hidden) return;
    return this.open(this.episodeId, { refresh: true });
  }
  close() {
    if (this.pending || this.isDirty()) return false;
    ++this.generation;
    this.episodeId = null; this.record = null; this.draft = null;
    this.draw();
    return true;
  }
  draw() {
    const editing = Boolean(this.draft);
    this.root.innerHTML = `<div class="panel-heading"><div><h2>Research</h2><p>Saved findings and source links for this production. Linked pages are never fetched automatically.</p></div><div>${editing ? '<button data-research-cancel>Cancel</button> <button data-research-save class="primary">Save</button>' : `<button data-research-reload>Reload</button> <button data-research-edit ${this.record ? "" : "disabled"}>Edit research</button>`}</div></div>
      <p data-research-status role="status" aria-live="polite"></p>
      ${editing ? `<fieldset data-research-fields><legend>Edit research</legend><div class="story-toolbar"><div class="story-mode"><button data-research-write class="active">Write</button><button data-research-preview>Preview</button></div></div><label>Summary (Markdown)<textarea data-research-summary rows="14"></textarea></label><article data-research-preview-body class="story-rendered" hidden></article><h3>Links</h3><div data-research-links></div><button data-research-add>Add link</button><p class="help">Summary: up to 1 MiB UTF-8. Up to 100 links; URL 8192 bytes, title 512 bytes, note 2048 bytes. Complete research JSON: 2 MiB. Oversized saves are rejected.</p></fieldset>
      <section data-research-conflict class="story-conflict" hidden><h3>Newer research is saved</h3><p>Your full draft is preserved. Compare the latest saved record, then reconcile your draft or reload it.</p><label>Latest saved summary and links<textarea data-research-current readonly rows="8"></textarea></label><button data-research-latest>Reload latest (discard draft)</button> <button data-research-reconcile>Keep draft and reconcile against latest</button></section>` : '<h3>Summary</h3><article data-research-read class="story-rendered"></article><h3>Links</h3><div data-research-sources></div>'}
      <dialog data-research-leave aria-labelledby="researchLeaveTitle" class="library-modal"><h2 id="researchLeaveTitle">Save research changes before continuing?</h2><p>The assistant and production actions use saved research. Your pending edits have not been saved.</p><div class="modal-actions"><button data-research-stay>Stay</button><button data-research-discard>Discard</button><button data-research-leave-save class="primary">Save</button></div></dialog>`;
    if (editing) {
      this.root.querySelector("[data-research-summary]").value = this.draft.summary;
      this.drawLinks();
    } else if (this.record) {
      this.markdown(this.root.querySelector("[data-research-read]"), this.record.summary || "_No research summary yet._");
      this.root.querySelector("[data-research-sources]").innerHTML = this.record.links.length ? `<ol>${this.record.links.map((link) => `<li><a href="${esc(httpUrl(link.url) ? link.url : "#")}" target="_blank" rel="noopener noreferrer">${esc(link.title || link.url)}</a>${link.note ? `<p>${esc(link.note)}</p>` : ""}</li>`).join("")}</ol>` : '<p class="library-empty">No source links yet. Add links to support your findings.</p>';
      this.status(`Saved research · r${this.record.researchRevision}${this.record.actor ? ` · ${this.record.actor}` : ""}`);
    } else this.status(this.episodeId ? "Loading research…" : "Open a production to read its research.");
  }
  markdown(target, source) {
    target.innerHTML = this.renderMarkdown(source);
    // The shared renderer disables HTML/images. Research links additionally stay external
    // and HTTP(S)-only, so even relative Markdown links cannot navigate away with a draft.
    for (const link of target.querySelectorAll("a")) {
      if (!httpUrl(link.getAttribute("href"))) link.removeAttribute("href");
      link.setAttribute("target", "_blank"); link.setAttribute("rel", "noopener noreferrer");
    }
  }
  drawLinks(focusIndex = null, field = "url") {
    this.root.querySelector("[data-research-links]").innerHTML = this.draft.links.map((link, i) => `<div class="research-link-editor" data-link-index="${i}" data-link-id="${esc(link.id)}"><label>URL ${i + 1}<input type="url" data-link-field="url" value="${esc(link.url)}"></label><label>Title (optional)<input data-link-field="title" value="${esc(link.title)}"></label><label>Relevance note (optional)<textarea rows="2" data-link-field="note">${esc(link.note)}</textarea></label><div><button data-research-up ${i ? "" : "disabled"} aria-label="Move link ${i + 1} up">Move up</button> <button data-research-down ${i < this.draft.links.length - 1 ? "" : "disabled"} aria-label="Move link ${i + 1} down">Move down</button> <button data-research-remove aria-label="Remove link ${i + 1}">Remove</button></div></div>`).join("");
    if (focusIndex !== null) (this.root.querySelector(`[data-link-index="${focusIndex}"] [data-link-field="${field}"]`) || this.root.querySelector("[data-research-add]")).focus();
  }
  edit() {
    if (!this.record || this.pending) return;
    ++this.generation; // Invalidate any idle refresh already in flight.
    this.loading = false;
    this.draft = copy(content(this.record)); this.latest = null; this.version++;
    this.draw();
    this.root.querySelector("[data-research-summary]").focus();
  }
  async save() {
    if (this.pending) return this.pending;
    if (!this.draft) return null;
    const generation = this.generation, episodeId = this.episodeId, version = this.version;
    const submitted = copy(this.draft);
    this.root.querySelector("[data-research-fields]").disabled = true;
    for (const button of this.root.querySelectorAll("[data-research-save], [data-research-cancel]")) button.disabled = true;
    this.status("Saving research…");
    this.pending = (async () => {
      try {
        const saved = await this.api(`/api/episodes/${encodeURIComponent(episodeId)}/research`, { method: "PUT", body: JSON.stringify({ expectedResearchRevision: this.record.researchRevision, ...submitted }) });
        if (generation !== this.generation) return null;
        this.record = saved;
        if (version === this.version) { this.draft = null; this.latest = null; this.draw(); this.root.querySelector("[data-research-edit]").focus(); }
        else this.status("Research saved; newer edits are still pending.");
        return this.isDirty() ? null : saved;
      } catch (error) {
        if (generation !== this.generation) return null;
        this.status(`Research save failed — draft preserved. ${error.message}`, true);
        if (error.status === 409 && error.current) {
          this.latest = error.current;
          this.root.querySelector("[data-research-conflict]").hidden = false;
          this.root.querySelector("[data-research-current]").value = JSON.stringify(error.current, null, 2);
        }
        return null;
      } finally {
        if (generation === this.generation) {
          this.pending = null;
          const fields = this.root.querySelector("[data-research-fields]"); if (fields) fields.disabled = false;
          for (const button of this.root.querySelectorAll("[data-research-save], [data-research-cancel]")) button.disabled = false;
        }
      }
    })();
    return this.pending;
  }
  async discard() {
    if (this.pending) return false;
    this.draft = null; this.latest = null;
    this.draw();
    await this.open(this.episodeId, { refresh: true });
    this.root.querySelector("[data-research-edit]")?.focus();
    return true;
  }
  async requestLeave() {
    if (this.leavePromise) return this.leavePromise;
    if (this.pending) await this.pending;
    if (!this.isDirty()) { if (this.draft) await this.discard(); return "discard"; }
    this.leavePromise = new Promise((resolve) => {
      const dialog = this.root.querySelector("[data-research-leave]"), previous = this.root.ownerDocument.activeElement;
      const finish = (choice) => {
        if (dialog.close) dialog.close(); else dialog.removeAttribute("open");
        this.leavePromise = null;
        if (choice === "stay") previous?.focus();
        resolve(choice);
      };
      dialog.oncancel = (event) => { event.preventDefault(); finish("stay"); };
      dialog.querySelector("[data-research-stay]").onclick = () => finish("stay");
      dialog.querySelector("[data-research-discard]").onclick = async () => { await this.discard(); finish("discard"); };
      dialog.querySelector("[data-research-leave-save]").onclick = async () => { if (await this.save()) finish("save"); };
      if (dialog.showModal) dialog.showModal(); else dialog.setAttribute("open", "");
      dialog.querySelector("[data-research-stay]").focus();
    });
    return this.leavePromise;
  }
  async click(event) {
    const button = event.target.closest("button");
    if (!button || button.disabled || this.pending || !this.root.contains(button)) return;
    if (button.hasAttribute("data-research-edit")) return this.edit();
    if (button.hasAttribute("data-research-reload")) return this.open(this.episodeId, { refresh: true });
    if (button.hasAttribute("data-research-save")) return this.save();
    if (button.hasAttribute("data-research-cancel")) { if (!this.isDirty() || this.confirm("Discard your unsaved research changes?")) return this.discard(); return; }
    if (button.hasAttribute("data-research-latest")) { if (this.confirm("Discard your draft and reload the latest saved research?")) return this.discard(); return; }
    if (button.hasAttribute("data-research-reconcile") && this.latest) {
      this.record = this.latest; this.latest = null;
      this.root.querySelector("[data-research-conflict]").hidden = true;
      return this.status("Review your preserved draft against the latest revision, then Save your reconciled research.");
    }
    if (!this.draft) return;
    if (button.hasAttribute("data-research-preview")) {
      this.markdown(this.root.querySelector("[data-research-preview-body]"), this.draft.summary);
      this.root.querySelector("[data-research-preview-body]").hidden = false;
      this.root.querySelector("[data-research-summary]").parentElement.hidden = true;
      button.classList.add("active"); this.root.querySelector("[data-research-write]").classList.remove("active");
    } else if (button.hasAttribute("data-research-write")) {
      this.root.querySelector("[data-research-preview-body]").hidden = true;
      this.root.querySelector("[data-research-summary]").parentElement.hidden = false;
      button.classList.add("active"); this.root.querySelector("[data-research-preview]").classList.remove("active");
      this.root.querySelector("[data-research-summary]").focus();
    } else {
      let index = Number(button.closest("[data-link-index]")?.dataset.linkIndex);
      if (button.hasAttribute("data-research-add")) {
        if (this.draft.links.length >= 100) return this.status("Research supports at most 100 links. Remove a link before adding another.", true);
        index = this.draft.links.length;
        this.draft.links.push({ id: `research_link_${globalThis.crypto.randomUUID()}`, url: "", title: "", note: "" });
      } else if (button.hasAttribute("data-research-remove")) this.draft.links.splice(index, 1);
      else if (button.hasAttribute("data-research-up") || button.hasAttribute("data-research-down")) {
        const next = index + (button.hasAttribute("data-research-up") ? -1 : 1);
        [this.draft.links[index], this.draft.links[next]] = [this.draft.links[next], this.draft.links[index]]; index = next;
      } else return;
      this.version++; this.drawLinks(index); this.status("Unsaved research changes. Save before sending them to the assistant.");
    }
  }
}

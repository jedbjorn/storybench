import { EditorState, StateField } from "@codemirror/state";
import { Decoration, EditorView, keymap } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown, markdownKeymap } from "@codemirror/lang-markdown";
import MarkdownIt from "markdown-it";
import { STARTER_STORY } from "./story-markdown.js";

export { STARTER_STORY } from "./story-markdown.js";

export function mappingChangeSummary(mappingChanges) {
  const sections = mappingChanges?.retiredSectionIds?.length || 0;
  const cards = mappingChanges?.unassignedCardIds?.length || 0;
  if (!sections && !cards) return "";
  return `${cards} ${cards === 1 ? "card is" : "cards are"} now unassigned because ${sections} story ${sections === 1 ? "section was" : "sections were"} removed. Open Storyboard to reassign ${cards === 1 ? "it" : "them"}.`;
}

export function matchesSubmittedCommit(current, submitted, error = {}) {
  return current?.source === submitted || Boolean(
    error.committed &&
    current?.storyRevision === error.committed.storyRevision &&
    current?.source === error.committed.source,
  );
}

export function isStorySaveShortcut(event) {
  return (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "s";
}

const sectionMarker = /^ {0,3}<!--\s*storybench:section\s+[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\s*-->\s*$/gim;
const sectionMarkerLine = /^ {0,3}<!--[ \t]*storybench:section[ \t]+[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[ \t]*-->[ \t]*$/gim;

function markerDecorations(source) {
  const ranges = [];
  for (const match of source.matchAll(sectionMarkerLine)) {
    const afterMarker = match.index + match[0].length;
    const end = afterMarker + (source[afterMarker] === "\n" ? 1 : 0);
    ranges.push(Decoration.replace({}).range(match.index, end));
  }
  return Decoration.set(ranges);
}

const hiddenSectionMarkers = StateField.define({
  create: (state) => markerDecorations(state.doc.toString()),
  update: (decorations, transaction) => transaction.docChanged ? markerDecorations(transaction.state.doc.toString()) : decorations,
  provide: (field) => [
    EditorView.decorations.from(field),
    EditorView.atomicRanges.of((view) => view.state.field(field)),
  ],
});

export const sectionMarkerExtensions = [
  hiddenSectionMarkers,
  EditorState.changeFilter.of((transaction) => {
    let removesMarkerAlone = false;
    const markers = transaction.startState.field(hiddenSectionMarkers);
    transaction.changes.iterChanges((from, to, _newFrom, _newTo, inserted) => {
      if (inserted.length || from === to) return;
      markers.between(from, to, (markerFrom, markerTo) => {
        if (from === markerFrom && to === markerTo) removesMarkerAlone = true;
      });
    });
    return !removesMarkerAlone;
  }),
];

export function createStoryRenderer() {
  const renderer = new MarkdownIt({ html: false, linkify: false, typographer: false });
  renderer.renderer.rules.image = (tokens, index) => {
    const token = tokens[index];
    const alt = token.content || token.attrGet("alt") || "image";
    return `<span class="story-image-unavailable" role="img" aria-label="Image unavailable">[${renderer.utils.escapeHtml(alt)} unavailable]</span>`;
  };
  const defaultLinkOpen = renderer.renderer.rules.link_open || ((tokens, index, options, _env, self) => self.renderToken(tokens, index, options));
  renderer.renderer.rules.link_open = (tokens, index, options, env, self) => {
    const href = tokens[index].attrGet("href") || "";
    if (!/^(https?:|mailto:|\/|#)/i.test(href)) tokens[index].attrSet("href", "#");
    tokens[index].attrSet("rel", "noreferrer noopener");
    return defaultLinkOpen(tokens, index, options, env, self);
  };
  return (source) => renderer.render(String(source || "").replace(sectionMarker, ""));
}

export class StoryEditor {
  constructor({ root, api, setStatus, toast, onSaved = () => {} }) {
    this.root = root;
    this.api = api;
    this.setStatus = setStatus;
    this.toast = toast;
    this.onSaved = onSaved;
    this.renderMarkdown = createStoryRenderer();
    this.story = null;
    this.episodeId = null;
    this.view = null;
    this.mode = "read";
    this.savePromise = null;
    this.bind();
  }

  bind() {
    this.root.querySelector("[data-story-edit]").onclick = () => this.edit();
    this.root.querySelector("[data-story-start]").onclick = () => this.edit(STARTER_STORY);
    this.root.querySelector("[data-story-write]").onclick = () => this.showWrite();
    this.root.querySelector("[data-story-preview]").onclick = () => this.showPreview();
    this.root.querySelector("[data-story-save]").onclick = () => this.save();
    this.root.querySelector("[data-story-cancel]").onclick = () => this.cancel();
    this.root.querySelector("[data-story-copy]").onclick = () => this.copyDraft();
    this.root.querySelector("[data-story-latest]").onclick = () => this.useLatest();
    this.root.querySelector("[data-story-reconcile]").onclick = () => this.reconcile();
    document.addEventListener("keydown", (event) => {
      if (!this.view || this.root.querySelector("[data-story-editing]").hidden || !isStorySaveShortcut(event)) return;
      event.preventDefault();
      this.save();
    });
  }

  async open(episodeId) {
    if (episodeId === this.episodeId && this.isDirty()) return;
    const request = Symbol("story-open");
    this.openRequest = request;
    this.destroyView();
    this.episodeId = null;
    this.story = null;
    this.showLoading();
    let story;
    try {
      story = await this.api(`/api/episodes/${episodeId}/story`);
    } catch (error) {
      if (this.openRequest === request) this.showLoadError(error.message);
      throw error;
    }
    if (this.openRequest !== request) return false;
    this.episodeId = episodeId;
    this.story = story;
    this.showMappingChanges(null);
    this.mode = "read";
    this.destroyView();
    this.drawRead();
    return true;
  }

  drawRead() {
    const source = this.story?.source || "";
    this.root.querySelector("[data-story-read]").innerHTML = source
      ? this.renderMarkdown(source)
      : '<div class="story-empty"><h2>Your story is empty</h2><p>Start with an outline or write ordinary Markdown.</p></div>';
    this.root.querySelector("[data-story-start]").hidden = Boolean(source);
    this.root.querySelector("[data-story-start]").disabled = false;
    this.root.querySelector("[data-story-edit]").disabled = false;
    this.root.querySelector("[data-story-edit]").textContent = source ? "Edit story" : "Write from scratch";
    this.root.querySelector("[data-story-reading]").hidden = false;
    this.root.querySelector("[data-story-editing]").hidden = true;
    this.root.querySelector("[data-story-conflict]").hidden = true;
    this.setStatus(`Story saved · r${this.story.storyRevision}`);
  }

  showLoading() {
    this.root.querySelector("[data-story-reading]").hidden = false;
    this.root.querySelector("[data-story-editing]").hidden = true;
    this.root.querySelector("[data-story-read]").innerHTML = '<div class="story-empty"><p>Loading story…</p></div>';
    this.root.querySelector("[data-story-start]").hidden = true;
    this.root.querySelector("[data-story-edit]").disabled = true;
    this.setStatus("Loading story…");
  }

  showLoadError(message) {
    this.root.querySelector("[data-story-read]").innerHTML = `<div class="story-empty"><h2>Story unavailable</h2><p>${escapeText(message)}</p></div>`;
    this.root.querySelector("[data-story-start]").hidden = true;
    this.root.querySelector("[data-story-edit]").disabled = true;
    this.setStatus("Story could not be loaded");
  }

  edit(initial = this.story?.source || "") {
    this.mode = "write";
    this.root.querySelector("[data-story-reading]").hidden = true;
    this.root.querySelector("[data-story-editing]").hidden = false;
    this.destroyView();
    this.view = new EditorView({
      parent: this.root.querySelector("[data-story-editor]"),
      state: EditorState.create({
        doc: initial,
        extensions: [
          history(), markdown(), EditorView.lineWrapping, sectionMarkerExtensions,
          keymap.of([...defaultKeymap, ...historyKeymap, ...markdownKeymap]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) this.setStatus("Story has unsaved changes");
          }),
        ],
      }),
    });
    this.showWrite();
    this.view.focus();
  }

  source() { return this.view?.state.doc.toString() ?? this.story?.source ?? ""; }
  isDirty() { return Boolean(this.view && this.source() !== (this.story?.source || "")); }

  showWrite() {
    this.mode = "write";
    this.root.querySelector("[data-story-editor]").hidden = false;
    this.root.querySelector("[data-story-draft-preview]").hidden = true;
    this.toggleModeButtons();
  }

  showPreview() {
    this.mode = "preview";
    this.root.querySelector("[data-story-draft-preview]").innerHTML = this.renderMarkdown(this.source());
    this.root.querySelector("[data-story-editor]").hidden = true;
    this.root.querySelector("[data-story-draft-preview]").hidden = false;
    this.toggleModeButtons();
  }

  toggleModeButtons() {
    this.root.querySelector("[data-story-write]").classList.toggle("active", this.mode === "write");
    this.root.querySelector("[data-story-preview]").classList.toggle("active", this.mode === "preview");
  }

  async save() {
    if (!this.view || this.savePromise) return this.savePromise;
    const source = this.source();
    const submittedRevision = this.story.storyRevision;
    this.setSaving(true);
    this.setStatus("Saving story…");
    this.savePromise = this.api(`/api/episodes/${this.episodeId}/story`, {
      method: "PUT",
      body: JSON.stringify({ expectedStoryRevision: submittedRevision, source }),
    }).then((saved) => this.accept(saved)).catch(async (error) => {
      if (error.status === 503 || error.publicationPending || error.committed || error.conflictPath) {
        return this.resolveUncertain(source, error);
      }
      if (error.status === 409 && error.current) return this.showConflict(error.current, source, error.message);
      this.setStatus("Story save failed — draft preserved");
      this.toast(error.message);
      return null;
    }).finally(() => { this.savePromise = null; this.setSaving(false); });
    return this.savePromise;
  }

  async resolveUncertain(submitted, originalError) {
    try {
      const current = await this.api(`/api/episodes/${this.episodeId}/story`);
      if (originalError.conflictPath) {
        this.story = current;
        this.showConflict(current, submitted, "Story changes were committed, but the registered story.md had changed outside Storybench. That file was preserved as a conflict artifact; your draft remains open while publication is blocked.");
        this.setStatus("Story committed — external file conflict blocks publication");
        return null;
      }
      const committedMatch = matchesSubmittedCommit(current, submitted, originalError);
      if (committedMatch && current.publicationStatus === "published") return this.accept(current);
      if (committedMatch) {
        try {
          const published = await this.api(`/api/episodes/${this.episodeId}/story/publication`, {
            method: "POST",
            body: JSON.stringify({ expectedStoryRevision: current.storyRevision }),
          });
          return this.accept(published);
        } catch (retryError) {
          this.story = current;
          if (retryError.conflictPath)
            return this.showConflict(current, submitted, "Story changes were committed, but the registered story.md had changed outside Storybench. That file was preserved as a conflict artifact; your draft remains open while publication is blocked.");
          this.setStatus("Story committed; publication pending — draft preserved");
          this.toast("Story is committed but story.md still needs publication recovery.");
          return null;
        }
      }
      return this.showConflict(current, submitted, "The save outcome was uncertain and the saved story differs.");
    } catch {
      this.setStatus("Save outcome unknown — draft preserved");
      this.toast(originalError.message);
      return null;
    }
  }

  accept(saved) {
    this.story = saved;
    this.destroyView();
    this.mode = "read";
    this.drawRead();
    this.showMappingChanges(saved.mappingChanges);
    this.onSaved(saved);
    return saved;
  }

  showMappingChanges(changes) {
    const message = mappingChangeSummary(changes);
    const panel = this.root.querySelector("[data-story-mapping-changes]");
    panel.hidden = !message;
    panel.textContent = message;
    if (message) this.toast(message);
  }

  showConflict(current, draft, message) {
    this.story = current;
    const panel = this.root.querySelector("[data-story-conflict]");
    panel.hidden = false;
    panel.querySelector("[data-story-conflict-message]").textContent = message || "A newer story was saved. Your draft is still open.";
    panel.querySelector("[data-story-current]").value = current.source || "";
    this.setStatus("Story conflict — draft preserved");
    this.toast("A newer story exists. Reconcile or choose a version.");
    return null;
  }

  async copyDraft() {
    await navigator.clipboard.writeText(this.source());
    this.toast("Draft copied");
  }

  useLatest() {
    if (!confirm("Discard your draft and use the latest saved story?")) return;
    this.edit(this.story.source || "");
    this.root.querySelector("[data-story-conflict]").hidden = true;
    this.setStatus(`Latest story loaded · r${this.story.storyRevision}`);
  }

  reconcile() {
    this.root.querySelector("[data-story-conflict]").hidden = true;
    this.setStatus("Editing draft against latest revision");
  }

  cancel() {
    if (this.isDirty() && !confirm("Discard your unsaved story changes?")) return false;
    this.destroyView();
    this.mode = "read";
    this.drawRead();
    return true;
  }

  async requestLeave() {
    if (!this.isDirty()) return "discard";
    return new Promise((resolve) => {
      const dialog = this.root.querySelector("[data-story-leave]");
      dialog.hidden = false;
      const finish = (choice) => {
        dialog.hidden = true;
        if (choice === "discard") {
          this.destroyView();
          this.mode = "read";
          this.drawRead();
        }
        resolve(choice);
      };
      dialog.querySelector("[data-leave-stay]").onclick = () => finish("stay");
      dialog.querySelector("[data-leave-discard]").onclick = () => finish("discard");
      dialog.querySelector("[data-leave-save]").onclick = async () => {
        const saved = await this.save();
        if (saved) finish("save");
      };
    });
  }

  setSaving(value) {
    this.root.querySelector("[data-story-save]").disabled = value;
    this.root.querySelector("[data-story-save]").textContent = value ? "Saving…" : "Save";
  }

  destroyView() { this.view?.destroy(); this.view = null; }
}

function escapeText(value) {
  return String(value || "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

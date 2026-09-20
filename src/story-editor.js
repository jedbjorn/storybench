import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown, markdownKeymap } from "@codemirror/lang-markdown";
import MarkdownIt from "markdown-it";

export const STARTER_STORY = `# Overview

# Hook

# Sections

## Intro

## Beat

## Outro
`;

const sectionMarker = /<!--\s*storybench:section\s+[0-9a-f-]+\s*-->/gi;

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
  constructor({ root, api, setStatus, toast }) {
    this.root = root;
    this.api = api;
    this.setStatus = setStatus;
    this.toast = toast;
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
  }

  async open(episodeId) {
    if (episodeId === this.episodeId && this.isDirty()) return;
    this.episodeId = episodeId;
    this.story = await this.api(`/api/episodes/${episodeId}/story`);
    this.mode = "read";
    this.destroyView();
    this.drawRead();
  }

  drawRead() {
    const source = this.story?.source || "";
    this.root.querySelector("[data-story-read]").innerHTML = source
      ? this.renderMarkdown(source)
      : '<div class="story-empty"><h2>Your story is empty</h2><p>Start with an outline or write ordinary Markdown.</p></div>';
    this.root.querySelector("[data-story-start]").hidden = Boolean(source);
    this.root.querySelector("[data-story-edit]").textContent = source ? "Edit story" : "Write from scratch";
    this.root.querySelector("[data-story-reading]").hidden = false;
    this.root.querySelector("[data-story-editing]").hidden = true;
    this.root.querySelector("[data-story-conflict]").hidden = true;
    this.setStatus(`Story saved · r${this.story.storyRevision}`);
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
          history(), markdown(), EditorView.lineWrapping,
          keymap.of([...defaultKeymap, ...historyKeymap, ...markdownKeymap, {
            key: "Mod-s", preventDefault: true, run: () => { this.save(); return true; },
          }]),
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
      if (current.source === submitted && current.publicationStatus === "published") return this.accept(current);
      if (current.source === submitted) {
        this.story = current;
        this.setStatus("Story committed; publication pending — draft preserved");
        this.toast("Story is committed but story.md still needs publication recovery.");
        return null;
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
    return saved;
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

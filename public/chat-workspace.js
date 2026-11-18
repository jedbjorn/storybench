import { previewUrl, pruneSelections, selectionKey, withChannel } from "./preview-links.js";
import { ChatTranscript } from "./chat-transcript.js";
import { uploadLibraryFile } from "./library-workspace.js";
import { ChatSettings, boundaryText, selectionLabel } from "./chat-settings.js";
import { agentRows, agentStatus, contextLabel, formatTokens } from "./chat-agents.js";
import { clock } from "./chat-transcript.js";

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
const working = (state) => ["queued", "running", "interrupting", "compacting"].includes(state);
const stoppable = (state) => ["queued", "running", "interrupting"].includes(state);
const HISTORY_LIMIT = 10;
// Compact: two arrows pressing in on one line.
const COMPACT_ICON = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12h16M8 3l4 4 4-4M8 21l4-4 4 4"/></svg>';

export class ChatWorkspace {
  constructor({ root, api, getEpisode, renderMarkdown, toast = () => {}, onBusyChange = () => {}, uploadImage = uploadLibraryFile, beforeSend = async () => {} }) {
    Object.assign(this, { root, api, getEpisode, renderMarkdown, toast, onBusyChange, uploadImage, beforeSend });
    this.imageDrafts = new Map();
    this.sending = false;
    this.conversations = [];
    this.currentId = null;
    this.generation = 0;
    this.draftChain = Promise.resolve();
    this.historyOpen = false;
    this.settings = new ChatSettings({ root, api, toast });
    // This tab's selection record for Preview's redline popup lives only while the tab has the production open.
    this.tabId = crypto.randomUUID();
    pruneSelections();
    // A timer can still fire while the page is being torn down; nothing is recorded after pagehide.
    const view = root.ownerDocument.defaultView;
    view?.addEventListener("pagehide", () => { this.departed = true; this.forgetSelection(); });
    view?.addEventListener("pageshow", () => { this.departed = false; });
    this.current = null;
    this.selection = 0;
    this.refreshSequence = 0;
    this.listSequence = 0;
  }

  async open() {
    await this.flushDraft();
    this.stopTimers();
    const episodeId = this.getEpisode()?.id;
    const generation = ++this.generation;
    this.episodeId = episodeId;
    this.currentId = null;
    this.conversations = [];
    if (!episodeId) return this.clear();
    this.root.hidden = false;
    this.root.innerHTML = `<div class="chat-toolbar"><button class="chat-history-toggle" data-chat-history-toggle type="button" aria-label="Open chat history" aria-controls="chatHistoryDrawer" aria-expanded="false">‹</button><div class="chat-identity"><b data-chat-title>${this.getEpisode()?.kind === "deck" ? "Deck" : "Episode"} assistant</b><span data-chat-status role="status"></span></div><button class="chat-selection" data-chat-selection type="button" aria-haspopup="dialog" aria-controls="chatSettingsPanel" title="Harness, model and thinking for this conversation">Codex · default model</button></div><div id="chatSettingsPanel" class="chat-settings-panel" data-chat-settings-panel role="dialog" aria-label="Conversation harness and model" hidden></div><div class="chat-history-backdrop" data-chat-history-backdrop hidden></div><section id="chatHistoryDrawer" class="chat-history-drawer" data-chat-history-drawer aria-label="Chat history" hidden><div class="chat-history-heading"><strong>Chat history</strong><button data-chat-rename type="button">Rename</button></div><div class="chat-history-list" data-chat-history-list></div><div class="chat-agents"><strong class="chat-agents-heading">Agents</strong><div class="chat-agents-list" data-chat-agents></div></div></section><div class="chat-transcript-panel"><div data-chat-messages tabindex="0" aria-label="Conversation messages"></div><button class="chat-jump" data-chat-jump type="button" aria-label="Jump to end" title="Jump to end" hidden><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 4v16m-6-6 6 6 6-6"/></svg></button></div><div class="chat-composer"><div class="chat-attachments" data-chat-attachments></div><div class="chat-upload-status" data-chat-upload-status role="status"></div><textarea data-chat-draft aria-label="Message" placeholder="Ask the ${this.getEpisode()?.kind === "deck" ? "deck" : "episode"} assistant, or drop an image" rows="3"></textarea><div class="chat-composer-actions"><button class="chat-icon" data-chat-compact type="button" aria-disabled="true" aria-label="Compact context" title="Compact context">${COMPACT_ICON}</button><button class="chat-icon" data-chat-attach type="button" aria-label="Attach images" title="Attach images"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m8 13 7-7a3 3 0 0 1 4 4l-9 9a5 5 0 0 1-7-7l10-10M6 15l8-8"/></svg></button><input data-chat-files type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden><button class="chat-icon" data-chat-new type="button" aria-label="New chat" title="New chat">＋</button><button class="chat-icon chat-stop" data-chat-stop type="button" aria-label="Stop active response" title="Stop active response" hidden>×</button></div><small>Enter to send · Shift+Enter for a new line</small></div>`;
    this.setHistoryOpen(false);
    this.bind(generation, episodeId);
    await this.settings.loadCatalog();
    await this.refreshList(generation, episodeId);
    if (!this.isCurrent(generation, episodeId)) return;
    this.pollTimer = setInterval(() => { this.recordSelection(); this.refreshList(generation, episodeId, { preserveSelection: true }).catch(() => {}); }, 1000);
  }

  recordSelection() {
    if (this.departed || !this.episodeId || !this.currentId) return;
    const value = { id: this.currentId, selectedAt: this.selectedAt, seenAt: Date.now() };
    try { localStorage.setItem(selectionKey(this.episodeId, this.tabId), JSON.stringify(value)); } catch { /* storage unavailable */ }
  }

  forgetSelection() {
    try { if (this.episodeId) localStorage.removeItem(selectionKey(this.episodeId, this.tabId)); } catch { /* storage unavailable */ }
  }

  close() {
    this.flushDraft().catch(() => {});
    ++this.generation;
    this.stopTimers();
    this.episodeId = null;
    this.currentId = null;
    this.conversations = [];
    this.clear();
  }

  clear() { this.root.hidden = true; this.root.innerHTML = ""; }
  stopTimers() {
    this.forgetSelection();
    this.transcript?.destroy();
    this.transcript = null;
    this.current = null;
    this.sending = false;
    ++this.selection;
    clearInterval(this.pollTimer); clearTimeout(this.draftTimer);
    this.pollTimer = null; this.draftTimer = null;
    if (this.outsideClick) this.root.ownerDocument.removeEventListener("click", this.outsideClick);
    if (this.escapeKey) this.root.ownerDocument.removeEventListener("keydown", this.escapeKey);
    this.outsideClick = null; this.escapeKey = null;
  }
  isCurrent(generation, episodeId, conversationId) {
    return generation === this.generation && episodeId === this.episodeId && (conversationId === undefined || conversationId === this.currentId);
  }
  itemUrl(episodeId = this.episodeId, conversationId = this.currentId) { return `/api/episodes/${episodeId}/chats/${conversationId}`; }
  draftField() { return this.root.querySelector("[data-chat-draft]"); }
  isBusy() { return this.conversations.some((item) => working(item.state)); }

  async sendProduction({ kind, targetCardId = null, prompt = "", clientRequestId = crypto.randomUUID() }) {
    if (!this.episodeId || !this.currentId) await this.open();
    if (!this.episodeId || !this.currentId) throw new Error("Open an episode before asking the assistant");
    if (this.isBusy()) throw new Error("A request is already active for this episode. Let it finish or press Stop; this request was not queued.");
    const episodeId = this.episodeId, conversationId = this.currentId, generation = this.generation;
    await this.flushDraft();
    await this.beforeSend();
    const value = await this.api(`${this.itemUrl(episodeId, conversationId)}/production-requests`, { method: "POST",
      body: JSON.stringify({ kind, targetCardId, prompt, clientRequestId }) });
    if (this.isCurrent(generation, episodeId, conversationId)) await this.refreshList(generation, episodeId, { preserveSelection: true });
    return value;
  }

  setHistoryOpen(open) {
    this.historyOpen = Boolean(open);
    const drawer = this.root.querySelector("[data-chat-history-drawer]");
    const backdrop = this.root.querySelector("[data-chat-history-backdrop]");
    const toggle = this.root.querySelector("[data-chat-history-toggle]");
    if (drawer) { drawer.hidden = !this.historyOpen; drawer.inert = !this.historyOpen; }
    if (backdrop) backdrop.hidden = !this.historyOpen;
    if (toggle) {
      toggle.setAttribute("aria-expanded", String(this.historyOpen));
      toggle.setAttribute("aria-label", this.historyOpen ? "Close chat history" : "Open chat history");
    }
  }

  imageDraft(conversationId = this.currentId) {
    if (!this.imageDrafts.has(conversationId)) this.imageDrafts.set(conversationId, { attachments: [], uploads: [], dirty: false, error: "", revision: 0 });
    return this.imageDrafts.get(conversationId);
  }

  saveImages(episodeId, conversationId, state) {
    const revision = ++state.revision;
    state.dirty = true;
    const ids = state.attachments.map((item) => item.itemId);
    const request = () => this.api(this.itemUrl(episodeId, conversationId), { method: "PUT", body: JSON.stringify({ attachmentIds: ids }) });
    this.draftChain = this.draftChain.catch(() => {}).then(request).then(() => {
      if (revision === state.revision) state.dirty = false;
    });
    return this.draftChain;
  }

  paintImages() {
    const container = this.root.querySelector('[data-chat-attachments]');
    if (!container || !this.currentId) return;
    const state = this.imageDraft();
    const attach = this.root.querySelector('[data-chat-attach]');
    attach.disabled = !this.supportsImages(); attach.title = attach.disabled ? 'This model has no image input' : 'Attach images';
    container.innerHTML = state.attachments.map((item) => `<div class="chat-attachment"><img src="/api/episodes/${encodeURIComponent(this.episodeId)}/library/${encodeURIComponent(item.itemId)}/file" alt="${escapeHtml(item.label)}"><span>${escapeHtml(item.label)}</span><button type="button" data-chat-remove-image="${escapeHtml(item.itemId)}" aria-label="Remove ${escapeHtml(item.label)}">×</button></div>`).join('')
      + state.uploads.map((item) => `<div class="chat-attachment uploading"><span>Uploading ${escapeHtml(item.name)}…</span></div>`).join('');
    this.root.querySelector('[data-chat-upload-status]').textContent = state.error;
  }

  supportsImages() {
    const settings = this.current?.settings;
    if (!settings) return true;
    const source = settings.inferenceSource || `${settings.harness}-login`;
    const entry = this.settings.catalog?.harnesses?.find((entry) => (entry.source || `${entry.harness}-login`) === source);
    const model = entry?.models?.find((model) => model.id === settings.model);
    return !model?.inputModalities || model.inputModalities.includes('image');
  }
  async addImages(files) {
    if (!this.supportsImages()) { this.imageDraft().error = 'This model has no image input. Choose another model to attach images.'; this.paintImages(); return; }
    const episodeId = this.episodeId, conversationId = this.currentId;
    if (!episodeId || !conversationId || this.sending) return;
    const state = this.imageDraft(conversationId);
    state.error = '';
    const accepted = [];
    for (const file of files) {
      if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) { state.error = 'Choose PNG, JPEG, WebP or GIF images.'; continue; }
      if (file.size > 20 * 1024 * 1024) { state.error = 'Each image must be 20 MiB or smaller.'; continue; }
      if (state.attachments.length + state.uploads.length >= 8) { state.error = 'Attach up to eight images per message.'; break; }
      accepted.push(file); state.uploads.push(file);
    }
    this.paintImages();
    for (const file of accepted) {
      try {
        const item = await this.uploadImage({ episodeId, file, category: 'Reference' });
        if (item.asset?.kind !== 'image') throw new Error('That file could not be read as an image.');
        if (!state.attachments.some((value) => value.itemId === item.id)) state.attachments.push({ itemId: item.id, label: item.label, episodeId });
        await this.saveImages(episodeId, conversationId, state);
      } catch (error) { state.error = `${file.name}: ${error.message}`; }
      finally {
        state.uploads.splice(state.uploads.indexOf(file), 1);
        if (this.episodeId === episodeId && this.currentId === conversationId) this.paintImages();
      }
    }
  }

  queueDraft({ episodeId = this.episodeId, conversationId = this.currentId, value = this.draftField()?.value ?? "" } = {}) {
    if (!episodeId || !conversationId) return this.draftChain;
    const request = () => this.api(this.itemUrl(episodeId, conversationId), { method: "PUT", body: JSON.stringify({ draft: value }) });
    this.draftChain = this.draftChain.catch(() => {}).then(request).then((result) => {
      const field = this.draftField();
      if (this.episodeId === episodeId && this.currentId === conversationId && field?.value === value) field.dataset.dirty = "false";
      return result;
    });
    return this.draftChain;
  }
  flushDraft() {
    clearTimeout(this.draftTimer); this.draftTimer = null;
    const field = this.draftField();
    return field?.dataset.dirty === "true" ? this.queueDraft({ value: field.value }) : this.draftChain.catch(() => {});
  }

  bind(generation, episodeId) {
    const toggle = this.root.querySelector("[data-chat-history-toggle]");
    const drawer = this.root.querySelector("[data-chat-history-drawer]");
    toggle.onclick = () => this.setHistoryOpen(!this.historyOpen);
    this.root.querySelector("[data-chat-history-list]").onclick = async (event) => {
      const button = event.target.closest("[data-chat-id]");
      if (!button) return;
      const next = button.dataset.chatId;
      if (next === this.currentId) return this.setHistoryOpen(false);
      await this.flushDraft();
      if (!this.isCurrent(generation, episodeId)) return;
      this.selectConversation(next);
      await this.refresh(generation, episodeId, next);
      if (this.isCurrent(generation, episodeId, next)) {
        this.paintConversationList();
        this.setHistoryOpen(false);
      }
    };
    this.root.querySelector("[data-chat-selection]").onclick = async () => {
      const panel = this.root.querySelector("[data-chat-settings-panel]");
      if (!panel.hidden) { panel.hidden = true; panel.innerHTML = ""; return; }
      const conversationId = this.currentId;
      await this.settings.loadCatalog();
      if (!this.isCurrent(generation, episodeId, conversationId) || !this.current) return;
      const busy = this.conversations.some((item) => working(item.state));
      this.settings.open(panel, { ...this.current, episodeId }, { busy, onSaved: async () => {
        if (this.isCurrent(generation, episodeId, conversationId)) await this.refreshList(generation, episodeId, { preserveSelection: true });
      } });
    };
    this.root.querySelector("[data-chat-new]").onclick = async () => {
      await this.flushDraft();
      if (!this.isCurrent(generation, episodeId)) return;
      const value = await this.api(`/api/episodes/${episodeId}/chats`, { method: "POST", body: JSON.stringify({ name: `Conversation ${this.conversations.length + 1}` }) });
      if (!this.isCurrent(generation, episodeId)) return;
      this.selectConversation(value.id);
      await this.refreshList(generation, episodeId, { preserveSelection: true });
    };
    this.root.querySelector("[data-chat-rename]").onclick = async () => {
      const conversationId = this.currentId, current = this.conversations.find((value) => value.id === conversationId);
      const name = prompt("Conversation name", current?.name || "");
      if (!name?.trim()) return;
      await this.api(this.itemUrl(episodeId, conversationId), { method: "PUT", body: JSON.stringify({ name }) });
      if (this.isCurrent(generation, episodeId)) await this.refreshList(generation, episodeId, { preserveSelection: true });
    };
    const draft = this.draftField();
    draft.oninput = () => {
      draft.dataset.dirty = "true";
      clearTimeout(this.draftTimer);
      const conversationId = this.currentId, value = draft.value;
      this.draftTimer = setTimeout(() => this.queueDraft({ episodeId, conversationId, value }).catch(() => {}), 250);
    };
    const composer = this.root.querySelector('.chat-composer');
    const files = this.root.querySelector('[data-chat-files]');
    this.root.querySelector('[data-chat-attach]').onclick = () => files.click();
    files.onchange = () => { this.addImages([...files.files]); files.value = ''; };
    draft.addEventListener('paste', (event) => {
      const images = [...(event.clipboardData?.items || [])].filter((item) => item.kind === 'file').map((item) => item.getAsFile()).filter(Boolean);
      if (!images.length) return;
      event.preventDefault(); this.addImages(images);
    });
    composer.ondragover = (event) => {
      if (![...(event.dataTransfer?.types || [])].includes('Files')) return;
      event.preventDefault(); composer.classList.add('drag-over');
    };
    composer.ondragleave = (event) => { if (!composer.contains(event.relatedTarget)) composer.classList.remove('drag-over'); };
    composer.ondrop = (event) => {
      if (!event.dataTransfer?.files?.length) return;
      event.preventDefault(); composer.classList.remove('drag-over'); this.addImages([...event.dataTransfer.files]);
    };
    this.root.querySelector('[data-chat-attachments]').onclick = async (event) => {
      const remove = event.target.closest('[data-chat-remove-image]'); if (!remove || this.sending) return;
      const conversationId = this.currentId, state = this.imageDraft();
      state.attachments = state.attachments.filter((item) => item.itemId !== remove.dataset.chatRemoveImage);
      this.paintImages();
      try { await this.saveImages(episodeId, conversationId, state); }
      catch (error) { state.error = error.message; if (this.currentId === conversationId) this.paintImages(); }
    };
    // Enter sends; there is no send button. The server decides whether the production is busy
    // (the one-second poll can be stale); a refusal is a toast and the draft stays.
    this.sendDraft = async () => {
      const conversationId = this.currentId, text = draft.value, selection = this.selection;
      const imageDraft = this.imageDraft(conversationId);
      if ((!text.trim() && !imageDraft.attachments.length) || !conversationId || this.sending || imageDraft.uploads.length) return;
      this.sending = true;
      try {
        await this.flushDraft();
        await this.beforeSend();
        await this.api(`${this.itemUrl(episodeId, conversationId)}/messages`, { method: "POST", body: JSON.stringify({ text, ...(imageDraft.attachments.length ? { attachmentIds: imageDraft.attachments.map((item) => item.itemId) } : {}) }) });
        imageDraft.attachments = []; imageDraft.dirty = false; imageDraft.error = "";
        if (!this.isCurrent(generation, episodeId, conversationId) || selection !== this.selection) return;
        if (draft.value === text) { draft.value = ""; draft.dataset.dirty = "false"; }
        await this.refreshList(generation, episodeId, { preserveSelection: true });
      } catch (cause) { this.toast(cause.message); }
      finally { if (this.isCurrent(generation, episodeId)) { this.sending = false; this.paintImages(); } }
    };
    draft.onkeydown = (event) => {
      if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
      event.preventDefault();
      this.sendDraft();
    };
    this.root.querySelector("[data-chat-compact]").onclick = async (event) => {
      const button = event.currentTarget, conversationId = this.currentId;
      if (button.getAttribute("aria-disabled") === "true" || !conversationId) return;
      button.setAttribute("aria-disabled", "true");
      try {
        await this.api(`${this.itemUrl(episodeId, conversationId)}/compact`, { method: "POST", body: "{}" });
        if (this.isCurrent(generation, episodeId, conversationId)) await this.refreshList(generation, episodeId, { preserveSelection: true });
      } catch (cause) { this.toast(cause.message); }
    };
    this.root.querySelector("[data-chat-stop]").onclick = async () => {
      const conversationId = this.currentId;
      try { await this.api(`${this.itemUrl(episodeId, conversationId)}/interrupt`, { method: "POST", body: "{}" }); if (this.isCurrent(generation, episodeId, conversationId)) await this.refresh(generation, episodeId, conversationId); }
      catch (cause) { this.toast(cause.message); }
    };
    this.root.querySelector("[data-chat-messages]").onclick = async (event) => {
      const button = event.target.closest("[data-chat-retry]");
      if (!button || this.isBusy()) return;
      const conversationId = this.currentId;
      try {
        await this.flushDraft();
        await this.beforeSend();
        await this.api(`${this.itemUrl(episodeId, conversationId)}/production-requests/${button.dataset.chatRetry}/retry`, { method: "POST", body: JSON.stringify({ clientRequestId: crypto.randomUUID() }) });
        if (this.isCurrent(generation, episodeId, conversationId)) await this.refreshList(generation, episodeId, { preserveSelection: true });
      } catch (cause) { this.toast(cause.message); }
    };
    this.outsideClick = (event) => {
      if (!this.historyOpen || drawer.contains(event.target) || toggle.contains(event.target)) return;
      this.setHistoryOpen(false);
    };
    this.escapeKey = (event) => { if (event.key === "Escape" && this.historyOpen) { this.setHistoryOpen(false); toggle.focus(); } };
    this.root.ownerDocument.addEventListener("click", this.outsideClick);
    this.root.ownerDocument.addEventListener("keydown", this.escapeKey);
  }

  paintConversationList() {
    const list = this.root.querySelector("[data-chat-history-list]");
    if (!list) return;
    // At most ten, newest first; the open conversation stays reachable.
    const current = this.conversations.find((value) => value.id === this.currentId);
    let shown = this.conversations.slice(0, HISTORY_LIMIT);
    if (current && !shown.includes(current)) shown = [...shown.slice(0, HISTORY_LIMIT - 1), current];
    list.innerHTML = shown.map((value) => `<button class="chat-history-item ${value.id === this.currentId ? "selected" : ""}" data-chat-id="${escapeHtml(value.id)}" type="button" aria-current="${value.id === this.currentId ? "true" : "false"}"><b>${escapeHtml(value.name)}</b><span>${working(value.state) ? "working" : escapeHtml(value.state || "idle")}</span></button>`).join("");
    this.root.querySelector("[data-chat-title]").textContent = current?.name || "Episode assistant";
    this.root.querySelector("[data-chat-rename]").disabled = !current;
  }

  selectConversation(id) {
    if (this.currentId === id && this.transcript) return;
    const switching = this.currentId !== null;
    this.transcript?.destroy();
    this.currentId = id;
    // Shared with Preview's redline popup (same origin) so a redline defaults to the conversation open here.
    this.selectedAt = Date.now();
    this.recordSelection();
    this.current = null;
    ++this.selection;
    this.transcript = new ChatTranscript(this.root.querySelector('[data-chat-messages]'), this.root.querySelector('[data-chat-jump]'), this.getEpisode()?.kind);
    const draft = this.draftField();
    if (switching) { draft.value = ''; draft.dataset.dirty = 'false'; }
    this.root.querySelector('[data-chat-compact]').setAttribute('aria-disabled', 'true');
    this.root.querySelector('[data-chat-agents]').innerHTML = '';
    this.root.querySelector('[data-chat-stop]').hidden = true;
    this.root.querySelector('[data-chat-status]').textContent = '';
  }

  async refreshList(generation, episodeId, { preserveSelection = false } = {}) {
    const sequence = ++this.listSequence, selection = this.selection;
    let conversations = await this.api(`/api/episodes/${episodeId}/chats`);
    if (!this.isCurrent(generation, episodeId)) return;
    if (!conversations.length) conversations = [await this.api(`/api/episodes/${episodeId}/chats`, { method: "POST", body: JSON.stringify({ name: "Conversation 1" }) })];
    if (!this.isCurrent(generation, episodeId)) return;
    if (selection !== this.selection || sequence < (this.appliedListSequence ?? 0)) return;
    this.appliedListSequence = sequence;
    this.conversations = conversations;
    if (!preserveSelection || !conversations.some((value) => value.id === this.currentId)) this.selectConversation(conversations[0].id);
    this.paintConversationList();
    await this.refresh(generation, episodeId, this.currentId);
  }

  async refresh(generation, episodeId, conversationId) {
    if (!this.isCurrent(generation, episodeId, conversationId)) return;
    const sequence = ++this.refreshSequence, selection = this.selection;
    const imageRevision = this.imageDraft(conversationId).revision;
    const sent = Date.now();
    const value = await this.api(this.itemUrl(episodeId, conversationId));
    const received = Date.now();
    if (!this.isCurrent(generation, episodeId, conversationId) || selection !== this.selection || sequence < (this.appliedRefreshSequence ?? 0)) return;
    this.appliedRefreshSequence = sequence;
    this.current = value;
    // Server clock minus this one, taking the server's stamp as the round trip's midpoint.
    const serverTime = Date.parse(value.serverTime);
    if (Number.isFinite(serverTime)) this.clockOffset = serverTime - (sent + received) / 2;
    const status = this.root.querySelector("[data-chat-status]");
    const active = !value.error && working(value.state);
    const label = value.error || ({ running: "working", interrupting: "stopping" }[value.state] ?? value.state);
    const statusHtml = `${escapeHtml(label)}${active ? ' <span class="chat-working-dots" aria-hidden="true">...</span>' : ""}`;
    // Keep the animation and live region stable across the one-second refreshes.
    if (status.innerHTML !== statusHtml) status.innerHTML = statusHtml;
    const chip = this.root.querySelector("[data-chat-selection]");
    chip.textContent = selectionLabel(value.settings);
    chip.dataset.selectable = value.settings ? "true" : "false";
    // Messages and visible boundaries (settings changes, new native sessions) in time order.
    const boundaries = (value.events ?? []).map((event) => ({ key: `event:${event.sequence}`, at: event.createdAt, text: boundaryText(event) })).filter((entry) => entry.text);
    const retryByMessage = new Map((value.runs ?? []).filter((run) => ["failed", "interrupted"].includes(run.state)).map((run) => [run.originatingMessageId, run.id]));
    // A transport error can leave an assistant row marked streaming. Its
    // originating user/run still carries terminal truth, even on later turns.
    let origin;
    const visible = value.messages.flatMap(message => {
      // A wake line (role system) originates its turn like a creator message but is shown as an app line.
      if (message.role === 'user' || message.role === 'system') { origin = message; return [{ ...message }]; }
      let state = message.state;
      if (['queued', 'running', 'streaming'].includes(state)) {
        const run = (value.runs ?? []).find(run => run.originatingMessageId === origin?.id);
        const terminal = [run?.state, origin?.state].find(state => ['failed', 'interrupted'].includes(state));
        if (terminal) state = terminal;
        else if (active) return [];
        else state = value.state === 'interrupted' ? 'interrupted' : 'failed';
      }
      return [{ ...message, state }];
    });
    // Assistant replies are Markdown blocks, which cannot live inside <p>; creator text stays literal.
    const items = [...visible.map((message) => { if (message.role === "system") return { key: `m:${message.id}`, at: message.createdAt, html: `<p class="chat-boundary chat-app-line" role="note" data-message-id="${escapeHtml(message.id)}"><span>${escapeHtml(message.text)}</span></p>` };
      const assistant = message.role === "assistant", tag = assistant ? "div" : "p", body = assistant ? "div" : "span"; return { key: `m:${message.id}`, at: message.createdAt, html: `<${tag} class="chat-${escapeHtml(message.role)}" data-message-id="${escapeHtml(message.id)}"><b>${message.role === "user" ? "You" : "Assistant"}</b><${body}${assistant ? ' class="chat-markdown"' : ""}>${assistant ? this.renderMarkdown(message.text) : escapeHtml(message.text)}${(message.attachments || []).map((item) => item.unavailable ? `<span class="chat-image-removed" role="note">Redline image removed</span>` : `<a class="chat-image-link" href="${escapeHtml(previewUrl('library', episodeId, this.getEpisode()?.channelId, item.itemId))}" target="storybench-preview"><img src="/api/episodes/${encodeURIComponent(episodeId)}/library/${encodeURIComponent(item.itemId)}/file" alt="${escapeHtml(item.label)}" loading="lazy"></a><a class="chat-image-download" href="${escapeHtml(withChannel(`/api/episodes/${encodeURIComponent(episodeId)}/library/${encodeURIComponent(item.itemId)}/file?download=1`, this.getEpisode()?.channelId))}">Download</a>`).join("")}</${body}>${assistant && ['failed', 'interrupted'].includes(message.state) ? `<small class="chat-response-outcome">${message.state === 'interrupted' ? 'Interrupted' : 'Failed'} · partial response</small>` : ''}${retryByMessage.has(message.id) ? `<button type="button" data-chat-retry="${escapeHtml(retryByMessage.get(message.id))}" aria-label="Retry this request as a new explicit request">Retry</button>` : ""}</${tag}>` }; }),
      ...boundaries.map((entry) => ({ ...entry, html: `<p class="chat-boundary" role="note"><span>${escapeHtml(entry.text)}</span></p>` }))]
      .sort((a, b) => String(a.at ?? "").localeCompare(String(b.at ?? "")));
    const run = (value.runs ?? []).findLast((entry) => ["starting", "running"].includes(entry.state));
    const compaction = value.state === "compacting" ? (value.events ?? []).findLast((event) => event.type === "compaction.started") : null;
    const turnStatus = { events: value.events ?? [], state: value.state, startedAt: run?.startedAt ?? compaction?.createdAt ?? null, offset: this.clockOffset ?? 0 };
    this.transcript.render(items.length || active ? items : [{ key: 'empty', html: `<p>Start a conversation about this ${this.getEpisode()?.kind === "deck" ? "deck" : "episode"}.</p>` }], active, turnStatus);
    const draft = this.draftField();
    if (draft.dataset.dirty !== "true") { draft.value = value.draft || ""; draft.dataset.dirty = "false"; }
    const busy = this.conversations.some((item) => working(item.state));
    const imageDraft = this.imageDraft();
    if (imageRevision === imageDraft.revision && !imageDraft.dirty && !imageDraft.uploads.length) imageDraft.attachments = value.draftAttachments || [];
    this.paintImages();
    this.paintCompact(value, busy);
    this.paintAgents(value);
    const stop = this.root.querySelector("[data-chat-stop]"); stop.hidden = !stoppable(value.state); stop.disabled = value.state === "interrupting";
    this.onBusyChange(busy);
  }

  paintCompact(value, busy) {
    const button = this.root.querySelector("[data-chat-compact]"), context = value.context;
    const why = !context ? "Not available in this installation"
      : value.state === "compacting" ? "Compacting now"
      : busy ? "Available when the assistant is idle"
      : context.reason;
    const meter = context ? `Context ${contextLabel(context)}${Number.isFinite(context.trigger) ? ` · compacts automatically at ${formatTokens(context.trigger)}` : ""}` : "";
    button.setAttribute("aria-disabled", String(Boolean(why) || this.sending));
    button.title = ["Compact context", why || "Summarize the conversation so far to free the assistant's working memory", meter].filter(Boolean).join("\n");
  }

  paintAgents(value) {
    const list = this.root.querySelector("[data-chat-agents]");
    if (!list) return;
    const now = Date.now() + (this.clockOffset ?? 0), kind = this.getEpisode()?.kind === "deck" ? "deck" : "video";
    const html = agentRows(value).map((row) => {
      const tokens = row.id === "main" ? contextLabel(value.context) : formatTokens(row.tokens);
      const time = Number.isFinite(row.startedAt) ? ` · ${clock((row.endedAt ?? now) - row.startedAt)}` : "";
      const running = ["working", "running", "compacting"].includes(row.state);
      // Worded like the turn status line under the animation, and right aligned like it.
      const status = agentStatus(row, { kind, live: this.transcript?.animation ? this.transcript.shown?.label : null });
      return `<div class="chat-agent${running ? " running" : ""}"><b title="${escapeHtml(row.name)}">${escapeHtml(row.name)}</b><span class="chat-agent-stats" title="${escapeHtml(`${row.model} | ${tokens}`)}">${escapeHtml(row.model)} | ${escapeHtml(tokens)}</span><span class="chat-agent-status">${escapeHtml(status)}${escapeHtml(time)}</span></div>`;
    }).join("");
    if (list.innerHTML !== html) list.innerHTML = html;
  }
}

export default ChatWorkspace;

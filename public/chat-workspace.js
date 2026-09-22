import { uploadLibraryFile } from "./library-workspace.js";
import { ChatSettings, boundaryText, selectionLabel } from "./chat-settings.js";

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
const working = (state) => ["queued", "running", "interrupting"].includes(state);

export class ChatWorkspace {
  constructor({ root, api, getEpisode, toast = () => {}, onBusyChange = () => {}, uploadImage = uploadLibraryFile }) {
    Object.assign(this, { root, api, getEpisode, toast, onBusyChange, uploadImage });
    this.imageDrafts = new Map();
    this.sending = false;
    this.conversations = [];
    this.currentId = null;
    this.generation = 0;
    this.draftChain = Promise.resolve();
    this.historyOpen = false;
    this.settings = new ChatSettings({ root, api, toast });
    this.current = null;
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
    this.root.innerHTML = `<div class="chat-toolbar"><button class="chat-history-toggle" data-chat-history-toggle type="button" aria-label="Open chat history" aria-controls="chatHistoryDrawer" aria-expanded="false">‹</button><div class="chat-identity"><b data-chat-title>Episode assistant</b><span data-chat-status role="status"></span></div><button class="chat-selection" data-chat-selection type="button" aria-haspopup="dialog" aria-controls="chatSettingsPanel" title="Harness, model and thinking for this conversation">Codex · default model</button></div><div id="chatSettingsPanel" class="chat-settings-panel" data-chat-settings-panel role="dialog" aria-label="Conversation harness and model" hidden></div><div class="chat-history-backdrop" data-chat-history-backdrop hidden></div><section id="chatHistoryDrawer" class="chat-history-drawer" data-chat-history-drawer aria-label="Chat history" hidden><div class="chat-history-heading"><strong>Chat history</strong><button data-chat-rename type="button">Rename</button></div><div class="chat-history-list" data-chat-history-list></div></section><div data-chat-messages></div><div class="chat-composer"><div class="chat-attachments" data-chat-attachments></div><div class="chat-upload-status" data-chat-upload-status role="status"></div><textarea data-chat-draft aria-label="Message" placeholder="Ask the episode assistant, or drop an image" rows="3"></textarea><div class="chat-composer-actions"><button class="chat-icon" data-chat-send type="button" aria-label="Send message" title="Send message">↑</button><button class="chat-icon" data-chat-attach type="button" aria-label="Attach images" title="Attach images"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m8 13 7-7a3 3 0 0 1 4 4l-9 9a5 5 0 0 1-7-7l10-10M6 15l8-8"/></svg></button><input data-chat-files type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden><button class="chat-icon" data-chat-new type="button" aria-label="New chat" title="New chat">＋</button><button class="chat-icon chat-stop" data-chat-stop type="button" aria-label="Stop active response" title="Stop active response" hidden>×</button></div><small>Enter to send · Shift+Enter for a new line</small></div>`;
    this.setHistoryOpen(false);
    this.bind(generation, episodeId);
    await this.refreshList(generation, episodeId);
    if (!this.isCurrent(generation, episodeId)) return;
    this.pollTimer = setInterval(() => this.refreshList(generation, episodeId, { preserveSelection: true }).catch(() => {}), 1000);
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
    const episodeId = this.episodeId, conversationId = this.currentId;
    await this.flushDraft();
    const value = await this.api(`${this.itemUrl(episodeId, conversationId)}/production-requests`, { method: "POST",
      body: JSON.stringify({ kind, targetCardId, prompt, clientRequestId }) });
    if (this.isCurrent(this.generation, episodeId, conversationId)) await this.refreshList(this.generation, episodeId, { preserveSelection: true });
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
    container.innerHTML = state.attachments.map((item) => `<div class="chat-attachment"><img src="/api/episodes/${encodeURIComponent(this.episodeId)}/library/${encodeURIComponent(item.itemId)}/file" alt="${escapeHtml(item.label)}"><span>${escapeHtml(item.label)}</span><button type="button" data-chat-remove-image="${escapeHtml(item.itemId)}" aria-label="Remove ${escapeHtml(item.label)}">×</button></div>`).join('')
      + state.uploads.map((item) => `<div class="chat-attachment uploading"><span>Uploading ${escapeHtml(item.name)}…</span></div>`).join('');
    this.root.querySelector('[data-chat-upload-status]').textContent = state.error;
    this.root.querySelector('[data-chat-send]').disabled = this.isBusy() || this.sending || state.uploads.length > 0;
  }

  async addImages(files) {
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
      this.currentId = next;
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
      this.currentId = value.id;
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
    const send = this.root.querySelector("[data-chat-send]");
    send.onclick = async () => {
      const conversationId = this.currentId, text = draft.value;
      const imageDraft = this.imageDraft(conversationId);
      if ((!text.trim() && !imageDraft.attachments.length) || send.disabled || this.sending) return;
      this.sending = true; send.disabled = true;
      try {
        await this.flushDraft();
        await this.api(`${this.itemUrl(episodeId, conversationId)}/messages`, { method: "POST", body: JSON.stringify({ text, ...(imageDraft.attachments.length ? { attachmentIds: imageDraft.attachments.map((item) => item.itemId) } : {}) }) });
        imageDraft.attachments = []; imageDraft.dirty = false; imageDraft.error = "";
        if (!this.isCurrent(generation, episodeId, conversationId)) return;
        if (draft.value === text) { draft.value = ""; draft.dataset.dirty = "false"; }
        await this.refreshList(generation, episodeId, { preserveSelection: true });
      } catch (cause) { this.toast(cause.message); }
      finally { this.sending = false; this.paintImages(); }
    };
    draft.onkeydown = (event) => {
      if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
      event.preventDefault();
      send.click();
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
    list.innerHTML = this.conversations.map((value) => `<button class="chat-history-item ${value.id === this.currentId ? "selected" : ""}" data-chat-id="${escapeHtml(value.id)}" type="button" aria-current="${value.id === this.currentId ? "true" : "false"}"><b>${escapeHtml(value.name)}</b><span>${working(value.state) ? "working" : escapeHtml(value.state || "idle")}</span></button>`).join("");
    const current = this.conversations.find((value) => value.id === this.currentId);
    this.root.querySelector("[data-chat-title]").textContent = current?.name || "Episode assistant";
    this.root.querySelector("[data-chat-rename]").disabled = !current;
  }

  async refreshList(generation, episodeId, { preserveSelection = false } = {}) {
    let conversations = await this.api(`/api/episodes/${episodeId}/chats`);
    if (!this.isCurrent(generation, episodeId)) return;
    if (!conversations.length) conversations = [await this.api(`/api/episodes/${episodeId}/chats`, { method: "POST", body: JSON.stringify({ name: "Conversation 1" }) })];
    if (!this.isCurrent(generation, episodeId)) return;
    this.conversations = conversations;
    if (!preserveSelection || !conversations.some((value) => value.id === this.currentId)) this.currentId = conversations[0].id;
    this.paintConversationList();
    await this.refresh(generation, episodeId, this.currentId);
  }

  async refresh(generation, episodeId, conversationId) {
    const imageRevision = this.imageDraft(conversationId).revision;
    const value = await this.api(this.itemUrl(episodeId, conversationId));
    if (!this.isCurrent(generation, episodeId, conversationId)) return;
    this.current = value;
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
    const boundaries = (value.events ?? []).map((event) => ({ at: event.createdAt, text: boundaryText(event) })).filter((entry) => entry.text);
    const retryByMessage = new Map((value.runs ?? []).filter((run) => ["failed", "interrupted"].includes(run.state)).map((run) => [run.originatingMessageId, run.id]));
    const items = [...value.messages.map((message) => ({ at: message.createdAt, html: `<p class="chat-${escapeHtml(message.role)}" data-message-id="${message.id}"><b>${message.role === "user" ? "You" : "Assistant"}</b><span>${escapeHtml(message.text)}${(message.attachments || []).map((item) => `<a class="chat-image-link" href="/api/episodes/${encodeURIComponent(episodeId)}/library/${encodeURIComponent(item.itemId)}/file" target="_blank" rel="noopener"><img src="/api/episodes/${encodeURIComponent(episodeId)}/library/${encodeURIComponent(item.itemId)}/file" alt="${escapeHtml(item.label)}" loading="lazy"></a>`).join("")}</span>${retryByMessage.has(message.id) ? `<button type="button" data-chat-retry="${escapeHtml(retryByMessage.get(message.id))}" aria-label="Retry this request as a new explicit request">Retry</button>` : ""}</p>` })),
      ...boundaries.map((entry) => ({ at: entry.at, html: `<p class="chat-boundary" role="note"><span>${escapeHtml(entry.text)}</span></p>` }))]
      .sort((a, b) => String(a.at ?? "").localeCompare(String(b.at ?? "")));
    this.root.querySelector("[data-chat-messages]").innerHTML = items.map((item) => item.html).join("") || "<p>Start a conversation about this episode.</p>";
    const draft = this.draftField();
    if (draft.dataset.dirty !== "true") { draft.value = value.draft || ""; draft.dataset.dirty = "false"; }
    const busy = this.conversations.some((item) => working(item.state));
    const imageDraft = this.imageDraft();
    if (imageRevision === imageDraft.revision && !imageDraft.dirty && !imageDraft.uploads.length) imageDraft.attachments = value.draftAttachments || [];
    this.paintImages();
    const send = this.root.querySelector("[data-chat-send]"); send.disabled = busy || this.sending || imageDraft.uploads.length > 0; send.title = busy ? "Another conversation is working for this episode" : "";
    const stop = this.root.querySelector("[data-chat-stop]"); stop.hidden = !working(value.state); stop.disabled = value.state === "interrupting";
    this.onBusyChange(busy);
  }
}

export default ChatWorkspace;

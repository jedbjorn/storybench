import { ChatSettings, boundaryText, selectionLabel } from "./chat-settings.js";

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
const working = (state) => ["queued", "running", "interrupting"].includes(state);

export class ChatWorkspace {
  constructor({ root, api, getEpisode, toast = () => {} }) {
    Object.assign(this, { root, api, getEpisode, toast });
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
    this.root.innerHTML = `<div class="chat-toolbar"><button class="chat-history-toggle" data-chat-history-toggle type="button" aria-label="Open chat history" aria-controls="chatHistoryDrawer" aria-expanded="false">‹</button><div class="chat-identity"><b data-chat-title>Episode assistant</b><span data-chat-status role="status"></span></div><button class="chat-selection" data-chat-selection type="button" aria-haspopup="dialog" aria-controls="chatSettingsPanel" title="Harness, model and thinking for this conversation">Codex · default model</button></div><div id="chatSettingsPanel" class="chat-settings-panel" data-chat-settings-panel role="dialog" aria-label="Conversation harness and model" hidden></div><div class="chat-history-backdrop" data-chat-history-backdrop hidden></div><section id="chatHistoryDrawer" class="chat-history-drawer" data-chat-history-drawer aria-label="Chat history" hidden><div class="chat-history-heading"><strong>Chat history</strong><button data-chat-rename type="button">Rename</button></div><div class="chat-history-list" data-chat-history-list></div></section><div data-chat-messages></div><div class="chat-composer"><textarea data-chat-draft aria-label="Message" placeholder="Ask the episode assistant" rows="3"></textarea><div class="chat-composer-actions"><button class="visually-hidden" data-chat-send type="button">Send message</button><button class="chat-icon" data-chat-new type="button" aria-label="New chat" title="New chat">＋</button><button class="chat-icon danger" data-chat-stop type="button" aria-label="Stop active response" title="Stop active response" hidden>×</button></div><small>Enter to send · Shift+Enter for a new line</small></div>`;
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

  setHistoryOpen(open) {
    this.historyOpen = Boolean(open);
    const drawer = this.root.querySelector("[data-chat-history-drawer]");
    const backdrop = this.root.querySelector("[data-chat-history-backdrop]");
    const toggle = this.root.querySelector("[data-chat-history-toggle]");
    if (drawer) drawer.hidden = !this.historyOpen;
    if (backdrop) backdrop.hidden = !this.historyOpen;
    if (toggle) {
      toggle.setAttribute("aria-expanded", String(this.historyOpen));
      toggle.setAttribute("aria-label", this.historyOpen ? "Close chat history" : "Open chat history");
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
    const send = this.root.querySelector("[data-chat-send]");
    send.onclick = async () => {
      const conversationId = this.currentId, text = draft.value;
      if (!text.trim() || send.disabled) return;
      try {
        await this.flushDraft();
        await this.api(`${this.itemUrl(episodeId, conversationId)}/messages`, { method: "POST", body: JSON.stringify({ text }) });
        if (!this.isCurrent(generation, episodeId, conversationId)) return;
        draft.value = ""; draft.dataset.dirty = "false";
        await this.refreshList(generation, episodeId, { preserveSelection: true });
      } catch (cause) { this.toast(cause.message); }
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
    this.outsideClick = (event) => {
      if (!this.historyOpen || drawer.contains(event.target) || toggle.contains(event.target)) return;
      this.setHistoryOpen(false);
    };
    this.escapeKey = (event) => { if (event.key === "Escape" && this.historyOpen) this.setHistoryOpen(false); };
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
    const value = await this.api(this.itemUrl(episodeId, conversationId));
    if (!this.isCurrent(generation, episodeId, conversationId)) return;
    this.current = value;
    this.root.querySelector("[data-chat-status]").textContent = value.error || value.state;
    const chip = this.root.querySelector("[data-chat-selection]");
    chip.textContent = selectionLabel(value.settings);
    chip.dataset.selectable = value.settings ? "true" : "false";
    // Messages and visible boundaries (settings changes, new native sessions) in time order.
    const boundaries = (value.events ?? []).map((event) => ({ at: event.createdAt, text: boundaryText(event) })).filter((entry) => entry.text);
    const items = [...value.messages.map((message) => ({ at: message.createdAt, html: `<p class="chat-${escapeHtml(message.role)}"><b>${message.role === "user" ? "You" : "Assistant"}</b><span>${escapeHtml(message.text)}</span></p>` })),
      ...boundaries.map((entry) => ({ at: entry.at, html: `<p class="chat-boundary" role="note"><span>${escapeHtml(entry.text)}</span></p>` }))]
      .sort((a, b) => String(a.at ?? "").localeCompare(String(b.at ?? "")));
    this.root.querySelector("[data-chat-messages]").innerHTML = items.map((item) => item.html).join("") || "<p>Start a conversation about this episode.</p>";
    const draft = this.draftField();
    if (draft.dataset.dirty !== "true") { draft.value = value.draft || ""; draft.dataset.dirty = "false"; }
    const busy = this.conversations.some((item) => working(item.state));
    const send = this.root.querySelector("[data-chat-send]"); send.disabled = busy; send.title = busy ? "Another conversation is working for this episode" : "";
    const stop = this.root.querySelector("[data-chat-stop]"); stop.hidden = !working(value.state); stop.disabled = value.state === "interrupting";
  }
}

export default ChatWorkspace;

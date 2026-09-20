const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
const working = (state) => ["queued", "running", "interrupting"].includes(state);

export class ChatWorkspace {
  constructor({ root, api, getEpisode, toast = () => {} }) {
    Object.assign(this, { root, api, getEpisode, toast });
    this.conversations = [];
    this.currentId = null;
    this.generation = 0;
    this.draftChain = Promise.resolve();
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
    this.root.innerHTML = `<div class="chat-switcher"><select data-chat-select aria-label="Conversation"></select><button data-chat-new type="button">New</button><button data-chat-rename type="button">Rename</button></div><div data-chat-status role="status"></div><div data-chat-messages></div><textarea data-chat-draft aria-label="Message" placeholder="Ask the episode assistant"></textarea><div><button data-chat-send type="button">Send</button><button data-chat-stop type="button" hidden>Stop</button></div>`;
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
  stopTimers() { clearInterval(this.pollTimer); clearTimeout(this.draftTimer); this.pollTimer = null; this.draftTimer = null; }
  isCurrent(generation, episodeId, conversationId) {
    return generation === this.generation && episodeId === this.episodeId && (conversationId === undefined || conversationId === this.currentId);
  }
  itemUrl(episodeId = this.episodeId, conversationId = this.currentId) { return `/api/episodes/${episodeId}/chats/${conversationId}`; }
  draftField() { return this.root.querySelector("[data-chat-draft]"); }

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
    this.root.querySelector("[data-chat-select]").onchange = async (event) => {
      const next = event.target.value;
      await this.flushDraft();
      if (!this.isCurrent(generation, episodeId)) return;
      this.currentId = next;
      await this.refresh(generation, episodeId, next);
    };
    this.root.querySelector("[data-chat-new]").onclick = async () => {
      await this.flushDraft();
      if (!this.isCurrent(generation, episodeId)) return;
      const value = await this.api(`/api/episodes/${episodeId}/chats`, { method: "POST", body: JSON.stringify({ name: `Conversation ${this.conversations.length + 1}` }) });
      if (!this.isCurrent(generation, episodeId)) return;
      this.currentId = value.id;
      await this.refreshList(generation, episodeId);
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
    this.root.querySelector("[data-chat-send]").onclick = async () => {
      const conversationId = this.currentId, text = draft.value;
      if (!text.trim()) return;
      try {
        await this.flushDraft();
        await this.api(`${this.itemUrl(episodeId, conversationId)}/messages`, { method: "POST", body: JSON.stringify({ text }) });
        if (!this.isCurrent(generation, episodeId, conversationId)) return;
        draft.value = ""; draft.dataset.dirty = "false";
        await this.refreshList(generation, episodeId, { preserveSelection: true });
      } catch (cause) { this.toast(cause.message); }
    };
    this.root.querySelector("[data-chat-stop]").onclick = async () => {
      const conversationId = this.currentId;
      try { await this.api(`${this.itemUrl(episodeId, conversationId)}/interrupt`, { method: "POST", body: "{}" }); if (this.isCurrent(generation, episodeId, conversationId)) await this.refresh(generation, episodeId, conversationId); }
      catch (cause) { this.toast(cause.message); }
    };
  }

  async refreshList(generation, episodeId, { preserveSelection = false } = {}) {
    let conversations = await this.api(`/api/episodes/${episodeId}/chats`);
    if (!this.isCurrent(generation, episodeId)) return;
    if (!conversations.length) conversations = [await this.api(`/api/episodes/${episodeId}/chats`, { method: "POST", body: JSON.stringify({ name: "Conversation 1" }) })];
    if (!this.isCurrent(generation, episodeId)) return;
    this.conversations = conversations;
    if (!preserveSelection || !conversations.some((value) => value.id === this.currentId)) this.currentId = conversations[0].id;
    this.root.querySelector("[data-chat-select]").innerHTML = conversations.map((value) => `<option value="${escapeHtml(value.id)}" ${value.id === this.currentId ? "selected" : ""}>${escapeHtml(value.name)}${working(value.state) ? " • working" : ""}</option>`).join("");
    await this.refresh(generation, episodeId, this.currentId);
  }

  async refresh(generation, episodeId, conversationId) {
    const value = await this.api(this.itemUrl(episodeId, conversationId));
    if (!this.isCurrent(generation, episodeId, conversationId)) return;
    this.root.querySelector("[data-chat-status]").textContent = value.error || value.state;
    this.root.querySelector("[data-chat-messages]").innerHTML = value.messages.map((message) => `<p class="chat-${escapeHtml(message.role)}"><b>${message.role === "user" ? "You" : "Assistant"}</b><span>${escapeHtml(message.text)}</span></p>`).join("") || "<p>Start a conversation about this episode.</p>";
    const draft = this.draftField();
    if (draft.dataset.dirty !== "true") { draft.value = value.draft || ""; draft.dataset.dirty = "false"; }
    const busy = this.conversations.some((item) => working(item.state));
    const send = this.root.querySelector("[data-chat-send]"); send.disabled = busy; send.title = busy ? "Another conversation is working for this episode" : "";
    const stop = this.root.querySelector("[data-chat-stop]"); stop.hidden = !working(value.state); stop.disabled = value.state === "interrupting";
  }
}

export default ChatWorkspace;

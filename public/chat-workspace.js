const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);

export class ChatWorkspace {
  constructor({ root, api, getEpisode, toast = () => {} }) {
    this.root = root;
    this.api = api;
    this.getEpisode = getEpisode;
    this.toast = toast;
    this.conversations = [];
    this.currentId = null;
    this.timer = null;
  }

  async open() {
    this.episodeId = this.getEpisode()?.id;
    if (!this.episodeId) return this.close();
    this.root.hidden = false;
    this.root.innerHTML = `<div class="chat-switcher"><select data-chat-select aria-label="Conversation"></select><button data-chat-new type="button">New</button><button data-chat-rename type="button">Rename</button></div><div data-chat-status role="status"></div><div data-chat-messages></div><textarea data-chat-draft aria-label="Message" placeholder="Ask the episode assistant"></textarea><div><button data-chat-send type="button">Send</button><button data-chat-stop type="button" hidden>Stop</button></div>`;
    this.bind();
    await this.refreshList();
    this.timer = setInterval(() => this.refresh().catch(() => {}), 1000);
  }

  close() {
    clearInterval(this.timer); this.timer = null; this.currentId = null; this.conversations = [];
    if (this.root) { this.root.hidden = true; this.root.innerHTML = ""; }
  }

  bind() {
    this.root.querySelector("[data-chat-select]").onchange = async (event) => { await this.saveDraft(); this.currentId = event.target.value; await this.refresh(); };
    this.root.querySelector("[data-chat-new]").onclick = async () => { const value = await this.api(`/api/episodes/${this.episodeId}/chats`, { method: "POST", body: JSON.stringify({ name: `Conversation ${this.conversations.length + 1}` }) }); this.currentId = value.id; await this.refreshList(); };
    this.root.querySelector("[data-chat-rename]").onclick = async () => { const current = this.conversations.find((value) => value.id === this.currentId); const name = prompt("Conversation name", current?.name || ""); if (!name?.trim()) return; await this.api(this.itemUrl(), { method: "PUT", body: JSON.stringify({ name }) }); await this.refreshList(); };
    this.root.querySelector("[data-chat-draft]").oninput = () => { clearTimeout(this.draftTimer); this.draftTimer = setTimeout(() => this.saveDraft().catch(() => {}), 250); };
    this.root.querySelector("[data-chat-send]").onclick = async () => { const field = this.root.querySelector("[data-chat-draft]"); if (!field.value.trim()) return; try { await this.api(`${this.itemUrl()}/messages`, { method: "POST", body: JSON.stringify({ text: field.value }) }); field.value = ""; await this.refreshList(); } catch (cause) { this.toast(cause.message); } };
    this.root.querySelector("[data-chat-stop]").onclick = async () => { try { await this.api(`${this.itemUrl()}/interrupt`, { method: "POST", body: "{}" }); await this.refresh(); } catch (cause) { this.toast(cause.message); } };
  }

  itemUrl() { return `/api/episodes/${this.episodeId}/chats/${this.currentId}`; }
  async saveDraft() {
    if (!this.currentId) return;
    await this.api(this.itemUrl(), { method: "PUT", body: JSON.stringify({ draft: this.root.querySelector("[data-chat-draft]").value }) });
  }
  async refreshList() {
    this.conversations = await this.api(`/api/episodes/${this.episodeId}/chats`);
    if (!this.conversations.length) this.conversations = [await this.api(`/api/episodes/${this.episodeId}/chats`, { method: "POST", body: JSON.stringify({ name: "Conversation 1" }) })];
    if (!this.conversations.some((value) => value.id === this.currentId)) this.currentId = this.conversations[0].id;
    this.root.querySelector("[data-chat-select]").innerHTML = this.conversations.map((value) => `<option value="${escapeHtml(value.id)}" ${value.id === this.currentId ? "selected" : ""}>${escapeHtml(value.name)}${["queued", "running", "interrupting"].includes(value.state) ? " • working" : ""}</option>`).join("");
    await this.refresh();
  }
  async refresh() {
    if (!this.currentId) return;
    const value = await this.api(this.itemUrl()), busy = this.conversations.some((item) => ["queued", "running", "interrupting"].includes(item.state));
    this.root.querySelector("[data-chat-status]").textContent = value.error || value.state;
    this.root.querySelector("[data-chat-messages]").innerHTML = value.messages.map((message) => `<p class="chat-${escapeHtml(message.role)}"><b>${message.role === "user" ? "You" : "Assistant"}</b><span>${escapeHtml(message.text)}</span></p>`).join("") || "<p>Start a conversation about this episode.</p>";
    const draft = this.root.querySelector("[data-chat-draft]"); if (document.activeElement !== draft) draft.value = value.draft || "";
    this.root.querySelector("[data-chat-send]").disabled = busy;
    this.root.querySelector("[data-chat-send]").title = busy ? "Another conversation is working for this episode" : "";
    const stop = this.root.querySelector("[data-chat-stop]"); stop.hidden = !["queued", "running", "interrupting"].includes(value.state); stop.disabled = value.state === "interrupting";
  }
}

export default ChatWorkspace;

import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { ChatWorkspace } from "../public/chat-workspace.js";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
function page() {
  const dom = new JSDOM('<main id="chat"></main>');
  globalThis.document = dom.window.document;
  globalThis.prompt = () => null;
  return { dom, root: dom.window.document.querySelector("#chat") };
}

test("late episode replies cannot redraw the current chat workspace", async (t) => {
  const { dom, root } = page(); t.after(() => dom.window.close());
  let episode = { id: "one" }, releaseOne;
  const delayed = new Promise((resolve) => { releaseOne = resolve; });
  const api = async (url) => {
    if (url === "/api/episodes/one/chats") return delayed;
    if (url === "/api/episodes/two/chats") return [{ id: "two-chat", name: "Two", state: "idle", draft: "" }];
    if (url.endsWith("/two-chat")) return { id: "two-chat", name: "Two", state: "idle", draft: "", messages: [] };
    throw new Error(`unexpected ${url}`);
  };
  const workspace = new ChatWorkspace({ root, api, getEpisode: () => episode });
  const first = workspace.open();
  episode = { id: "two" };
  await workspace.open();
  releaseOne([{ id: "one-chat", name: "One", state: "idle", draft: "" }]);
  await first;
  assert.equal(root.querySelector("[data-chat-title]").textContent, "Two");
  assert.equal(root.querySelector('[data-chat-id="two-chat"]').getAttribute("aria-current"), "true");
  workspace.close();
});

test("polling releases the episode busy lock after a turn completes", async (t) => {
  const { dom, root } = page(); t.after(() => dom.window.close());
  let state = "running";
  const context = { tokens: 1200, trigger: 500000, canCompact: true, reason: null };
  const api = async (url) => url.endsWith("/chats")
    ? [{ id: "chat", name: "Work", state, draft: "" }]
    : { id: "chat", name: "Work", state, draft: "", messages: [], context };
  const workspace = new ChatWorkspace({ root, api, getEpisode: () => ({ id: "episode" }) });
  await workspace.open();
  const compact = root.querySelector("[data-chat-compact]");
  assert.equal(workspace.isBusy(), true);
  assert.equal(compact.getAttribute("aria-disabled"), "true");
  assert.match(compact.title, /Available when the assistant is idle/);
  state = "idle";
  await workspace.refreshList(workspace.generation, "episode", { preserveSelection: true });
  assert.equal(workspace.isBusy(), false);
  assert.equal(compact.getAttribute("aria-disabled"), "false");
  workspace.close();
});

test("creating a conversation selects the new conversation", async (t) => {
  const { dom, root } = page(); t.after(() => dom.window.close());
  const conversations = [{ id: "old", name: "Conversation 1", state: "idle", draft: "old draft" }];
  const api = async (url, options = {}) => {
    if (url.endsWith("/chats") && options.method === "POST") {
      const created = { id: "new", name: "Conversation 2", state: "idle", draft: "new draft" };
      conversations.push(created); return created;
    }
    if (url.endsWith("/chats")) return conversations;
    const conversation = conversations.find((value) => url.endsWith(`/${value.id}`));
    return { ...conversation, messages: [] };
  };
  const workspace = new ChatWorkspace({ root, api, getEpisode: () => ({ id: "episode" }) });
  await workspace.open();
  await root.querySelector("[data-chat-new]").onclick();
  assert.equal(workspace.currentId, "new");
  assert.equal(root.querySelector('[data-chat-id="new"]').getAttribute("aria-current"), "true");
  assert.equal(root.querySelector("[data-chat-draft]").value, "new draft");
  workspace.close();
});

test("refresh opens the most recent conversation while polling keeps the current selection", async (t) => {
  const { dom, root } = page(); t.after(() => dom.window.close());
  const conversations = [
    { id: "new", name: "Conversation 2", state: "idle", draft: "new draft" },
    { id: "old", name: "Conversation 1", state: "idle", draft: "old draft" },
  ];
  const api = async (url) => url.endsWith("/chats")
    ? conversations
    : { ...conversations.find((value) => url.endsWith(value.id)), messages: [] };
  const workspace = new ChatWorkspace({ root, api, getEpisode: () => ({ id: "episode" }) });
  await workspace.open();
  assert.deepEqual([...root.querySelectorAll("[data-chat-id]")].map((item) => item.dataset.chatId), ["new", "old"]);
  assert.equal(workspace.currentId, "new");
  assert.equal(root.querySelector("[data-chat-draft]").value, "new draft");

  await root.querySelector('[data-chat-history-list]').onclick({ target: root.querySelector('[data-chat-id="old"]') });
  await workspace.refreshList(workspace.generation, "episode", { preserveSelection: true });
  assert.equal(workspace.currentId, "old");

  await workspace.open();
  assert.equal(workspace.currentId, "new");
  assert.equal(root.querySelector('[data-chat-id="new"]').getAttribute("aria-current"), "true");
  workspace.close();
});

test("episode switch flushes the captured draft without cross-writing the next episode", async (t) => {
  const { dom, root } = page(); t.after(() => dom.window.close());
  let episode = { id: "one" }; const writes = [];
  const api = async (url, options = {}) => {
    if (options.method === "PUT") { writes.push({ url, body: JSON.parse(options.body) }); return {}; }
    if (url.endsWith("/chats")) { const id = url.includes("/one/") ? "one-chat" : "two-chat"; return [{ id, name: id, state: "idle", draft: "" }]; }
    const id = url.endsWith("one-chat") ? "one-chat" : "two-chat";
    return { id, name: id, state: "idle", draft: "", messages: [] };
  };
  const workspace = new ChatWorkspace({ root, api, getEpisode: () => episode });
  await workspace.open();
  const field = root.querySelector("[data-chat-draft]");
  field.value = "captured for one";
  field.dispatchEvent(new dom.window.Event("input"));
  episode = { id: "two" };
  await workspace.open();
  await workspace.draftChain; await tick();
  assert.deepEqual(writes, [{ url: "/api/episodes/one/chats/one-chat", body: { draft: "captured for one" } }]);
  assert.equal(workspace.episodeId, "two");
  workspace.close();
});

test("history drawer opens on demand and closes on click-off or Escape", async (t) => {
  const { dom, root } = page(); t.after(() => dom.window.close());
  const api = async (url) => url.endsWith("/chats")
    ? [{ id: "chat", name: "Story notes", state: "idle", draft: "" }]
    : { id: "chat", name: "Story notes", state: "idle", draft: "", messages: [] };
  const workspace = new ChatWorkspace({ root, api, getEpisode: () => ({ id: "episode" }) });
  await workspace.open();
  const toggle = root.querySelector("[data-chat-history-toggle]");
  const drawer = root.querySelector("[data-chat-history-drawer]");
  toggle.click();
  assert.equal(drawer.hidden, false);
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  root.querySelector("[data-chat-messages]").click();
  assert.equal(drawer.hidden, true);
  toggle.click();
  dom.window.document.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.equal(drawer.hidden, true);
  workspace.close();
});

test("choosing a history item switches conversations and closes the drawer", async (t) => {
  const { dom, root } = page(); t.after(() => dom.window.close());
  const conversations = [
    { id: "one", name: "Story", state: "idle", draft: "first" },
    { id: "two", name: "Graphics", state: "idle", draft: "second" },
  ];
  const api = async (url) => url.endsWith("/chats")
    ? conversations
    : { ...conversations.find((value) => url.endsWith(value.id)), messages: [] };
  const workspace = new ChatWorkspace({ root, api, getEpisode: () => ({ id: "episode" }) });
  await workspace.open();
  root.querySelector("[data-chat-history-toggle]").click();
  root.querySelector('[data-chat-id="two"]').click();
  await tick();
  assert.equal(workspace.currentId, "two");
  assert.equal(root.querySelector("[data-chat-title]").textContent, "Graphics");
  assert.equal(root.querySelector("[data-chat-history-drawer]").hidden, true);
  assert.equal(root.querySelector("[data-chat-draft]").value, "second");
  workspace.close();
});

test("Enter sends, Shift+Enter keeps a newline, and × interrupts the active chat", async (t) => {
  const { dom, root } = page(); t.after(() => dom.window.close());
  let state = "idle"; const calls = [];
  const conversation = () => ({ id: "chat", name: "Edit", state, draft: "", messages: [] });
  const api = async (url, options = {}) => {
    calls.push({ url, method: options.method, body: options.body && JSON.parse(options.body) });
    if (url.endsWith("/chats")) return [conversation()];
    if (url.endsWith("/messages")) return {};
    if (url.endsWith("/interrupt")) { state = "interrupting"; return {}; }
    return conversation();
  };
  const workspace = new ChatWorkspace({ root, api, getEpisode: () => ({ id: "episode" }) });
  await workspace.open();
  const draft = root.querySelector("[data-chat-draft]");
  draft.value = "Send this";
  draft.dispatchEvent(new dom.window.Event("input"));
  const enter = new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
  draft.dispatchEvent(enter);
  await tick(); await tick();
  assert.equal(enter.defaultPrevented, true);
  assert.ok(calls.some((call) => call.url.endsWith("/messages") && call.body.text === "Send this"));

  draft.value = "Keep this line";
  const shifted = new dom.window.KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true, cancelable: true });
  draft.dispatchEvent(shifted);
  assert.equal(shifted.defaultPrevented, false);

  state = "running";
  await workspace.refreshList(workspace.generation, "episode", { preserveSelection: true });
  const stop = root.querySelector("[data-chat-stop]");
  assert.equal(stop.hidden, false);
  assert.equal(stop.textContent, "×");
  assert.equal(stop.classList.contains("chat-stop"), true);
  assert.equal(stop.classList.contains("danger"), false);
  stop.click();
  await tick();
  assert.ok(calls.some((call) => call.url.endsWith("/interrupt") && call.method === "POST"));
  workspace.close();
});

test('late image uploads persist only to the captured conversation and failures preserve the draft', async (t) => {
  const { dom, root } = page(); t.after(() => dom.window.close());
  let episode = { id: 'one' }, finishUpload; const writes = [];
  const api = async (url, options = {}) => {
    if (options.method === 'PUT') { writes.push({ url, body: JSON.parse(options.body) }); return {}; }
    if (url.endsWith('/messages')) throw new Error('Send failed');
    const id = url.includes('/one/') ? 'one-chat' : 'two-chat';
    return url.endsWith('/chats') ? [{ id, state: 'idle' }] : { id, state: 'idle', messages: [], draft: '' };
  };
  const workspace = new ChatWorkspace({ root, api, getEpisode: () => episode, uploadImage: () => new Promise((resolve) => { finishUpload = resolve; }) });
  await workspace.open();
  const pending = workspace.addImages([{ name: 'image.png', type: 'image/png', size: 20 }]);
  assert.equal(workspace.imageDraft().uploads.length, 1, 'Enter does not send while an image is uploading');
  episode = { id: 'two' }; await workspace.open();
  finishUpload({ id: 'one-image', label: 'Image', asset: { kind: 'image' } }); await pending;
  assert.deepEqual(writes, [{ url: '/api/episodes/one/chats/one-chat', body: { attachmentIds: ['one-image'] } }]);
  assert.equal(root.querySelector('.chat-attachment'), null);
  workspace.imageDraft().attachments = [{ itemId: 'two-image', label: 'Two image', episodeId: 'two' }];
  workspace.paintImages();
  await workspace.sendDraft();
  assert.equal(workspace.imageDraft().attachments[0].itemId, 'two-image');
  assert.equal(workspace.sending, false);
  await workspace.addImages([{ name: 'not-image.txt', type: 'text/plain', size: 1 }]);
  assert.match(root.querySelector('[data-chat-upload-status]').textContent, /PNG/);
  workspace.close();
});

test('unsaved production conflicts block chat and production requests without discarding the message', async t => {
  const {dom,root}=page(); t.after(()=>dom.window.close());
  const writes=[], notices=[];
  const api=async (url,options={})=>{
    if (options.method==='POST') writes.push(url);
    if (url.endsWith('/chats')) return [{id:'chat',name:'Work',state:'idle',draft:''}];
    if (url.endsWith('/chat') && !options.method) return {id:'chat',name:'Work',state:'idle',draft:'',messages:[]};
    return {};
  };
  const workspace=new ChatWorkspace({root,api,getEpisode:()=>({id:'episode'}),toast:message=>notices.push(message),beforeSend:async()=>{throw new Error('Resolve unsaved slides');}});
  t.after(()=>workspace.close()); await workspace.open();
  const draft=root.querySelector('[data-chat-draft]'); draft.value='Build from this';
  draft.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter' })); await tick();
  assert.equal(writes.some(url=>url.endsWith('/messages')),false);
  assert.equal(draft.value,'Build from this'); assert.ok(notices.includes('Resolve unsaved slides'));
  await assert.rejects(workspace.sendProduction({kind:'draft'}),/unsaved slides/);
  assert.equal(writes.some(url=>url.endsWith('/production-requests')),false);
});

test("history lists ten conversations; the drawer shows agents; the compact button compacts", async (t) => {
  const { dom, root } = page(); t.after(() => dom.window.close());
  const conversations = Array.from({ length: 12 }, (_, index) => ({ id: `c${index}`, name: `Conversation ${12 - index}`, state: "idle", draft: "" }));
  const calls = [];
  const context = { tokens: 312_400, trigger: 500_000, canCompact: true, reason: null };
  const api = async (url, options = {}) => {
    calls.push({ url, method: options.method ?? "GET" });
    if (url.endsWith("/chats")) return conversations;
    if (url.endsWith("/compact")) return {};
    const id = url.split("/").at(-1);
    return { id, name: id, state: "idle", draft: "", messages: [], context, settings: { harness: "claude", model: "opus" },
      runs: [{ state: "completed", modelResolved: "claude-opus-5-5", startedAt: "2026-11-18T10:00:00.000Z", finishedAt: "2026-11-18T10:03:27.000Z" }],
      events: [{ type: "turn.started", createdAt: "2026-11-18T10:00:00.000Z", payload: {} }, { type: "agent.updated", createdAt: "2026-11-18T10:00:05.000Z", payload: { id: "a", label: "Rework assets", model: "claude-sonnet-5", tokens: 16_461, state: "completed" } },
        { type: "agent.updated", createdAt: "2026-11-18T10:01:05.000Z", payload: { id: "a", state: "completed" } }] };
  };
  const workspace = new ChatWorkspace({ root, api, getEpisode: () => ({ id: "episode" }) });
  t.after(() => workspace.close());
  await workspace.open();
  assert.equal(root.querySelectorAll("[data-chat-id]").length, 10);
  workspace.selectConversation("c11"); workspace.paintConversationList();
  const ids = [...root.querySelectorAll("[data-chat-id]")].map((item) => item.dataset.chatId);
  assert.equal(ids.length, 10); assert.equal(ids.at(-1), "c11", "the open conversation stays reachable");
  await workspace.refresh(workspace.generation, "episode", "c11");
  const rows = [...root.querySelectorAll(".chat-agent")].map((row) => [...row.children].map((child) => child.textContent));
  assert.deepEqual(rows, [["Assistant", "claude-opus-5-5 | 312k / 500k", "Done · 3:27"], ["Rework assets", "claude-sonnet-5 | 16k", "Done · 1:00"]]);
  const compact = root.querySelector("[data-chat-compact]");
  assert.equal(compact.getAttribute("aria-disabled"), "false");
  assert.match(compact.title, /^Compact context\n.+\nContext 312k \/ 500k · compacts automatically at 500k$/);
  await compact.onclick({ currentTarget: compact });
  assert.ok(calls.some((call) => call.url === "/api/episodes/episode/chats/c11/compact" && call.method === "POST"));
});

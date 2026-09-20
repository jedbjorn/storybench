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
  const api = async (url) => url.endsWith("/chats")
    ? [{ id: "chat", name: "Work", state, draft: "" }]
    : { id: "chat", name: "Work", state, draft: "", messages: [] };
  const workspace = new ChatWorkspace({ root, api, getEpisode: () => ({ id: "episode" }) });
  await workspace.open();
  assert.equal(root.querySelector("[data-chat-send]").disabled, true);
  state = "idle";
  await workspace.refreshList(workspace.generation, "episode", { preserveSelection: true });
  assert.equal(root.querySelector("[data-chat-send]").disabled, false);
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
  stop.click();
  await tick();
  assert.ok(calls.some((call) => call.url.endsWith("/interrupt") && call.method === "POST"));
  workspace.close();
});

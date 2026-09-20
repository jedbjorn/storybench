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
  assert.equal(root.querySelector("[data-chat-select]").value, "two-chat");
  assert.match(root.textContent, /Two/);
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

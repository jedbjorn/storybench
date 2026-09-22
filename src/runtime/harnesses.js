// Worker-backed harness adapters (minimal slice; adapter lane #26 extends these).
//  - WorkerCodexConnection: the existing CodexConnection over the worker's harness socket,
//    with command execution enabled inside the worker boundary and Storybench tools as
//    app-server dynamic tools (image results as inputImage content items).
//  - ClaudeStreamSession: Claude Code headless stream-json over the harness socket, with
//    Storybench tools served by the in-worker MCP bridge.
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { CodexConnection, CodexError, TOOL_CONTENT } from "../codex.js";
import { toCodexContentItems } from "./tools.js";

export class WorkerCodexConnection extends CodexConnection {
  constructor({ child, tools, effort = null, ...options }) {
    const handlers = Object.fromEntries(tools.definitions.map((definition) => [
      definition.name,
      async (args) => ({ [TOOL_CONTENT]: toCodexContentItems(await tools.call(definition.name, args)) }),
    ]));
    super({ ...options, tools: handlers, spawn: () => child });
    // Storybench tools are served over the request's MCP bridge (see the worker launch
    // table); dynamic tools stay available for callers that pass `dynamicTools: true`.
    this.dynamicTools = options.dynamicTools === true ? tools.definitions.map((definition) => ({ type: "function", ...definition })) : [];
    this.effort = effort;
    // Model/effort as reported by the harness for this thread (never assumed). Codex's
    // current app-server responses do not report the resolved effort, so effortResolved is
    // normally null even when an effort was selected for the turn.
    this.resolved = { model: null, effort: null };
  }

  #capture(result) {
    if (typeof result?.model === "string") this.resolved.model = result.model;
    if (typeof result?.reasoningEffort === "string") this.resolved.effort = result.reasoningEffort;
  }

  async startThread() {
    const result = await this.request("thread/start", this.threadParams());
    const id = result?.thread?.id;
    if (!id) throw new CodexError("CODEX_PROTOCOL_ERROR", "thread/start returned no thread id.");
    this.#capture(result);
    return id;
  }

  // Exact resume with the selected model; a compatible same-harness settings change applies here.
  async resumeExact(threadId) {
    const result = await this.request("thread/resume", { ...this.threadParams(), threadId });
    if (result?.thread?.id !== threadId) throw new CodexError("CODEX_SESSION_LOST", "Codex could not resume the saved conversation thread.");
    if (result.thread.cwd && result.thread.cwd !== this.cwd) throw new CodexError("CODEX_SESSION_MISMATCH", "The saved Codex thread belongs to a different workspace.");
    this.#capture(result);
    return threadId;
  }

  threadParams() {
    return {
      cwd: this.cwd,
      ...(this.model ? { model: this.model } : {}),
      // Unrestricted inside the verified worker container boundary (spec #11).
      approvalPolicy: "never", sandbox: "danger-full-access", dynamicTools: this.dynamicTools,
    };
  }

  async startTurn(threadId, text, images = []) {
    this.startingEvents = [];
    try {
      const result = await this.request("turn/start", {
        threadId, input: [{ type: "text", text }, ...images.map((image) => ({ type: "image", url: `data:${image.mimeType};base64,${image.data}` }))], cwd: this.cwd,
        approvalPolicy: "never", sandboxPolicy: { type: "dangerFullAccess" },
        ...(this.effort ? { effort: this.effort } : {}),
      }, { uncertain: true });
      const id = result?.turn?.id;
      if (!id) throw new CodexError("CODEX_PROTOCOL_ERROR", "turn/start returned no turn id.", { uncertain: true });
      const buffered = this.startingEvents;
      this.startingEvents = null;
      for (const event of buffered) this.onEvent(event);
      return id;
    } catch (error) { this.startingEvents = null; throw error; }
  }

  // Resume the exact native thread; if the harness cannot resume it in this worker (the
  // record is absent or belongs to another workspace path), start a fresh native segment
  // and expose the transition instead of silently dropping or relabelling history.
  async resumeThread(threadId) {
    try { return await this.resumeExact(threadId); }
    catch (error) {
      if (!["CODEX_SESSION_LOST", "CODEX_SESSION_MISMATCH", "CODEX_PROTOCOL_ERROR"].includes(error.code)) throw error;
      const fresh = await this.startThread();
      this.segmentTransition = { previousThreadId: threadId, threadId: fresh, reason: error.code, detail: String(error.message).slice(0, 300) };
      return fresh;
    }
  }

  listSkills() { return this.request("skills/list", { cwds: [this.cwd], forceReload: true }); }
}

export class ClaudeStreamSession {
  constructor(child, { onEvent = () => {}, onRaw = () => {} } = {}) {
    this.child = child;
    this.onEvent = onEvent;
    this.sessionId = null;
    this.init = null;
    this.waiters = [];
    this.closed = false;
    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    lines.on("line", (line) => {
      let event;
      try { event = JSON.parse(line); } catch { onRaw(line); return; }
      if (event.type === "system" && event.subtype === "init") { this.init = event; this.sessionId = event.session_id; }
      if (event.session_id && !this.sessionId) this.sessionId = event.session_id;
      this.onEvent(event);
      if (event.type === "result") this.waiters.shift()?.resolve(event);
    });
    child.once("exit", () => {
      this.closed = true;
      for (const waiter of this.waiters.splice(0)) waiter.reject(new Error("Claude exited before the turn completed"));
    });
  }

  // Send one user turn and resolve with the stream's `result` event.
  send(text, images = []) {
    if (this.closed) return Promise.reject(new Error("Claude session is closed"));
    const done = new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
    this.child.stdin.write(JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text }, ...images.map((image) => ({ type: "image", source: { type: "base64", media_type: image.mimeType, data: image.data } }))] } }) + "\n");
    return done;
  }

  close() { this.child.stdin.end(); this.child.kill(); }
}

// Claude Code as a production chat adapter. It presents the same connection interface the
// chat service uses for Codex (startThread/resumeThread/startTurn/interrupt/close) and
// normalizes the stream-json events into the chat's event vocabulary:
//   turn/started, item/agentMessage/delta, item/started|completed (dynamicToolCall),
//   turn/completed {status completed|failed|interrupted, usage, model}.
// The native session is created lazily on the first turn: a new thread gets a session ID we
// choose (`--session-id`), a resumed thread uses `--resume <exact id>`. Storybench tools reach
// Claude through the request's MCP bridge (mcp__storybench__*), the same shared tool set.
const MCP_PREFIX = "mcp__storybench__";

export class ClaudeChatConnection {
  constructor({ spawnSession, model = null, effort = null, onEvent = () => {}, onError = () => {} }) {
    Object.assign(this, { spawnSession, model, effort, onEvent, onError });
    this.resolved = { model: null, effort: effort ?? null };
    this.launch = null;
    this.session = null;
    this.turnId = null;
    this.toolNames = new Map();
    this.usage = null;
    this.interrupted = false;
    this.attempt = null;
  }

  async open() { return this; }

  async startThread() {
    const sessionId = randomUUID();
    this.launch = { sessionId };
    this.threadId = sessionId;
    return sessionId;
  }

  async resumeThread(threadId) {
    this.launch = { resume: threadId };
    this.threadId = threadId;
    return threadId;
  }

  #emit(method, params) { this.onEvent({ method, params: { threadId: this.threadId, turnId: this.turnId, ...params } }); }

  #resumeUnavailable(detail) {
    const previousThreadId = this.launch?.resume;
    const message = String(detail || "Claude could not resume the saved session").slice(0, 500);
    this.segmentTransition = { previousThreadId, threadId: null, reason: "CLAUDE_SESSION_LOST", detail: message, resumeUnavailable: true };
    return Object.assign(new Error(message), { code: "CLAUDE_SESSION_LOST", resumeUnavailable: true });
  }

  #normalize(event) {
    if (event.type === "system" && event.subtype === "init") {
      if (typeof event.model === "string") this.resolved.model = event.model;
      return;
    }
    if (event.type === "assistant") {
      if (typeof event.message?.model === "string") this.resolved.model = event.message.model;
      if (event.message?.usage) this.usage = event.message.usage;
      for (const block of event.message?.content ?? []) {
        if (block.type === "text" && block.text) this.#emit("item/agentMessage/delta", { delta: block.text });
        else if (block.type === "tool_use") {
          const name = String(block.name || "").startsWith(MCP_PREFIX) ? block.name.slice(MCP_PREFIX.length) : block.name;
          this.toolNames.set(block.id, name);
          this.#emit("item/started", { item: { type: "dynamicToolCall", tool: name, status: "inProgress", native: !String(block.name).startsWith(MCP_PREFIX) } });
        }
      }
      return;
    }
    if (event.type === "user") {
      for (const block of Array.isArray(event.message?.content) ? event.message.content : []) {
        if (block.type !== "tool_result") continue;
        this.#emit("item/completed", { item: { type: "dynamicToolCall", tool: this.toolNames.get(block.tool_use_id) ?? "tool", status: block.is_error ? "failed" : "completed" } });
      }
      return;
    }
    if (event.type === "result") {
      const failed = event.is_error || event.subtype !== "success";
      const status = this.interrupted ? "interrupted" : failed ? "failed" : "completed";
      this.completed = true;
      if (event.usage) this.usage = event.usage;
      if (event.modelUsage && !this.resolved.model) this.resolved.model = Object.keys(event.modelUsage)[0] ?? null;
      this.#emit("turn/completed", { turn: { id: this.turnId, status, ...(status === "failed" ? { error: String(event.result || event.subtype || "Claude turn failed").slice(0, 500) } : {}) },
        usage: this.usage, model: this.resolved.model, costUsd: event.total_cost_usd ?? null });
    }
  }

  async startTurn(threadId, text, images = []) {
    if (!this.launch || threadId !== this.threadId) throw new Error("Start or resume the Claude session before starting a turn");
    const launch = { ...this.launch }, resuming = Boolean(launch.resume);
    const child = await this.spawnSession({ harness: "claude", model: this.model, ...(this.effort ? { effort: this.effort } : {}), ...launch });
    this.child = child;
    this.completed = false;
    this.turnId ??= randomUUID();
    let raw = "", readyResolve, readyReject, readySettled = false;
    const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
    const settleReady = (method, value) => { if (readySettled) return; readySettled = true; method(value); };
    const unavailableResult = (event) => event?.type === "result" && /no conversation found|session[^\n]{0,80}(?:not found|missing|does not exist)/i.test(String(event.result || event.error || event.subtype || ""));
    const attempt = { child, resuming };
    this.attempt = attempt;
    this.session = new ClaudeStreamSession(child, {
      onRaw: (line) => { raw = `${raw}\n${line}`.slice(-1000); },
      onEvent: (event) => {
        if (resuming && !this.session?.init && unavailableResult(event)) {
          settleReady(readyReject, this.#resumeUnavailable(event.result || event.error));
          return;
        }
        this.#normalize(event);
        if (event.type === "system" && event.subtype === "init") settleReady(readyResolve);
        else if (event.type === "result") settleReady(readyResolve);
      },
    });
    this.#emit("turn/started", { turn: { id: this.turnId } });
    child.once("exit", () => {
      if (this.attempt !== attempt) return;
      if (!this.completed) {
        if (resuming && !this.session?.init) {
          settleReady(readyReject, this.#resumeUnavailable(raw.trim() || "Claude exited before finding the saved session"));
          return;
        }
        const detail = this.interrupted ? null : "Claude Code exited before the turn completed";
        this.completed = true;
        this.#emit("turn/completed", { turn: { id: this.turnId, status: this.interrupted ? "interrupted" : "failed", ...(detail ? { error: detail } : {}) }, model: this.resolved.model });
      }
    });
    this.session.send(text, images).then(() => { this.completed = true; }, (error) => {
      if (resuming && !this.session?.init) settleReady(readyReject, this.#resumeUnavailable(raw.trim() || error.message));
      else if (!this.completed) this.onError(error);
    });
    // A resumed CLI may reject a missing session only after its first input. Do not tell chat
    // that dispatch succeeded until init proves the recorded session exists.
    if (resuming) await ready;
    return this.turnId;
  }

  // Ask Claude to interrupt the running turn (stream-json control request). The chat's Stop
  // fallback removes the worker if the turn does not end promptly.
  async interrupt() {
    this.interrupted = true;
    if (this.child?.stdin?.writable) this.child.stdin.write(JSON.stringify({ type: "control_request", request_id: randomUUID(), request: { subtype: "interrupt" } }) + "\n");
    return {};
  }

  close() { this.session?.close(); }
}

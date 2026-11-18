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
import { TOOL_DELIVERED, withToolDelivery } from "../tool-delivery.js";
import { anthropicContext } from "./compaction.js";

// Codex native item types and the tool names their entries are recorded under. A webSearch
// item carries no status of its own.
const CODEX_NATIVE_TOOLS = Object.freeze({ commandExecution: "shell", fileChange: "apply_patch", webSearch: "web_search" });

export class WorkerCodexConnection extends CodexConnection {
  constructor({ child, tools, effort = null, autocompact = null, ...options }) {
    const handlers = Object.fromEntries(tools.definitions.map((definition) => [
      definition.name,
      async (args) => { const output = await tools.call(definition.name, args); return withToolDelivery({ [TOOL_CONTENT]: toCodexContentItems(output) }, output?.[TOOL_DELIVERED]); },
    ]));
    super({ ...options, tools: handlers, spawn: () => child });
    // Storybench tools are served over the request's MCP bridge (see the worker launch
    // table); dynamic tools stay available for callers that pass `dynamicTools: true`.
    this.dynamicTools = options.dynamicTools === true ? tools.definitions.map((definition) => ({ type: "function", ...definition })) : [];
    this.effort = effort;
    this.autocompact = autocompact;
    // Model/effort as reported by the harness for this thread (never assumed). Codex's
    // current app-server responses do not report the resolved effort, so effortResolved is
    // normally null even when an effort was selected for the turn.
    this.resolved = { model: null, effort: null };
    const forward = this.onEvent;
    this.onEvent = (event) => { for (const own of this.#production(event)) forward(own); };
  }

  // Subagents run as their own app-server threads. Only the conversation's thread reaches
  // chat; each delegation shows as one tool entry per subagent (its `agentThreadId`), started
  // when the subagent is spawned and completed the first time it ends. Codex reports every
  // activity kind as an item/started + item/completed pair and may report a subagent again
  // after it ended ("interacted" on a follow-up, then a second "completed"); none of that
  // opens or closes another entry.
  #subagents = new Set();
  // Every subagent thread seen this connection, for its token usage (Agents panel).
  #agentThreads = new Set();
  // Context meter: the latest request's input side; a compaction's before/after sizes.
  #context = null;
  #compaction = null;

  #production(event) {
    const params = event.params;
    // Derived events carry no turn: a subagent's usage belongs to its own thread's turns.
    const derived = (method, values) => ({ method, params: { threadId: this.threadId, ...values } });
    if (event.method === "thread/tokenUsage/updated") {
      // `last.inputTokens` already counts the cached part. The update after a compaction has
      // inputTokens 0 and the reduced context as its total.
      const last = params.tokenUsage?.last ?? {}, tokens = last.inputTokens || last.totalTokens || 0;
      if (params.threadId === this.threadId) {
        if (this.#compaction && !last.inputTokens) this.#compaction.after = tokens;
        this.#context = tokens;
        return [derived("context/usage", { tokens, window: params.tokenUsage?.modelContextWindow ?? null })];
      }
      return this.#agentThreads.has(params.threadId) ? [derived("agent/updated", { id: params.threadId, tokens })] : [];
    }
    const item = params?.item;
    if (params?.threadId && this.threadId && params.threadId !== this.threadId) {
      // A subagent's own tool calls: its current activity on the Agents panel, nothing else.
      if (!this.#agentThreads.has(params.threadId) || !["item/started", "item/completed"].includes(event.method)) return [];
      const tool = CODEX_NATIVE_TOOLS[item?.type] ?? (["mcpToolCall", "dynamicToolCall"].includes(item?.type) ? item.tool : null);
      return tool ? [derived("agent/updated", { id: params.threadId, activity: event.method === "item/started" ? tool : "" })] : [];
    }
    if (item?.type === "contextCompaction") {
      if (event.method === "item/started") this.#compaction = { before: this.#context, after: null };
      if (event.method !== "item/completed") return [];
      const { before = null, after = null } = this.#compaction ?? {};
      this.#compaction = null;
      return [derived("context/compacted", { trigger: this.compactRequested ? "manual" : "auto", preTokens: before, postTokens: after })];
    }
    if (item?.type === "collabAgentToolCall" && item.model && item.receiverThreadIds?.length)
      return item.receiverThreadIds.map((id) => derived("agent/updated", { id, model: item.model }));
    const native = CODEX_NATIVE_TOOLS[item?.type];
    if (native && ["item/started", "item/completed"].includes(event.method)) {
      // Codex's own shell, patch and web search items become ordinary tool entries. Only the
      // name and status are kept: no command, diff, query or results (spec #40).
      const status = item.status ?? (event.method === "item/started" ? "inProgress" : "completed");
      return [{ ...event, params: { ...params, item: { type: "dynamicToolCall", tool: native, status } } }];
    }
    if (item?.type !== "subAgentActivity") return [event];
    const { kind, agentThreadId } = item;
    const entry = (status) => ({ ...event, params: { ...params, item: { type: "dynamicToolCall", tool: "subagent", status } } });
    const agent = (state) => derived("agent/updated", { id: agentThreadId, label: String(item.agentPath ?? "").split("/").filter(Boolean).at(-1) || "Subagent", state });
    if (event.method === "item/started" && kind === "started" && !this.#subagents.has(agentThreadId)) {
      this.#subagents.add(agentThreadId); this.#agentThreads.add(agentThreadId);
      return [entry("inProgress"), agent("running")];
    }
    if (event.method === "item/completed" && ["completed", "interrupted"].includes(kind) && this.#subagents.delete(agentThreadId)) return [entry(kind), agent(kind)];
    return [];
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
    this.threadId = id;
    return id;
  }

  // Exact resume with the selected model; a compatible same-harness settings change applies here.
  async resumeExact(threadId) {
    const result = await this.request("thread/resume", { ...this.threadParams(), threadId });
    if (result?.thread?.id !== threadId) throw new CodexError("CODEX_SESSION_LOST", "Codex could not resume the saved conversation thread.");
    if (result.thread.cwd && result.thread.cwd !== this.cwd) throw new CodexError("CODEX_SESSION_MISMATCH", "The saved Codex thread belongs to a different workspace.");
    this.#capture(result);
    this.threadId = threadId;
    return threadId;
  }

  threadParams() {
    return {
      cwd: this.cwd,
      ...(this.model ? { model: this.model } : {}),
      // Unrestricted inside the verified worker container boundary (spec #11).
      approvalPolicy: "never", sandbox: "danger-full-access", dynamicTools: this.dynamicTools,
      ...(this.autocompact ? { config: { model_auto_compact_token_limit: this.autocompact } } : {}),
    };
  }

  // Ask Codex to compact the loaded thread now. It runs as a turn of its own: turn/started,
  // a contextCompaction item, turn/completed.
  async compact(threadId) {
    this.compactRequested = true;
    await this.request("thread/compact/start", { threadId });
  }

  async startTurn(threadId, text, images = [], { onDelivered } = {}) {
    this.startingEvents = [];
    try {
      const result = await this.request("turn/start", {
        threadId, input: [{ type: "text", text }, ...images.map((image) => ({ type: "image", url: `data:${image.mimeType};base64,${image.data}` }))], cwd: this.cwd,
        approvalPolicy: "never", sandboxPolicy: { type: "dangerFullAccess" },
        ...(this.effort ? { effort: this.effort } : {}),
      }, { uncertain: true, onDelivered });
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
  send(text, images = [], onDelivered) {
    if (this.closed) return Promise.reject(new Error("Claude session is closed"));
    const done = new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
    this.child.stdin.write(JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text }, ...images.map((image) => ({ type: "image", source: { type: "base64", media_type: image.mimeType, data: image.data } }))] } }) + "\n", (error) => { if (!error) onDelivered?.(); });
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
  constructor({ spawnSession, model = null, effort = null, autocompact = null, onEvent = () => {}, onError = () => {} }) {
    Object.assign(this, { spawnSession, model, effort, autocompact, onEvent, onError });
    this.resolved = { model: null, effort: effort ?? null };
    this.launch = null;
    this.session = null;
    this.turnId = null;
    this.toolNames = new Map();
    // Delegations (Agent/Task tool calls) by tool-use id, for the Agents panel.
    this.agents = new Set();
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
    if (event.type === "system" && event.subtype === "compact_boundary") {
      const meta = event.compact_metadata ?? {};
      this.#emit("context/compacted", { trigger: meta.trigger ?? null, preTokens: meta.pre_tokens ?? null, postTokens: meta.post_tokens ?? null });
      return;
    }
    // A subagent's messages carry the delegating tool call's id. Its prose and inner tool
    // calls stay out of the transcript; the delegation itself is the parent's tool entry.
    // Its model and context size feed the Agents panel only.
    if (event.parent_tool_use_id && ["assistant", "user"].includes(event.type)) {
      if (!this.agents.has(event.parent_tool_use_id)) return;
      // Its current activity: the tool it called last, cleared ("") when the result returns.
      const content = Array.isArray(event.message?.content) ? event.message.content : [];
      const call = content.findLast((block) => block.type === "tool_use");
      const activity = call ? String(call.name || "").replace(MCP_PREFIX, "") : content.some((block) => block.type === "tool_result") ? "" : undefined;
      this.#emit("agent/updated", { id: event.parent_tool_use_id, ...(event.type === "assistant" ? { model: event.message?.model ?? null, tokens: anthropicContext(event.message?.usage) } : {}), ...(activity !== undefined ? { activity } : {}) });
      return;
    }
    if (event.type === "assistant") {
      if (typeof event.message?.model === "string") this.resolved.model = event.message.model;
      if (event.message?.usage) {
        this.usage = event.message.usage;
        const tokens = anthropicContext(event.message.usage);
        if (tokens > 0) this.#emit("context/usage", { tokens });
      }
      for (const block of event.message?.content ?? []) {
        if (block.type === "text" && block.text) this.#emit("item/agentMessage/delta", { delta: block.text });
        else if (block.type === "tool_use") {
          const name = String(block.name || "").startsWith(MCP_PREFIX) ? block.name.slice(MCP_PREFIX.length) : block.name;
          this.toolNames.set(block.id, name);
          this.#emit("item/started", { item: { type: "dynamicToolCall", tool: name, status: "inProgress", native: !String(block.name).startsWith(MCP_PREFIX) } });
          if (["Agent", "Task"].includes(block.name)) {
            this.agents.add(block.id);
            this.#emit("agent/updated", { id: block.id, label: block.input?.description || block.input?.subagent_type || "Subagent", model: block.input?.model ?? null, state: "running" });
          }
        }
      }
      return;
    }
    if (event.type === "user") {
      for (const block of Array.isArray(event.message?.content) ? event.message.content : []) {
        if (block.type !== "tool_result") continue;
        this.#emit("item/completed", { item: { type: "dynamicToolCall", tool: this.toolNames.get(block.tool_use_id) ?? "tool", status: block.is_error ? "failed" : "completed" } });
        if (!this.agents.delete(block.tool_use_id)) continue;
        const result = event.tool_use_result && typeof event.tool_use_result === "object" ? event.tool_use_result : {};
        this.#emit("agent/updated", { id: block.tool_use_id, state: block.is_error ? "failed" : "completed",
          ...(typeof result.resolvedModel === "string" ? { model: result.resolvedModel } : {}), ...(Number.isFinite(result.totalTokens) ? { tokens: result.totalTokens } : {}) });
      }
      return;
    }
    if (event.type === "result") {
      const failed = event.is_error || event.subtype !== "success";
      const status = this.interrupted ? "interrupted" : failed ? "failed" : "completed";
      this.completed = true;
      if (event.usage) this.usage = event.usage;
      if (event.modelUsage && !this.resolved.model) this.resolved.model = Object.keys(event.modelUsage)[0] ?? null;
      const window = event.modelUsage?.[this.resolved.model]?.contextWindow;
      if (Number.isFinite(window)) this.#emit("context/usage", { window });
      this.#emit("turn/completed", { turn: { id: this.turnId, status, ...(status === "failed" ? { error: String(event.result || event.subtype || "Claude turn failed").slice(0, 500) } : {}) },
        usage: this.usage, model: this.resolved.model, costUsd: event.total_cost_usd ?? null });
    }
  }

  async startTurn(threadId, text, images = [], { onDelivered } = {}) {
    if (!this.launch || threadId !== this.threadId) throw new Error("Start or resume the Claude session before starting a turn");
    const launch = { ...this.launch }, resuming = Boolean(launch.resume);
    const child = await this.spawnSession({ harness: "claude", model: this.model, ...(this.effort ? { effort: this.effort } : {}), ...(this.autocompact ? { autocompact: this.autocompact } : {}), ...launch });
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
    this.session.send(text, images, onDelivered).then(() => { this.completed = true; }, (error) => {
      if (resuming && !this.session?.init) settleReady(readyReject, this.#resumeUnavailable(raw.trim() || error.message));
      else if (!this.completed) this.onError(error);
    });
    // A resumed CLI may reject a missing session only after its first input. Do not tell chat
    // that dispatch succeeded until init proves the recorded session exists.
    if (resuming) await ready;
    return this.turnId;
  }

  // Compact the resumed session now: a turn whose whole prompt is `/compact` (checked live on
  // 2.1.327 over stream-json input: compact_boundary, then a result naming local_command).
  compact(threadId) { return this.startTurn(threadId, "/compact"); }

  // Ask Claude to interrupt the running turn (stream-json control request). The chat's Stop
  // fallback removes the worker if the turn does not end promptly.
  async interrupt() {
    this.interrupted = true;
    if (this.child?.stdin?.writable) this.child.stdin.write(JSON.stringify({ type: "control_request", request_id: randomUUID(), request: { subtype: "interrupt" } }) + "\n");
    return {};
  }

  close() { this.session?.close(); }
}

// Worker-backed harness adapters (minimal slice; adapter lane #26 extends these).
//  - WorkerCodexConnection: the existing CodexConnection over the worker's harness socket,
//    with command execution enabled inside the worker boundary and Storybench tools as
//    app-server dynamic tools (image results as inputImage content items).
//  - ClaudeStreamSession: Claude Code headless stream-json over the harness socket, with
//    Storybench tools served by the in-worker MCP bridge.
import { createInterface } from "node:readline";
import { CodexConnection, CodexError, TOOL_CONTENT } from "../codex.js";
import { toCodexContentItems } from "./tools.js";

export class WorkerCodexConnection extends CodexConnection {
  constructor({ child, tools, ...options }) {
    const handlers = Object.fromEntries(tools.definitions.map((definition) => [
      definition.name,
      async (args) => ({ [TOOL_CONTENT]: toCodexContentItems(await tools.call(definition.name, args)) }),
    ]));
    super({ ...options, tools: handlers, spawn: () => child });
    this.dynamicTools = tools.definitions.map((definition) => ({ type: "function", ...definition }));
  }

  threadParams() {
    return {
      cwd: this.cwd,
      ...(this.model ? { model: this.model } : {}),
      // Unrestricted inside the verified worker container boundary (spec #11).
      approvalPolicy: "never", sandbox: "danger-full-access", dynamicTools: this.dynamicTools,
    };
  }

  async startTurn(threadId, text) {
    this.startingEvents = [];
    try {
      const result = await this.request("turn/start", {
        threadId, input: [{ type: "text", text }], cwd: this.cwd,
        approvalPolicy: "never", sandboxPolicy: { type: "dangerFullAccess" },
      }, { uncertain: true });
      const id = result?.turn?.id;
      if (!id) throw new CodexError("CODEX_PROTOCOL_ERROR", "turn/start returned no turn id.", { uncertain: true });
      const buffered = this.startingEvents;
      this.startingEvents = null;
      for (const event of buffered) this.onEvent(event);
      return id;
    } catch (error) { this.startingEvents = null; throw error; }
  }

  listSkills() { return this.request("skills/list", { cwds: [this.cwd], forceReload: true }); }
}

export class ClaudeStreamSession {
  constructor(child, { onEvent = () => {} } = {}) {
    this.child = child;
    this.onEvent = onEvent;
    this.sessionId = null;
    this.init = null;
    this.waiters = [];
    this.closed = false;
    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    lines.on("line", (line) => {
      let event;
      try { event = JSON.parse(line); } catch { return; }
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
  send(text) {
    if (this.closed) return Promise.reject(new Error("Claude session is closed"));
    const done = new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
    this.child.stdin.write(JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text }] } }) + "\n");
    return done;
  }

  close() { this.child.stdin.end(); this.child.kill(); }
}

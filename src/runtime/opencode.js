// OpenCode uses its own agent loop. Storybench only adapts its JSON event stream.
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
export const TOOL_DISCIPLINE = 'Use the actual tool interface. Never emit tool calls as text. Never call invalid tools. Read the available schemas and use the storybench MCP tools for scoped app operations.';
export function openCodeConfig(route, { model, mcp, boot = 'AGENTS.md', transportKey = null }) {
  const native = `${route.id || route.source}/${model}`;
  return { model: native, enabled_providers: [route.id || route.source], provider: { [route.id || route.source]: {
    npm: route.protocol === 'anthropic' ? '@ai-sdk/anthropic' : '@ai-sdk/openai-compatible', name: route.name,
    options: { baseURL: route.baseUrl, ...(transportKey ? { apiKey: transportKey } : route.keyEnv ? { apiKey: `{env:${route.keyEnv}}` } : {}) },
    models: { [model]: { ...(route.modelVariants?.[model] ? { variants: route.modelVariants[model] } : {}), name: model, attachment: true, tool_call: true, modalities: { input: ['text', 'image'], output: ['text'] } } },
  } }, mcp: { storybench: { type: 'local', command: [mcp.command, ...mcp.args], environment: mcp.env, enabled: true } }, instructions: [boot], permission: 'allow' };
}
export class OpenCodeConnection {
  constructor({ spawnSession, model, effort, onEvent = () => {}, onError = () => {} }) { Object.assign(this, { spawnSession, model, effort, onEvent, onError }); this.resolved = { model, effort }; }
  async open() { return this; }
  async startThread() { this.threadId = randomUUID(); return this.threadId; }
  async resumeThread(id) { this.threadId = id; this.resume = true; return id; }
  emit(method, params) { this.onEvent({ method, params: { threadId: this.threadId, turnId: this.turnId, ...params } }); }
  async startTurn(threadId, text, images = [], { onDelivered } = {}) {
    this.turnId = randomUUID(); this.completed = false;
    const child = await this.spawnSession({ harness: 'opencode', model: this.model, sessionId: threadId, ...(this.resume ? { resume: threadId } : {}), ...(this.effort ? { effort: this.effort } : {}) }); this.child = child;
    const lines = createInterface({ input: child.stdout });
    lines.on('line', (line) => {
      let event; try { event = JSON.parse(line); } catch { return; }
      if (event.type === 'text' && event.part?.text) this.emit('item/agentMessage/delta', { delta: event.part.text });
      if (event.type === 'tool_use') this.emit(event.part?.state?.status === 'running' ? 'item/started' : 'item/completed', { item: { type: 'mcpToolCall', tool: event.part?.tool, status: event.part?.state?.status } });
      if (event.type === 'error') this.failed = true;
      if (event.type === 'storybench.complete') {
        this.completed = true;
        this.emit('turn/completed', { turn: { id: this.turnId, status: this.interrupted ? 'interrupted' : event.ok && !this.failed ? 'completed' : 'failed', ...(!event.ok || this.failed ? { error: 'OpenCode request failed; check provider settings and model' } : {}) } });
      }
    });
    child.once('error', () => this.onError(new Error('OpenCode worker connection failed')));
    child.once('exit', () => { if (!this.completed) this.emit('turn/completed', { turn: { id: this.turnId, status: this.interrupted ? 'interrupted' : 'failed', error: 'OpenCode exited before completion' } }); });
    this.emit('turn/started', { turn: { id: this.turnId } });
    child.stdin.write(JSON.stringify({ text, images }) + '\n', (error) => { if (!error) onDelivered?.(); });
    return this.turnId;
  }
  async interrupt() { this.interrupted = true; this.child?.kill(); return {}; }
  close() { this.child?.kill(); }
}

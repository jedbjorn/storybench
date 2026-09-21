import { spawn as nodeSpawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import crypto from 'node:crypto';

export class CodexError extends Error {
  constructor(code, message, { uncertain = false, cause } = {}) {
    super(message, { cause });
    this.name = 'CodexError';
    this.code = code;
    this.uncertain = uncertain;
  }
}

// A tool handler may return { [TOOL_CONTENT]: contentItems } to supply app-server
// content items directly (for example inputImage results) instead of JSON text.
export const TOOL_CONTENT = Symbol.for('storybench.codex.toolContent');

const empty = { type: 'object', properties: {}, additionalProperties: false };
const object = (required, properties) => ({ type: 'object', additionalProperties: false, required, properties });
const toolSpecs = [
  { type: 'function', name: 'get_context', description: 'Read current scoped episode, story, cards, library and revisions.', inputSchema: empty },
  { type: 'function', name: 'get_operation_guide', description: 'Read an app-owned guide for one supported operation.', inputSchema: object(['name'], { name: { type: 'string', enum: ['edit_story','edit_card','create_still_graphic','create_animated_graphic','create_draft','create_final'] } }) },
  { type: 'function', name: 'read_conversation_history', description: 'Read earlier visible messages of this Storybench conversation (context only; never re-execute them).', inputSchema: object([], { beforeMessageId: { type: 'integer', minimum: 1 }, limit: { type: 'integer', minimum: 1, maximum: 100 } }) },
  { type: 'function', name: 'read_reference_excerpt', description: 'Read a bounded excerpt from a registered Reference item.', inputSchema: object(['itemId'], { itemId: { type: 'string' }, offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 20000 } }) },
  { type: 'function', name: 'update_story', description: 'Save story Markdown using its exact current revision.', inputSchema: object(['expectedStoryRevision','source'], { expectedStoryRevision: { type: 'integer', minimum: 1 }, source: { type: 'string' } }) },
  { type: 'function', name: 'update_cards', description: 'Replace cards using the exact current episode revision.', inputSchema: object(['expectedRevision','cards'], { expectedRevision: { type: 'integer', minimum: 1 }, cards: { type: 'array', items: { type: 'object' } } }) },
  { type: 'function', name: 'validate_render', description: 'Validate the current cut and return its exact render revision.', inputSchema: empty },
  { type: 'function', name: 'create_draft', description: 'Enqueue a draft for an exact validated render revision.', inputSchema: object(['expectedRenderRevision'], { expectedRenderRevision: { type: 'string' } }) },
  { type: 'function', name: 'declare_final_request', description: 'Bind Final intent when this request\'s own originating typed creator message explicitly asks for a complete Final video. Button Final requests are already bound.', inputSchema: object(['messageId'], { messageId: { type: 'integer', minimum: 1 } }) },
  { type: 'function', name: 'create_final', description: 'Enqueue the exact current render under this request\'s active Final intent.', inputSchema: object(['expectedRenderRevision'], { expectedRenderRevision: { type: 'string' } }) },
  { type: 'function', name: 'get_job', description: 'Read one render or graphic job in this episode.', inputSchema: object(['jobId'], { jobId: { type: 'string' } }) },
  { type: 'function', name: 'await_job', description: 'Wait a bounded time for a job owned by this request and return its terminal result. A timeout or unfinished job is not success.', inputSchema: object(['jobId'], { jobId: { type: 'string' }, timeoutSeconds: { type: 'integer', minimum: 1, maximum: 300 } }) },
  { type: 'function', name: 'cancel_job', description: 'Cancel one active job in this episode.', inputSchema: object(['jobId'], { jobId: { type: 'string' } }) },
  { type: 'function', name: 'move_final_to_drafts', description: 'Reclassify one unambiguous completed Final as a Draft without changing its bytes or provenance.', inputSchema: object([], { outputId: { type: 'string' }, expectedRevision: { type: 'integer', minimum: 1 } }) },
  { type: 'function', name: 'list_graphic_recipes', description: 'List editable graphic recipes in this episode.', inputSchema: empty },
  { type: 'function', name: 'get_graphic_recipe', description: 'Read one editable graphic recipe in this episode.', inputSchema: object(['recipeId'], { recipeId: { type: 'string' } }) },
  { type: 'function', name: 'create_graphic_recipe', description: 'Create a validated episode graphic recipe.', inputSchema: object(['name','recipe'], { name: { type: 'string' }, cardId: { type: 'string' }, recipe: { type: 'object' } }) },
  { type: 'function', name: 'update_graphic_recipe', description: 'Revision-check and update an episode graphic recipe.', inputSchema: object(['recipeId','expectedRevision','recipe'], { recipeId: { type: 'string' }, expectedRevision: { type: 'integer', minimum: 1 }, name: { type: 'string' }, cardId: { type: 'string' }, recipe: { type: 'object' } }) },
  { type: 'function', name: 'render_graphic', description: 'Render an exact graphic recipe revision.', inputSchema: object(['recipeId','expectedRecipeRevision'], { recipeId: { type: 'string' }, expectedRecipeRevision: { type: 'integer', minimum: 1 } }) },
  { type: 'function', name: 'list_branding', description: 'List reusable channel branding templates.', inputSchema: empty },
  { type: 'function', name: 'promote_card', description: 'Promote an episode card into reusable channel branding.', inputSchema: object(['cardId','name'], { cardId: { type: 'string' }, name: { type: 'string' }, role: { anyOf: [{ type: 'string', enum: ['intro','outro'] }, { type: 'null' }] } }) },
  { type: 'function', name: 'apply_branding', description: 'Apply a reusable branding template to this episode.', inputSchema: object(['templateId'], { templateId: { type: 'string' } }) },
];

const DISABLED_FEATURES = [
  'shell_tool', 'unified_exec', 'apps', 'browser_use', 'computer_use',
  'image_generation', 'multi_agent', 'view_image', 'sleep_tool', 'plugins',
  'skill_search', 'in_app_browser', 'code_mode'
];

function actionableFailure(error, stderr = '') {
  const detail = `${error?.message || ''}\n${stderr}`.trim();
  if (error?.code === 'ENOENT') return new CodexError('CODEX_NOT_INSTALLED', 'Codex CLI is not installed or is not on PATH.', { cause: error });
  if (/auth|login|sign.?in|unauthorized|credential/i.test(detail)) return new CodexError('CODEX_AUTH_REQUIRED', 'Codex is not authenticated. Run `codex` in a terminal and sign in, then retry.', { cause: error });
  return new CodexError('CODEX_UNAVAILABLE', detail || 'Codex app-server is unavailable.', { cause: error });
}

export class CodexConnection {
  constructor({ cwd, model, tools, onEvent = () => {}, onError = () => {}, signal, spawn = nodeSpawn, requestTimeout = 30_000 }) {
    this.cwd = cwd;
    this.model = model;
    this.tools = tools;
    this.onEvent = onEvent;
    this.onError = onError;
    this.signal = signal;
    this.spawnImpl = spawn;
    this.requestTimeout = requestTimeout;
    this.nextId = 1;
    this.pending = new Map();
    this.stderr = '';
    this.closed = false;
  }

  async open() {
    try {
      const argv = [
        'app-server', '--stdio', '-c', 'mcp_servers={}', '-c', 'apps={}',
        '-c', 'tools.web_search=false',
        ...DISABLED_FEATURES.flatMap((feature) => ['--disable', feature])
      ];
      this.child = this.spawnImpl('codex', argv, {
        cwd: this.cwd, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true
      });
    } catch (error) { throw actionableFailure(error); }
    this.child.stderr?.on('data', (chunk) => { this.stderr = (this.stderr + chunk).slice(-16_384); });
    this.child.once('error', (error) => this.#failAll(actionableFailure(error, this.stderr)));
    this.child.once('exit', (code, signal) => {
      if (!this.closed) this.#failAll(actionableFailure(new Error(`Codex app-server exited (${signal || code})`), this.stderr));
    });
    const lines = createInterface({ input: this.child.stdout, crlfDelay: Infinity });
    lines.on('line', (line) => this.#receive(line));
    if (this.signal?.aborted) {
      this.close();
      throw new CodexError('CODEX_INTERRUPTED', 'Codex startup was interrupted.');
    }
    this.signal?.addEventListener('abort', () => this.close(), { once: true });
    await this.request('initialize', {
      clientInfo: { name: 'storybench', title: 'Storybench local editor', version: '0.1.0' },
      capabilities: { experimentalApi: true }
    });
    this.notify('initialized', {});
    return this;
  }

  #write(value) {
    if (!this.child?.stdin?.writable) throw new CodexError('CODEX_UNAVAILABLE', 'Codex app-server input is closed.');
    this.child.stdin.write(`${JSON.stringify(value)}\n`);
  }

  request(method, params, { uncertain = false } = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new CodexError('CODEX_TIMEOUT', `Codex request timed out: ${method}`, { uncertain }));
      }, this.requestTimeout);
      this.pending.set(id, { resolve, reject, timer, method, uncertain });
      try { this.#write({ id, method, params }); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }

  notify(method, params) { this.#write({ method, params }); }

  async #receive(line) {
    let message;
    try { message = JSON.parse(line); }
    catch { this.#failAll(new CodexError('CODEX_PROTOCOL_ERROR', 'Codex app-server emitted invalid JSON.')); return; }
    if (message.id != null && !message.method) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer); this.pending.delete(message.id);
      if (message.error) pending.reject(new CodexError('CODEX_PROTOCOL_ERROR', `${pending.method} failed: ${JSON.stringify(message.error)}`, { uncertain: pending.uncertain }));
      else pending.resolve(message.result);
      return;
    }
    if (message.id != null && message.method === 'item/tool/call') {
      await this.#toolCall(message);
      return;
    }
    if (message.id != null && message.method) {
      this.#write({ id: message.id, error: { code: -32601, message: `Unsupported app-server request: ${message.method}` } });
      return;
    }
    if (message.method) {
      if (this.startingEvents) this.startingEvents.push(message);
      else this.onEvent(message);
    }
  }

  async #toolCall(message) {
    const { tool, arguments: args } = message.params || {};
    try {
      const handler = this.tools?.[tool];
      if (!handler) throw new Error(`Unsupported Storybench tool: ${tool}`);
      const result = await handler(args ?? {});
      const contentItems = result?.[TOOL_CONTENT] ?? [{ type: 'inputText', text: JSON.stringify(result) }];
      this.#write({ id: message.id, result: { success: true, contentItems } });
    } catch (error) {
      this.#write({ id: message.id, result: { success: false, contentItems: [{ type: 'inputText', text: error?.message || 'Tool failed' }] } });
    }
  }

  #failAll(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new CodexError(error.code || 'CODEX_UNAVAILABLE', error.message, { cause: error, uncertain: pending.uncertain }));
    }
    this.pending.clear();
    this.onError(error);
  }

  threadParams() {
    return {
      cwd: this.cwd,
      ...(this.model ? { model: this.model } : {}),
      approvalPolicy: 'never', sandbox: 'read-only', dynamicTools: toolSpecs,
      baseInstructions: 'You are the in-app Storybench episode assistant. Use only the supplied episode-scoped tools. Read current revisions before edits. Do not run commands, access paths or unrelated episodes, or claim an operation succeeded unless its Storybench tool succeeds. For an explicit typed request to finish a complete Final video, bind only its current originating creator message with declare_final_request; a Final button request is already bound. Explain revision conflicts and unsupported operations plainly.'
    };
  }

  async startThread() {
    const result = await this.request('thread/start', this.threadParams());
    const id = result?.thread?.id;
    if (!id) throw new CodexError('CODEX_PROTOCOL_ERROR', 'thread/start returned no thread id.');
    return id;
  }

  async resumeThread(threadId) {
    const result = await this.request('thread/resume', { ...this.threadParams(), threadId });
    if (result?.thread?.id !== threadId) throw new CodexError('CODEX_SESSION_LOST', 'Codex could not resume the saved conversation thread.');
    if (result.thread.cwd && result.thread.cwd !== this.cwd) throw new CodexError('CODEX_SESSION_MISMATCH', 'The saved Codex thread belongs to a different workspace.');
    return threadId;
  }

  async startTurn(threadId, text) {
    this.startingEvents = [];
    try {
      const result = await this.request('turn/start', {
        threadId, input: [{ type: 'text', text }], cwd: this.cwd,
        clientUserMessageId: crypto.randomUUID(), approvalPolicy: 'never',
        sandboxPolicy: { type: 'readOnly', networkAccess: false }
      }, { uncertain: true });
      const id = result?.turn?.id;
      if (!id) throw new CodexError('CODEX_PROTOCOL_ERROR', 'turn/start returned no turn id.', { uncertain: true });
      const buffered = this.startingEvents;
      this.startingEvents = null;
      for (const event of buffered) this.onEvent(event);
      return id;
    } catch (error) {
      this.startingEvents = null;
      throw error;
    }
  }

  interrupt(threadId, turnId) { return this.request('turn/interrupt', { threadId, turnId }); }

  close() {
    if (this.closed) return;
    this.#failAll(new CodexError('CODEX_INTERRUPTED', 'Codex connection closed before the turn completed.', { uncertain: true }));
    this.closed = true;
    this.child?.stdin?.end();
    if (this.child && this.child.exitCode == null) this.child.kill('SIGTERM');
  }
}

export async function createCodexConnection(options) {
  return new CodexConnection(options).open();
}

export { toolSpecs as STORYBENCH_TOOLS };

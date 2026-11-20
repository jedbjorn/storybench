import { spawn as nodeSpawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import crypto from 'node:crypto';
import { TOOL_DELIVERED } from './tool-delivery.js';
import { SLIDE_TYPES } from './deck-data.js';

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
// Keep revision conflicts actionable through both native dynamic tools and MCP.
export const toolErrorText = (error) => error?.current?.researchRevision !== undefined
  ? JSON.stringify({ error: error.message, statusCode: error.statusCode, current: error.current })
  : error?.message || 'Tool failed';

const empty = { type: 'object', properties: {}, additionalProperties: false };
const object = (required, properties) => ({ type: 'object', additionalProperties: false, required, properties });
const deckText = { type: 'string' };
const deckMedia = object(['itemId'], { itemId: deckText, alt: deckText });
// Relative to the authored geometry: x/y in SVG user units, rotate in degrees about the group's centre.
const deckGroupState = object([], { x: { type: 'number', minimum: -8192, maximum: 8192 }, y: { type: 'number', minimum: -8192, maximum: 8192 },
  scale: { type: 'number', minimum: 0, maximum: 16 }, rotate: { type: 'number', minimum: -3600, maximum: 3600 }, opacity: { type: 'number', minimum: 0, maximum: 1 } });
// Layout primitives (spec #44): bounded arguments shared by the deck defaults and each slide's overrides.
const deckSide = { type: ['string', 'null'], enum: ['top', 'bottom', 'left', 'right', null], description: 'Side of the slide\'s visual (media, vector or gallery); needs a visual' };
const deckAlign = { type: ['string', 'null'], enum: ['start', 'center', 'end', null], description: 'align: start (left), center or end (right); valign: start (top), center or end (bottom)' };
const copyWidth = { type: ['number', 'null'], minimum: 20, maximum: 100, description: 'Width as a percentage of the available layout region' };
const deckPrimitives = {
  copy: { ...object([], { position: deckSide, align: deckAlign, valign: deckAlign, titleWidth: copyWidth, bodyWidth: copyWidth }), description: 'The title and body block: side of the visual, horizontal align, vertical valign (start = top).' },
  stageText: { ...object([], { width: copyWidth, style: { type: ['string', 'null'], enum: ['chips', 'steps', 'list', 'card', null], description: 'chips: stage titles as buttons (vector default); steps: numbered sections revealed cumulatively (text default); list: bulleted or numbered items, current marked; card: one card that flips to each stage as it starts' },
    position: deckSide, align: { ...deckAlign, description: 'Also aligns the stage and gallery buttons; center centres every wrapped row' }, valign: deckAlign,
    numbered: { type: ['boolean', 'null'], description: 'list and card' }, flipMs: { type: ['number', 'null'], minimum: 0, maximum: 2000, description: 'card: how long each flip takes' } }),
    description: 'How stage titles and bodies are shown.' },
  type: { ...object([], { scale: { type: ['string', 'null'], enum: ['compact', 'standard', 'large', null], description: 'compact is smaller, large is bigger than the template sizes (standard)' } }), description: 'Heading and body type, scaled together.' },
  spacing: { ...object([], { density: { type: ['string', 'null'], enum: ['compact', 'standard', 'spacious', null], description: 'compact is tighter, spacious is looser than the template gaps (standard)' } }), description: 'Internal slide spacing.' },
  columns: { ...object([], { width: copyWidth }), description: 'Width of the columns group.' },
  caption: { ...object([], { width: copyWidth }), description: 'Width of the slide caption.' },
  eyebrow: { ...object([], { width: copyWidth }), description: 'Width of the authored slide header label.' },
  visual: { ...object([], Object.fromEntries(['top', 'bottom', 'left', 'right'].map(side => [side,
    { type: ['number', 'null'], minimum: -240, maximum: 240, description: 'Slide units. Positive extends the edge behind content, negative adds padding, zero keeps the template gap.' }]))),
    description: 'Independent edge spacing for an image, video, drawing or gallery.' },
  timing: { ...object([], { betweenMs: { type: ['number', 'null'], minimum: 0, maximum: 60000 } }), description: 'One gap for the slide: every stage after the first starts betweenMs after the previous stage\'s motion ends; stages after the first then take no afterMs, holdMs or manual trigger.' },
};
const deckSlide = object(['id', 'title', 'layout'], {
  id: deckText, title: deckText, layout: { type: 'string', enum: Object.keys(SLIDE_TYPES) },
  body: deckText, notes: deckText, eyebrow: deckText, caption: deckText,
  targetMinutes: { type: 'number', minimum: 0 }, sectionId: { type: ['string', 'null'] },
  media: { anyOf: [deckMedia, { type: 'null' }] }, vector: { anyOf: [deckMedia, { type: 'null' }] },
  referenceItemIds: { type: 'array', items: deckText },
  columns: { type: 'array', items: object(['title'], { title: deckText, body: deckText }) },
  stages: { type: 'array', items: object(['id', 'title'], { id: deckText, title: deckText, body: deckText,
    hideFromList: { type: 'boolean', description: 'Hide this stage’s audience text in every stage style. Its timing, drawing and Presenter navigation are preserved.' },
    afterMs: { type: 'number', minimum: 0, maximum: 3600000 },
    trigger: { type: 'string', enum: ['auto', 'manual'], description: 'auto starts this stage afterMs after the previous one ends (afterMs may be 0 to flow straight on); manual waits for selection. Unset: a positive afterMs is automatic.' },
    durationMs: { type: 'number', minimum: 0, maximum: 60000, description: 'How long this stage\'s motion takes. Unset keeps the standard short fade and does not delay the next stage.' },
    holdMs: { type: 'number', minimum: 0, maximum: 3600000, description: 'Rest after the motion before the next stage\'s afterMs starts.' },
    easing: { type: 'string', enum: ['linear', 'ease-in', 'ease-out', 'ease-in-out'] },
    motion: { type: 'string', enum: ['fade', 'draw', 'enter'], description: 'How svgGroupIds arrive: fade (default, also text), draw (strokes draw along their length; groups need stroked geometry), enter (from the state in from).' },
    from: deckGroupState,
    changes: { type: 'array', maxItems: 64, description: 'Move groups an earlier stage revealed: each is interpolated from its current state to `to` over durationMs. State accumulates across stages.', items: object(['groupId', 'to'], { groupId: deckText, to: deckGroupState }) },
    svgGroupIds: { type: 'array', minItems: 1, uniqueItems: true, items: deckText, description: 'Registered SVG group IDs revealed by this stable stage. Each vector stage needs svgGroupIds, changes or both; groups cannot be mapped twice.' } }) },
  subnav: { type: 'array', items: object(['id', 'label'], { id: deckText, label: deckText, itemId: { type: ['string', 'null'] } }) },
  design: { ...object([], deckPrimitives), description: 'This slide\'s overrides of the deck design defaults, per argument; null or unset follows the deck.' },
  candidates: { type: 'array', description: 'Unpicked candidates for this slide\'s visual: library images, video or SVG drawings of this production, never references or audio. The pick (the star) is what media, vector or subnav holds; starring moves an asset from here into those fields, unstarring moves it back. Omit to keep the saved list; a supplied list replaces it and must keep every saved pick (picked, or listed here).',
    items: object(['itemId'], { itemId: deckText, alt: { type: 'string', description: 'Screen-reader description on this slide' }, label: { type: 'string', description: 'Gallery label; unset uses the asset\'s label' } }) },
  pickSetBy: { type: ['string', 'null'], enum: ['creator', 'agent', null], description: 'Who last changed this slide\'s picks, as read_deck returns it. Accepted so a read slide can be saved back; ignored on save, which records it.' },
});
// The slide-type declaration (public/slide-types.js), as save_deck states it.
const deckTypes = Object.entries(SLIDE_TYPES).map(([name, type]) => `${name} (${type.label}): ${[
  type.visual.length ? `visual ${type.visual.join('/')}` : 'no visual', type.columns ? `${type.columns.join('-')} columns` : null, type.steps === 'required' ? 'steps required' : null].filter(Boolean).join(', ')}`).join('; ');
// Deck-level design (spec #44). Omitted keeps the saved design; a supplied design replaces it.
const deckHex = { type: ['string', 'null'], description: 'Six-digit hex, for example #1255FF' }, deckFont = { type: ['string', 'null'] }, deckSetBy = { type: ['string', 'null'], enum: ['creator', 'agent', null] };
const deckDesign = object([], {
  aspectRatio: { type: 'string', enum: ['16:9', '16:10'], description: 'Delivery frame for every slide. Defaults to 16:9.' },
  theme: { ...object([], {
    colors: object([], { base: deckHex, accent: deckHex, background: deckHex }),
    fonts: object([], { base: deckFont, accent: deckFont, alternate: deckFont }),
    setBy: { ...object([], { colors: object([], { base: deckSetBy, accent: deckSetBy, background: deckSetBy }), fonts: object([], { base: deckSetBy, accent: deckSetBy, alternate: deckSetBy }) }),
      description: 'Who set each value, as read_deck returns it. Accepted so a read design can be saved back; ignored on save, which records it.' } }),
    description: 'This deck\'s colour and font roles. Colours: base = text, accent = rules, eyebrows, step numbers, current marker, active button and focus; background = page; every other template hue derives from these. Fonts: base = body and notes, accent = headings, alternate = eyebrows and captions. A role left unset or null follows the channel Brand Standards at build time, else the template default. Fonts come from the get_context catalogue.' },
  ...deckPrimitives,
});
export const AUTHORING_TOOLS = Object.freeze(['save_deck', 'build_deck', 'update_story', 'update_cards', 'update_storyboard', 'create_draft', 'create_final', 'create_graphic_recipe', 'update_graphic_recipe', 'render_graphic', 'apply_branding']);
const toolSpecs = [
  { type: 'function', name: 'read_research', description: 'Read the complete saved research summary and ordered links for this production, including production identity and independent researchRevision. Saved URLs are not fetched or verified.', inputSchema: empty },
  { type: 'function', name: 'save_research', description: 'Directly replace this production’s complete research using expectedResearchRevision. Retain link IDs when editing/reordering; omitted IDs are generated. Limits in UTF-8 bytes: summary 1 MiB; 100 links; ID 200; HTTP(S) URL 8192; title 512; note 2048; normalized JSON 2 MiB. Oversize is rejected without truncation. On conflict read current research and reconcile.', inputSchema: object(['expectedResearchRevision','summary','links'], {
    expectedResearchRevision: { type: 'integer', minimum: 1 }, summary: { type: 'string' },
    links: { type: 'array', maxItems: 100, items: object(['url'], { id: { type: 'string' }, url: { type: 'string' }, title: { type: 'string' }, note: { type: 'string' } }) },
  }) },
  { type: 'function', name: 'read_deck', description: 'Read saved ordered slides (picks in media, vector and subnav; unpicked candidates; pickSetBy, who last changed the picks), the deck design (theme with setBy per value, layout primitive defaults), story and current revision.', inputSchema: empty },
  { type: 'function', name: 'save_deck', description: `Replace ordered slides using the current revision. Preserve slide/stage IDs when reordering. Slide types (layout) and their slots: ${deckTypes}. A value a type has no slot for is kept, hidden, so changing type loses nothing. A vector {itemId,alt} selects a registered SVG (drawing); each stage maps svgGroupIds from asset metadata, cumulatively revealed in stage order. Do not combine vector with media/gallery. Each slide's candidates list its unpicked assets; media, vector and subnav hold the picks, and a save that changes a slide's picks is recorded with who changed it. Unmapped geometry stays visible. afterMs delays each reveal, including the first; zero waits for manual selection unless trigger is auto. Optional per stage: trigger, durationMs, holdMs, easing, motion (fade, draw, enter with from) and changes, which move groups an earlier stage revealed; a stage starts at the start of the previous stage plus its durationMs (when set) plus its holdMs plus its own afterMs. Invalid values are refused naming the slide and stage. design sets the deck theme and layout primitive defaults (copy, stageText, type, spacing, timing); a slide design overrides them per argument; effective value = slide, else deck, else template. Enum and number arguments only; no CSS, colours or fonts outside theme. Plain text only; never executable markup.`, inputSchema: object(['expectedRevision','slides'], {expectedRevision:{type:'integer',minimum:1},slides:{type:'array',items:deckSlide},design:{...deckDesign,description:'Deck theme and layout defaults. Omit to keep the saved design; a supplied design replaces it whole, so start from read_deck. A changed theme value records setBy agent; an unchanged one keeps its recorded setBy.'}}) },
  { type: 'function', name: 'build_deck', description: 'Build an offline HTML and ZIP draft bundle from the saved exact revision. Await the returned job; failed/queued is not success.', inputSchema: object(['expectedRevision'], {expectedRevision:{type:'integer',minimum:1}}) },
  { type: 'function', name: 'get_context', description: 'Read current scoped episode, story, cards, library and revisions, with research discovery metadata only. Call read_research for the complete saved summary and links before composing or revising authoring work.', inputSchema: empty },
  { type: 'function', name: 'get_operation_guide', description: 'Read an app-owned guide for one supported operation.', inputSchema: object(['name'], { name: { type: 'string', enum: ['edit_story','edit_card','create_still_graphic','create_animated_graphic','create_draft','create_final'] } }) },
  { type: 'function', name: 'read_conversation_history', description: 'Read earlier visible messages of this Storybench conversation (context only; never re-execute them).', inputSchema: object([], { beforeMessageId: { type: 'integer', minimum: 1 }, limit: { type: 'integer', minimum: 1, maximum: 100 } }) },
  { type: 'function', name: 'read_reference_excerpt', description: 'Read a bounded excerpt from a registered Reference item.', inputSchema: object(['itemId'], { itemId: { type: 'string' }, offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 20000 } }) },
  { type: 'function', name: 'update_story', description: 'Save story Markdown using its exact current revision.', inputSchema: object(['expectedStoryRevision','source'], { expectedStoryRevision: { type: 'integer', minimum: 1 }, source: { type: 'string' } }) },
  { type: 'function', name: 'update_cards', description: 'Replace cards using the exact current episode revision.', inputSchema: object(['expectedRevision','cards'], { expectedRevision: { type: 'integer', minimum: 1 }, cards: { type: 'array', items: { type: 'object' } } }) },
  { type: 'function', name: 'validate_render', description: 'Validate the current cut and return its exact render revision.', inputSchema: empty },
  { type: 'function', name: 'create_draft', description: 'Enqueue a draft for an exact validated render revision.', inputSchema: object(['expectedRenderRevision'], { expectedRenderRevision: { type: 'string' } }) },
  { type: 'function', name: 'declare_final_request', description: 'Bind Final intent to this request by citing its originating typed creator message (or the root typed message of an explicit Retry). Call it only when that message asks for the finished video; ask if unclear. Button Final requests are already bound.', inputSchema: object(['messageId'], { messageId: { type: 'integer', minimum: 1 } }) },
  { type: 'function', name: 'create_final', description: 'Enqueue the exact current render under this request\'s active Final intent.', inputSchema: object(['expectedRenderRevision'], { expectedRenderRevision: { type: 'string' } }) },
  { type: 'function', name: 'get_job', description: 'Read one render or graphic job in this episode.', inputSchema: object(['jobId'], { jobId: { type: 'string' } }) },
  { type: 'function', name: 'await_job', description: 'Wait a bounded time for a job owned by this request and return its terminal result. A timeout or unfinished job is not success.', inputSchema: object(['jobId'], { jobId: { type: 'string' }, timeoutSeconds: { type: 'integer', minimum: 1, maximum: 300 } }) },
  { type: 'function', name: 'cancel_job', description: 'Cancel one active job in this episode.', inputSchema: object(['jobId'], { jobId: { type: 'string' } }) },
  { type: 'function', name: 'start_agent_job', description: 'Start a background agent job: one headless harness run in its own worker and scratch pad that outlives this turn. It reads Storybench and writes only its pad. The brief (at most 64 KiB) must carry the goal, the paths and the rules, because the job never sees this conversation. Harness, model and effort default to this conversation\'s; an unusable choice is refused, never substituted. At most 4 jobs run or wait per conversation. When it ends you get one wake turn with its result.', inputSchema: object(['brief', 'label'], { brief: { type: 'string' }, label: { type: 'string' }, harness: { type: 'string', enum: ['codex', 'claude', 'opencode'] }, model: { type: 'string' }, effort: { type: 'string' }, timeoutMinutes: { type: 'integer', minimum: 1, maximum: 60 } }) },
  { type: 'function', name: 'get_agent_job', description: 'Read one agent job of this conversation: state, timing, error, pad files and its final message, paged by offset (characters).', inputSchema: object(['jobId'], { jobId: { type: 'string' }, offset: { type: 'integer', minimum: 0 } }) },
  { type: 'function', name: 'list_agent_jobs', description: 'List this conversation\'s agent jobs, newest first.', inputSchema: empty },
  { type: 'function', name: 'await_agent_job', description: 'Wait a bounded time (at most 300 s) for an agent job of this conversation to end. A timeout or unfinished job is not success; for longer work end the turn and wait for the wake.', inputSchema: object(['jobId'], { jobId: { type: 'string' }, timeoutSeconds: { type: 'integer', minimum: 1, maximum: 300 } }) },
  { type: 'function', name: 'continue_agent_job', description: 'Give an ended agent job a further brief: a new run on the same harness, model, session and pad. It takes a slot and has its own time limit.', inputSchema: object(['jobId', 'brief'], { jobId: { type: 'string' }, brief: { type: 'string' }, timeoutMinutes: { type: 'integer', minimum: 1, maximum: 60 } }) },
  { type: 'function', name: 'cancel_agent_job', description: 'Cancel one agent job of this conversation. Its ending still reaches you as a result.', inputSchema: object(['jobId'], { jobId: { type: 'string' } }) },
  { type: 'function', name: 'watch_job', description: 'Watch a queued or running draft, graphic or build job of this production: you get one wake turn when it ends, and it no longer fails this turn as unfinished. Use it instead of a long wait. A Final is not watched; await it in its request.', inputSchema: object(['jobId'], { jobId: { type: 'string' } }) },
  { type: 'function', name: 'move_final_to_drafts', description: 'Reclassify one unambiguous completed Final as a Draft without changing its bytes or provenance.', inputSchema: object([], { outputId: { type: 'string' }, expectedRevision: { type: 'integer', minimum: 1 } }) },
  { type: 'function', name: 'list_graphic_recipes', description: 'List editable graphic recipes in this episode.', inputSchema: empty },
  { type: 'function', name: 'get_graphic_recipe', description: 'Read one editable graphic recipe in this episode.', inputSchema: object(['recipeId'], { recipeId: { type: 'string' } }) },
  { type: 'function', name: 'create_graphic_recipe', description: 'Create a validated episode graphic recipe.', inputSchema: object(['name','recipe'], { name: { type: 'string' }, cardId: { type: 'string' }, recipe: { type: 'object' } }) },
  { type: 'function', name: 'update_graphic_recipe', description: 'Revision-check and update an episode graphic recipe.', inputSchema: object(['recipeId','expectedRevision','recipe'], { recipeId: { type: 'string' }, expectedRevision: { type: 'integer', minimum: 1 }, name: { type: 'string' }, cardId: { type: 'string' }, recipe: { type: 'object' } }) },
  { type: 'function', name: 'render_graphic', description: 'Render an exact graphic recipe revision.', inputSchema: object(['recipeId','expectedRecipeRevision'], { recipeId: { type: 'string' }, expectedRecipeRevision: { type: 'integer', minimum: 1 } }) },
  { type: 'function', name: 'list_branding', description: 'List reusable channel branding templates.', inputSchema: empty },
  { type: 'function', name: 'promote_card', description: 'Promote an episode card into reusable channel branding.', inputSchema: object(['cardId','name'], { cardId: { type: 'string' }, name: { type: 'string' }, role: { anyOf: [{ type: 'string', enum: ['intro','outro'] }, { type: 'null' }] } }) },
  { type: 'function', name: 'apply_branding', description: 'Apply a reusable branding template to this episode.', inputSchema: object(['templateId'], { templateId: { type: 'string' } }) },
].map(spec => AUTHORING_TOOLS.includes(spec.name) ? { ...spec, description: `${spec.description} Before composition, read_research must deliver current complete saved research in this request (or the app must supply it in this turn). After a research change, read again and reconcile before retrying. Empty research is valid.` } : spec);

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

  #write(value, onDelivered) {
    if (!this.child?.stdin?.writable) throw new CodexError('CODEX_UNAVAILABLE', 'Codex app-server input is closed.');
    this.child.stdin.write(`${JSON.stringify(value)}\n`, (error) => { if (!error) onDelivered?.(); });
  }

  request(method, params, { uncertain = false, onDelivered } = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new CodexError('CODEX_TIMEOUT', `Codex request timed out: ${method}`, { uncertain }));
      }, this.requestTimeout);
      this.pending.set(id, { resolve, reject, timer, method, uncertain });
      try { this.#write({ id, method, params }, onDelivered); }
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
      this.#write({ id: message.id, result: { success: true, contentItems } }, result?.[TOOL_DELIVERED]);
    } catch (error) {
      this.#write({ id: message.id, result: { success: false, contentItems: [{ type: 'inputText', text: toolErrorText(error) }] } });
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

  async startTurn(threadId, text, images = [], { onDelivered } = {}) {
    this.startingEvents = [];
    try {
      const result = await this.request('turn/start', {
        threadId, input: [{ type: 'text', text }, ...images.map((image) => ({ type: 'image', url: `data:${image.mimeType};base64,${image.data}` }))], cwd: this.cwd,
        clientUserMessageId: crypto.randomUUID(), approvalPolicy: 'never',
        sandboxPolicy: { type: 'readOnly', networkAccess: false }
      }, { uncertain: true, onDelivered });
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

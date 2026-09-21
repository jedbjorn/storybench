import { randomUUID } from "node:crypto";
import path from "node:path";
import { createCodexConnection } from "./codex.js";
import { getOperationGuide, OPERATION_GUIDE_NAMES } from "./agent-guides.js";
import { changeSettings, initialSettings, planTurn } from "./runtime/conversation-runtime.js";

const now = () => new Date().toISOString();
const parse = (value, fallback) => value == null ? fallback : JSON.parse(value);
const newId = () => `conversation_${randomUUID()}`;
const error = (message, statusCode = 400, extra = {}) => Object.assign(new Error(message), { statusCode, ...extra });
const safeRef = (value) => {
  if (typeof value !== "string" || path.isAbsolute(value)) return null;
  const normalized = path.normalize(value);
  return normalized === ".." || normalized.startsWith(`..${path.sep}`) ? null : normalized;
};

function installSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations(id TEXT PRIMARY KEY,episode_id TEXT NOT NULL,name TEXT NOT NULL,draft TEXT NOT NULL DEFAULT '',state TEXT NOT NULL DEFAULT 'idle',thread_id TEXT,active_turn_id TEXT,error TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS conversations_episode ON conversations(episode_id,created_at);
    CREATE TABLE IF NOT EXISTS conversation_messages(id INTEGER PRIMARY KEY AUTOINCREMENT,conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,role TEXT NOT NULL,text TEXT NOT NULL,state TEXT NOT NULL,turn_id TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS conversation_events(conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,sequence INTEGER NOT NULL,type TEXT NOT NULL,payload TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(conversation_id,sequence));
  `);
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='chats'").get()) return;
  for (const legacy of db.prepare("SELECT * FROM chats").all()) {
    if (db.prepare("SELECT 1 FROM conversations WHERE episode_id=?").get(legacy.episode_id)) continue;
    const id = newId();
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare(`INSERT INTO conversations(id,episode_id,name,state,thread_id,active_turn_id,error,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)`)
        .run(id, legacy.episode_id, legacy.name || "Conversation 1", legacy.state, legacy.thread_id, legacy.active_turn_id, legacy.error, legacy.created_at, legacy.updated_at);
      if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='chat_messages'").get())
        db.prepare(`INSERT INTO conversation_messages(id,conversation_id,role,text,state,turn_id,created_at,updated_at) SELECT id,?,role,text,state,turn_id,created_at,updated_at FROM chat_messages WHERE episode_id=? ORDER BY id`).run(id, legacy.episode_id);
      if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='chat_events'").get())
        db.prepare(`INSERT INTO conversation_events(conversation_id,sequence,type,payload,created_at) SELECT ?,sequence,type,payload,created_at FROM chat_events WHERE episode_id=? ORDER BY sequence`).run(id, legacy.episode_id);
      db.exec("COMMIT");
    } catch (cause) { db.exec("ROLLBACK"); throw cause; }
  }
}

// `continuity` (optional): { persistence, catalog: async ({ refresh }) => harness entries }.
// With it, each conversation carries its own harness/model/effort selection and native-session
// segments (spec #11 "Switching and continuity"); without it the legacy single-Codex path runs.
export function createChatService({ store, renders, onChange = () => {}, codexFactory = createCodexConnection, model = process.env.STORYBENCH_CODEX_MODEL, continuity = null }) {
  const db = store.db;
  installSchema(db);
  const restartStamp = now();
  // Unfinished turns from a previous process (crash, restart, reconciled worker) are marked
  // interrupted and never replayed.
  db.prepare("UPDATE conversation_messages SET state='interrupted',updated_at=? WHERE state IN ('queued','running','streaming')").run(restartStamp);
  db.prepare(`UPDATE conversations SET state='interrupted',active_turn_id=NULL,error='The previous Codex turn was interrupted by an application restart. It was not replayed; send a new message to continue the saved thread.',updated_at=? WHERE state IN ('queued','running','interrupting')`).run(restartStamp);

  const active = new Map(), tasks = new Set(), listeners = new Map();
  let closing = false;
  const episode = (id) => { const value = store.getEpisode(id); if (!value) throw error("Episode not found", 404); return value; };
  const row = (episodeId, id) => {
    episode(episodeId);
    const value = db.prepare("SELECT * FROM conversations WHERE id=? AND episode_id=?").get(id, episodeId);
    if (!value) throw error("Conversation not found", 404);
    return value;
  };
  const summary = (value) => ({ id: value.id, episodeId: value.episode_id, name: value.name, draft: value.draft, state: value.state,
    ...(value.thread_id ? { threadId: value.thread_id } : {}), ...(value.active_turn_id ? { activeTurnId: value.active_turn_id } : {}),
    ...(value.error ? { error: value.error } : {}), createdAt: value.created_at, updatedAt: value.updated_at });
  const project = (episodeId, id) => {
    const value = row(episodeId, id);
    const selection = continuity ? {
      settings: continuity.persistence.getSettings(value.id),
      segments: continuity.persistence.listSegments(value.id).map(({ id: segmentId, harness, nativeSessionId, reason, previousSegmentId, createdAt, endedAt }) => ({ id: segmentId, harness, nativeSessionId, reason, previousSegmentId, createdAt, endedAt })),
      runs: continuity.persistence.listRuns(value.id).slice(-20),
    } : {};
    return { ...summary(value), ...selection,
      messages: db.prepare("SELECT id,role,text,state,turn_id turnId,created_at createdAt,updated_at updatedAt FROM conversation_messages WHERE conversation_id=? ORDER BY id").all(id),
      events: db.prepare("SELECT sequence,type,payload,created_at createdAt FROM conversation_events WHERE conversation_id=? ORDER BY sequence").all(id)
        .map((event) => ({ ...event, conversationId: id, payload: parse(event.payload, {}) })) };
  };
  const emit = (value, type, payload = {}) => {
    const sequence = Number(db.prepare("SELECT COALESCE(MAX(sequence),0)+1 value FROM conversation_events WHERE conversation_id=?").get(value.id).value);
    const event = { sequence, conversationId: value.id, type, payload, createdAt: now() };
    db.prepare("INSERT INTO conversation_events VALUES(?,?,?,?,?)").run(value.id, sequence, type, JSON.stringify(payload), event.createdAt);
    for (const listener of listeners.get(value.episode_id) || []) listener(event);
    onChange(value.episode_id);
  };
  const setState = (value, state, { threadId, turnId, detail = null } = {}) => {
    db.prepare("UPDATE conversations SET state=?,thread_id=COALESCE(?,thread_id),active_turn_id=?,error=?,updated_at=? WHERE id=?")
      .run(state, threadId ?? null, turnId ?? null, detail, now(), value.id);
    emit(value, "status", { state, ...(turnId ? { turnId } : {}), ...(detail ? { error: detail } : {}) });
  };
  const create = (episodeId, { name = "New conversation" } = {}) => {
    episode(episodeId); name = String(name).trim(); if (!name) throw error("Conversation name is required");
    const id = newId(), stamp = now();
    db.prepare("INSERT INTO conversations(id,episode_id,name,created_at,updated_at) VALUES(?,?,?,?,?)").run(id, episodeId, name, stamp, stamp);
    // A new conversation reuses the last explicit choice; other conversations are untouched.
    if (continuity) continuity.persistence.initSettings(id, initialSettings(continuity.persistence));
    return project(episodeId, id);
  };
  const first = (episodeId) => {
    episode(episodeId);
    let value = db.prepare("SELECT * FROM conversations WHERE episode_id=? ORDER BY created_at,id LIMIT 1").get(episodeId);
    if (!value) { create(episodeId, { name: "Conversation 1" }); value = db.prepare("SELECT * FROM conversations WHERE episode_id=? ORDER BY created_at,id LIMIT 1").get(episodeId); }
    return value;
  };
  const ensureActive = (value, origin) => {
    const current = row(value.episode_id, value.id), activity = active.get(value.episode_id);
    if (closing || activity !== origin || activity?.conversationId !== value.id || !["queued", "running"].includes(current.state)) throw error("The turn is no longer active; changes are closed", 409);
  };
  const excerpt = (episodeId, itemId, offset = 0, limit = 4000) => {
    const item = store.listEpisodeLibrary(episodeId).find((candidate) => candidate.id === itemId);
    const current = store.getEpisode(episodeId);
    // Scope comes from explicit episode/card links; the Reference category remains readable as before.
    const linked = current.referenceItemIds.includes(itemId) || current.cards.some((card) => (card.referenceItemIds || []).includes(itemId));
    if (!item || (item.category !== "Reference" && !linked)) throw error("Reference item not found", 404);
    const text = item.extractedText ?? item.provenance?.extractedText ?? "", start = Math.max(0, Number(offset) || 0), size = Math.min(20_000, Math.max(1, Number(limit) || 4000));
    return { itemId, offset: start, text: text.slice(start, start + size), truncated: start + size < text.length };
  };
  const librarySummary = (episodeId) => store.listEpisodeLibrary(episodeId).map((item) => ({ id: item.id, revision: item.revision, label: item.label,
    category: item.category, sourceKind: item.sourceKind, extractionStatus: item.extractionStatus,
    asset: item.asset && { id: item.asset.id, name: item.asset.name, kind: item.asset.kind, duration: item.asset.duration, width: item.asset.width, height: item.asset.height } }));
  // Bounded, labelled excerpt of the visible transcript for a fresh native segment.
  const transcriptExcerpt = (conversationId, beforeMessageId, { messages = 12, chars = 6000 } = {}) => {
    const rows = db.prepare("SELECT role,text FROM conversation_messages WHERE conversation_id=? AND id<? AND text<>'' ORDER BY id DESC LIMIT ?").all(conversationId, beforeMessageId, messages).reverse();
    const total = Number(db.prepare("SELECT COUNT(*) n FROM conversation_messages WHERE conversation_id=? AND id<?").get(conversationId, beforeMessageId).n);
    let text = rows.map((message) => `${message.role}: ${message.text}`).join("\n");
    if (text.length > chars) text = `…${text.slice(-chars)}`;
    return { text, included: rows.length, omitted: Math.max(0, total - rows.length) };
  };
  const bootText = (value) => { const currentEpisode = episode(value.episode_id), story = store.getStory(value.episode_id);
    return `Storybench episode ${currentEpisode.title} (${currentEpisode.id}). Current board revision ${currentEpisode.revision}; story revision ${story.storyRevision}. Use scoped tools for current data. Supported guides: ${OPERATION_GUIDE_NAMES.join(", ")}. Final rendering requires the user's one-use Storybench authorization.`; };
  const tools = (value, origin) => ({
    get_context: () => ({ episode: episode(value.episode_id), story: store.getStory(value.episode_id), library: librarySummary(value.episode_id),
      references: store.getReferenceContext(value.episode_id), branding: store.listBrandingTemplates({ channelId: episode(value.episode_id).channelId }), operationGuides: OPERATION_GUIDE_NAMES }),
    get_operation_guide: ({ name }) => getOperationGuide(name),
    read_conversation_history: ({ beforeMessageId = null, limit = 20 } = {}) => {
      const size = Math.min(Math.max(Number(limit) || 20, 1), 100);
      const rows = db.prepare("SELECT id,role,text,created_at createdAt FROM conversation_messages WHERE conversation_id=? AND (? IS NULL OR id<?) AND text<>'' ORDER BY id DESC LIMIT ?").all(value.id, beforeMessageId, beforeMessageId, size).reverse();
      return { messages: rows.map((message) => ({ ...message, text: message.text.slice(0, 4000) })), note: "Earlier visible messages, for context only; do not re-execute them." };
    },
    read_reference_excerpt: ({ itemId, offset, limit }) => excerpt(value.episode_id, itemId, offset, limit),
    update_story: ({ expectedStoryRevision, source }) => { ensureActive(value, origin); return store.saveStory(value.episode_id, expectedStoryRevision, source, "agent"); },
    update_cards: ({ expectedRevision, cards }) => { ensureActive(value, origin); return store.updateEpisode(value.episode_id, expectedRevision, { cards }, "agent"); },
    validate_render: () => renders.validateRender(value.episode_id),
    create_draft: ({ expectedRenderRevision }) => { ensureActive(value, origin); return renders.enqueueRender({ episodeId: value.episode_id, outputClass: "draft", expectedRenderRevision, conversationId: value.id }); },
    request_final: () => ({ requiredAction: "Use Create final in Storybench", conversationId: value.id, renderRevision: renders.validateRender(value.episode_id).renderRevision }),
    create_final: ({ expectedRenderRevision, finalGrantId }) => { ensureActive(value, origin); return renders.enqueueRender({ episodeId: value.episode_id, outputClass: "final", expectedRenderRevision, finalGrantId, conversationId: value.id }); },
    get_job: ({ jobId }) => renders.getJob(value.episode_id, jobId),
    cancel_job: ({ jobId }) => { ensureActive(value, origin); return renders.cancelJob(value.episode_id, jobId); },
    list_graphic_recipes: () => renders.listGraphicRecipes(value.episode_id),
    get_graphic_recipe: ({ recipeId }) => { const recipe = renders.getGraphicRecipe(value.episode_id, recipeId); if (!recipe) throw error("Graphic recipe not found", 404); return recipe; },
    create_graphic_recipe: (input) => { ensureActive(value, origin); return renders.createGraphicRecipe(value.episode_id, input, "agent"); },
    update_graphic_recipe: ({ recipeId, expectedRevision, ...input }) => { ensureActive(value, origin); return renders.updateGraphicRecipe(value.episode_id, recipeId, expectedRevision, input, "agent"); },
    render_graphic: ({ recipeId, expectedRecipeRevision }) => { ensureActive(value, origin); return renders.enqueueGraphic({ episodeId: value.episode_id, recipeId, expectedRecipeRevision }); },
    list_branding: () => store.listBrandingTemplates({ channelId: episode(value.episode_id).channelId }),
    promote_card: ({ cardId, name, role = null }) => { ensureActive(value, origin); return store.promoteCard(value.episode_id, cardId, { name, role }); },
    apply_branding: ({ templateId }) => { ensureActive(value, origin); return store.applyBrandingTemplate(value.episode_id, templateId); },
    // Compatibility handlers for provider threads created by the first prototype.
    get_project: () => episode(value.episode_id),
    list_assets: () => store.listEpisodeLibrary(value.episode_id).filter((item) => item.asset).map((item) => ({ id: item.asset.id, name: item.asset.name, kind: item.asset.kind, duration: item.asset.duration, width: item.asset.width, height: item.asset.height,
      hasAudio: Array.isArray(item.asset.metadata?.streams) ? item.asset.metadata.streams.some((stream) => stream?.codec_type === "audio") : Boolean(item.asset.metadata?.hasAudio), mediaRef: safeRef(item.asset.path), thumbnailRef: safeRef(item.asset.thumbnailPath) })),
    update_storyboard: ({ expectedRevision, cards }) => { ensureActive(value, origin); return store.updateEpisode(value.episode_id, expectedRevision, { cards }, "agent"); },
  });

  async function execute(value, messageId, text) {
    let connection, turnId, assistantId, terminal = false, dispatch = false, aborted = false, resolveDone, rejectDone;
    const requestId = `request_${randomUUID()}`;
    const persistence = continuity?.persistence;
    let plan = null, segment = null;
    const finishRun = (patch) => { if (persistence && plan) try { persistence.updateRun(requestId, { ...patch, finishedAt: now() }); } catch { /* attribution is best effort */ } };
    const controller = new AbortController(), pending = [], done = new Promise((resolve, reject) => { resolveDone = resolve; rejectDone = reject; });
    const activity = { conversationId: value.id, abort: () => { aborted = true; controller.abort(); if (dispatch) rejectDone(error("Chat stopped; the prompt was not replayed", 409)); } };
    active.set(value.episode_id, activity);
    const consume = (event) => {
      const params = event.params || {}, eventTurn = params.turnId || params.turn?.id;
      if (turnId && eventTurn && eventTurn !== turnId) return;
      if (!turnId && eventTurn) turnId = eventTurn;
      if (event.method === "turn/started") {
        db.prepare("UPDATE conversation_messages SET state='running',updated_at=? WHERE id=?").run(now(), messageId); setState(value, "running", { turnId });
        if (persistence && plan) try { persistence.updateRun(requestId, { state: "running", nativeTurnId: turnId ?? null }); } catch { /* already running */ }
      }
      else if (event.method === "item/agentMessage/delta" && typeof params.delta === "string") {
        if (!assistantId) assistantId = store.addConversationMessage({ conversationId: value.id, role: "assistant", text: "", state: "streaming", turnId }).id;
        db.prepare("UPDATE conversation_messages SET text=text||?,updated_at=? WHERE id=?").run(params.delta, now(), assistantId);
        emit(value, "assistant.delta", { messageId: assistantId, text: params.delta, turnId });
      } else if (["item/started", "item/completed"].includes(event.method) && ["dynamicToolCall", "mcpToolCall"].includes(params.item?.type)) emit(value, event.method === "item/started" ? "tool.started" : "tool.completed", { name: params.item.tool || params.item.name, status: params.item.status, turnId });
      else if (event.method === "turn/completed") {
        terminal = true; const status = params.turn?.status, state = status === "completed" ? "idle" : status === "interrupted" ? "interrupted" : "error", detail = state === "error" ? JSON.stringify(params.turn?.error || "Codex turn failed") : null;
        db.prepare("UPDATE conversation_messages SET state=?,updated_at=? WHERE id=?").run(status === "completed" ? "completed" : status === "interrupted" ? "interrupted" : "failed", now(), messageId);
        if (assistantId) db.prepare("UPDATE conversation_messages SET state=?,updated_at=? WHERE id=?").run(status === "completed" ? "completed" : status === "interrupted" ? "interrupted" : "failed", now(), assistantId);
        finishRun({ state: status === "completed" ? "completed" : status === "interrupted" ? "interrupted" : "failed", error: detail, assistantMessageId: assistantId ?? null, nativeTurnId: turnId,
          modelResolved: connection?.resolved?.model ?? params.model ?? null, effortResolved: connection?.resolved?.effort ?? null, usage: params.usage ?? null });
        setState(value, state, { detail }); resolveDone();
      }
    };
    try {
      if (persistence) {
        // Decide the native session: resume the active segment of the selected harness, or open a
        // new segment. Native session IDs never cross harnesses.
        const earlier = Number(db.prepare("SELECT COUNT(*) n FROM conversation_messages WHERE conversation_id=? AND id<?").get(value.id, messageId).n) > 0;
        plan = planTurn(persistence, value.id, { hasEarlierMessages: earlier, legacyThreadId: value.thread_id, defaultModel: model });
        segment = plan.segment ?? (plan.newSegment.reason === "migrated"
          ? persistence.createSegment({ conversationId: value.id, harness: "codex", reason: "migrated", id: plan.newSegment.adoptId, nativeSessionId: plan.newSegment.nativeSessionId })
          : persistence.createSegment({ conversationId: value.id, harness: plan.selection.harness, reason: plan.newSegment.reason, previousSegmentId: plan.newSegment.previousSegmentId, firstMessageId: messageId }));
        persistence.createRun({ id: requestId, conversationId: value.id, segmentId: segment.id, userMessageId: messageId, harness: plan.selection.harness,
          modelSelected: plan.selection.model, effortSelected: plan.selection.effort, state: "starting", startedAt: now() });
      }
      connection = await codexFactory({ cwd: store.workspace, model: plan ? plan.selection.model : model, tools: tools(value, activity), signal: controller.signal,
        episodeId: value.episode_id, conversationId: value.id, requestId, request: { text, messageId, kind: "chat", cardId: null },
        ...(plan ? { harness: plan.selection.harness, effort: plan.selection.effort, segmentId: segment.id } : {}),
        onEvent: (event) => dispatch ? consume(event) : pending.push(event), onError: (cause) => { if (dispatch) rejectDone(cause); } });
      if (aborted) throw error("Chat stopped; the prompt was not replayed", 409);
      activity.connection = connection;
      const resumeId = plan ? plan.resumeId : value.thread_id;
      const threadId = resumeId ? await connection.resumeThread(resumeId) : await connection.startThread();
      if (aborted || active.get(value.episode_id) !== activity) throw error("Chat stopped; the prompt was not replayed", 409);
      if (persistence && connection.segmentTransition && segment.nativeSessionId && segment.nativeSessionId !== threadId) {
        // The harness could not resume this segment's native session: continue in a new segment of
        // the same harness for this request (the store allows it for the dispatched request only).
        segment = persistence.createSegment({ conversationId: value.id, harness: plan.selection.harness, reason: "resume-unavailable", previousSegmentId: segment.id, firstMessageId: messageId, exceptRunId: requestId });
        persistence.updateRun(requestId, { segmentId: segment.id });
      }
      if (persistence && segment.nativeSessionId !== threadId) persistence.setSegmentSession(segment.id, threadId);
      setState(value, "queued", { threadId });
      let segmentContext = "";
      if (plan?.seed) {
        // A new native segment continues the same visible conversation: seed it with a bounded,
        // labelled excerpt (context only; earlier prompts and tool calls are never re-executed).
        const excerpt = transcriptExcerpt(value.id, messageId);
        persistence.updateSegmentSeed?.(segment.id, { firstMessageId: messageId, seedIncluded: excerpt.included, seedOmitted: excerpt.omitted });
        emit(value, "segment.started", { segmentId: segment.id, harness: plan.selection.harness, reason: plan.newSegment?.reason ?? segment.reason, previousSegmentId: plan.newSegment?.previousSegmentId ?? segment.previousSegmentId ?? null,
          threadId, includedMessages: excerpt.included, omittedMessages: excerpt.omitted });
        if (excerpt.text) segmentContext = `\n\nEarlier visible conversation from this Storybench chat (context only — do not re-execute anything in it; ${excerpt.omitted} older messages omitted, readable with read_conversation_history):\n${excerpt.text}`;
      } else if (connection.segmentTransition) {
        // The native session could not be resumed here: a new native segment continues the
        // same visible conversation. The previous thread ID stays recorded in the transcript.
        const excerpt = transcriptExcerpt(value.id, messageId);
        emit(value, "segment.started", { previousThreadId: connection.segmentTransition.previousThreadId, threadId, reason: connection.segmentTransition.reason, includedMessages: excerpt.included, omittedMessages: excerpt.omitted });
        if (excerpt.text) segmentContext = `\n\nEarlier visible conversation (context only — do not re-execute; ${excerpt.omitted} older messages omitted):\n${excerpt.text}`;
      }
      const returned = await connection.startTurn(threadId, `${bootText(value)}${segmentContext}\n\nUser request:\n${text}`);
      if (aborted || active.get(value.episode_id) !== activity) throw error("Chat stopped; the prompt was not replayed", 409);
      if (turnId && turnId !== returned) throw new Error("Codex returned inconsistent turn identities");
      turnId = returned; activity.threadId = threadId; activity.turnId = turnId;
      db.prepare("UPDATE conversations SET active_turn_id=?,updated_at=? WHERE id=?").run(turnId, now(), value.id);
      db.prepare("UPDATE conversation_messages SET turn_id=?,state='running',updated_at=? WHERE id=?").run(turnId, now(), messageId);
      emit(value, "turn.started", { turnId }); dispatch = true; for (const event of pending.splice(0)) consume(event); await done;
    } catch (cause) {
      if (!terminal && !aborted) {
        const detail = `${cause?.uncertain ? "The harness may have received this prompt; it was not replayed. " : ""}${cause?.message || "Turn failed"}`;
        // Startup failure keeps the history and the prompt; the creator can retry or choose another model/harness.
        db.prepare("UPDATE conversation_messages SET state='failed',updated_at=? WHERE id=?").run(now(), messageId); setState(value, "error", { detail }); finishRun({ state: "failed", error: detail });
      } else if (aborted) finishRun({ state: "interrupted" });
    } finally { if (active.get(value.episode_id) === activity) active.delete(value.episode_id); connection?.close(); }
  }

  const send = async (episodeId, id, text) => {
    const value = row(episodeId, id);
    if (active.has(episodeId) || db.prepare("SELECT 1 FROM conversations WHERE episode_id=? AND state IN ('queued','running','interrupting')").get(episodeId)) throw error("A Codex turn is already active for this episode", 409);
    if (typeof text !== "string" || !text.trim()) throw error("Chat message must not be blank");
    // One active production request per conversation (the store does not refuse a second 'starting' run).
    if (continuity && continuity.persistence.activeRuns?.(id).length) throw error("A request is already running in this conversation; let it finish or press Stop", 409);
    // Origin is bound to the role by the store: a typed creator message (shortcuts are #27's handler).
    const stamp = now(), messageId = store.addConversationMessage({ conversationId: id, role: "user", text: text.trim(), state: "queued" }).id;
    db.prepare("UPDATE conversations SET draft='',state='queued',error=NULL,updated_at=? WHERE id=?").run(stamp, id); emit(value, "status", { state: "queued" });
    const task = execute(value, messageId, text.trim()); tasks.add(task); task.finally(() => tasks.delete(task)); return project(episodeId, id);
  };
  const interrupt = async (episodeId, id) => {
    const value = row(episodeId, id), activity = active.get(episodeId);
    if (!activity || activity.conversationId !== id || !["queued", "running"].includes(value.state)) throw error("This conversation has no active Codex turn", 409);
    if (!activity.connection || !value.thread_id || !value.active_turn_id) { activity.abort(); db.prepare("UPDATE conversation_messages SET state='interrupted',updated_at=? WHERE conversation_id=? AND state IN ('queued','running','streaming')").run(now(), id); setState(value, "interrupted"); return project(episodeId, id); }
    setState(value, "interrupting", { threadId: value.thread_id, turnId: value.active_turn_id });
    if (activity.connection.workerRequest) {
      // Worker-backed turn: if the harness has not ended the turn shortly, remove its worker,
      // which terminates every descendant command.
      const force = setTimeout(() => {
        if (active.get(episodeId) !== activity) return;
        activity.abort(); activity.connection.close();
        db.prepare("UPDATE conversation_messages SET state='interrupted',updated_at=? WHERE conversation_id=? AND state IN ('queued','running','streaming')").run(now(), id);
        setState(value, "interrupted", { detail: "Stopped; the turn's worker and its commands were terminated. The prompt was not replayed." });
      }, 10_000);
      force.unref?.();
    }
    await activity.connection.interrupt(value.thread_id, value.active_turn_id); return project(episodeId, id);
  };
  const busyReason = (episodeId) => {
    if (active.has(episodeId) || db.prepare("SELECT 1 FROM conversations WHERE episode_id=? AND state IN ('queued','running','interrupting')").get(episodeId))
      return "A turn is active for this episode. Let it finish or press Stop before changing the harness, model or effort.";
    if (store.listJobs(episodeId).some((job) => ["queued", "running", "cancelling"].includes(job.state)))
      return "Production work is still running for this episode. Let it finish or cancel it before changing the harness, model or effort.";
    return null;
  };
  const updateSettings = async (episodeId, id, body = {}) => {
    if (!continuity) throw error("Harness and model selection is not available in this installation", 501);
    const value = row(episodeId, id);
    const last = db.prepare("SELECT payload FROM conversation_events WHERE conversation_id=? AND type='settings.changed' ORDER BY sequence DESC LIMIT 1").get(id);
    const catalog = await continuity.catalog({ refresh: false });
    const result = changeSettings(continuity.persistence, id, { harness: body.harness, model: body.model || null, effort: body.effort || null }, {
      catalog, busy: busyReason(episodeId), expectedRevision: body.expectedRevision, clientRequestId: body.clientRequestId ?? null, lastClientRequestId: parse(last?.payload, {})?.clientRequestId ?? null,
    });
    if (result.changed) {
      // Visible settings-change boundary in the transcript.
      const pick = ({ harness, model: selected, effort }) => ({ harness, model: selected ?? null, effort: effort ?? null });
      emit(value, "settings.changed", { from: pick(result.previous), to: pick(result.settings), clientRequestId: body.clientRequestId ?? null,
        continuity: result.harnessChanged ? "new-segment-on-next-message" : "same-session-resumed-on-next-message", notes: result.notes });
    }
    return { ...project(episodeId, id), settingsResult: { changed: result.changed, duplicate: result.duplicate, notes: result.notes, advisory: Boolean(result.advisory) } };
  };
  const update = (episodeId, id, patch) => { const value = row(episodeId, id), name = patch.name === undefined ? value.name : String(patch.name).trim(), draft = patch.draft === undefined ? value.draft : String(patch.draft); if (!name) throw error("Conversation name is required"); db.prepare("UPDATE conversations SET name=?,draft=?,updated_at=? WHERE id=?").run(name, draft, now(), id); return project(episodeId, id); };
  return {
    list: (episodeId) => { episode(episodeId); return db.prepare("SELECT * FROM conversations WHERE episode_id=? ORDER BY created_at,id").all(episodeId).map((value) => ({ ...summary(value), ...(continuity ? { settings: continuity.persistence.getSettings(value.id) } : {}) })); }, create,
    updateSettings, busyReason,
    get: (episodeId, id) => project(episodeId, id || first(episodeId).id), update,
    send: (episodeId, id, text) => text === undefined ? send(episodeId, first(episodeId).id, id) : send(episodeId, id, text),
    interrupt: (episodeId, id) => interrupt(episodeId, id || first(episodeId).id),
    getLegacy: (episodeId) => project(episodeId, first(episodeId).id), sendLegacy: (episodeId, text) => send(episodeId, first(episodeId).id, text), interruptLegacy: (episodeId) => interrupt(episodeId, first(episodeId).id),
    subscribe(episodeId, listener) { episode(episodeId); const set = listeners.get(episodeId) || new Set(); set.add(listener); listeners.set(episodeId, set); return () => { set.delete(listener); if (!set.size) listeners.delete(episodeId); }; },
    async close() {
      closing = true;
      const stops = [];
      for (const [episodeId, item] of active) {
        const value = db.isOpen ? db.prepare("SELECT * FROM conversations WHERE id=? AND episode_id=?").get(item.conversationId, episodeId) : null;
        if (value) { db.prepare("UPDATE conversation_messages SET state='interrupted',updated_at=? WHERE conversation_id=? AND state IN ('queued','running','streaming')").run(now(), value.id); setState(value, "interrupted", { detail: "Stopped because Storybench shut down; the prompt was not replayed." }); }
        stops.push(item.connection?.close()); item.abort();
      }
      await Promise.allSettled([...tasks, ...stops]); active.clear();
    }
  };
}

export default createChatService;

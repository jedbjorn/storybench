import { createCodexConnection } from './codex.js';
import path from 'node:path';

const now = () => new Date().toISOString();
const parse = (value, fallback) => value == null ? fallback : JSON.parse(value);
const safeRelativeRef = (value) => {
  if (typeof value !== 'string' || path.isAbsolute(value)) return null;
  const normalized = path.normalize(value);
  return normalized === '..' || normalized.startsWith(`..${path.sep}`) ? null : normalized;
};

export function createChatService({ store, onChange = () => {}, codexFactory = createCodexConnection, model = process.env.STORYBENCH_CODEX_MODEL }) {
  const db = store.db;
  db.exec(`
    CREATE TABLE IF NOT EXISTS chats (episode_id TEXT PRIMARY KEY, state TEXT NOT NULL DEFAULT 'idle', thread_id TEXT, active_turn_id TEXT, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, name TEXT NOT NULL DEFAULT 'Conversation 1');
    CREATE TABLE IF NOT EXISTS chat_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, episode_id TEXT NOT NULL, role TEXT NOT NULL, text TEXT NOT NULL, state TEXT NOT NULL, turn_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS chat_events (episode_id TEXT NOT NULL, sequence INTEGER NOT NULL, type TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(episode_id,sequence));
  `);
  const interrupted = db.prepare("SELECT episode_id FROM chats WHERE state IN ('queued','running','interrupting')").all();
  for (const row of interrupted) {
    const stamp = now();
    const message = 'The previous Codex turn was interrupted by an application restart. It was not replayed; send a new message to continue the saved thread.';
    db.prepare("UPDATE chats SET state='error',active_turn_id=NULL,error=?,updated_at=? WHERE episode_id=?").run(message, stamp, row.episode_id);
    db.prepare("UPDATE chat_messages SET state='failed',updated_at=? WHERE episode_id=? AND state IN ('queued','running')").run(stamp, row.episode_id);
  }

  const active = new Map();
  const tasks = new Set();
  const abortors = new Map();
  let closing = false;
  const listeners = new Map();
  const ensureEpisode = (episodeId) => {
    if (!store.getEpisode(episodeId)) { const error = new Error('Episode not found'); error.statusCode = 404; throw error; }
  };
  const ensureChat = (episodeId) => {
    ensureEpisode(episodeId);
    let row = db.prepare('SELECT * FROM chats WHERE episode_id=?').get(episodeId);
    if (!row) {
      const stamp = now();
      db.prepare("INSERT INTO chats(episode_id,state,created_at,updated_at) VALUES(?,'idle',?,?)").run(episodeId, stamp, stamp);
      row = db.prepare('SELECT * FROM chats WHERE episode_id=?').get(episodeId);
    }
    return row;
  };
  const appendEvent = (episodeId, type, payload = {}) => {
    const sequence = Number(db.prepare('SELECT COALESCE(MAX(sequence),0)+1 AS value FROM chat_events WHERE episode_id=?').get(episodeId).value);
    const event = { sequence, type, payload, createdAt: now() };
    db.prepare('INSERT INTO chat_events VALUES(?,?,?,?,?)').run(episodeId, sequence, type, JSON.stringify(payload), event.createdAt);
    for (const listener of listeners.get(episodeId) || []) listener(event);
    onChange(episodeId);
    return event;
  };
  const projection = (episodeId) => {
    const chat = ensureChat(episodeId);
    return {
      state: chat.state, ...(chat.thread_id ? { threadId: chat.thread_id } : {}),
      messages: db.prepare('SELECT id,role,text,state,turn_id AS turnId,created_at AS createdAt,updated_at AS updatedAt FROM chat_messages WHERE episode_id=? ORDER BY id').all(episodeId),
      events: db.prepare('SELECT sequence,type,payload,created_at AS createdAt FROM chat_events WHERE episode_id=? ORDER BY sequence').all(episodeId).map((event) => ({ ...event, payload: parse(event.payload, {}) })),
      ...(chat.error ? { error: chat.error } : {})
    };
  };
  const updateState = (episodeId, state, { threadId, turnId, error = null } = {}) => {
    db.prepare('UPDATE chats SET state=?,thread_id=COALESCE(?,thread_id),active_turn_id=?,error=?,updated_at=? WHERE episode_id=?').run(state, threadId ?? null, turnId ?? null, error, now(), episodeId);
    appendEvent(episodeId, 'status', { state, ...(turnId ? { turnId } : {}), ...(error ? { error } : {}) });
  };

  async function execute(episodeId, messageId, text) {
    let connection;
    let turnId;
    let assistantId;
    let terminal = false;
    let resolveDone;
    let rejectDone;
    let waitingForTerminal = false;
    let aborted = false;
    const controller = new AbortController();
    let dispatchReady = false;
    const pendingEvents = [];
    const done = new Promise((resolve, reject) => { resolveDone = resolve; rejectDone = reject; });
    abortors.set(episodeId, () => {
      aborted = true;
      controller.abort();
      if (waitingForTerminal) rejectDone(new Error('Chat stopped with the application; the prompt was not replayed.'));
    });
    const chat = ensureChat(episodeId);
    const tools = {
      get_project: () => store.getEpisode(episodeId),
      list_assets: () => store.listAssets().map((asset) => ({
        id: asset.id, name: asset.name, kind: asset.kind,
        duration: asset.duration, width: asset.width, height: asset.height,
        hasAudio: Array.isArray(asset.metadata?.streams)
          ? asset.metadata.streams.some((stream) => stream?.codec_type === 'audio')
          : Boolean(asset.metadata?.hasAudio),
        mediaRef: safeRelativeRef(asset.path), thumbnailRef: safeRelativeRef(asset.thumbnailPath)
      })),
      update_storyboard: ({ expectedRevision, cards }) => {
        const current = ensureChat(episodeId);
        if (closing || aborted || terminal || !['queued', 'running'].includes(current.state)) {
          const error = new Error('The turn is no longer active; storyboard changes are closed.');
          error.statusCode = 409;
          throw error;
        }
        const episode = store.updateEpisode(episodeId, expectedRevision, { cards }, 'agent');
        appendEvent(episodeId, 'storyboard.updated', { revision: episode.revision });
        return episode;
      }
    };
    const consume = (raw) => {
      const params = raw.params || {};
      const eventTurn = params.turnId || params.turn?.id;
      if (turnId && eventTurn && eventTurn !== turnId) return;
      if (!turnId && eventTurn) turnId = eventTurn;
      if (raw.method === 'turn/started') {
        db.prepare("UPDATE chat_messages SET state='running',updated_at=? WHERE id=?").run(now(), messageId);
        updateState(episodeId, 'running', { turnId });
      } else if (raw.method === 'item/agentMessage/delta' && typeof params.delta === 'string') {
        if (!assistantId) {
          const stamp = now();
          assistantId = Number(db.prepare("INSERT INTO chat_messages(episode_id,role,text,state,turn_id,created_at,updated_at) VALUES(?,'assistant','','streaming',?,?,?)").run(episodeId, turnId, stamp, stamp).lastInsertRowid);
        }
        db.prepare('UPDATE chat_messages SET text=text||?,updated_at=? WHERE id=?').run(params.delta, now(), assistantId);
        appendEvent(episodeId, 'assistant.delta', { messageId: assistantId, text: params.delta, turnId });
      } else if (raw.method === 'item/started' || raw.method === 'item/completed') {
        const item = params.item || {};
        if (item.type === 'dynamicToolCall') appendEvent(episodeId, raw.method === 'item/started' ? 'tool.started' : 'tool.completed', { name: item.tool || item.name, status: item.status, turnId });
      } else if (raw.method === 'turn/completed') {
        const status = params.turn?.status;
        terminal = true;
        const state = status === 'completed' ? 'idle' : status === 'interrupted' ? 'interrupted' : 'error';
        const error = state === 'error' ? JSON.stringify(params.turn?.error || 'Codex turn failed') : null;
        db.prepare('UPDATE chat_messages SET state=?,updated_at=? WHERE id=?').run(status === 'completed' ? 'completed' : status === 'interrupted' ? 'interrupted' : 'failed', now(), messageId);
        if (assistantId) db.prepare('UPDATE chat_messages SET state=?,updated_at=? WHERE id=?').run(status === 'completed' ? 'completed' : status === 'interrupted' ? 'interrupted' : 'failed', now(), assistantId);
        updateState(episodeId, state, { error });
        resolveDone();
      }
    };
    try {
      connection = await codexFactory({
        cwd: store.workspace, model, tools, signal: controller.signal,
        onEvent: (event) => dispatchReady ? consume(event) : pendingEvents.push(event),
        onError: (error) => { if (waitingForTerminal) rejectDone(error); }
      });
      if (aborted) throw new Error('Chat stopped with the application; the prompt was not replayed.');
      active.set(episodeId, connection);
      const threadId = chat.thread_id ? await connection.resumeThread(chat.thread_id) : await connection.startThread();
      if (aborted) throw new Error('Chat stopped with the application; the prompt was not replayed.');
      updateState(episodeId, 'queued', { threadId });
      const returnedTurnId = await connection.startTurn(threadId, text);
      if (aborted) throw new Error('Chat stopped with the application; the prompt was not replayed.');
      if (turnId && turnId !== returnedTurnId) throw new Error('Codex returned inconsistent turn identities');
      turnId = returnedTurnId;
      db.prepare('UPDATE chats SET active_turn_id=?,updated_at=? WHERE episode_id=?').run(turnId, now(), episodeId);
      db.prepare('UPDATE chat_messages SET turn_id=?,state=\'running\',updated_at=? WHERE id=?').run(turnId, now(), messageId);
      appendEvent(episodeId, 'turn.started', { turnId });
      waitingForTerminal = true;
      dispatchReady = true;
      for (const event of pendingEvents.splice(0)) consume(event);
      await done;
    } catch (error) {
      if (!terminal && !aborted) {
        const prefix = error?.uncertain ? 'Codex may have received this prompt; it was not replayed. ' : '';
        const detail = `${prefix}${error?.message || 'Codex turn failed'}`;
        db.prepare("UPDATE chat_messages SET state='failed',updated_at=? WHERE id=?").run(now(), messageId);
        updateState(episodeId, 'error', { error: detail });
      }
    } finally {
      active.delete(episodeId);
      abortors.delete(episodeId);
      connection?.close();
    }
  }

  return {
    get: projection,
    async send(episodeId, text) {
      const chat = ensureChat(episodeId);
      if (['queued', 'running', 'interrupting'].includes(chat.state) || active.has(episodeId)) { const error = new Error('A Codex turn is already active for this episode'); error.statusCode = 409; throw error; }
      if (typeof text !== 'string' || !text.trim()) { const error = new Error('Chat message must not be blank'); error.statusCode = 400; throw error; }
      const stamp = now();
      const messageId = Number(db.prepare("INSERT INTO chat_messages(episode_id,role,text,state,created_at,updated_at) VALUES(?,'user',?,'queued',?,?)").run(episodeId, text.trim(), stamp, stamp).lastInsertRowid);
      updateState(episodeId, 'queued');
      const task = execute(episodeId, messageId, text.trim());
      tasks.add(task);
      task.finally(() => tasks.delete(task));
      return projection(episodeId);
    },
    async interrupt(episodeId) {
      const chat = ensureChat(episodeId);
      const connection = active.get(episodeId);
      if (!['queued', 'running'].includes(chat.state) || !abortors.has(episodeId)) { const error = new Error('No active Codex turn to interrupt'); error.statusCode = 409; throw error; }
      if (!connection || !chat.thread_id || !chat.active_turn_id) {
        abortors.get(episodeId)();
        db.prepare("UPDATE chat_messages SET state='interrupted',updated_at=? WHERE episode_id=? AND state IN ('queued','running','streaming')").run(now(), episodeId);
        updateState(episodeId, 'interrupted');
        return projection(episodeId);
      }
      updateState(episodeId, 'interrupting', { threadId: chat.thread_id, turnId: chat.active_turn_id });
      await connection.interrupt(chat.thread_id, chat.active_turn_id);
      return projection(episodeId);
    },
    subscribe(episodeId, listener) {
      ensureChat(episodeId);
      const set = listeners.get(episodeId) || new Set(); set.add(listener); listeners.set(episodeId, set);
      return () => { set.delete(listener); if (!set.size) listeners.delete(episodeId); };
    },
    async close() {
      closing = true;
      for (const connection of active.values()) connection.close();
      for (const abort of abortors.values()) abort();
      await Promise.allSettled([...tasks]);
      const stamp = now();
      db.prepare("UPDATE chat_messages SET state='failed',updated_at=? WHERE state IN ('queued','running','streaming')").run(stamp);
      db.prepare("UPDATE chats SET state='error',active_turn_id=NULL,error='Chat stopped with the application; the prompt was not replayed.',updated_at=? WHERE state IN ('queued','running','interrupting')").run(stamp);
      active.clear();
    }
  };
}

export default createChatService;

// Harness/model selection and native-session continuity for Storybench conversations
// (spec #11 "Selection and availability", "Switching and continuity"; decision #31).
//
// Persistence is behind a thin interface so the storage can be the v9 tables
// (conversation settings columns, conversation_segments, production_runs) without changing
// the rules here. createMemoryConversationPersistence() implements it for tests.
//
// Persistence interface:
//   getSettings(conversationId) -> { harness, model, effort, source, revision, updatedAt }
//   saveSettings(conversationId, { harness, model, effort }, { expectedRevision }) -> settings (source "explicit")
//   lastExplicitSettings() -> settings | null
//   initSettings(conversationId, settings) -> settings (for a new conversation)
//   activeSegment(conversationId) -> segment | null
//   listSegments(conversationId) -> segment[] (oldest first)
//   createSegment({ conversationId, harness, reason, previousSegmentId, firstMessageId, seedIncluded, seedOmitted }) -> segment
//   setSegmentSession(segmentId, nativeSessionId)
//   endSegment(segmentId)
//   createRun(run) / updateRun(id, patch) / listRuns(conversationId)
import { randomUUID } from "node:crypto";

export const HARNESS_LABELS = Object.freeze({ codex: "Codex", claude: "Claude Code" });
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._:\-[\]]{0,79}$/;
const EFFORT = /^[a-z]{2,12}$/;

export class SelectionError extends Error {
  constructor(code, message, statusCode = 400, extra = {}) { super(message); this.name = "SelectionError"; this.code = code; this.statusCode = statusCode; Object.assign(this, extra); }
}

// Validate a requested selection against the live catalogue (harness.models entries).
// Returns the normalized selection plus notes (e.g. an unlisted exact model ID).
export function validateSelection(catalog, { harness, model = null, effort = null }) {
  const entry = catalog.find((candidate) => candidate.harness === harness);
  if (!entry) throw new SelectionError("UNKNOWN_HARNESS", `Unsupported harness: ${String(harness)}`);
  if (!entry.available) throw new SelectionError("HARNESS_UNAVAILABLE", `${HARNESS_LABELS[harness]} is unavailable: ${entry.reason}`, 409);
  const notes = [];
  let listed = null;
  if (model != null) {
    if (typeof model !== "string" || !MODEL.test(model)) throw new SelectionError("INVALID_MODEL", "Model must be a plain model identifier");
    listed = entry.models.find((candidate) => candidate.id === model) ?? null;
    if (!listed) {
      if (!entry.exactModelIds) throw new SelectionError("UNKNOWN_MODEL", `${model} is not an available ${HARNESS_LABELS[harness]} model`);
      notes.push(`${model} is not in the ${HARNESS_LABELS[harness]} list; it will be verified when the next turn starts`);
    }
  }
  if (effort != null) {
    if (typeof effort !== "string" || !EFFORT.test(effort)) throw new SelectionError("INVALID_EFFORT", "Effort must be a level name");
    // Effort options come from the selected harness/model's own contract.
    const supported = listed ? listed.efforts : model == null ? defaultModelEfforts(entry) : harness === "claude" ? entry.efforts ?? [] : null;
    if (supported == null) throw new SelectionError("UNSUPPORTED_EFFORT", `Effort support for the unlisted model ${model} is unknown; leave effort at the native default`);
    if (!supported.includes(effort)) throw new SelectionError("UNSUPPORTED_EFFORT", `${effort} is not a supported effort for ${model ?? `the ${HARNESS_LABELS[harness]} default model`} (supported: ${supported.join(", ") || "none"})`);
  }
  return { harness, model, effort, notes, advisory: Boolean(entry.advisory && model) };
}

function defaultModelEfforts(entry) {
  const fallback = entry.models.find((model) => model.isDefault);
  return fallback ? fallback.efforts : entry.efforts ?? [];
}

const same = (a, b) => a.harness === b.harness && (a.model ?? null) === (b.model ?? null) && (a.effort ?? null) === (b.effort ?? null);

// Decide how the next turn runs: resume the active segment's exact native session, or open
// a new segment (first turn, a harness switch, or returning to an earlier harness). Native
// session IDs never cross harnesses.
export function planTurn(persistence, conversationId, { hasEarlierMessages = false, legacyThreadId = null, defaultModel = null } = {}) {
  const settings = persistence.getSettings(conversationId);
  // Host default / STORYBENCH_CODEX_MODEL seed only an unmigrated Codex conversation's model.
  const model = settings.model ?? (settings.source !== "explicit" && settings.harness === "codex" ? defaultModel : null);
  const selection = { harness: settings.harness, model, effort: settings.effort ?? null };
  const active = persistence.activeSegment(conversationId);
  // An active segment whose native session never started (e.g. a failed startup) starts it now,
  // seeded like any new segment.
  if (active && active.harness === settings.harness) return { selection, segment: active, resumeId: active.nativeSessionId ?? null, newSegment: null, seed: !active.nativeSessionId && hasEarlierMessages };
  if (!active && legacyThreadId && settings.harness === "codex" && !persistence.listSegments(conversationId).length)
    return { selection, segment: null, resumeId: legacyThreadId, newSegment: { reason: "migrated", previousSegmentId: null, adoptId: conversationId, nativeSessionId: legacyThreadId }, seed: false };
  const segments = persistence.listSegments(conversationId);
  const previous = active ?? segments.at(-1) ?? null;
  const reason = !previous ? "initial" : segments.some((segment) => segment.harness === settings.harness) ? "harness-return" : "harness-switch";
  return { selection, segment: null, resumeId: null, newSegment: { reason, previousSegmentId: previous?.id ?? null }, seed: hasEarlierMessages };
}

// Apply a settings change. Refused while the episode is busy; validated before commit;
// idempotent for a repeated client request; a harness change ends the active segment so the
// next turn opens a new one (a same-harness change resumes the exact session with new settings).
export function changeSettings(persistence, conversationId, requested, { catalog, busy = null, expectedRevision, clientRequestId = null, lastClientRequestId = null }) {
  if (busy) throw new SelectionError("BUSY", busy, 409);
  const current = persistence.getSettings(conversationId);
  if (clientRequestId && clientRequestId === lastClientRequestId) return { settings: current, changed: false, duplicate: true, notes: [] };
  if (!Number.isInteger(expectedRevision) || expectedRevision !== current.revision)
    throw new SelectionError("SETTINGS_CONFLICT", "These settings changed in another view; reopen them and choose again", 409, { current });
  const next = validateSelection(catalog, requested);
  if (same(next, current)) return { settings: current, changed: false, duplicate: false, notes: next.notes };
  const settings = persistence.saveSettings(conversationId, { harness: next.harness, model: next.model, effort: next.effort }, { expectedRevision });
  let endedSegment = null;
  if (current.harness !== next.harness) {
    const active = persistence.activeSegment(conversationId);
    if (active) { persistence.endSegment(active.id); endedSegment = active.id; }
  }
  return { settings, previous: current, changed: true, duplicate: false, notes: next.notes, advisory: next.advisory, harnessChanged: current.harness !== next.harness, endedSegment };
}

// Initial settings for a new conversation: the last explicit choice, else the defaults.
export function initialSettings(persistence, defaults = { harness: "codex", model: null, effort: null }) {
  const last = persistence.lastExplicitSettings();
  return last ? { harness: last.harness, model: last.model ?? null, effort: last.effort ?? null, source: "explicit-inherited" } : { ...defaults, source: "default" };
}

export function createMemoryConversationPersistence({ now = () => new Date().toISOString() } = {}) {
  const settings = new Map(), segments = [], runs = new Map();
  const get = (conversationId) => settings.get(conversationId) ?? { harness: "codex", model: null, effort: null, source: "migrated", revision: 1, updatedAt: null };
  return {
    getSettings: get,
    initSettings(conversationId, value) {
      const stored = { harness: value.harness, model: value.model ?? null, effort: value.effort ?? null, source: value.source === "explicit-inherited" ? "default" : value.source ?? "default", revision: 1, updatedAt: null, inheritedFrom: value.source === "explicit-inherited" ? "last-explicit" : null };
      settings.set(conversationId, stored);
      return stored;
    },
    saveSettings(conversationId, value, { expectedRevision }) {
      const current = get(conversationId);
      if (current.revision !== expectedRevision) throw new SelectionError("SETTINGS_CONFLICT", "Settings changed concurrently", 409);
      const stored = { ...value, source: "explicit", revision: current.revision + 1, updatedAt: now() };
      settings.set(conversationId, stored);
      return stored;
    },
    lastExplicitSettings() {
      return [...settings.values()].filter((value) => value.source === "explicit").sort((a, b) => String(a.updatedAt).localeCompare(String(b.updatedAt))).at(-1) ?? null;
    },
    activeSegment: (conversationId) => segments.filter((segment) => segment.conversationId === conversationId && !segment.endedAt).at(-1) ?? null,
    listSegments: (conversationId) => segments.filter((segment) => segment.conversationId === conversationId),
    createSegment({ conversationId, harness, reason, previousSegmentId = null, firstMessageId = null, seedIncluded = null, seedOmitted = null, id = null, nativeSessionId = null }) {
      for (const segment of segments) if (segment.conversationId === conversationId && !segment.endedAt) segment.endedAt = now();
      const segment = { id: id ?? `segment_${randomUUID()}`, conversationId, harness, nativeSessionId, reason, previousSegmentId, firstMessageId, seedIncluded, seedOmitted, createdAt: now(), endedAt: null };
      segments.push(segment);
      return segment;
    },
    setSegmentSession(segmentId, nativeSessionId) {
      const segment = segments.find((candidate) => candidate.id === segmentId);
      if (segments.some((candidate) => candidate !== segment && candidate.harness === segment.harness && candidate.nativeSessionId === nativeSessionId))
        throw new SelectionError("SESSION_REUSED", "A native session belongs to exactly one segment", 409);
      segment.nativeSessionId = nativeSessionId;
    },
    endSegment(segmentId) { const segment = segments.find((candidate) => candidate.id === segmentId); if (segment && !segment.endedAt) segment.endedAt = now(); },
    createRun(run) { runs.set(run.id, { ...run }); return runs.get(run.id); },
    updateRun(id, patch) { runs.set(id, { ...runs.get(id), ...patch }); return runs.get(id); },
    listRuns: (conversationId) => [...runs.values()].filter((run) => run.conversationId === conversationId),
  };
}

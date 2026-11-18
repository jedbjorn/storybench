// The chat drawer's Agents panel and token figures. Pure functions of the conversation
// projection, loaded by the browser and by Node tests.
import { phaseLabel, toolPhase } from './turn-phases.js';

// 312k, 1.2M; 950 stays 950.
export function formatTokens(value) {
  if (!Number.isFinite(value)) return '—';
  if (value < 1000) return String(Math.round(value));
  if (value < 1_000_000) return `${Math.round(value / 1000)}k`;
  return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
}

// "312k / 500k" against the compact trigger, or the size alone.
export function contextLabel(context) {
  if (!Number.isFinite(context?.tokens)) return '— tokens';
  return Number.isFinite(context.trigger) ? `${formatTokens(context.tokens)} / ${formatTokens(context.trigger)}` : `${formatTokens(context.tokens)} tokens`;
}

const working = (state) => ['queued', 'running', 'interrupting', 'compacting'].includes(state);

// Rows: the conversation's own agent, then the agents it delegated to in its latest turn.
// Each row is { id, name, model, tokens, startedAt, endedAt, state } with times in ms
// (server clock); `endedAt` null means still running.
export function agentRows(value) {
  if (!value) return [];
  const events = value.events ?? [], runs = value.runs ?? [];
  const run = runs.at(-1) ?? null, active = working(value.state);
  const main = {
    id: 'main', name: 'Assistant', state: value.state === 'compacting' ? 'compacting' : active ? 'working' : run ? run.state : 'idle',
    model: run?.modelResolved ?? run?.modelSelected ?? value.settings?.model ?? 'default model',
    tokens: value.context?.tokens ?? null, trigger: value.context?.trigger ?? null,
    startedAt: run ? Date.parse(run.startedAt) : null,
    endedAt: run && !(active && ['starting', 'running'].includes(run.state)) ? Date.parse(run.finishedAt ?? run.updatedAt) || null : null,
  };
  const turnStart = events.findLastIndex((event) => event.type === 'turn.started');
  const agents = new Map();
  for (const event of turnStart < 0 ? [] : events.slice(turnStart + 1)) {
    if (event.type !== 'agent.updated' || !event.payload?.id) continue;
    const at = Date.parse(event.createdAt), payload = event.payload;
    const row = agents.get(payload.id) ?? { id: payload.id, name: 'Subagent', model: null, tokens: null, activity: '', startedAt: at, endedAt: null, state: 'running', lastAt: at };
    if (payload.label) row.name = payload.label;
    if (payload.model) row.model = payload.model;
    if (Number.isFinite(payload.tokens)) row.tokens = payload.tokens;
    if (typeof payload.activity === 'string') row.activity = payload.activity;
    if (payload.state) row.state = payload.state;
    if (payload.state && payload.state !== 'running') row.endedAt = at;
    row.lastAt = at;
    agents.set(payload.id, row);
  }
  // A delegation the turn never reported finished ended when the turn did.
  // An agent whose model was never reported runs on the conversation's model (the default for both harnesses).
  const delegated = [...agents.values()].map(({ lastAt, ...row }) => ({ ...row, model: row.model ?? main.model,
    ...(row.state === 'running' && !active ? { state: 'ended', endedAt: main.endedAt ?? lastAt } : {}) }));
  return [main, ...delegated];
}

const ENDED = { completed: 'Done', failed: 'Failed', interrupted: 'Stopped', ended: 'Ended', idle: 'Idle' };

// A card's status line, worded like the turn status line: a running delegation shows the phase of
// the tool it is in (the same table), or Thinking between tools. `live` is the transcript's current
// label for the conversation's own agent while its turn runs.
export function agentStatus(row, { kind = 'video', live = null } = {}) {
  if (row.id === 'main') return row.state === 'compacting' ? phaseLabel('compacting') : row.state === 'working' ? live ?? phaseLabel('thinking') : ENDED[row.state] ?? ENDED.idle;
  if (row.state !== 'running') return ENDED[row.state] ?? ENDED.ended;
  return row.activity ? phaseLabel(toolPhase(row.activity), kind) : phaseLabel('thinking');
}

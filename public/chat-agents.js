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

const JOB_LIVE = ['queued', 'running'];
// The conversation's agent jobs (spec #42), which outlive the turn that started them: the
// projection's rows (running first, then ended newest first) with the tokens and tool activity
// their workers reported in `agent_job.updated` events, up to 20.
function jobRows(value) {
  const seen = new Map();
  for (const event of value.events ?? []) {
    if (event.type !== 'agent_job.updated' || !event.payload?.id) continue;
    const payload = event.payload, row = seen.get(payload.id) ?? {};
    if (Number.isFinite(payload.tokens)) row.tokens = payload.tokens;
    if (typeof payload.activity === 'string') row.activity = payload.activity;
    seen.set(payload.id, row);
  }
  const jobs = value.agentJobs ?? [], ended = (job) => Date.parse(job.endedAt) || 0;
  // Ended jobs newest ending first; the projection's order breaks ties (sort is stable).
  const done = jobs.filter((job) => !JOB_LIVE.includes(job.state)).sort((a, b) => ended(b) - ended(a));
  return [...jobs.filter((job) => JOB_LIVE.includes(job.state)), ...done].slice(0, 20).map((job) => {
    const reported = seen.get(job.id) ?? {}, live = JOB_LIVE.includes(job.state);
    return { id: `job:${job.id}`, job: true, name: job.label || 'Agent job', harness: job.harness ?? null, model: job.model ?? 'default model',
      tokens: reported.tokens ?? null, activity: live ? reported.activity ?? '' : '', state: job.state,
      startedAt: Date.parse(job.startedAt ?? job.createdAt) || null, endedAt: live ? null : Date.parse(job.endedAt) || null };
  });
}

// Rows: the conversation's own agent, the agents it delegated to in its latest turn, then its
// agent jobs. Each row is { id, name, model, tokens, startedAt, endedAt, state } with times in
// ms (server clock); `endedAt` null means still running. Job rows add `job` and `harness`.
export function agentRows(value) {
  if (!value) return [];
  const events = value.events ?? [], runs = value.runs ?? [];
  const run = runs.at(-1) ?? null, active = working(value.state);
  const jobs = jobRows(value), waiting = jobs.filter((row) => JOB_LIVE.includes(row.state)).length;
  const main = {
    id: 'main', name: 'Assistant', state: value.state === 'compacting' ? 'compacting' : active ? 'working' : waiting ? 'waiting' : run ? run.state : 'idle', waiting,
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
  return [main, ...delegated, ...jobs];
}

const ENDED = { completed: 'Done', failed: 'Failed', interrupted: 'Stopped', ended: 'Ended', idle: 'Idle' };
// A job's `interrupted` is an unknown outcome after a restart, not a Stop (spec #42 'Ledger').
const JOB_ENDED = { completed: 'Done', failed: 'Failed', timed_out: 'Timed out', cancelled: 'Stopped', interrupted: 'Interrupted' };

// "Waiting for agents (2)": the conversation's agent between turns while its jobs run.
export const waitingLabel = (count) => `Waiting for agents (${count})`;

// A card's status line, worded like the turn status line: a running delegation or job shows the
// phase of the tool it is in (the same table), or Thinking between tools. `live` is the
// transcript's current label for the conversation's own agent while its turn runs.
export function agentStatus(row, { kind = 'video', live = null } = {}) {
  if (row.id === 'main') return row.state === 'compacting' ? phaseLabel('compacting') : row.state === 'working' ? live ?? phaseLabel('thinking')
    : row.state === 'waiting' ? waitingLabel(row.waiting) : ENDED[row.state] ?? ENDED.idle;
  if (row.job && row.state === 'queued') return phaseLabel('waiting');
  if (row.job && row.state !== 'running') return JOB_ENDED[row.state] ?? row.state;
  if (row.state !== 'running') return ENDED[row.state] ?? ENDED.ended;
  const phase = row.activity ? phaseLabel(toolPhase(row.activity), kind) : phaseLabel('thinking');
  return row.job ? `Running · ${phase}` : phase;
}

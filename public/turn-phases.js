// Tool-to-phase table for the live turn status line (spec #40, Phases). One module, loaded by
// the browser and by Node, so the chat projection and the selection rule read the same rows.
// A stored tool name maps after removing a `mcp__storybench__` or `storybench_` prefix;
// matching ignores case, which covers native names across harnesses (Read / read). A name
// with no row — a renamed native tool, or a new app tool not yet listed — is Working.
const PHASE_TOOLS = {
  research: [
    'read_reference_excerpt', 'search_project', 'read_research', 'save_research', 'get_context', 'get_capabilities',
    'search_video_moments', 'get_video_moment',
    'read_conversation_history', 'get_operation_guide', 'read_deck', 'list_graphic_recipes', 'get_graphic_recipe', 'list_branding',
    'Read', 'Grep', 'Glob', 'LS', 'WebSearch', 'WebFetch', 'web_search', 'webfetch', 'read', 'grep', 'glob', 'list',
  ],
  assets: [
    'register_work_file', 'reuse_project_item', 'create_graphic_recipe', 'update_graphic_recipe', 'render_graphic', 'apply_branding', 'promote_card',
    'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'apply_patch', 'write', 'edit', 'patch',
  ],
  build: [
    'update_story', 'update_cards', 'save_deck', 'build_deck', 'create_draft', 'declare_final_request', 'create_final',
    'move_final_to_drafts', 'get_job', 'await_job', 'cancel_job',
  ],
  check: [
    'open_deck_qa', 'inspect_deck_qa', 'act_deck_qa', 'check_deck_qa', 'report_deck_qa', 'get_deck_qa_report', 'close_deck_qa',
    'inspect_image', 'inspect_contact_sheet', 'inspect_media', 'validate_render',
  ],
  delegate: ['subagent', 'Task', 'Agent', 'task', 'start_agent_job', 'get_agent_job', 'list_agent_jobs', 'await_agent_job', 'continue_agent_job', 'cancel_agent_job', 'watch_job'],
  report: ['find_upstream_issues', 'prepare_upstream_report', 'read_upstream_issue'],
};

export const PHASE_LABELS = Object.freeze({
  research: 'Researching',
  assets: 'Creating assets',
  build: Object.freeze({ deck: 'Building the deck', video: 'Building the video' }),
  check: 'Checking my work',
  delegate: 'Delegating',
  report: 'Preparing a report',
  other: 'Working',
  // Labels with no tools: the turn's own state.
  thinking: 'Thinking',
  waiting: 'Waiting to start',
  stopping: 'Stopping',
  compacting: 'Compacting context',
});

// Spec #40 Selection rule. The FnB tunes these by feel at Alpha; they live only here.
export const STATUS_TIMING = Object.freeze({ windowMs: 10_000, thinkingMs: 8_000, dwellMs: 4_000 });

const TABLE = new Map(Object.entries(PHASE_TOOLS).flatMap(([phase, names]) => names.map((name) => [name.toLowerCase(), phase])));
const toolKey = (name) => String(name ?? '').replace(/^mcp__storybench__|^storybench_/, '').toLowerCase();

export function toolPhase(name) {
  return TABLE.get(toolKey(name)) ?? 'other';
}

export function phaseLabel(phase, kind = 'video') {
  const label = PHASE_LABELS[phase] ?? PHASE_LABELS.other;
  return typeof label === 'string' ? label : label[kind] ?? label.video;
}

// The current turn's tool starts and the calls still in flight, from the conversation's event log.
// A completion closes the oldest open start of the same tool (the payload carries no call id). The
// bridge's `tool.called` and the harness's `tool.started` report one call twice, in either order,
// so each pairs with one unpaired report of the other kind and counts once.
export function turnActivity(events) {
  const turnStart = events.findLastIndex((event) => event.type === 'turn.started');
  const starts = [], open = new Map(), called = new Map(), started = new Map();
  const list = (map, key) => map.get(key) ?? map.set(key, []).get(key);
  for (const event of events.slice(turnStart + 1)) {
    if (!['tool.started', 'tool.called', 'tool.completed'].includes(event.type)) continue;
    const key = toolKey(event.payload?.name), at = Date.parse(event.createdAt);
    if (event.type === 'tool.completed') { list(open, key).shift(); continue; }
    if (event.type === 'tool.called') {
      if (list(started, key).shift()) continue;
      const entry = { phase: toolPhase(key), at };
      starts.push(entry); list(called, key).push(entry);
      continue;
    }
    // tool.started: in flight until completed; a bridge report that came first already counted the start.
    const prior = list(called, key).shift(), entry = prior ?? { phase: toolPhase(key), at };
    if (!prior) { starts.push(entry); list(started, key).push(entry); }
    list(open, key).push(entry);
  }
  return { starts, inFlight: [...open.values()].flat().sort((a, b) => a.at - b.at) };
}

// The phase to show now. `shown` is the previous result (null at first); `now` is server time in ms.
// Returns { phase, label, since, turn }, where `since` is when `phase` first showed.
export function selectStatus({ events = [], state, now, kind, shown = null }) {
  const turn = events.findLast((event) => event.type === 'turn.started')?.sequence ?? null;
  const show = (phase, helpers = 0) => {
    const label = helpers >= 2 ? `${phaseLabel(phase, kind)} · ${helpers} helpers` : phaseLabel(phase, kind);
    const since = shown?.phase === phase && shown.turn === turn ? shown.since : now;
    return { phase, label, since, turn };
  };
  if (state === 'queued') return show('waiting');
  if (state === 'interrupting') return show('stopping');
  if (state === 'compacting') return show('compacting');
  const { windowMs, thinkingMs, dwellMs } = STATUS_TIMING;
  const { starts, inFlight } = turnActivity(events);
  const recent = starts.filter((entry) => now - entry.at <= windowMs);
  const helpers = inFlight.filter((entry) => entry.phase === 'delegate').length;
  let candidate;
  if (inFlight.length) candidate = inFlight.at(-1).phase;
  else if (!recent.some((entry) => now - entry.at <= thinkingMs)) candidate = 'thinking';
  else {
    // Most starts in the window; a tie goes to the phase started most recently.
    const tally = new Map();
    for (const { phase, at } of recent) tally.set(phase, { count: (tally.get(phase)?.count ?? 0) + 1, last: at });
    candidate = [...tally].sort(([, a], [, b]) => b.count - a.count || b.last - a.last)[0][0];
  }
  // Never false: a tool phase stays only while one of its tools is in flight or in the window.
  const untoolled = ['thinking', 'other', 'waiting', 'stopping'];
  const supported = (phase) => untoolled.includes(phase) || [...inFlight, ...recent].some((entry) => entry.phase === phase);
  const holds = shown && shown.turn === turn && !['waiting', 'stopping', 'compacting'].includes(shown.phase)
    && now - shown.since < dwellMs && supported(shown.phase);
  const phase = holds ? shown.phase : candidate;
  return show(phase, phase === 'delegate' ? helpers : 0);
}

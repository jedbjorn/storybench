// Tool-to-phase table for the live turn status line (spec #40, Phases). One module, loaded by
// the browser and by Node, so the chat projection and the selection rule read the same rows.
// A stored tool name maps after removing a `mcp__storybench__` or `storybench_` prefix;
// matching ignores case, which covers native names across harnesses (Read / read). A name
// with no row — a renamed native tool, or a new app tool not yet listed — is Working.
const PHASE_TOOLS = {
  research: [
    'read_reference_excerpt', 'search_project', 'read_research', 'save_research', 'get_context', 'get_capabilities',
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
  delegate: ['subagent', 'Task', 'Agent', 'task'],
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
});

const TABLE = new Map(Object.entries(PHASE_TOOLS).flatMap(([phase, names]) => names.map((name) => [name.toLowerCase(), phase])));

export function toolPhase(name) {
  const bare = String(name ?? '').replace(/^mcp__storybench__|^storybench_/, '').toLowerCase();
  return TABLE.get(bare) ?? 'other';
}

export function phaseLabel(phase, kind = 'video') {
  const label = PHASE_LABELS[phase] ?? PHASE_LABELS.other;
  return typeof label === 'string' ? label : label[kind] ?? label.video;
}

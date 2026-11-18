// Spec #40 E1: the tool-to-phase table is complete and correct.
import test from "node:test";
import assert from "node:assert/strict";
import { SHARED_TOOLS, KIND_REGISTRY } from "../src/runtime/kinds.js";
import { DECK_QA_DEFINITIONS } from "../src/deck-qa-tools.js";
import { toolPhase, phaseLabel } from "../public/turn-phases.js";

// The spec's table, row by row: phase -> app tools.
const APP = {
  research: ["read_reference_excerpt", "search_project", "read_research", "save_research", "get_context", "get_capabilities",
    "read_conversation_history", "get_operation_guide", "read_deck", "list_graphic_recipes", "get_graphic_recipe", "list_branding"],
  assets: ["register_work_file", "reuse_project_item", "create_graphic_recipe", "update_graphic_recipe", "render_graphic", "apply_branding", "promote_card"],
  build: ["update_story", "update_cards", "save_deck", "build_deck", "create_draft", "declare_final_request", "create_final",
    "move_final_to_drafts", "get_job", "await_job", "cancel_job"],
  check: ["open_deck_qa", "inspect_deck_qa", "act_deck_qa", "check_deck_qa", "report_deck_qa", "get_deck_qa_report", "close_deck_qa",
    "inspect_image", "inspect_contact_sheet", "inspect_media", "validate_render"],
  report: ["find_upstream_issues", "prepare_upstream_report", "read_upstream_issue"],
  // Spec #42 'Parent tools': agent jobs and watches are delegation.
  delegate: ["start_agent_job", "get_agent_job", "list_agent_jobs", "await_agent_job", "continue_agent_job", "cancel_agent_job", "watch_job"],
};

// Native names as each harness stores them (Claude Code after its MCP prefix is removed;
// Codex native items and subagent entries; OpenCode's lower-case built-ins).
const NATIVE = {
  "Claude Code": { Read: "research", Grep: "research", Glob: "research", LS: "research", WebSearch: "research", WebFetch: "research",
    Write: "assets", Edit: "assets", MultiEdit: "assets", NotebookEdit: "assets", Task: "delegate", Agent: "delegate", Bash: "other", TodoWrite: "other" },
  Codex: { shell: "other", apply_patch: "assets", web_search: "research", subagent: "delegate" },
  OpenCode: { read: "research", grep: "research", glob: "research", list: "research", webfetch: "research",
    write: "assets", edit: "assets", patch: "assets", task: "delegate", bash: "other", todowrite: "other" },
};

test("E1: every registered app tool has a row, and maps to its phase bare and prefixed", () => {
  const registered = new Set([...SHARED_TOOLS, ...Object.values(KIND_REGISTRY).flatMap((entry) => entry.tools), ...DECK_QA_DEFINITIONS.map(({ name }) => name)]);
  const expected = new Map(Object.entries(APP).flatMap(([phase, names]) => names.map((name) => [name, phase])));
  // A registered app tool with no row in the spec's table fails here, so the table stays complete.
  assert.deepEqual([...registered].filter((name) => !expected.has(name)), [], "registered app tools missing from the phase table");
  for (const [name, phase] of expected) {
    for (const stored of [name, `storybench_${name}`, `mcp__storybench__${name}`]) assert.equal(toolPhase(stored), phase, stored);
  }
});

test("E1: native names map as listed for Claude Code, Codex and OpenCode, ignoring case", () => {
  for (const [harness, names] of Object.entries(NATIVE)) {
    for (const [name, phase] of Object.entries(names)) {
      assert.equal(toolPhase(name), phase, `${harness} ${name}`);
      assert.equal(toolPhase(name.toUpperCase()), phase, `${harness} ${name.toUpperCase()}`);
      assert.equal(toolPhase(name.toLowerCase()), phase, `${harness} ${name.toLowerCase()}`);
    }
  }
});

test("E1: an unknown or missing name is Working", () => {
  for (const name of ["frobnicate", "storybench_frobnicate", "mcp__storybench__frobnicate", "mcp__other__read_deck", "", undefined, null])
    assert.equal(toolPhase(name), "other", String(name));
  assert.equal(phaseLabel(toolPhase("frobnicate")), "Working");
});

test("E1: labels follow the table, with the build label by production kind", () => {
  assert.deepEqual(["research", "assets", "check", "delegate", "report", "other"].map((phase) => phaseLabel(phase)),
    ["Researching", "Creating assets", "Checking my work", "Delegating", "Preparing a report", "Working"]);
  assert.equal(phaseLabel("build", "deck"), "Building the deck");
  assert.equal(phaseLabel("build", "video"), "Building the video");
  assert.equal(phaseLabel("build"), "Building the video", "a production without a kind is a video");
});

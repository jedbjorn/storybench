// Spec #40 E3: the selection rule is stable and never false, over scripted event sequences.
import test from "node:test";
import assert from "node:assert/strict";
import { selectStatus, toolPhase, STATUS_TIMING } from "../public/turn-phases.js";

const BASE = Date.parse("2026-11-18T10:00:00.000Z");
const at = (seconds) => new Date(BASE + seconds * 1000).toISOString();

// A scripted turn: events stamped in seconds from the turn start, sequenced in time order.
function script(entries) {
  return [["turn.started", 0], ...entries]
    .map(([type, seconds, name]) => ({ type, seconds, ...(name ? { payload: { name } } : { payload: {} }) }))
    .sort((a, b) => a.seconds - b.seconds)
    .map(({ seconds, ...event }, index) => ({ ...event, sequence: index + 1, createdAt: at(seconds) }));
}
// One call: started at `from`, completed at `to` (omit `to` for a call still running).
const call = (name, from, to) => [["tool.started", from, name], ...(to === undefined ? [] : [["tool.completed", to, name]])];

// Sample the rule every 250 ms the way the display does, carrying the shown phase forward.
function run(events, { until, kind = "video", state = "running", step = 0.25 } = {}) {
  const samples = [];
  let shown = null;
  for (let seconds = 0; seconds <= until + 1e-9; seconds += step) {
    const now = BASE + Math.round(seconds * 1000);
    shown = selectStatus({ events: events.filter((event) => Date.parse(event.createdAt) <= now), state, now, kind, shown });
    samples.push({ seconds: Math.round(seconds * 1000) / 1000, ...shown });
  }
  return samples;
}
const runs = (samples) => samples.reduce((list, sample) => (list.at(-1)?.label === sample.label ? list : [...list, sample]), []);

test("E3 timing constants live in one place", () => {
  assert.deepEqual({ ...STATUS_TIMING }, { windowMs: 10_000, thinkingMs: 8_000, dwellMs: 4_000 });
});

test("E3 (a): a burst of QA calls after research waits out the dwell and does not flicker", () => {
  // Research from the first moment, then 20 QA calls within 3 s, each brief.
  const qa = Array.from({ length: 20 }, (_, i) => call(i % 2 ? "storybench_inspect_image" : "check_deck_qa", 1.5 + i * 0.15, 1.55 + i * 0.15)).flat();
  const events = script([...call("read_research", 0, 1), ...call("mcp__storybench__search_project", 1, 1.4), ...qa]);
  const samples = run(events, { until: 20, kind: "deck" });
  const changes = runs(samples);
  assert.deepEqual(changes.map(({ label }) => label), ["Researching", "Checking my work", "Thinking"]);
  assert.equal(changes[0].seconds, 0, "the first phase of the turn shows at once");
  assert.ok(changes[1].seconds >= STATUS_TIMING.dwellMs / 1000, `Checking waited for Researching's dwell (${changes[1].seconds} s)`);
  assert.equal(changes[1].seconds, 4, "and shows as soon as the dwell ends");
});

test("E3 (b): one long build shows Building throughout", () => {
  const samples = run(script(call("build_deck", 0, 60)), { until: 59.75, kind: "deck" });
  assert.deepEqual([...new Set(samples.map(({ label }) => label))], ["Building the deck"]);
  assert.deepEqual([...new Set(run(script(call("create_draft", 0, 60)), { until: 59.75 }).map(({ label }) => label))], ["Building the video"]);
});

test("E3 (c): 8 s with no tool is Thinking", () => {
  assert.equal(run(script([]), { until: 0 })[0].label, "Thinking", "a turn with no tool yet thinks");
  const samples = run(script(call("read_deck", 0, 0.5)), { until: 12 });
  const label = (seconds) => samples.find((sample) => sample.seconds === seconds).label;
  assert.equal(label(8), "Researching", "under 8 s since the last start");
  assert.equal(label(8.25), "Thinking", "8 s after the last start, past the dwell");
  assert.equal(label(12), "Thinking");
});

test("E3 (d): a tie in the window goes to the phase started most recently", () => {
  const events = script([...call("read_deck", 1, 1.2), ...call("register_work_file", 2, 2.2)]);
  assert.equal(selectStatus({ events, state: "running", now: BASE + 3000 }).label, "Creating assets");
  const reversed = script([...call("register_work_file", 1, 1.2), ...call("read_deck", 2, 2.2)]);
  assert.equal(selectStatus({ events: reversed, state: "running", now: BASE + 3000 }).label, "Researching");
  // Most starts beats recency.
  const more = script([...call("register_work_file", 1, 1.1), ...call("apply_branding", 1.5, 1.6), ...call("read_deck", 2, 2.2)]);
  assert.equal(selectStatus({ events: more, state: "running", now: BASE + 3000 }).label, "Creating assets");
});

test("E3 (d): the bridge's tool.called and the harness's tool.started are one call, in either order", () => {
  // Two asset calls, then one research call reported twice: assets still has the most starts.
  for (const order of [[["tool.called", 2, "read_deck"], ["tool.started", 2.05, "read_deck"]], [["tool.started", 2, "read_deck"], ["tool.called", 2.05, "read_deck"]]]) {
    const events = script([...call("register_work_file", 1, 1.1), ...call("render_graphic", 1.5, 1.6), ...order, ["tool.completed", 2.1, "read_deck"]]);
    assert.equal(selectStatus({ events, state: "running", now: BASE + 3000 }).label, "Creating assets", order[0][0]);
  }
  // A bridge report alone (OpenCode reports its start only at completion) still counts as a start.
  const bridged = script([["tool.called", 1, "inspect_media"]]);
  assert.equal(selectStatus({ events: bridged, state: "running", now: BASE + 2000 }).label, "Checking my work");
});

test("E3 (e): two delegations in flight read Delegating · 2 helpers", () => {
  const one = script(call("subagent", 0));
  assert.equal(selectStatus({ events: one, state: "running", now: BASE + 1000 }).label, "Delegating");
  const two = script([...call("subagent", 0), ...call("subagent", 0.5)]);
  assert.equal(selectStatus({ events: two, state: "running", now: BASE + 1000 }).label, "Delegating · 2 helpers");
  const three = script([...call("Task", 0), ...call("Agent", 0.2), ...call("task", 0.4)]);
  assert.equal(selectStatus({ events: three, state: "running", now: BASE + 1000 }).label, "Delegating · 3 helpers");
  const finished = script([...call("subagent", 0, 3), ...call("subagent", 0.5)]);
  assert.equal(selectStatus({ events: finished, state: "running", now: BASE + 4000 }).label, "Delegating", "one helper left");
});

test("E3: Waiting to start and Stopping show at once, without dwell; a new turn starts fresh", () => {
  const events = script(call("read_deck", 0));
  const shown = selectStatus({ events, state: "running", now: BASE + 500 });
  assert.equal(shown.label, "Researching");
  assert.equal(selectStatus({ events, state: "interrupting", now: BASE + 600, shown }).label, "Stopping");
  assert.equal(selectStatus({ events, state: "queued", now: BASE + 600, shown }).label, "Waiting to start");
  // The next turn begins with its own first phase, whatever the last turn showed.
  const next = [...events, { type: "turn.started", sequence: 9, payload: {}, createdAt: at(1) }, { type: "tool.started", sequence: 10, payload: { name: "build_deck" }, createdAt: at(1) }];
  assert.equal(selectStatus({ events: next, state: "running", now: BASE + 1100, shown }).label, "Building the video");
});

// (f): independent of the rule's own bookkeeping, a shown tool phase must have a tool of that
// phase that started within the window, or that has more starts than completions so far.
function supported(events, now, phase) {
  const seen = events.filter((event) => Date.parse(event.createdAt) <= now && event.payload?.name && toolPhase(event.payload.name) === phase);
  const started = seen.filter((event) => event.type !== "tool.completed");
  if (started.some((event) => now - Date.parse(event.createdAt) <= STATUS_TIMING.windowMs)) return true;
  const count = (type, name) => seen.filter((event) => event.type === type && event.payload.name === name).length;
  return started.some(({ payload: { name } }) => count("tool.started", name) > count("tool.completed", name));
}

test("E3 (f): at no step is a tool phase shown without a matching tool in flight or in the window", () => {
  let seed = 7;
  const random = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const names = ["read_deck", "Read", "register_work_file", "apply_patch", "build_deck", "check_deck_qa", "inspect_image", "subagent", "find_upstream_issues", "Bash", "TodoWrite"];
  const tool = new Set(["research", "assets", "build", "check", "delegate", "report"]);
  for (let round = 0; round < 25; round++) {
    const entries = [];
    let clock = 0;
    for (let i = 0; i < 40; i++) {
      clock += random() < 0.15 ? 6 + random() * 10 : random() * 2;
      const name = names[Math.floor(random() * names.length)], length = random() < 0.2 ? 5 + random() * 30 : random() * 2;
      entries.push(...call(name, clock, clock + length));
      if (random() < 0.5) entries.push(["tool.called", clock + 0.01, name]);
    }
    const events = script(entries);
    for (const sample of run(events, { until: clock + 45, step: 0.5 })) {
      if (!tool.has(sample.phase)) continue;
      assert.ok(supported(events, BASE + sample.seconds * 1000, sample.phase), `round ${round} at ${sample.seconds} s showed ${sample.label}`);
    }
  }
});

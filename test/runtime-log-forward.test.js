import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { capLine, followContainerLogs, workerDiagnostic } from "../src/runtime/log-forward.js";

function fakeSpawn() {
  const calls = [];
  const spawn = (command, args) => {
    const child = new EventEmitter();
    child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.exitCode = null;
    child.kill = (signal) => { child.killed = signal; child.exitCode = 0; child.stdout.end(); child.stderr.end(); };
    calls.push({ command, args, child });
    return child;
  };
  return { spawn, calls };
}
const flush = () => new Promise((resolve) => setImmediate(resolve));

test("app output is followed with an argv array, capped per line and rate-limited with a dropped counter", async () => {
  const { spawn, calls } = fakeSpawn();
  const logged = [];
  let clock = 0;
  const follower = followContainerLogs({ containerId: "abc123", event: "app.output", log: (entry) => logged.push(entry), maxLineBytes: 16, maxLinesPerWindow: 3, windowMs: 1000, spawn, now: () => clock });
  assert.deepEqual([calls[0].command, calls[0].args], ["docker", ["logs", "--follow", "abc123"]]);
  calls[0].child.stderr.write("x".repeat(40) + "\n");
  for (let i = 0; i < 5; i++) calls[0].child.stdout.write(`line ${i}\n`);
  await flush();
  assert.equal(logged.length, 3);
  assert.equal(logged[0].truncated, true);
  assert.ok(Buffer.byteLength(logged[0].line) <= 16 + 3);
  assert.equal(logged[0].stream, "stderr");
  clock = 1500;
  calls[0].child.stdout.write("after window\n");
  await flush();
  assert.deepEqual(logged.find((entry) => entry.event === "app.output.dropped"), { event: "app.output.dropped", dropped: 3, level: "warn" });
  assert.equal(logged.at(-1).line, "after window");
  follower.stop();
  assert.equal(calls[0].child.killed, "SIGTERM");
});

test("worker forwarding keeps only the launcher's structured diagnostics, never harness or model text", async () => {
  assert.deepEqual(workerDiagnostic('{"event":"harness.started","harness":"codex","pid":12}'), { event: "harness.started", harness: "codex", pid: 12 });
  assert.equal(workerDiagnostic('{"event":"harness.started","prompt":"secret"}').prompt, undefined);
  assert.equal(workerDiagnostic("Thinking about the user's story…"), null);
  assert.equal(workerDiagnostic('{"type":"assistant","message":"model text"}'), null);
  assert.equal(workerDiagnostic('{"event":"codex.trace","text":"prompt"}'), null);
  const { spawn, calls } = fakeSpawn();
  const logged = [];
  const follower = followContainerLogs({ containerId: "w1", event: "worker.output", fields: { requestId: "r1" }, log: (entry) => logged.push(entry), filter: workerDiagnostic, spawn });
  calls[0].child.stderr.write('{"event":"worker.ready","harness":"claude","uid":0}\nmodel says hello\n{"event":"harness.exited","code":0,"signal":null}\n');
  await flush();
  assert.deepEqual(logged.map((entry) => entry.event), ["worker.output", "worker.output"]);
  assert.equal(logged[0].requestId, "r1");
  assert.ok(!JSON.stringify(logged).includes("model says hello"));
  follower.stop();
});

test("line capping respects multibyte characters", () => {
  assert.equal(capLine("short").truncated, false);
  const { text, truncated } = capLine("é".repeat(10), 5);
  assert.equal(truncated, true);
  assert.ok(!text.includes("�"));
});

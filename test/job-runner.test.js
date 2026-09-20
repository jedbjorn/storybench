import test from "node:test";
import assert from "node:assert/strict";
import { HeavyJobQueue } from "../src/job-runner.js";

test("heavy worker runs one job at a time and continues after rejection", async () => {
  const queue = new HeavyJobQueue();
  const events = [];
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const first = queue.enqueue("first", async () => { events.push("first:start"); await gate; events.push("first:end"); });
  const failed = queue.enqueue("failed", async () => { events.push("failed:start"); throw new Error("boom"); }, undefined,
    (error) => events.push(`failed:${error.message}`));
  const last = queue.enqueue("last", async () => { events.push("last:start"); });
  await Promise.resolve();
  assert.deepEqual(events, ["first:start"]);
  release();
  await Promise.all([first, failed, last]);
  assert.deepEqual(events, ["first:start", "first:end", "failed:start", "failed:boom", "last:start"]);
  await queue.close();
});

test("heavy worker cancels queued and active jobs honestly", async () => {
  const queue = new HeavyJobQueue();
  const events = [];
  const active = queue.enqueue("active", async (signal) => new Promise((resolve) => signal.addEventListener("abort", () => {
    events.push(signal.reason.message); resolve();
  }, { once: true })));
  const queued = queue.enqueue("queued", async () => events.push("should not run"), (reason) => events.push(reason));
  await Promise.resolve();
  assert.equal(queue.cancel("queued", "queued cancelled"), "queued");
  assert.equal(queue.cancel("active", "active cancelled"), "active");
  await Promise.all([active, queued]);
  assert.deepEqual(events, ["queued cancelled", "active cancelled"]);
  await queue.close();
});

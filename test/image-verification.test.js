import test from "node:test";
import assert from "node:assert/strict";
import { probeTools, runChecked } from "../src/runtime/image-check.js";
import { checkImage, REQUIRED_TOOLS } from "../src/runtime/image-verification.js";

const result = (stdout = "version 1") => ({ status: 0, stdout, stderr: "" });
const fakeRunner = (name, args) => {
  if (name === "node") return result("v24.21.0");
  if (name === "codex") return result("codex-cli 0.155.1");
  if (name === "claude") return result("2.1.278 (Claude Code)");
  if (name === "fc-match") return result(args.at(-1));
  return result();
};

test("required tool probe identifies absent and broken media tools", () => {
  assert.deepEqual(Object.keys(probeTools("app", fakeRunner)), REQUIRED_TOOLS.app);
  const worker = probeTools("worker", fakeRunner);
  assert.deepEqual(Object.keys(worker), REQUIRED_TOOLS.worker);
  assert.deepEqual([worker.codex, worker.claude], ["0.155.1", "2.1.278"], "capability proof compares normalized harness versions");
  assert.throws(() => probeTools("app", (name, args) => name === "ffprobe" ? { status: 127, stdout: "", stderr: "missing" } : fakeRunner(name, args)), /ffprobe: missing/);
  assert.throws(() => probeTools("app", (name, args) => name === "python3" && args[0] === "-c" ? { status: 1, stdout: "", stderr: "No module named PIL" } : fakeRunner(name, args)), /python3: No module named PIL/);
  assert.throws(() => probeTools("app", (name, args) => name === "resvg" ? result("") : fakeRunner(name, args)), /resvg: empty version output/);
  assert.throws(() => probeTools("app", (name, args) => name === "fc-match" ? result("Other Sans") : fakeRunner(name, args)), /font DejaVu Sans/);
  assert.throws(() => runChecked("ffmpeg", ["-version"], () => ({ status: null, error: new Error("ENOENT"), stdout: "", stderr: "" })), /ffmpeg: ENOENT/);
});

test("image evidence fails closed on missing tools, failed commands and incomplete smoke", async () => {
  const good = Object.fromEntries(REQUIRED_TOOLS.worker.map((name) => [name, name === "node" ? "v24.21.0" : name === "codex" ? "0.155.1" : name === "claude" ? "2.1.278" : "version 1"]));
  const run = async () => ({ code: 0, stdout: JSON.stringify(good), stderr: "" });
  assert.deepEqual(await checkImage(run, "sha256:worker", "worker"), good);
  await assert.rejects(checkImage(async () => ({ code: 127, stderr: "ffmpeg: not found" }), "sha256:worker", "worker"), /ffmpeg: not found/);
  await assert.rejects(checkImage(async () => ({ code: 0, stdout: JSON.stringify({ ...good, pillow: "" }) }), "sha256:worker", "worker"), /missing pillow evidence/);
  await assert.rejects(checkImage(async () => ({ code: 0, stdout: JSON.stringify({ pillowPng: true }) }), "sha256:worker", "worker", "smoke"), /missing svgPng evidence/);
});

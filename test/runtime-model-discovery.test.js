import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createModelDiscovery, parseClaudeHelp, parseCodexModelList } from "../src/runtime/model-discovery.js";
import { validateControlRequest } from "../src/runtime/validate.js";

test("codex model/list results become picker entries with per-model efforts; hidden models are omitted", () => {
  const models = parseCodexModelList({ data: [
    { id: "gpt-6-astra", model: "gpt-6-astra", displayName: "GPT-6-Astra", isDefault: true, defaultReasoningEffort: "medium", supportedReasoningEfforts: [{ reasoningEffort: "low", description: "" }, { reasoningEffort: "high", description: "" }] },
    { id: "codex-auto-review", model: "codex-auto-review", hidden: true, supportedReasoningEfforts: [] },
    { id: "gpt-5.5", model: "gpt-5.5", displayName: "GPT-5.5", supportedReasoningEfforts: ["low"] },
  ] });
  assert.deepEqual(models.map((model) => model.id), ["gpt-6-astra", "gpt-5.5"]);
  assert.deepEqual(models[0].efforts, ["low", "high"]);
  assert.equal(models[0].defaultEffort, "medium");
  assert.deepEqual(models[1].efforts, ["low"]);
});

test("claude aliases and effort levels come from the installed CLI help", () => {
  const help = `Options:
  --effort <level>                      Effort level for the current session
                                        (low, medium, high, xhigh, max)
  --model <model>                       Model for the current session. Provide
                                        an alias for the latest model (e.g.
                                        'sonnet' or 'opus') or a model's full
                                        name (e.g. 'claude-sonnet-5').
  --print                               Print`;
  assert.deepEqual(parseClaudeHelp(help), { aliases: ["sonnet", "opus", "claude-sonnet-5"], efforts: ["low", "medium", "high", "xhigh", "max"] });
});

test("discovery reports an unavailable harness with a plain reason and no models (temp fixtures only)", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "sb-disc-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(path.join(dir, "codex.json"), "{broken");
  const spawn = () => { throw new Error("must not run discovery without a usable login"); };
  const discovery = createModelDiscovery({ config: { installId: "t", images: { worker: "sha256:x" }, credentials: { codex: path.join(dir, "codex.json"), claude: path.join(dir, "none.json") } }, stageRoot: dir, spawn });
  const codex = await discovery.discover("codex");
  assert.equal(codex.available, false);
  assert.match(codex.reason, /not valid JSON/);
  assert.deepEqual(codex.models, []);
  assert.match((await discovery.discover("claude")).reason, /No claude login/);
});

test("the models control op is validated", () => {
  assert.deepEqual(validateControlRequest({ op: "harness.models", harness: "codex", refresh: true }), { op: "harness.models", harness: "codex", refresh: true });
  assert.throws(() => validateControlRequest({ op: "harness.models", harness: "bash" }), { code: "INVALID_HARNESS" });
  assert.throws(() => validateControlRequest({ op: "harness.models", harness: "codex", image: "x" }), { code: "UNEXPECTED_FIELDS" });
  assert.throws(() => validateControlRequest({ op: "harness.models", harness: "codex", refresh: "yes" }), /refresh must be a boolean/);
});

test("a failed discovery reports the error, keeps exact IDs selectable and is retried", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "sb-disc2-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(path.join(dir, "auth.json"), JSON.stringify({ tokens: { access_token: "a", refresh_token: "r" } }));
  let calls = 0;
  const spawn = () => { calls++; throw new Error("docker unavailable"); };
  const discovery = createModelDiscovery({ config: { installId: "t", images: { worker: "sha256:x" }, credentials: { codex: path.join(dir, "auth.json"), claude: path.join(dir, "none.json") } }, stageRoot: path.join(dir, "missing-parent", "credentials"), spawn });
  const first = await discovery.discover("codex");
  assert.equal(first.available, true);
  assert.match(first.discoveryError, /docker unavailable/);
  assert.equal(first.exactModelIds, true);
  await discovery.discover("codex");
  assert.equal(calls, 2, "a failed discovery is not cached");
});

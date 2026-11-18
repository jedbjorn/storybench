// Agent job workers (spec #42 'Run'): A2 container isolation (the workerRunArgs variant, the
// host's pad checks, the boot rendered into the pad), A3 the read-only tool set, and A12
// OpenCode jobs by adapter and launch-argv tests (the live check is pending on flag #81).
import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { createAgentJobService } from "../src/agent-jobs.js";
import { defaultBootContextFor, mergeTools } from "../src/runtime/app-runtime.js";
import { loadTemplates, renderEpisodeBoot } from "../src/runtime/boot.js";
import { createHost } from "../src/runtime/host.js";
import { JOB_TOOLS, jobReadTools, renderJobBoot, selectJobTools } from "../src/runtime/job-worker.js";
import { appRunArgs, validateHostConfig, workerRunArgs } from "../src/runtime/layout.js";
import { OpenCodeConnection } from "../src/runtime/opencode.js";
import { activeRenderHolder } from "../src/runtime/request.js";
import { createScopedTools } from "../src/runtime/tools.js";
import { validateControlRequest } from "../src/runtime/validate.js";
import { CATALOG, jobFixture } from "./agent-job-fixtures.js";

const hostConfig = {
  installId: "test1", dataRoot: "/srv/sb/data", stateRoot: "/srv/sb/state", runtimeRoot: "/run/user/1000/sb", port: 18850,
  images: { app: `sha256:${"a".repeat(64)}`, worker: `sha256:${"b".repeat(64)}` },
  credentials: { codex: "/home/u/.codex/auth.json", claude: "/home/u/.claude/.credentials.json" },
};
const EPISODE = "channels/ch-a/episodes/ep-1", WORK = `${EPISODE}/work`, JOB = "agent_job_1", PAD = `${WORK}/jobs/${JOB}`;
const turnStart = { op: "worker.start", requestId: "req-1", harness: "codex", segmentId: "seg-1", episodeDir: EPISODE, workDir: WORK };
const jobStart = { ...turnStart, requestId: JOB, segmentId: JOB, padDir: PAD };
const mountsOf = (args) => args.filter((_, index) => args[index - 1] === "--mount");
const flagsOf = (args) => args.filter((value, index) => args[index - 1] !== "--mount" && value !== "--mount" && !/req-1|agent_job_1/.test(value) && !value.startsWith("/storybench/data/"));

test("A2: the job variant of workerRunArgs keeps the work area read-only and makes the pad the only writable data path and the working directory", () => {
  const config = validateHostConfig(hostConfig);
  const credentialFile = `/run/user/1000/sb/credentials/${JOB}/auth.json`;
  const job = workerRunArgs(config, validateControlRequest(jobStart), { presentRoots: ["channels", "media"], credentialFile });
  const turn = workerRunArgs(config, validateControlRequest(turnStart), { presentRoots: ["channels", "media"], credentialFile: "/run/user/1000/sb/credentials/req-1/auth.json" });
  const mounts = mountsOf(job);
  const dataMounts = mounts.filter((mount) => mount.includes("target=/storybench/data/"));
  assert.deepEqual(dataMounts.filter((mount) => !mount.endsWith(",readonly")), [`type=bind,source=/srv/sb/data/${PAD},target=/storybench/data/${PAD}`], "the pad is the only writable data path");
  assert.ok(!mounts.some((mount) => mount.includes(`target=/storybench/data/${WORK},`) || mount.endsWith(`target=/storybench/data/${WORK}`)), "the work area is not mounted writable");
  assert.ok(dataMounts.includes("type=bind,source=/srv/sb/data/channels,target=/storybench/data/channels,readonly"), "the work area stays read-only under its project root");
  assert.equal(job[job.indexOf("--workdir") + 1], `/storybench/data/${PAD}`);
  assert.ok(mounts.includes(`type=bind,source=/srv/sb/state/harnesses/codex/${JOB},target=/storybench/session/codex`), "its own session folder");
  assert.ok(mounts.includes(`type=bind,source=${credentialFile},target=/storybench/session/codex/auth.json`), "its own credential copy");
  assert.ok(mounts.includes(`type=bind,source=/run/user/1000/sb/requests/${JOB}/app,target=/run/storybench/request/app,readonly`));
  assert.equal(job[job.indexOf("--name") + 1], `storybench-test1-worker-${JOB}`, "the job id stands in for the request id");
  assert.ok(job.includes(`io.storybench.request=${JOB}`) && job.includes(`STORYBENCH_REQUEST_ID=${JOB}`));
  // Same image, hardening and network as a turn worker.
  assert.deepEqual(flagsOf(job), flagsOf(turn));
  assert.equal(job.at(-3), config.images.worker);
  assert.doesNotMatch(job.join(" ") + appRunArgs(config).join(" "), /docker\.sock|--privileged/);
});

test("A2: the control channel accepts a pad only as <workDir>/jobs/<jobId>", () => {
  assert.equal(validateControlRequest(jobStart).episode.pad, PAD);
  assert.equal(validateControlRequest(turnStart).episode.pad, undefined);
  for (const padDir of [WORK, `${WORK}/jobs`, `${WORK}/jobs/`, `${WORK}/jobs/../../x`, `${WORK}/jobs/a/b`, `${WORK}/other/${JOB}`, `${EPISODE}/jobs/${JOB}`, `/abs/${PAD}`, 7])
    assert.throws(() => validateControlRequest({ ...jobStart, padDir }), { code: /INVALID_PAD_DIR|INVALID_ID/ }, String(padDir));
});

test("A2: the host starts a job worker only on a real pad inside the work area", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "sb-job-host-")); t.after(() => rm(root, { recursive: true, force: true }));
  const config = { ...hostConfig, dataRoot: path.join(root, "data"), stateRoot: path.join(root, "state"), runtimeRoot: path.join(root, "runtime") };
  await mkdir(path.join(config.dataRoot, PAD), { recursive: true });
  const login = path.join(root, "auth.json");
  await writeFile(login, JSON.stringify({ tokens: { access_token: "a", refresh_token: "r", id_token: "i" } }), { mode: 0o600 });
  const runs = [];
  const host = createHost({ ...config, credentials: { codex: login, claude: "/absent/.credentials.json" } }, { log: () => {}, followLogs: () => ({ stop() {} }), dockerApi: {
    async docker(args) { if (args[0] === "run") runs.push(args); return "c".repeat(64); }, async listByLabels() { return []; }, async inspectContainer() { return null; }, async ensureNetwork() {},
  } });
  const started = await host.handle({ ...jobStart, source: "codex-login" });
  assert.equal(started.workingDir, `/storybench/data/${PAD}`);
  assert.equal(runs[0][runs[0].indexOf("--workdir") + 1], `/storybench/data/${PAD}`);
  assert.ok(runs[0].includes(`type=bind,source=${config.dataRoot}/${PAD},target=/storybench/data/${PAD}`));
  await host.handle({ op: "worker.stop", requestId: JOB });
  const turn = await host.handle({ ...turnStart, source: "codex-login" });
  assert.equal(turn.workingDir, `/storybench/data/${EPISODE}`);
  await host.handle({ op: "worker.stop", requestId: "req-1" });

  await assert.rejects(host.handle({ ...jobStart, requestId: "agent_job_2", padDir: `${WORK}/jobs/agent_job_2` }), { code: "PAD_MISSING" });
  await mkdir(path.join(root, "elsewhere"));
  await symlink(path.join(root, "elsewhere"), path.join(config.dataRoot, WORK, "jobs", "agent_job_3"));
  await assert.rejects(host.handle({ ...jobStart, requestId: "agent_job_3", padDir: `${WORK}/jobs/agent_job_3` }), { code: "PAD_ESCAPE" });
  assert.equal(runs.length, 2, "no worker starts for a missing or escaping pad");
});

test("A2: a job's boot renders into its pad, never the production directory, and takes no render claim", async (t) => {
  const { app, episode, conversation } = await jobFixture(t);
  const episodeDir = app.store.episodeLocation(episode.id).directory, padDir = path.join(app.store.episodeWorkDirectory(episode.id), "jobs", JOB);
  await mkdir(padDir, { recursive: true });
  const templates = await loadTemplates(undefined, "video");
  // The values openHeldRequest adds to every render.
  const values = defaultBootContextFor(app.store, { episodeId: episode.id, conversationId: conversation.id, model: null, harness: "codex" })({});
  const context = { ...values, tools: { served: "get_context" }, paths: { ...values.paths, episode: episodeDir, work: app.store.episodeWorkDirectory(episode.id), requestWork: padDir } };
  await renderEpisodeBoot({ episodeDir, templates, kind: "video", context });
  const snapshot = async () => Object.fromEntries(await Promise.all(["AGENTS.md", "CLAUDE.md", ".storybench/renders.json", ".opencode/.gitignore"].map(async (file) =>
    [file, createHash("sha256").update(await readFile(path.join(episodeDir, file))).digest("hex")])));
  const before = await snapshot();
  const render = await renderJobBoot({ padDir, episodeDir, templates, context: { ...context, paths: { ...context.paths, pad: padDir } } });
  assert.deepEqual(await snapshot(), before, "production boot files are unchanged by a job");
  assert.equal(activeRenderHolder(episodeDir), null);
  assert.deepEqual(render.files.map((file) => file.path).sort(), [".opencode/.gitignore", "AGENTS.md", "CLAUDE.md"]);
  const boot = await readFile(path.join(padDir, "AGENTS.md"), "utf8");
  assert.equal(boot, await readFile(path.join(padDir, "CLAUDE.md"), "utf8"));
  assert.match(boot, new RegExp(`\`${padDir}\` is your working directory and the only place you can write`));
  assert.match(boot, /Jobs fixture/);
  for (const skill of templates.skills) assert.ok(boot.includes(path.join(episodeDir, ".claude/skills", skill.name, "SKILL.md")), skill.name);
});

const FORBIDDEN = /^(save_|build_|update_|create_|render_|register_|declare_final|move_final|apply_|promote_|reuse_|cancel_|await_|prepare_|validate_render)/;

test("A3: a job is served only read-only tools, and a call to any other tool is refused", async (t) => {
  for (const kind of ["video", "deck"]) {
    const { app, episode, conversation } = await jobFixture(t, { kind });
    const scoped = createScopedTools({ requestId: JOB, conversationId: conversation.id, harness: "codex", channelId: episode.channelId, episodeId: episode.id,
      dataRoot: app.store.workspace, episodeDir: app.store.episodeLocation(episode.id).directory, workDir: app.store.episodeWorkDirectory(episode.id), requestWorkDir: app.store.episodeWorkDirectory(episode.id) }, { store: app.store });
    t.after(() => scoped.close());
    const job = { id: JOB, episodeId: episode.id, conversationId: conversation.id };
    const tools = selectJobTools(mergeTools(scoped, jobReadTools({ store: app.store, renders: app.renders, decks: app.decks, job })), kind);
    const served = tools.definitions.map(({ name }) => name).sort();
    assert.deepEqual(served, JOB_TOOLS.filter((name) => kind === "deck" ? name !== "get_operation_guide" : name !== "read_deck").sort(), kind);
    assert.ok(!served.some((name) => FORBIDDEN.test(name) || name === "save_research"), kind);
    for (const name of ["save_research", "register_work_file", "update_story", "build_deck", "save_deck", "create_draft", "create_final", "declare_final_request", "render_graphic", "reuse_project_item", "cancel_job", "start_agent_job", "prepare_upstream_report"])
      await assert.rejects(tools.call(name, {}), { code: "UNKNOWN_TOOL" }, `${kind}: ${name}`);
    const context = JSON.parse((await tools.call("get_context", {})).text);
    assert.equal(context.episode.id, episode.id);
    const research = JSON.parse((await tools.call("read_research", {})).text);
    assert.equal(research.episodeId, episode.id);
  }
});

// OpenCode worker output (src/runtime/worker/opencode.mjs) over a fake harness socket.
function openCodeChild(lines) {
  const child = new EventEmitter();
  child.stdout = new PassThrough(); child.stdin = new PassThrough(); child.kill = () => {};
  child.stdin.once("data", () => {
    for (const line of lines) child.stdout.write(JSON.stringify(line) + "\n");
    child.stdout.end(); setImmediate(() => child.emit("exit", 0));
  });
  return child;
}

test("A12: OpenCode jobs run, capture their result and continue on their saved session through the adapter", async (t) => {
  const headers = [];
  const scripts = [
    [{ type: "text", part: { text: "Reading." } }, { type: "tool_use", part: { tool: "storybench_get_context", state: { status: "completed" } } }, { type: "text", part: { text: "Report: notes.md" } }, { type: "storybench.complete", ok: true }],
    [{ type: "text", part: { text: "Continued report" } }, { type: "storybench.complete", ok: true }],
    [{ type: "storybench.complete", ok: false }],
  ];
  const launcher = async (job, { onEvent, onError }) => new OpenCodeConnection({ model: job.model, effort: job.effort, onEvent, onError,
    spawnSession: async (header) => { headers.push(header); return openCodeChild(scripts.shift()); } });
  const { app, conversation } = await jobFixture(t);
  app.store.db.prepare("UPDATE conversations SET harness='opencode',inference_source='gateway',model='fixture-model',effort=NULL WHERE id=?").run(conversation.id);
  const service = createAgentJobService({ store: app.store, launcher, catalog: async () => CATALOG });
  t.after(() => service.close());
  const first = await service.start({ conversationId: conversation.id, requestId: "r", brief: "Research.", label: "OpenCode" });
  assert.deepEqual([first.harness, first.source, first.model], ["opencode", "gateway", "fixture-model"]);
  await service.settled(first.id);
  const done = service.get(conversation.id, first.id);
  assert.deepEqual([done.state, done.result.text], ["completed", "Report: notes.md"]);
  assert.deepEqual(headers[0], { harness: "opencode", model: "fixture-model", sessionId: done.sessionId });
  const next = await service.continue({ conversationId: conversation.id, requestId: "r2", jobId: first.id, brief: "Go on." });
  await service.settled(next.id);
  assert.deepEqual(headers[1], { harness: "opencode", model: "fixture-model", sessionId: done.sessionId, resume: done.sessionId });
  assert.equal(service.get(conversation.id, next.id).result.text, "Continued report");
  const failed = await service.start({ conversationId: conversation.id, requestId: "r3", brief: "Fail.", label: "Fails" });
  await service.settled(failed.id);
  assert.deepEqual(service.get(conversation.id, failed.id).error, { stage: "harness", message: "OpenCode request failed; check provider settings and model" });
});

test("A12: the worker launch table runs an OpenCode job's start and continue headers and refuses a mismatched resume", async () => {
  const previous = process.env.STORYBENCH_HARNESS;
  process.env.STORYBENCH_HARNESS = "opencode";
  try {
    const { launchArgv } = await import(`../src/runtime/worker/agent.mjs?opencode-job=${randomUUID()}`);
    const sessionId = randomUUID();
    for (const header of [{ harness: "opencode", model: "fixture-model", sessionId }, { harness: "opencode", model: "fixture-model", sessionId, resume: sessionId }]) {
      const [command, args] = launchArgv(header);
      assert.equal(command, "node");
      assert.deepEqual(args, ["/opt/storybench/app/src/runtime/worker/opencode.mjs", JSON.stringify(header)]);
    }
    assert.throws(() => launchArgv({ harness: "opencode", model: "fixture-model", sessionId, resume: randomUUID() }), /Invalid OpenCode selection/);
    assert.throws(() => launchArgv({ harness: "opencode", model: "fixture-model", sessionId: "agent_job_1" }), /Invalid OpenCode selection/);
  } finally { if (previous === undefined) delete process.env.STORYBENCH_HARNESS; else process.env.STORYBENCH_HARNESS = previous; }
});

test("A12: an OpenCode job worker gets the provider route like a turn, with the pad as its working directory", () => {
  const config = validateHostConfig(hostConfig);
  const start = validateControlRequest({ ...jobStart, harness: "opencode", source: "gateway", model: "fixture-model" });
  const args = workerRunArgs(config, start, { presentRoots: ["channels"], envFile: "/private/selected.env", route: { source: "gateway" } });
  assert.equal(args[args.indexOf("--env-file") + 1], "/private/selected.env");
  assert.ok(args.includes(`STORYBENCH_ROUTE=${JSON.stringify({ source: "gateway" })}`) && args.includes("OPENCODE_DISABLE_CLAUDE_CODE=1"));
  assert.equal(args[args.indexOf("--workdir") + 1], `/storybench/data/${PAD}`);
  assert.ok(mountsOf(args).includes(`type=bind,source=/srv/sb/state/harnesses/opencode/${JOB},target=/storybench/session/opencode`));
});

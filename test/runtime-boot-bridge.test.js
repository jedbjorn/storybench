import test from "node:test";
import assert from "node:assert/strict";
import { connect } from "node:net";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fillTemplate, loadTemplates, renderEpisodeBoot } from "../src/runtime/boot.js";
import { startBridge } from "../src/runtime/bridge.js";
import { createScopedTools, toCodexContentItems, toMcpResult } from "../src/runtime/tools.js";

async function tempDir(t, prefix = "sb-boot-") {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

const context = {
  channel: { id: "ch-a" }, episode: { id: "ep-1" },
  paths: { episode: "/storybench/data/channels/ch-a/episodes/ep-1", work: "/storybench/data/channels/ch-a/episodes/ep-1/work", projects: "/storybench/data/channels" },
  runtime: { harness: "claude", model: "sonnet", bootPhrase: "BOOT-X", skillPhrase: "SKILL-Y" },
};

async function templates(dir, skills) {
  await mkdir(path.join(dir, "skills"), { recursive: true });
  await writeFile(path.join(dir, "BOOT.md"), "Episode {{episode.id}} phrase {{runtime.bootPhrase}}\n{{skills.index}}\n");
  for (const name of skills) {
    await mkdir(path.join(dir, "skills", name), { recursive: true });
    await writeFile(path.join(dir, "skills", name, "SKILL.md"), `---\nname: ${name}\ndescription: ${name} skill\n---\n\nPhrase {{runtime.skillPhrase}} in {{paths.work}}\n`);
  }
  return loadTemplates(dir);
}

test("boot renders one body into AGENTS.md and CLAUDE.md plus native skill dirs", async (t) => {
  const dir = await tempDir(t);
  const episode = path.join(dir, "episode");
  await mkdir(episode);
  await writeFile(path.join(episode, "story.md"), "# story");
  const result = await renderEpisodeBoot({ episodeDir: episode, context, templates: await templates(path.join(dir, "t1"), ["alpha", "beta"]) });
  const agents = await readFile(path.join(episode, "AGENTS.md"), "utf8");
  assert.equal(agents, await readFile(path.join(episode, "CLAUDE.md"), "utf8"));
  assert.match(agents, /Episode ep-1 phrase BOOT-X/);
  assert.match(agents, /\.claude\/skills\/alpha\/SKILL\.md/);
  assert.match(agents, /\.agents\/skills\/beta\/SKILL\.md/);
  for (const root of [".claude/skills", ".agents/skills"])
    assert.match(await readFile(path.join(episode, root, "alpha/SKILL.md"), "utf8"), /Phrase SKILL-Y in \/storybench/);
  assert.equal(result.files.length, 6);
  assert.ok(result.bootSha256 && result.templateVersion);
  const manifest = JSON.parse(await readFile(path.join(episode, ".storybench/renders.json"), "utf8"));
  assert.equal(manifest.files.length, 6);
});

test("re-render removes only obsolete app-owned skills and keeps user files", async (t) => {
  const dir = await tempDir(t);
  const episode = path.join(dir, "episode");
  await mkdir(path.join(episode, ".claude/skills/user-own"), { recursive: true });
  await mkdir(path.join(episode, "work"), { recursive: true });
  await writeFile(path.join(episode, ".claude/skills/user-own/SKILL.md"), "user");
  await writeFile(path.join(episode, "story.md"), "# story");
  await writeFile(path.join(episode, "work/clip.mp4"), "bytes");
  await renderEpisodeBoot({ episodeDir: episode, context, templates: await templates(path.join(dir, "t1"), ["alpha", "beta"]) });
  const second = await renderEpisodeBoot({ episodeDir: episode, context: { ...context, runtime: { ...context.runtime, bootPhrase: "BOOT-2" } }, templates: await templates(path.join(dir, "t2"), ["alpha"]) });
  assert.deepEqual(second.removed.sort(), [".agents/skills/beta/SKILL.md", ".claude/skills/beta/SKILL.md"]);
  await assert.rejects(stat(path.join(episode, ".claude/skills/beta")));
  assert.equal(await readFile(path.join(episode, ".claude/skills/user-own/SKILL.md"), "utf8"), "user");
  assert.equal(await readFile(path.join(episode, "story.md"), "utf8"), "# story");
  assert.equal(await readFile(path.join(episode, "work/clip.mp4"), "utf8"), "bytes");
  assert.match(await readFile(path.join(episode, "CLAUDE.md"), "utf8"), /BOOT-2/);
});

test("renders refuse to replace symlinks and templates reject unknown placeholders", async (t) => {
  const dir = await tempDir(t);
  const episode = path.join(dir, "episode");
  await mkdir(episode);
  await writeFile(path.join(dir, "outside.md"), "keep");
  await symlink(path.join(dir, "outside.md"), path.join(episode, "AGENTS.md"));
  await assert.rejects(renderEpisodeBoot({ episodeDir: episode, context, templates: await templates(path.join(dir, "t"), []) }), /non-file render target/);
  assert.equal(await readFile(path.join(dir, "outside.md"), "utf8"), "keep");
  assert.throws(() => fillTemplate("{{runtime.missing}}", context), /no value for \{\{runtime\.missing\}\}/);
});

test("the shipped placeholder templates render", async (t) => {
  const dir = await tempDir(t);
  const result = await renderEpisodeBoot({ episodeDir: dir, context });
  assert.ok(result.files.some((file) => file.path === ".agents/skills/storybench-runtime-check/SKILL.md"));
});

function bridgeCall(socketPath, message) {
  return new Promise((resolve, reject) => {
    const socket = connect(socketPath);
    let buffer = "";
    socket.on("connect", () => socket.write(JSON.stringify(message) + "\n"));
    socket.on("data", (chunk) => { buffer += chunk; });
    socket.on("end", () => resolve(JSON.parse(buffer)));
    socket.on("error", reject);
  });
}

test("request bridge requires the request token and returns MCP tool results", async (t) => {
  const dir = await tempDir(t, "sb-br-");
  const socketPath = path.join(dir, "bridge.sock");
  const calls = [];
  const tools = {
    definitions: [{ name: "echo", description: "e", inputSchema: { type: "object" } }],
    async call(name, args) {
      if (name !== "echo") throw new Error("Unknown Storybench tool");
      return { text: `echo ${args.value}`, images: [{ mimeType: "image/png", data: "AAAA" }] };
    },
  };
  const token = "t".repeat(64);
  const bridge = await startBridge({ socketPath, token, tools, onCall: (call) => calls.push(call) });
  t.after(() => bridge.close());
  assert.equal((await stat(socketPath)).mode & 0o777, 0o600);
  assert.deepEqual(await bridgeCall(socketPath, { token: "wrong", op: "tools/list" }), { ok: false, error: "Bridge token rejected" });
  assert.equal((await bridgeCall(socketPath, { op: "tools/list" })).ok, false);
  assert.equal((await bridgeCall(socketPath, { token, op: "tools/list" })).result.tools[0].name, "echo");
  const reply = await bridgeCall(socketPath, { token, op: "tools/call", name: "echo", arguments: { value: 7 } });
  assert.deepEqual(reply.result.content, [{ type: "text", text: "echo 7" }, { type: "image", data: "AAAA", mimeType: "image/png" }]);
  const failed = await bridgeCall(socketPath, { token, op: "tools/call", name: "nope", arguments: {} });
  assert.equal(failed.result.isError, true);
  assert.equal(calls.length, 2);
});

test("tool output adapters encode images for both harnesses", () => {
  const output = { text: "t", images: [{ mimeType: "image/png", data: "QUJD" }] };
  assert.deepEqual(toMcpResult(output).content[1], { type: "image", data: "QUJD", mimeType: "image/png" });
  assert.deepEqual(toCodexContentItems(output)[1], { type: "inputImage", imageUrl: "data:image/png;base64,QUJD" });
});

test("scoped tools inspect real frames and refuse to register symlinks or files outside work", async (t) => {
  const root = await tempDir(t, "sb-tools-");
  const episode = path.join(root, "channels/ch-a/episodes/ep-1");
  await mkdir(path.join(episode, "work"), { recursive: true });
  await writeFile(path.join(root, "storybench.sqlite"), "db");
  await promisify(execFile)("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=c=red:s=64x48:d=1", "-frames:v", "1", path.join(episode, "work/red.png")]);
  const registered = [];
  const tools = createScopedTools({ requestId: "r1", conversationId: "c1", harness: "codex", channelId: "ch-a", episodeId: "ep-1", dataRoot: root, episodeDir: episode, workDir: path.join(episode, "work") },
    { registerAsset: async (candidate) => { registered.push(candidate); return { id: "asset_1", ...candidate }; } });
  const seen = await tools.call("inspect_image", { path: "work/red.png" });
  assert.equal(Buffer.from(seen.images[0].data, "base64").subarray(1, 4).toString(), "PNG");
  await assert.rejects(tools.call("inspect_image", { path: "../../../../storybench.sqlite" }), { code: "PATH_NOT_PROJECT" });
  await symlink(path.join(root, "storybench.sqlite"), path.join(episode, "work/db.png"));
  await assert.rejects(tools.call("register_work_file", { path: "work/db.png" }), { code: "PATH_SYMLINK" });
  await assert.rejects(tools.call("register_work_file", { path: "../../../../storybench.sqlite" }), { code: "PATH_OUTSIDE_WORK" });
  await assert.rejects(tools.call("drop_database", {}), { code: "UNKNOWN_TOOL" });
  const result = JSON.parse((await tools.call("register_work_file", { path: "work/red.png", name: "Red" })).text);
  assert.equal(result.assetId, "asset_1");
  assert.equal(registered[0].name, "Red");
  assert.equal(registered[0].metadata.provenance.requestId, "r1");
  assert.equal(registered[0].metadata.provenance.workPath, "work/red.png");
});

test("worker launch table accepts only fixed harness argv", async () => {
  process.env.STORYBENCH_HARNESS = "claude";
  const { launchArgv } = await import("../src/runtime/worker/agent.mjs");
  const [command, args] = launchArgv({ harness: "claude", model: "sonnet", resume: "3ff05a59-8ffd-45bb-be71-f806f55e7c78" });
  assert.equal(command, "claude");
  assert.deepEqual(args.slice(args.indexOf("--resume")), ["--resume", "3ff05a59-8ffd-45bb-be71-f806f55e7c78"]);
  assert.ok(args.includes("--strict-mcp-config") && args.includes("--dangerously-skip-permissions"));
  assert.throws(() => launchArgv({ harness: "codex" }), /only runs claude/);
  assert.throws(() => launchArgv({ harness: "claude", model: "sonnet --add-dir /" }), /plain model/);
  assert.throws(() => launchArgv({ harness: "claude", model: "sonnet", resume: "latest" }), /session UUID/);
  assert.throws(() => launchArgv({ harness: "claude", model: "sonnet", argv: ["bash"] }), /Unexpected launch fields/);
});

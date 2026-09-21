import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  RuntimeError, parseEpisodeDir, resolveEpisodeDirectory, resolveProjectFile, resolveWorkFile, validateControlRequest,
} from "../src/runtime/validate.js";
import { PROJECT_ROOTS, appRunArgs, validateHostConfig, workerRunArgs } from "../src/runtime/layout.js";

const start = { op: "worker.start", requestId: "req-1", harness: "codex", segmentId: "seg-1", episodeDir: "channels/ch-a/episodes/ep-1", workDir: "channels/ch-a/episodes/ep-1/work" };
const code = (fn) => { try { fn(); } catch (error) { assert.ok(error instanceof RuntimeError, error.message); return error.code; } return "ACCEPTED"; };

test("control requests accept only the fixed operations and fields", () => {
  assert.deepEqual(validateControlRequest(start).episode, { relative: "channels/ch-a/episodes/ep-1", channelId: "ch-a", episodeId: "ep-1", work: "channels/ch-a/episodes/ep-1/work" });
  assert.equal(validateControlRequest({ op: "worker.start", requestId: "r", harness: "claude", segmentId: "s", episodeDir: "episodes/legacy-1", workDir: "episodes/legacy-1/work" }).episode.channelId, null);
  for (const workDir of ["channels/ch-b/episodes/ep-2/work", "channels/ch-a/episodes/ep-1", "channels/ch-a/episodes/ep-1/../ep-2/work", "/abs/work", undefined])
    assert.equal(code(() => validateControlRequest({ ...start, workDir })), "INVALID_WORK_DIR", String(workDir));
  assert.equal(validateControlRequest({ op: "worker.stop", requestId: "req-1" }).op, "worker.stop");
  assert.equal(validateControlRequest({ op: "harness.availability" }).op, "harness.availability");
  for (const extra of [{ image: "alpine" }, { mounts: [{ source: "/", target: "/h" }] }, { flags: ["--privileged"] }, { env: { A: "1" } }, { network: "host" }])
    assert.equal(code(() => validateControlRequest({ ...start, ...extra })), "UNEXPECTED_FIELDS");
  assert.equal(code(() => validateControlRequest({ op: "worker.stop", requestId: "r", image: "x" })), "UNEXPECTED_FIELDS");
  assert.equal(code(() => validateControlRequest({ op: "docker.run" })), "UNSUPPORTED_OP");
  assert.equal(code(() => validateControlRequest(null)), "INVALID_REQUEST");
  assert.equal(code(() => validateControlRequest([start])), "INVALID_REQUEST");
  assert.equal(code(() => validateControlRequest({ ...start, harness: "bash" })), "INVALID_HARNESS");
  for (const requestId of ["", "../x", "a b", "-lead", "x".repeat(65), 7]) assert.equal(code(() => validateControlRequest({ ...start, requestId })), "INVALID_ID");
});

test("episode directories must name a project episode without escapes", () => {
  for (const bad of ["/etc", "channels/ch-a/episodes/../../..", "channels/ch-a/episodes/ep-1/..", "channels//episodes/ep", "channels/ch-a/episodes/ep-1/work",
    "media/x", "episodes", "channels\\ch\\episodes\\ep", "./episodes/ep-1", "channels/ch a/episodes/ep", ""])
    assert.ok(["INVALID_EPISODE_DIR", "INVALID_ID"].includes(code(() => parseEpisodeDir(bad))), bad);
});

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "sb-runtime-"));
  const episode = path.join(root, "channels/ch-a/episodes/ep-1");
  await mkdir(path.join(episode, "work/sub"), { recursive: true });
  await mkdir(path.join(root, "channels/ch-b/episodes/ep-2/work"), { recursive: true });
  await writeFile(path.join(root, "storybench.sqlite"), "db");
  await writeFile(path.join(episode, "story.md"), "# story");
  await writeFile(path.join(episode, "work/out.png"), "png");
  await writeFile(path.join(root, "channels/ch-b/episodes/ep-2/notes.txt"), "notes");
  return { root, episode, work: path.join(episode, "work") };
}

test("work files resolve only inside work/ and never through symlinks", async (t) => {
  const { root, episode, work } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  assert.equal((await resolveWorkFile(work, "work/out.png", { base: episode })).relative, "out.png");
  assert.equal((await resolveWorkFile(work, path.join(work, "out.png"))).relative, "out.png");
  assert.equal((await resolveWorkFile(work, "out.png")).relative, "out.png");
  const reject = async (input, expected) => assert.equal(await resolveWorkFile(work, input, { base: episode }).then(() => "ACCEPTED", (error) => error.code), expected, input);
  await reject("story.md", "PATH_OUTSIDE_WORK");
  await reject("work/../story.md", "PATH_OUTSIDE_WORK");
  await reject(path.join(root, "storybench.sqlite"), "PATH_OUTSIDE_WORK");
  await reject("work", "PATH_OUTSIDE_WORK");
  await reject("work/sub", "PATH_NOT_FILE");
  await reject("work/missing.png", "PATH_MISSING");
  await symlink(path.join(root, "storybench.sqlite"), path.join(work, "db-link"));
  await reject("work/db-link", "PATH_SYMLINK");
  await symlink(path.join(episode, "story.md"), path.join(work, "inside-link"));
  await reject("work/inside-link", "PATH_SYMLINK");
  await symlink(root, path.join(work, "dir-link"));
  await reject("work/dir-link/storybench.sqlite", "PATH_OUTSIDE_WORK");
  await reject("work/x\0y", "INVALID_PATH");
});

test("project files exclude the database and symlink escapes", async (t) => {
  const { root, episode } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const opts = { projectRoots: PROJECT_ROOTS };
  assert.ok((await resolveProjectFile(root, path.join(root, "channels/ch-b/episodes/ep-2/notes.txt"), opts)).endsWith("notes.txt"));
  assert.ok((await resolveProjectFile(root, path.resolve(episode, "../../../ch-b/episodes/ep-2/notes.txt"), opts)).endsWith("notes.txt"));
  const reject = async (input, expected) => assert.equal(await resolveProjectFile(root, input, opts).then(() => "ACCEPTED", (error) => error.code), expected, input);
  await reject(path.join(root, "storybench.sqlite"), "PATH_NOT_PROJECT");
  await reject("/etc/passwd", "PATH_NOT_PROJECT");
  await symlink(path.join(root, "storybench.sqlite"), path.join(episode, "db-link"));
  await reject(path.join(episode, "db-link"), "PATH_NOT_PROJECT");
  await reject(path.join(episode, "work"), "PATH_NOT_FILE");
});

test("episode directories resolve on disk without symlink escapes", async (t) => {
  const { root } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const episodeAt = (relative) => ({ ...parseEpisodeDir(relative), work: `${relative}/work` });
  const ok = await resolveEpisodeDirectory(root, episodeAt("channels/ch-a/episodes/ep-1"));
  assert.ok(ok.workDir.endsWith("ep-1/work"));
  await mkdir(path.join(root, "channels/ch-a/episodes/ep-3"));
  await assert.rejects(resolveEpisodeDirectory(root, episodeAt("channels/ch-a/episodes/ep-3")), { code: "WORK_MISSING" });
  await symlink(path.join(root, "channels/ch-b/episodes/ep-2/work"), path.join(root, "channels/ch-a/episodes/ep-3/work"));
  await assert.rejects(resolveEpisodeDirectory(root, episodeAt("channels/ch-a/episodes/ep-3")), { code: "WORK_ESCAPE" });
  await symlink(path.join(root, "channels/ch-b/episodes/ep-2"), path.join(root, "channels/ch-a/episodes/ep-4"));
  await assert.rejects(resolveEpisodeDirectory(root, episodeAt("channels/ch-a/episodes/ep-4")), { code: "EPISODE_ESCAPE" });
  await assert.rejects(resolveEpisodeDirectory(root, episodeAt("channels/ch-a/episodes/nope")), { code: "EPISODE_MISSING" });
});

const hostConfig = {
  installId: "test1", dataRoot: "/srv/sb/data", stateRoot: "/srv/sb/state", runtimeRoot: "/run/user/1000/sb", port: 18850,
  images: { app: `sha256:${"a".repeat(64)}`, worker: `sha256:${"b".repeat(64)}` },
  credentials: { codex: "/home/u/.codex/auth.json", claude: "/home/u/.claude/.credentials.json" },
};

test("host config requires exact image IDs and separate roots", () => {
  assert.equal(validateHostConfig(hostConfig).port, 18850);
  assert.throws(() => validateHostConfig({ ...hostConfig, images: { ...hostConfig.images, worker: "storybench-worker:latest" } }), { code: "INVALID_CONFIG" });
  assert.throws(() => validateHostConfig({ ...hostConfig, stateRoot: "/srv/sb/data/state" }), { code: "INVALID_CONFIG" });
  assert.throws(() => validateHostConfig({ ...hostConfig, dataRoot: "/srv/sb/da,ta" }), { code: "INVALID_CONFIG" });
  assert.throws(() => validateHostConfig({ ...hostConfig, dataRoot: "relative/data" }), { code: "INVALID_CONFIG" });
  assert.throws(() => validateHostConfig({ ...hostConfig, port: 80 }), { code: "INVALID_CONFIG" });
});

test("container templates keep Docker control, the database and CLI homes out", () => {
  const config = validateHostConfig(hostConfig);
  const app = appRunArgs(config).join(" ");
  assert.match(app, /--publish 127\.0\.0\.1:18850:18850/);
  assert.match(app, /--data-root \/storybench\/data/);
  assert.doesNotMatch(app, /docker\.sock|--privileged/);
  const request = validateControlRequest(start);
  assert.deepEqual(PROJECT_ROOTS, ["channels", "episodes", "media", "branding"]);
  const args = workerRunArgs(config, request, { presentRoots: ["channels", "media", "branding", "imports", "cache"], credentialFile: "/run/user/1000/sb/credentials/req-1/auth.json" });
  const joined = args.join(" ");
  const mounts = args.filter((_, i) => args[i - 1] === "--mount");
  assert.doesNotMatch(joined, /docker\.sock|--privileged|storybench\.sqlite|\.codex[/ ]|\.claude[/ ]/);
  assert.ok(!mounts.some((m) => m.includes("source=/srv/sb/data,")), "data root itself is not mounted");
  assert.ok(mounts.includes("type=bind,source=/srv/sb/data/branding,target=/storybench/data/branding,readonly"), "legacy branding is read-only project material");
  assert.ok(!mounts.some((m) => m.includes("/imports") || m.includes("/cache")), "imports (app-only staging) and cache are never mounted");
  assert.ok(mounts.includes("type=bind,source=/srv/sb/data/channels,target=/storybench/data/channels,readonly"));
  assert.ok(mounts.includes("type=bind,source=/srv/sb/data/media,target=/storybench/data/media,readonly"));
  assert.ok(mounts.includes("type=bind,source=/srv/sb/data/channels/ch-a/episodes/ep-1/work,target=/storybench/data/channels/ch-a/episodes/ep-1/work"));
  assert.ok(mounts.includes("type=bind,source=/run/user/1000/sb/credentials/req-1/auth.json,target=/storybench/session/codex/auth.json"));
  assert.ok(mounts.includes("type=bind,source=/srv/sb/state/harnesses/codex/seg-1,target=/storybench/session/codex"));
  for (const flag of ["--read-only", "--cap-drop", "no-new-privileges", "--init"]) assert.ok(args.includes(flag), flag);
  assert.equal(args[args.indexOf("--network") + 1], "storybench-test1-worker");
  const legacy = workerRunArgs(config, validateControlRequest({ ...start, episodeDir: "episodes/legacy-1", workDir: "episodes/legacy-1/work" }), { presentRoots: ["channels", "episodes", "media"], credentialFile: "/run/user/1000/sb/credentials/req-1/auth.json" });
  assert.ok(legacy.includes("type=bind,source=/srv/sb/data/episodes,target=/storybench/data/episodes,readonly"));
  assert.ok(legacy.includes("type=bind,source=/srv/sb/data/episodes/legacy-1/work,target=/storybench/data/episodes/legacy-1/work"));
  assert.equal(legacy[legacy.indexOf("--workdir") + 1], "/storybench/data/episodes/legacy-1");
  assert.equal(args.at(-3), config.images.worker);
});

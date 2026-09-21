// Pure validation for the private runtime control channel and worker-visible paths.
// No Docker, network or provider access happens here; everything is unit-testable.
import { constants } from "node:fs";
import { lstat, open, readlink, realpath, stat } from "node:fs/promises";
import path from "node:path";

export class RuntimeError extends Error {
  constructor(code, message, { status = 400, cause } = {}) {
    super(message, { cause });
    this.name = "RuntimeError";
    this.code = code;
    this.status = status;
  }
}

export const HARNESSES = Object.freeze(["codex", "claude"]);
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
// Native session IDs: Codex thread IDs and Claude session IDs are UUID-shaped.
const SESSION_ID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._:\-[\]]{0,79}$/;

// The only operations the app may ask of the host lifecycle entry point.
const CONTROL_OPS = {
  "worker.start": ["op", "requestId", "harness", "segmentId", "episodeDir", "workDir"],
  "worker.stop": ["op", "requestId"],
  "worker.status": ["op", "requestId"],
  "harness.availability": ["op"],
  "harness.models": ["op", "harness", "refresh"],
};

export function assertId(value, field) {
  if (typeof value !== "string" || !ID.test(value))
    throw new RuntimeError("INVALID_ID", `${field} must be 1-64 characters of letters, digits, '-' or '_'`);
  return value;
}

export function assertHarness(value) {
  if (!HARNESSES.includes(value)) throw new RuntimeError("INVALID_HARNESS", `Unsupported harness: ${String(value)}`);
  return value;
}

export function assertModel(value) {
  if (typeof value !== "string" || !MODEL.test(value)) throw new RuntimeError("INVALID_MODEL", "Model must be a plain model identifier");
  return value;
}

export function assertSessionId(value) {
  if (typeof value !== "string" || !SESSION_ID.test(value)) throw new RuntimeError("INVALID_SESSION", "Native session ID must be a UUID");
  return value;
}

// Episode directories are data-root-relative (as resolved by the app's store path API,
// store.episodeLocation) and may only name a project episode:
// channels/<channel>/episodes/<episode> or the legacy adopted episodes/<episode>.
export function parseEpisodeDir(value) {
  if (typeof value !== "string" || !value || value.length > 300 || path.isAbsolute(value) || value.includes("\\") || value.includes("\0"))
    throw new RuntimeError("INVALID_EPISODE_DIR", "episodeDir must be a data-root-relative episode path");
  const parts = value.split("/");
  if (parts.some((part) => part === "" || part === "." || part === ".."))
    throw new RuntimeError("INVALID_EPISODE_DIR", "episodeDir must not contain empty, '.' or '..' segments");
  if (parts.length === 4 && parts[0] === "channels" && parts[2] === "episodes") {
    assertId(parts[1], "channel id");
    assertId(parts[3], "episode id");
    return { relative: value, channelId: parts[1], episodeId: parts[3] };
  }
  if (parts.length === 2 && parts[0] === "episodes") {
    assertId(parts[1], "episode id");
    return { relative: value, channelId: null, episodeId: parts[1] };
  }
  throw new RuntimeError("INVALID_EPISODE_DIR", "episodeDir must be channels/<channel>/episodes/<episode> or episodes/<episode>");
}

// The episode work directory (store.episodeWorkDirectory, data-root-relative) must be a
// plain descendant of the episode directory.
export function parseWorkDir(value, episode) {
  if (typeof value !== "string" || !value || value.length > 400 || path.isAbsolute(value) || value.includes("\\") || value.includes("\0"))
    throw new RuntimeError("INVALID_WORK_DIR", "workDir must be a data-root-relative path");
  const parts = value.split("/");
  if (parts.some((part) => part === "" || part === "." || part === ".."))
    throw new RuntimeError("INVALID_WORK_DIR", "workDir must not contain empty, '.' or '..' segments");
  if (!value.startsWith(`${episode.relative}/`)) throw new RuntimeError("INVALID_WORK_DIR", "workDir must be inside the episode directory");
  return value;
}

// Validate a control request exactly: unknown fields (images, flags, mounts, env, ...) are rejected.
export function validateControlRequest(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new RuntimeError("INVALID_REQUEST", "Control request must be a JSON object");
  const allowed = CONTROL_OPS[input.op];
  if (!allowed) throw new RuntimeError("UNSUPPORTED_OP", `Unsupported control operation: ${String(input.op)}`);
  const extra = Object.keys(input).filter((key) => !allowed.includes(key));
  if (extra.length) throw new RuntimeError("UNEXPECTED_FIELDS", `Unexpected control fields: ${extra.join(", ")}`);
  if (input.op === "harness.availability") return { op: input.op };
  if (input.op === "harness.models") {
    if (input.refresh !== undefined && typeof input.refresh !== "boolean") throw new RuntimeError("INVALID_REQUEST", "refresh must be a boolean");
    return { op: input.op, harness: assertHarness(input.harness), refresh: input.refresh === true };
  }
  const request = { op: input.op, requestId: assertId(input.requestId, "requestId") };
  if (input.op === "worker.start") {
    request.harness = assertHarness(input.harness);
    request.segmentId = assertId(input.segmentId, "segmentId");
    request.episode = parseEpisodeDir(input.episodeDir);
    request.episode.work = parseWorkDir(input.workDir, request.episode);
  }
  return request;
}

export function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

// Resolve an on-disk episode directory under the data root without following an escape.
export async function resolveEpisodeDirectory(dataRoot, episode) {
  const rootReal = await realpath(dataRoot);
  const lexical = path.join(rootReal, episode.relative);
  let actual;
  try { actual = await realpath(lexical); }
  catch (error) { throw new RuntimeError("EPISODE_MISSING", `Episode directory does not exist: ${episode.relative}`, { status: 404, cause: error }); }
  if (actual !== lexical || !isInside(rootReal, actual)) throw new RuntimeError("EPISODE_ESCAPE", "Episode directory resolves outside its registered location", { status: 403 });
  if (!(await stat(actual)).isDirectory()) throw new RuntimeError("EPISODE_MISSING", "Episode path is not a directory", { status: 404 });
  if (typeof episode.work !== "string") throw new RuntimeError("INVALID_WORK_DIR", "workDir is required");
  const work = path.join(rootReal, episode.work);
  const workInfo = await lstat(work).catch(() => null);
  if (!workInfo) throw new RuntimeError("WORK_MISSING", "Episode work directory does not exist", { status: 404 });
  if (workInfo.isSymbolicLink() || !workInfo.isDirectory() || (await realpath(work)) !== work || !isInside(actual, work))
    throw new RuntimeError("WORK_ESCAPE", "Episode work directory must be a real directory inside the episode", { status: 403 });
  return { dataRoot: rootReal, episodeDir: actual, workDir: work };
}

// Resolve a file the agent created in the episode work area. Relative paths resolve
// against `base` (the episode directory, the agent's working directory) and absolute
// worker-visible paths are taken as-is. Rejects escapes, symlinks and non-files.
export async function resolveWorkFile(workDir, input, { base } = {}) {
  if (typeof input !== "string" || !input || input.length > 1024 || input.includes("\0"))
    throw new RuntimeError("INVALID_PATH", "path must be a non-empty string");
  const workReal = await realpath(workDir);
  const lexical = path.resolve(base ? await realpath(base) : workReal, input);
  if (!isInside(workReal, lexical)) throw new RuntimeError("PATH_OUTSIDE_WORK", "Only files inside the episode work area can be registered", { status: 403 });
  const info = await lstat(lexical).catch(() => null);
  if (!info) throw new RuntimeError("PATH_MISSING", "Work file does not exist", { status: 404 });
  if (info.isSymbolicLink()) throw new RuntimeError("PATH_SYMLINK", "Symlinks cannot be registered; write the completed file into the work area", { status: 403 });
  if (!info.isFile()) throw new RuntimeError("PATH_NOT_FILE", "Only regular files can be registered", { status: 400 });
  const actual = await realpath(lexical);
  if (actual !== lexical || !isInside(workReal, actual)) throw new RuntimeError("PATH_OUTSIDE_WORK", "Work file resolves outside the work area", { status: 403 });
  return { path: actual, relative: path.relative(workReal, actual), size: info.size, mtimeMs: info.mtimeMs, ino: info.ino, dev: info.dev };
}

// Resolve a readable project file for inspection: anywhere under the data root's project
// trees, never the database or its sidecars, never through a symlink escape.
export async function resolveProjectFile(dataRoot, input, { projectRoots }) {
  if (typeof input !== "string" || !input || input.length > 1024 || input.includes("\0"))
    throw new RuntimeError("INVALID_PATH", "path must be a non-empty string");
  const rootReal = await realpath(dataRoot);
  const lexical = path.resolve(rootReal, input);
  const top = path.relative(rootReal, lexical).split(path.sep)[0];
  if (!isInside(rootReal, lexical) || !projectRoots.includes(top))
    throw new RuntimeError("PATH_NOT_PROJECT", "Path is not inside a Storybench project directory", { status: 403 });
  let actual;
  try { actual = await realpath(lexical); }
  catch (error) { throw new RuntimeError("PATH_MISSING", "File does not exist", { status: 404, cause: error }); }
  const actualTop = path.relative(rootReal, actual).split(path.sep)[0];
  if (!isInside(rootReal, actual) || !projectRoots.includes(actualTop))
    throw new RuntimeError("PATH_NOT_PROJECT", "Path resolves outside Storybench project directories", { status: 403 });
  if (!(await stat(actual)).isFile()) throw new RuntimeError("PATH_NOT_FILE", "Only regular files can be inspected");
  return actual;
}

// Open a validated project file ONCE (O_NOFOLLOW) and confirm, from the kernel's view of the
// open descriptor (/proc/self/fd/N), that it is inside a project root. Readers then use only
// this descriptor, so swapping the path after validation (e.g. to a symlink at the database)
// cannot change what is read. Caller closes `handle`.
export async function openProjectFile(dataRoot, input, { projectRoots }) {
  const actual = await resolveProjectFile(dataRoot, input, { projectRoots });
  const rootReal = await realpath(dataRoot);
  let handle;
  try { handle = await open(actual, constants.O_RDONLY | constants.O_NOFOLLOW); }
  catch (error) {
    if (error.code === "ELOOP") throw new RuntimeError("PATH_NOT_PROJECT", "Path resolves outside Storybench project directories", { status: 403 });
    throw new RuntimeError("PATH_MISSING", "File does not exist", { status: 404 });
  }
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new RuntimeError("PATH_NOT_FILE", "Only regular files can be inspected");
    const opened = await readlink(`/proc/self/fd/${handle.fd}`);
    const top = path.relative(rootReal, opened).split(path.sep)[0];
    if (!isInside(rootReal, opened) || !projectRoots.includes(top))
      throw new RuntimeError("PATH_NOT_PROJECT", "Path resolves outside Storybench project directories", { status: 403 });
    return { handle, path: opened, size: info.size };
  } catch (error) { await handle.close(); throw error; }
}

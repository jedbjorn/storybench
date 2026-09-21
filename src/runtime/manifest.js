// Release manifest: the one definition of a release's paired app/worker image identity
// (spec #10 "Installation Layout", spec #11 "Releases and proof"). Built by
// src/runtime/release.js from docker/Dockerfile; read by the host lifecycle entry point and
// (later) the installer/CLI. Mutable tags are never identity: images are exact IDs.
import { createHash } from "node:crypto";

export const MANIFEST_SCHEMA = "storybench.release/1";
// Bumped when the app <-> host control protocol, worker launch table or scoped-tool
// bridge changes incompatibly. App and worker of one release always share it.
export const RUNTIME_PROTOCOL = 1;
// Oldest database schema the current store migrates forward from.
export const MIN_SUPPORTED_SCHEMA = 0;
// Releases before shared channels (#19) carried no manifest; they support schema <= 5.
export const LEGACY_SUPPORTED_SCHEMA = Object.freeze({ min: 0, max: 5 });

const IMAGE_ID = /^sha256:[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{7,40}$/;
const VERSION = /^[0-9A-Za-z.+_-]{1,64}$/;

const fail = (message) => { throw Object.assign(new Error(`Invalid release manifest: ${message}`), { code: "INVALID_MANIFEST" }); };

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

// Stable identity of a manifest's content (independent of key order, whitespace and the
// informational build time), so one commit's release has one identity.
export function manifestId(manifest) {
  const { id, builtAt, ...content } = manifest;
  return `sha256:${createHash("sha256").update(canonical(content)).digest("hex")}`;
}

export function createManifest({ packageName, packageVersion, commit, ref = null, builtAt = new Date().toISOString(), images, tools = {}, schema }) {
  const manifest = {
    schema: MANIFEST_SCHEMA,
    package: { name: packageName, version: packageVersion },
    source: { commit, ref },
    builtAt,
    images: { app: { id: images.app }, worker: { id: images.worker } },
    runtime: { protocol: RUNTIME_PROTOCOL, tools },
    database: { supportedSchema: { min: schema.min, max: schema.max } },
  };
  return { ...validateManifest(manifest), id: manifestId(manifest) };
}

export function validateManifest(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("not an object");
  if (input.schema !== MANIFEST_SCHEMA) fail(`schema must be ${MANIFEST_SCHEMA}`);
  if (typeof input.package?.name !== "string" || !VERSION.test(input.package?.version ?? "")) fail("package name/version");
  if (!COMMIT.test(input.source?.commit ?? "")) fail("source.commit must be a git commit");
  for (const role of ["app", "worker"]) if (!IMAGE_ID.test(input.images?.[role]?.id ?? "")) fail(`images.${role}.id must be an exact sha256 image ID`);
  if (input.images.app.id === input.images.worker.id) fail("app and worker images must be distinct");
  if (!Number.isInteger(input.runtime?.protocol) || input.runtime.protocol < 1) fail("runtime.protocol");
  if (input.runtime.tools && (typeof input.runtime.tools !== "object" || Array.isArray(input.runtime.tools))) fail("runtime.tools");
  const range = input.database?.supportedSchema;
  if (!Number.isInteger(range?.min) || !Number.isInteger(range?.max) || range.min < 0 || range.max < range.min) fail("database.supportedSchema");
  if (input.id !== undefined && input.id !== manifestId(input)) fail("id does not match content");
  return input;
}

// Can this release run the given data root with this host?
export function checkCompatibility(manifest, { schemaVersion = null, hostProtocol = RUNTIME_PROTOCOL } = {}) {
  const problems = [];
  if (manifest.runtime.protocol !== hostProtocol) problems.push(`runtime protocol ${manifest.runtime.protocol} does not match host protocol ${hostProtocol}`);
  const { min, max } = manifest.database.supportedSchema;
  if (schemaVersion != null && (schemaVersion < min || schemaVersion > max)) problems.push(`database schema ${schemaVersion} is outside the supported range ${min}-${max}`);
  return { compatible: problems.length === 0, problems };
}

// Supported schema range of any release: from its manifest, or the pre-#19 legacy range.
export function supportedSchemaOf(manifest) {
  return manifest ? { ...manifest.database.supportedSchema } : { ...LEGACY_SUPPORTED_SCHEMA };
}

// What the app container is told about its own release (no paths, no secrets).
export function releaseIdentity(manifest) {
  return {
    manifestId: manifest.id ?? manifestId(manifest),
    version: manifest.package.version,
    commit: manifest.source.commit,
    images: { app: manifest.images.app.id, worker: manifest.images.worker.id },
    protocol: manifest.runtime.protocol,
    supportedSchema: { ...manifest.database.supportedSchema },
    tools: { ...(manifest.runtime.tools ?? {}) },
  };
}

// Defensive reader for tools that report a release (e.g. the CLI `version` command):
// never throws; returns the validated manifest or a plain reason.
export async function readReleaseManifest(file) {
  const { readFile } = await import("node:fs/promises");
  let text;
  try { text = await readFile(file, "utf8"); }
  catch (error) { return { ok: false, reason: error.code === "ENOENT" ? "No release manifest is installed" : `Release manifest is unreadable (${error.code})` }; }
  if (text.length > 256 * 1024) return { ok: false, reason: "Release manifest is too large" };
  let value;
  try { value = JSON.parse(text); } catch { return { ok: false, reason: "Release manifest is not valid JSON" }; }
  try { return { ok: true, manifest: validateManifest(value), identity: releaseIdentity(value) }; }
  catch (error) { return { ok: false, reason: error.message }; }
}

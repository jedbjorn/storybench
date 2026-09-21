// Version and release identity for `storybench version`. The release manifest schema belongs to the runtime lane
// (storybench.release/1); it is read defensively here, and its absence means a development checkout.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SCHEMA_VERSION } from "../store.js";

export const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export function packageInfo(root = PACKAGE_ROOT) {
  const value = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  return { name: value.name, version: value.version };
}

// A release directory carries manifest.json beside its package.json. STORYBENCH_RELEASE_MANIFEST overrides (tests).
export function readReleaseManifest({ env = process.env, root = PACKAGE_ROOT } = {}) {
  const file = env.STORYBENCH_RELEASE_MANIFEST || path.join(root, "manifest.json");
  let text;
  try { text = readFileSync(file, "utf8"); }
  catch (error) { return error.code === "ENOENT" ? { state: "absent" } : { state: "unreadable", reason: error.code }; }
  let manifest;
  try { manifest = JSON.parse(text); } catch { return { state: "unreadable", reason: "not JSON" }; }
  const str = (value) => (typeof value === "string" && value.length <= 200 ? value : null);
  const range = manifest?.database?.supportedSchema;
  const release = {
    schema: str(manifest?.schema),
    id: str(manifest?.id),
    version: str(manifest?.package?.version),
    commit: str(manifest?.source?.commit),
    ref: str(manifest?.source?.ref),
    builtAt: str(manifest?.builtAt),
    images: { app: str(manifest?.images?.app?.id), worker: str(manifest?.images?.worker?.id) },
    supportedSchema: Number.isInteger(range?.min) && Number.isInteger(range?.max) ? { min: range.min, max: range.max } : null,
  };
  if (release.schema !== "storybench.release/1" || !release.commit) return { state: "unrecognized", release };
  return { state: "release", release };
}

export function versionInfo(options = {}) {
  const pkg = packageInfo(options.root);
  const manifest = readReleaseManifest(options);
  const supportedSchema = manifest.release?.supportedSchema ?? { min: 0, max: SCHEMA_VERSION };
  return { package: pkg, manifest, supportedSchema, codeSchema: SCHEMA_VERSION };
}

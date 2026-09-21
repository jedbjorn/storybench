// Version and release identity for `storybench version`. The release manifest has one definition,
// src/runtime/manifest.js; this module only locates it and reports what that reader returns.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SCHEMA_VERSION } from "../store.js";
import { MIN_SUPPORTED_SCHEMA, readReleaseManifest } from "../runtime/manifest.js";

export const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export function packageInfo(root = PACKAGE_ROOT) {
  const value = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  return { name: value.name, version: value.version };
}

// A release directory carries manifest.json beside its package.json. STORYBENCH_RELEASE_MANIFEST overrides (tests).
export function manifestFile({ env = process.env, root = PACKAGE_ROOT } = {}) {
  return env.STORYBENCH_RELEASE_MANIFEST || path.join(root, "manifest.json");
}

// state: "release" (valid manifest), "absent" (development checkout) or "invalid" (present but rejected).
export async function versionInfo(options = {}) {
  const pkg = packageInfo(options.root);
  const file = manifestFile(options);
  let manifest;
  if (!existsSync(file)) manifest = { state: "absent" };
  else {
    const result = await readReleaseManifest(file);
    manifest = result.ok ? { state: "release", manifest: result.manifest, identity: result.identity } : { state: "invalid", reason: result.reason };
  }
  const supportedSchema = manifest.identity?.supportedSchema ?? { min: MIN_SUPPORTED_SCHEMA, max: SCHEMA_VERSION };
  return { package: pkg, manifest, supportedSchema, codeSchema: SCHEMA_VERSION };
}

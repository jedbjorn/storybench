// Version and release identity for `storybench version`. The release manifest has one definition,
// src/runtime/manifest.js; this module only locates it and reports what that reader returns.
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SCHEMA_VERSION } from "../store.js";
import { MIN_SUPPORTED_SCHEMA, readReleaseManifest } from "../runtime/manifest.js";
import { CliError } from "./errors.js";

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

// Resolve only an actual installed `current` pointer. A manifest beside a development checkout (or supplied by a
// test override) describes that checkout, but does not make it an installed release suitable for image execution.
export async function installedRelease(context, { required = false } = {}) {
  if (!context.xdg?.current || !context.xdg?.releases) {
    if (!required) return null;
    throw new CliError("No active Storybench release is installed", { hint: "Run the repository installer first." });
  }
  try { lstatSync(context.xdg.current); }
  catch (error) {
    if (error.code === "ENOENT" && !required) return null;
    if (error.code === "ENOENT") throw new CliError("No active Storybench release is installed", { hint: "Run the repository installer first." });
    throw error;
  }
  let root;
  try { root = realpathSync(context.xdg.current); }
  catch { throw new CliError("The active Storybench release pointer is broken"); }
  let releases;
  try { releases = realpathSync(context.xdg.releases); }
  catch { throw new CliError("The Storybench release store is missing"); }
  if (path.dirname(root) !== releases || !/^[0-9a-f]{40}$/.test(path.basename(root)))
    throw new CliError("The active release pointer does not select a commit directory in the Storybench release store");
  const file = path.join(root, "manifest.json");
  const result = await readReleaseManifest(file);
  if (!result.ok) throw new CliError(`The release manifest cannot be used: ${result.reason}`);
  if (result.manifest.source.commit !== path.basename(root))
    throw new CliError("The active release manifest does not match its commit directory");
  return { file, root, manifest: result.manifest, identity: result.identity };
}

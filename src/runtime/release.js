#!/usr/bin/env node
// Build a release's paired app/worker images from docker/Dockerfile and write its
// manifest. This is the single image/manifest definition; the installer (spec #10) calls
// buildRelease() rather than defining its own.
//
//   node src/runtime/release.js build --out /path/manifest.json [--tag storybench] [--allow-dirty] [--rebuild]
//   (an existing manifest at --out for the same commit, with its images present, is reused)
import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { SCHEMA_VERSION } from "../store.js";
import { MIN_SUPPORTED_SCHEMA, createManifest, readReleaseManifest } from "./manifest.js";

const run = promisify(execFile);
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const DOCKERFILE = path.join(REPO_ROOT, "docker/Dockerfile");

const TOOL_PROBE = [
  "echo node=$(node --version)",
  "echo codex=$(codex --version | awk '{print $NF}')",
  "echo claude=$(claude --version | awk '{print $1}')",
  "echo ffmpeg=$(ffmpeg -version | head -1 | awk '{print $3}')",
  "echo poppler=$(pdftotext -v 2>&1 | head -1 | awk '{print $3}')",
  "echo pillow=$(python3 -c 'import PIL; print(PIL.__version__)')",
  "echo resvg=$(resvg --version)",
].join("; ");

// Release idempotency is defined by the manifest: an existing valid manifest for the same
// commit whose exact images are still present is the release, and is returned unchanged.
// (Image IDs are reproducible for one commit when the build cache is warm, but a cold
// rebuild can differ — distro package drift and file timestamps — so IDs alone are not
// relied on for idempotency.)
export async function findReusableRelease(manifestPath, commit) {
  if (!manifestPath) return null;
  const found = await readReleaseManifest(manifestPath);
  if (!found.ok || found.manifest.source.commit !== commit) return null;
  for (const role of ["app", "worker"]) {
    try { await run("docker", ["image", "inspect", found.manifest.images[role].id, "--format", "{{.Id}}"]); }
    catch { return null; }
  }
  return found.manifest;
}

export async function buildRelease({ repo = REPO_ROOT, tag = "storybench", allowDirty = false, reuseManifestPath = null, log = () => {} } = {}) {
  const git = (...args) => run("git", ["-C", repo, ...args]).then((out) => out.stdout.trim());
  const commit = await git("rev-parse", "HEAD");
  // The dirty-tree refusal applies to reuse as well as to a fresh build.
  const dirtyTree = Boolean(await git("status", "--porcelain", "--untracked-files=no"));
  if (dirtyTree && !allowDirty) throw new Error("Refusing to build a release from a checkout with uncommitted tracked changes");
  const reusable = dirtyTree ? null : await findReusableRelease(reuseManifestPath, commit);
  if (reusable) { log(`reusing release ${reusable.id} for ${commit}`); return reusable; }
  const dirty = Boolean(await git("status", "--porcelain", "--untracked-files=no"));
  if (dirty && !allowDirty) throw new Error("Refusing to build a release from a checkout with uncommitted tracked changes");
  const ref = await git("rev-parse", "--abbrev-ref", "HEAD").catch(() => null);
  const epoch = await git("log", "-1", "--format=%ct", commit);
  const pkg = JSON.parse(await readFile(path.join(repo, "package.json"), "utf8"));
  const images = {};
  for (const target of ["app", "worker"]) {
    log(`building ${target}`);
    const imageTag = `${tag}-${target}:${commit.slice(0, 12)}`;
    // No provenance/SBOM attestations (they embed build-time metadata) and a fixed
    // SOURCE_DATE_EPOCH (the commit time) so rebuilding one commit reproduces the same IDs.
    await run("docker", ["build", "-f", DOCKERFILE, "--target", target, "--provenance=false", "--sbom=false",
      "--build-arg", `SOURCE_DATE_EPOCH=${epoch}`, "--label", `io.storybench.commit=${commit}`, "-t", imageTag, repo],
      { maxBuffer: 64 * 1024 * 1024, env: { ...process.env, SOURCE_DATE_EPOCH: epoch } });
    images[target] = (await run("docker", ["image", "inspect", imageTag, "--format", "{{.Id}}"])).stdout.trim();
  }
  const probe = (await run("docker", ["run", "--rm", "--network", "none", images.worker, "sh", "-c", TOOL_PROBE])).stdout;
  const tools = Object.fromEntries(probe.trim().split("\n").map((line) => line.split("=")).filter(([key, value]) => key && value));
  return createManifest({
    packageName: pkg.name, packageVersion: pkg.version, commit, ref,
    images, tools: { ...tools, ...(dirty ? { dirtyCheckout: "true" } : {}) }, schema: { min: MIN_SUPPORTED_SCHEMA, max: SCHEMA_VERSION },
  });
}

async function main(argv) {
  const at = (name) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
  if (argv[0] !== "build" || !at("out")) throw new Error("Usage: release.js build --out /path/manifest.json [--tag storybench] [--allow-dirty]");
  const out = path.resolve(at("out"));
  const manifest = await buildRelease({ tag: at("tag") ?? "storybench", allowDirty: argv.includes("--allow-dirty"),
    reuseManifestPath: argv.includes("--rebuild") ? null : out, log: (line) => console.error(line) });
  await writeFile(out, JSON.stringify(manifest, null, 2) + "\n");
  console.log(JSON.stringify({ id: manifest.id, images: manifest.images, commit: manifest.source.commit }));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(2));

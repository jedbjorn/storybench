#!/usr/bin/env node
// Build a release's paired app/worker images from docker/Dockerfile and write its
// manifest. This is the single image/manifest definition; the installer (spec #10) calls
// buildRelease() rather than defining its own.
//
//   node src/runtime/release.js build --out /path/manifest.json [--tag storybench] [--allow-dirty]
import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { SCHEMA_VERSION } from "../store.js";
import { MIN_SUPPORTED_SCHEMA, createManifest } from "./manifest.js";

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

export async function buildRelease({ repo = REPO_ROOT, tag = "storybench", allowDirty = false, log = () => {} } = {}) {
  const git = (...args) => run("git", ["-C", repo, ...args]).then((out) => out.stdout.trim());
  const commit = await git("rev-parse", "HEAD");
  const dirty = Boolean(await git("status", "--porcelain", "--untracked-files=no"));
  if (dirty && !allowDirty) throw new Error("Refusing to build a release from a checkout with uncommitted tracked changes");
  const ref = await git("rev-parse", "--abbrev-ref", "HEAD").catch(() => null);
  const pkg = JSON.parse(await readFile(path.join(repo, "package.json"), "utf8"));
  const images = {};
  for (const target of ["app", "worker"]) {
    log(`building ${target}`);
    const imageTag = `${tag}-${target}:${commit.slice(0, 12)}`;
    await run("docker", ["build", "-f", DOCKERFILE, "--target", target, "--label", `io.storybench.commit=${commit}`, "-t", imageTag, repo], { maxBuffer: 64 * 1024 * 1024 });
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
  const manifest = await buildRelease({ tag: at("tag") ?? "storybench", allowDirty: argv.includes("--allow-dirty"), log: (line) => console.error(line) });
  await writeFile(path.resolve(at("out")), JSON.stringify(manifest, null, 2) + "\n");
  console.log(JSON.stringify({ id: manifest.id, images: manifest.images, commit: manifest.source.commit }));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(2));

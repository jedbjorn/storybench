// Minimal Docker CLI wrapper for the host lifecycle entry point. Arguments are passed
// as an argv array (no shell). Only host code imports this module.
import { execFile } from "node:child_process";

export class DockerError extends Error {
  constructor(message, { stderr = "", code } = {}) {
    super(message);
    this.name = "DockerError";
    this.stderr = stderr;
    this.exitCode = code;
  }
}

export function docker(args, { timeout = 120_000, input } = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile("docker", args, { timeout, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) reject(new DockerError(`docker ${args[0]} failed: ${(stderr || error.message).trim().slice(0, 2000)}`, { stderr, code: error.code }));
      else resolve(stdout.trim());
    });
    if (input !== undefined) child.stdin.end(input);
  });
}

export async function listByLabels(labels, { all = true } = {}) {
  const filters = Object.entries(labels).flatMap(([key, value]) => ["--filter", `label=${key}=${value}`]);
  const out = await docker(["ps", ...(all ? ["--all"] : []), "--no-trunc", "--format", "{{.ID}}", ...filters]);
  return out ? out.split("\n").filter(Boolean) : [];
}

export async function inspectContainer(id) {
  try { return JSON.parse(await docker(["inspect", "--type", "container", id]))[0] ?? null; }
  catch (error) { if (/No such (container|object)/i.test(error.stderr || error.message)) return null; throw error; }
}

export async function ensureNetwork(name, labels) {
  try { await docker(["network", "inspect", name]); return; }
  catch { /* create below */ }
  const labelArgs = Object.entries(labels).flatMap(([key, value]) => ["--label", `${key}=${value}`]);
  await docker(["network", "create", "--driver", "bridge", ...labelArgs, name]);
}

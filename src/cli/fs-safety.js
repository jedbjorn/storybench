// Ownership and writability checks before any mutation (spec #10 "Safety and Failure"). Paths are data: they are
// canonicalized and checked, never passed through a shell.
import { accessSync, constants, existsSync, lstatSync, mkdirSync } from "node:fs";
import path from "node:path";
import { CliError } from "./errors.js";

export function nearestExistingAncestor(target) {
  let current = path.resolve(target);
  while (!existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return current;
}

// The target, or the nearest ancestor that exists (where it would be created), must belong to this user and be
// writable by them.
export function assertOwnedWritable(target, label) {
  const existing = nearestExistingAncestor(target);
  const where = existing === path.resolve(target) ? existing : `${existing} (where ${target} would be created)`;
  const info = lstatSync(existing);
  if (typeof process.getuid === "function" && info.uid !== process.getuid())
    throw new CliError(`Refusing to use ${label}: ${where} belongs to another user`, { hint: "Use a location owned by your account." });
  try { accessSync(existing, constants.W_OK); }
  catch { throw new CliError(`Refusing to use ${label}: ${where} is not writable`, { hint: "Fix its permissions or choose a writable location owned by your account." }); }
  return existing;
}

export function ensurePrivateDirectory(directory) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
}

// Global configuration: ~/.config/storybench/config.json. Written atomically (temporary sibling, fsync, rename,
// directory fsync); values are data, never shell text.
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeSync } from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { CliError } from "./errors.js";
import { assertOwnedWritable } from "./fs-safety.js";

export const DEFAULT_PORT = 4173;
export const CONFIG_VERSION = 1;

// The one port rule for the CLI and the configuration (the host publishes on a non-privileged loopback port).
export function validatePort(value, { exitCode = undefined } = {}) {
  const port = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new CliError("The port must be an integer from 1024 to 65535", exitCode === undefined ? {} : { exitCode });
  return port;
}

export function validateConfig(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new CliError("The Storybench configuration is not a JSON object");
  if (value.version !== CONFIG_VERSION) throw new CliError(`Unsupported configuration version ${JSON.stringify(value.version)}`);
  if (typeof value.dataRoot !== "string" || !path.isAbsolute(value.dataRoot)) throw new CliError("The configured data root must be an absolute path");
  if (value.dataRootId != null && typeof value.dataRootId !== "string") throw new CliError("The configured data-root identity is invalid");
  if (value.installId != null && (typeof value.installId !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(value.installId)))
    throw new CliError("The configured installation ID is invalid");
  const credentials = {};
  for (const harness of ["codex", "claude"]) {
    const file = value.credentials?.[harness];
    if (file == null) continue;
    if (typeof file !== "string" || !path.isAbsolute(file)) throw new CliError(`The configured ${harness} login path must be absolute`);
    credentials[harness] = path.resolve(file);
  }
  return { version: CONFIG_VERSION, dataRoot: path.resolve(value.dataRoot), dataRootId: value.dataRootId ?? null, port: validatePort(value.port ?? DEFAULT_PORT),
    ...(value.installId ? { installId: value.installId } : {}), ...(Object.keys(credentials).length ? { credentials } : {}) };
}

export function readConfig(file) {
  let text;
  try { text = readFileSync(file, "utf8"); }
  catch (error) { if (error.code === "ENOENT") return null; throw new CliError(`Cannot read the Storybench configuration (${error.code})`); }
  let parsed;
  try { parsed = JSON.parse(text); }
  catch { throw new CliError("The Storybench configuration is not valid JSON", { hint: "Repair or remove the configuration file, then run `storybench init`." }); }
  return validateConfig(parsed);
}

export function writeConfigAtomic(file, config, { beforeRename = null } = {}) {
  const value = validateConfig(config);
  const directory = path.dirname(file);
  assertOwnedWritable(directory, "the configuration directory");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temporary = path.join(directory, `.${path.basename(file)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  let descriptor = openSync(temporary, "wx", 0o600);
  try {
    writeSync(descriptor, `${JSON.stringify(value, null, 2)}\n`);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = null;
    beforeRename?.(temporary);
    renameSync(temporary, file);
  } catch (error) {
    if (descriptor != null) closeSync(descriptor);
    rmSync(temporary, { force: true });
    throw error;
  }
  const directoryHandle = openSync(directory, "r");
  try { fsyncSync(directoryHandle); } finally { closeSync(directoryHandle); }
  return value;
}

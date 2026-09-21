// Global configuration: ~/.config/storybench/config.json. Written atomically (temporary sibling, fsync, rename,
// directory fsync); values are data, never shell text.
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeSync } from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { CliError } from "./errors.js";

export const DEFAULT_PORT = 4173;
export const CONFIG_VERSION = 1;

export function validatePort(value) {
  const port = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new CliError("The port must be an integer from 1 to 65535");
  return port;
}

export function validateConfig(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new CliError("The Storybench configuration is not a JSON object");
  if (value.version !== CONFIG_VERSION) throw new CliError(`Unsupported configuration version ${JSON.stringify(value.version)}`);
  if (typeof value.dataRoot !== "string" || !path.isAbsolute(value.dataRoot)) throw new CliError("The configured data root must be an absolute path");
  if (value.dataRootId != null && typeof value.dataRootId !== "string") throw new CliError("The configured data-root identity is invalid");
  return { version: CONFIG_VERSION, dataRoot: path.resolve(value.dataRoot), dataRootId: value.dataRootId ?? null, port: validatePort(value.port ?? DEFAULT_PORT) };
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

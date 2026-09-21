// Durable identity for image/container ownership. It exists before init so the first
// release build is installation-specific, then becomes the config installId.
import crypto from "node:crypto";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeSync } from "node:fs";
import path from "node:path";
import { CliError } from "./errors.js";

const INSTALL_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function installationIdFile(xdg) { return path.join(xdg.share, "installation-id"); }

export function readInstallationId(xdg) {
  try {
    const value = readFileSync(installationIdFile(xdg), "utf8").trim();
    if (!INSTALL_ID.test(value)) throw new CliError("The installed Storybench identity is invalid");
    return value;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

export function ensureInstallationId(xdg, configuredId = null) {
  if (configuredId != null && !INSTALL_ID.test(configuredId)) throw new CliError("The configured Storybench installation ID is invalid");
  const existing = readInstallationId(xdg);
  if (existing && configuredId && existing !== configuredId)
    throw new CliError("The installed Storybench identity does not match its configuration", {
      hint: "Restore the matching configuration or installation before managing releases.",
    });
  if (existing) return existing;
  const value = configuredId ?? `sb${crypto.randomBytes(5).toString("hex")}`;
  const file = installationIdFile(xdg);
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  let descriptor = openSync(temporary, "wx", 0o600);
  try {
    writeSync(descriptor, `${value}\n`); fsyncSync(descriptor); closeSync(descriptor); descriptor = null;
    renameSync(temporary, file);
    const directory = openSync(path.dirname(file), "r");
    try { fsyncSync(directory); } finally { closeSync(directory); }
  } catch (error) {
    if (descriptor != null) closeSync(descriptor);
    rmSync(temporary, { force: true });
    throw error;
  }
  return value;
}

export function installedOrConfiguredId(xdg, configuredId = null) {
  return configuredId ?? (existsSync(xdg.share) ? readInstallationId(xdg) : null);
}

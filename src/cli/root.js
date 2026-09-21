// The configured data root, verified before any operation that uses it: never created or replaced implicitly.
import { inspectDataRoot } from "../services/data-root.js";
import { readConfig } from "./config.js";
import { CliError } from "./errors.js";

export function configuredRoot(context) {
  const config = readConfig(context.xdg.configFile);
  if (!config) throw new CliError("Storybench is not initialized on this account", { hint: "Run `storybench init [DIR]` (or `storybench init DIR --adopt` for a prototype workspace)." });
  const info = inspectDataRoot(config.dataRoot);
  if (info.state === "missing") throw new CliError(`The configured data root ${config.dataRoot} is missing`, { hint: restoreHint(config.dataRoot) });
  if (info.state === "legacy") throw new CliError(`The configured data root ${config.dataRoot} is an unadopted prototype workspace`, { hint: `Run \`storybench init ${config.dataRoot} --adopt\`.` });
  if (info.state !== "initialized") throw new CliError(`The configured data root ${config.dataRoot} is not a usable Storybench data root (${info.state})`, {
    hint: "Check the path in the configuration; Storybench does not repair or replace it automatically." });
  if (config.dataRootId && info.identity.id !== config.dataRootId) throw new CliError(`The data root at ${config.dataRoot} is a different Storybench installation than the one configured`, {
    hint: restoreHint(config.dataRoot) });
  return config;
}

export const restoreHint = (root) => `Restore or remount the configured data root at ${root}. Storybench never creates or substitutes a replacement.`;

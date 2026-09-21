// Command registry: usage, options and handlers. Help text is generated from these definitions so it stays complete.
import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import { StoreError } from "../store.js";
import { adoptWorkspace, initDataRoot, inspectDataRoot } from "../services/data-root.js";
import { DEFAULT_PORT, readConfig, writeConfigAtomic } from "./config.js";
import { CliError, EXIT } from "./errors.js";
import { withLock } from "./lock.js";
import { versionInfo } from "./release.js";
import { assertCurrentSchema, selectExecutor } from "./executor.js";
import { assertServiceStopped, runDown, runLogs, runOpen, runRestart, runStatus, runUp } from "./lifecycle.js";
import { assertOwnedWritable } from "./fs-safety.js";

// Canonical absolute path: resolve symlinks of the longest existing prefix; the rest is kept as data.
export function canonicalPath(input, cwd) {
  const absolute = path.resolve(cwd, input);
  const missing = [];
  let current = absolute;
  while (!existsSync(current)) {
    missing.unshift(path.basename(current));
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return path.join(realpathSync(current), ...missing);
}

// Service-layer refusals become CLI errors without stack traces or environment details.
function fromService(error) {
  if (error instanceof StoreError) return new CliError(error.message, { exitCode: EXIT.FAILED });
  return error;
}

// The configured data root, verified before any operation: never created or replaced implicitly.
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

const restoreHint = (root) => `Restore or remount the configured data root at ${root}. Storybench never creates or substitutes a replacement.`;

async function runInit(context, { positionals: [dir], options }) {
  if (options["channel-name"] !== undefined && !options.adopt) throw new CliError("--channel-name only applies with --adopt", { exitCode: EXIT.USAGE, hint: "Usage: storybench init [DIR] [--adopt] [--channel-name NAME]" });
  const target = canonicalPath(dir ?? ".", context.cwd);
  const existing = readConfig(context.xdg.configFile);
  if (existing && existing.dataRoot !== target)
    throw new CliError(`Storybench is already configured for the data root ${existing.dataRoot}`, {
      hint: "This build does not switch data roots; keep the configured root, or move the configuration aside deliberately first." });
  const port = existing?.port ?? DEFAULT_PORT;
  assertOwnedWritable(target, "the data root");
  assertOwnedWritable(path.dirname(context.xdg.configFile), "the configuration directory");
  if (options.adopt) {
    // Adoption migrates the database in place, so no Storybench service may have it open.
    await assertServiceStopped(context, existing ?? { port }, "adopting");
  }
  const operation = options.adopt ? "init --adopt" : "init";
  let result;
  try {
    result = await withLock(context.xdg.lockDir, operation, async () => {
      // Decide from the current state before anything is written.
      const info = inspectDataRoot(target);
      if (existing?.dataRootId) {
        if (["missing", "empty", "unrelated"].includes(info.state))
          throw new CliError(`The configured data root ${target} is ${info.state === "missing" ? "missing" : "not a Storybench data root any more"}`, { hint: restoreHint(target) });
        if (info.state === "initialized" && info.identity.id !== existing.dataRootId)
          throw new CliError(`The data root at ${target} is a different Storybench installation than the one configured`, { hint: restoreHint(target) });
      }
      // Plain init never upgrades a database; --adopt is the explicit, backed-up migration path.
      if (!options.adopt && info.state === "initialized") assertCurrentSchema(info, target);
      if (info.state === "newer") assertCurrentSchema(info, target);
      return options.adopt ? adoptWorkspace(target, { channelName: options["channel-name"] ?? undefined }) : initDataRoot(target);
    }, { timeoutMs: context.lockTimeoutMs });
  } catch (error) {
    const mapped = fromService(error);
    if (!options.adopt && /adopt it instead/.test(mapped.message)) mapped.hint = `Run \`storybench init ${target} --adopt\`.`;
    throw mapped;
  }
  writeConfigAtomic(context.xdg.configFile, { version: 1, dataRoot: target, dataRootId: result.identity.id, port });
  const out = context.out;
  if (options.adopt) {
    if (result.adopted) out(`Adopted the prototype workspace at ${target} (schema ${result.previousSchemaVersion} -> ${result.identity.schemaVersion}).\nMetadata backup: ${result.backupPath}`);
    else if (result.upgraded) out(`The data root at ${target} was already adopted; upgraded its database from schema ${result.upgraded.from} to ${result.upgraded.to}.\nMetadata backup: ${result.upgraded.backupPath ?? "(none recorded)"}`);
    else out(`The workspace at ${target} was already adopted and current; nothing changed.`);
  }
  else out(result.created ? `Initialized a Storybench data root at ${target}.` : `The data root at ${target} is already initialized; nothing changed.`);
  out(`Configuration: ${context.xdg.configFile} (port ${port})`);
  if (!result.channels.length) out("Next: create a channel with `storybench channel create NAME`, then start with `storybench up`.");
  else out(`Channels: ${result.channels.map((channel) => `${channel.name}${channel.isDefault ? " (default)" : ""}`).join(", ")}\nNext: \`storybench up\`.`);
  return EXIT.OK;
}

async function channelExecutor(context) {
  const config = configuredRoot(context);
  return selectExecutor({ dataRoot: config.dataRoot, dataRootId: config.dataRootId, lockDir: context.xdg.lockDir, lockTimeoutMs: context.lockTimeoutMs,
    port: config.port, probeService: context.probeService });
}
const channelLine = (channel) => `${channel.isDefault ? "*" : " "} ${channel.id}  ${channel.name}`;

async function runChannel(context, sub, { positionals }) {
  const executor = await channelExecutor(context);
  try {
    if (sub === "create") {
      const channel = await executor.createChannel(positionals[0]);
      context.out(`Created channel ${channel.name} (${channel.id})${channel.isDefault ? "; it is the default channel" : ""}.`);
    } else if (sub === "list") {
      const { channels } = await executor.listChannels();
      if (!channels.length) context.out("No channels yet. Create one with `storybench channel create NAME`.");
      else { context.out("  ID                                             NAME"); for (const channel of channels) context.out(channelLine(channel)); context.out("* = default channel for opening Storybench"); }
    } else if (sub === "current") {
      const channel = await executor.currentChannel();
      context.out(channel ? `${channel.name} (${channel.id})` : "No channel exists yet. Create one with `storybench channel create NAME`.");
    } else if (sub === "use") {
      const channel = await executor.useChannel(positionals[0]);
      context.out(`Default channel is now ${channel.name} (${channel.id}). Running work and open views are unaffected.`);
    }
  } catch (error) {
    if (error instanceof StoreError && error.statusCode === 404) throw new CliError(`Unknown channel: ${positionals[0]}`, { hint: "Run `storybench channel list` to see channel names and IDs." });
    throw fromService(error);
  }
  return EXIT.OK;
}

async function runVersion(context) {
  const info = await versionInfo({ env: context.env });
  context.out(`storybench ${info.package.version} (CLI and package ${info.package.name})`);
  const { manifest } = info;
  if (manifest.state === "release") {
    const { identity, manifest: value } = manifest;
    context.out(`Release: ${identity.manifestId}\nCommit: ${identity.commit}${value.source.ref ? ` (${value.source.ref})` : ""}\nBuilt: ${value.builtAt ?? "unknown"}`);
    context.out(`Images: app ${identity.images.app}, worker ${identity.images.worker}\nRuntime protocol: ${identity.protocol}`);
  } else if (manifest.state === "absent") context.out("Release: development checkout (no release manifest)");
  else context.out(`Release: the release manifest is not valid (${manifest.reason}); reporting this checkout's own schema support`);
  context.out(`Supported database schema: ${info.supportedSchema.min}-${info.supportedSchema.max}`);
  let config = null;
  try { config = readConfig(context.xdg.configFile); } catch { /* reported by other commands */ }
  if (!config) { context.out("Service: not configured (run `storybench init`)"); return EXIT.OK; }
  const service = await context.probeService(config.port);
  if (service.state === "running") {
    context.out(`Service: running on 127.0.0.1:${config.port} (database schema ${service.schemaVersion})`);
    if (service.schemaVersion > info.supportedSchema.max) context.out(`Mismatch: the running service uses schema ${service.schemaVersion}, newer than this CLI supports (${info.supportedSchema.max}).`);
    if (config.dataRootId && service.dataRootId !== config.dataRootId) context.out("Mismatch: the running service serves a different data root than the configured one.");
  } else if (service.state === "other") context.out(`Service: port ${config.port} is used by another program`);
  else context.out(`Service: not running on port ${config.port}`);
  return EXIT.OK;
}

const CHANNEL_SUBCOMMANDS = {
  create: { usage: "storybench channel create NAME", summary: "Add a channel; the first channel becomes the default", args: [1, 1],
    description: "Adds a channel record and its managed folders beneath the configured data root. Names are unique regardless of case; the channel's ID never changes.",
    examples: ["storybench channel create \"Cooking\""] },
  list: { usage: "storybench channel list", summary: "Show channel IDs and names, marking the default", args: [0, 0], examples: ["storybench channel list"] },
  current: { usage: "storybench channel current", summary: "Print the default channel used when opening Storybench", args: [0, 0],
    description: "The default only chooses where Storybench opens; the service serves every channel.", examples: ["storybench channel current"] },
  use: { usage: "storybench channel use NAME_OR_ID", summary: "Change the default channel", args: [1, 1],
    description: "Changes only the default for later opening. Nothing restarts, running work continues, and open views keep their channel.",
    examples: ["storybench channel use Cooking", "storybench channel use channel_2f6c…"] },
};

export const COMMANDS = {
  init: {
    usage: "storybench init [DIR] [--adopt] [--channel-name NAME]", summary: "Initialize (or adopt) and configure the data root", args: [0, 1],
    description: "Explicitly initializes DIR (default: the current directory) as the Storybench data root and records it in the configuration.\n" +
      "Unrelated files in DIR are left alone and never imported; conflicting Storybench state is refused.\n" +
      "--adopt migrates an existing prototype workspace in place into its first channel after a consistent metadata backup,\n" +
      "preserving IDs, media bytes and recorded paths. Adopting again changes nothing. The service must be stopped.",
    options: { adopt: { type: "boolean", help: "Adopt a prototype workspace instead of initializing an empty root" },
      "channel-name": { type: "string", help: "Name for the first channel when adopting (default: Main)" } },
    examples: ["storybench init ~/Storybench", "storybench init ~/.local/share/storybench/prototype --adopt --channel-name Prototype"],
    run: runInit,
  },
  channel: { usage: "storybench channel <create|list|current|use>", summary: "Create, list and select channels", subcommands: CHANNEL_SUBCOMMANDS, run: runChannel },
  version: { usage: "storybench version", summary: "Print the CLI version, release identity and supported schema range", args: [0, 0],
    description: "Works while the service is stopped. A checkout without a release manifest reports itself as a development checkout.",
    examples: ["storybench version"], run: runVersion },
  up: { usage: "storybench up [--port N] [--open]", summary: "Start the Storybench service and wait until it is healthy", args: [0, 0],
    description: "Starts the one user service for the configured data root and waits for health that matches this release and data root.\n" +
      "--port validates and saves a new port first; a port already in use is reported. Running `up` again while healthy changes nothing.",
    options: { port: { type: "string", help: "Serve on this loopback port (1024-65535) from now on" }, open: { type: "boolean", help: "Open Storybench in the browser once healthy" } },
    examples: ["storybench up", "storybench up --port 4180 --open"], run: (context, parsed) => runUp(context, parsed, configuredRoot) },
  down: { usage: "storybench down", summary: "Stop the Storybench service gracefully", args: [0, 0],
    description: "Drains and stops the service. Running it again succeeds. Channels and the default channel are never changed.",
    examples: ["storybench down"], run: (context, parsed) => runDown(context, parsed, configuredRoot) },
  restart: { usage: "storybench restart [--force]", summary: "Stop and start the service, protecting active work", args: [0, 0],
    description: "Refuses while any channel has active renders or agent turns unless --force is given (interrupted work is not replayed).\n" +
      "Verifies that the same release and data root are served afterwards.",
    options: { force: { type: "boolean", help: "Restart even though work is active" } }, examples: ["storybench restart"], run: (context, parsed) => runRestart(context, parsed, configuredRoot) },
  status: { usage: "storybench status", summary: "Report service state, URL, release, data root and default channel", args: [0, 0],
    description: "States: stopped, starting, healthy, mismatched (serving another release or data root), stopping or failed.",
    examples: ["storybench status"], run: (context, parsed) => runStatus(context, parsed, configuredRoot) },
  open: { usage: "storybench open", summary: "Open the running Storybench in the browser", args: [0, 0],
    description: "Opens the healthy URL, on the default channel, with the desktop's opener. Fails with a hint when Storybench is stopped.",
    examples: ["storybench open"], run: (context, parsed) => runOpen(context, parsed, configuredRoot) },
  logs: { usage: "storybench logs [-f]", summary: "Show this installation's service log", args: [0, 0],
    description: "Shows only this service's journal (lifecycle, app and worker diagnostics).",
    options: { follow: { type: "boolean", short: "f", help: "Keep following new entries" } }, examples: ["storybench logs", "storybench logs -f"],
    run: (context, parsed) => runLogs(context, parsed, configuredRoot) },
  help: { usage: "storybench help [COMMAND [SUBCOMMAND]]", summary: "Show help for Storybench or one command", args: [0, 2], examples: ["storybench help channel use"] },
};

// Registered for a stable surface; hidden from help until their tasks land.
export const UNAVAILABLE = ["doctor", "update", "rollback", "backup", "uninstall"];

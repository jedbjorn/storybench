// storybench CLI entry: parse, dispatch, and map failures to exit codes. main() is pure over its context so tests can
// run it in-process with a temporary HOME/XDG tree.
import os from "node:os";
import { COMMANDS, UNAVAILABLE } from "./commands.js";
import { CliError, EXIT, usageError } from "./errors.js";
import { probeService } from "./service.js";
import { resolveXdg } from "./xdg.js";

const COMMON_OPTIONS = { help: { type: "boolean", help: "Show this help" } };

export function parseArgs(tokens, options = {}) {
  const known = { ...COMMON_OPTIONS, ...options };
  const positionals = [], values = {};
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token === "--") { positionals.push(...tokens.slice(index + 1)); break; }
    if (token === "-h") { values.help = true; continue; }
    if (token.startsWith("--")) {
      const [name, inline] = token.slice(2).split(/=(.*)/s, 2);
      const spec = known[name];
      if (!spec) throw usageError(`Unknown option --${name}`);
      if (spec.type === "boolean") {
        if (inline !== undefined) throw usageError(`--${name} does not take a value`);
        values[name] = true;
      } else {
        const value = inline ?? tokens[++index];
        if (value === undefined || (inline === undefined && value.startsWith("--"))) throw usageError(`--${name} requires a value`);
        values[name] = value;
      }
      continue;
    }
    if (token.startsWith("-") && token !== "-") throw usageError(`Unknown option ${token}`);
    positionals.push(token);
  }
  return { positionals, options: values };
}

function commandHelp(name, spec) {
  const lines = [`Usage: ${spec.usage}`, "", spec.summary + "."];
  if (spec.description) lines.push("", spec.description);
  if (spec.subcommands) {
    lines.push("", "Commands:");
    for (const [sub, value] of Object.entries(spec.subcommands)) lines.push(`  ${sub.padEnd(10)}${value.summary}`);
    lines.push("", `Run \`storybench ${name} <command> --help\` for details.`);
  }
  const options = { ...(spec.options || {}), ...COMMON_OPTIONS };
  lines.push("", "Options:");
  for (const [option, value] of Object.entries(options)) lines.push(`  --${option}${value.type === "string" ? " VALUE" : ""}`.padEnd(26) + value.help);
  if (spec.examples?.length) lines.push("", "Examples:", ...spec.examples.map((example) => `  ${example}`));
  return lines.join("\n");
}

export function topHelp() {
  const lines = ["Usage: storybench <command> [options]", "", "Storybench keeps channels, episodes and media in one data root and runs as one local service.", "", "Commands:"];
  for (const [name, spec] of Object.entries(COMMANDS)) lines.push(`  ${name.padEnd(10)}${spec.summary}`);
  lines.push("", "Run `storybench help COMMAND` or `storybench COMMAND --help` for details.",
    "Configuration follows XDG locations (default ~/.config/storybench/config.json).");
  return lines.join("\n");
}

function helpFor(path) {
  if (!path.length) return { text: topHelp() };
  const [name, sub, ...extra] = path;
  if (UNAVAILABLE.includes(name)) return { text: `storybench ${name}: not available in this build.`, unavailable: true };
  const spec = COMMANDS[name];
  if (!spec) throw usageError(`Unknown command: ${name}`);
  if (sub === undefined) return { text: commandHelp(name, spec) };
  if (!spec.subcommands?.[sub] || extra.length) throw usageError(`Unknown command: ${path.join(" ")}`, `Run \`storybench help ${name}\`.`);
  return { text: commandHelp(`${name} ${sub}`, spec.subcommands[sub]) };
}

function checkArity(spec, positionals, label) {
  const [min, max] = spec.args ?? [0, 0];
  if (positionals.length < min) throw usageError(`${label} needs ${min === max ? min : `at least ${min}`} argument${min === 1 ? "" : "s"}`, `Usage: ${spec.usage}`);
  if (positionals.length > max) throw usageError(`${label} takes at most ${max} argument${max === 1 ? "" : "s"}`, `Usage: ${spec.usage}`);
}

export async function main(argv, overrides = {}) {
  const env = overrides.env ?? process.env;
  const stdout = overrides.stdout ?? process.stdout, stderr = overrides.stderr ?? process.stderr;
  const context = {
    env, cwd: overrides.cwd ?? process.cwd(),
    xdg: resolveXdg({ env, home: overrides.home ?? env.HOME ?? os.homedir() }),
    lockTimeoutMs: overrides.lockTimeoutMs ?? (Number(env.STORYBENCH_LOCK_TIMEOUT_MS) || 10_000),
    probeService: overrides.probeService ?? probeService,
    out: (text) => stdout.write(`${text}\n`),
  };
  try {
    const [name, ...rest] = argv;
    if (name === undefined || name === "--help" || name === "-h") { context.out(topHelp()); return EXIT.OK; }
    if (name === "--version") return await COMMANDS.version.run(context, { positionals: [], options: {} });
    if (UNAVAILABLE.includes(name)) throw new CliError(`${name} is not available in this build.`, { exitCode: EXIT.USAGE });
    if (name === "help") {
      const { positionals } = parseArgs(rest);
      if (positionals.length > 2) throw usageError("help takes at most a command and a subcommand");
      const result = helpFor(positionals);
      if (result.unavailable) throw new CliError(`${positionals[0]} is not available in this build.`, { exitCode: EXIT.USAGE });
      context.out(result.text);
      return EXIT.OK;
    }
    const spec = COMMANDS[name];
    if (!spec) throw usageError(`Unknown command: ${name}`);
    if (spec.subcommands) {
      const [sub, ...subArgs] = rest;
      if (sub === undefined || sub === "--help" || sub === "-h") {
        if (sub === undefined) throw usageError(`${name} needs a command`, `Run \`storybench help ${name}\`.`);
        context.out(commandHelp(name, spec)); return EXIT.OK;
      }
      const subSpec = spec.subcommands[sub];
      if (!subSpec) throw usageError(`Unknown command: ${name} ${sub}`, `Run \`storybench help ${name}\`.`);
      const parsed = parseArgs(subArgs, subSpec.options);
      if (parsed.options.help) { context.out(commandHelp(`${name} ${sub}`, subSpec)); return EXIT.OK; }
      checkArity(subSpec, parsed.positionals, `${name} ${sub}`);
      return await spec.run(context, sub, parsed);
    }
    const parsed = parseArgs(rest, spec.options);
    if (parsed.options.help) { context.out(commandHelp(name, spec)); return EXIT.OK; }
    checkArity(spec, parsed.positionals, name);
    return await spec.run(context, parsed);
  } catch (error) {
    if (error instanceof CliError) {
      stderr.write(`storybench: ${error.message}\n${error.hint ? `${error.hint}\n` : ""}`);
      return error.exitCode;
    }
    // Unexpected failures: report the message only (no environment or stack) and the generic failure code.
    stderr.write(`storybench: ${error?.message || "unexpected failure"}\n`);
    return EXIT.FAILED;
  }
}

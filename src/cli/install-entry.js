// Dependency-free parser/context for the clean-clone `__install` handoff. Do not import
// commands.js here: normal CLI commands load application services and their npm dependencies.
import os from "node:os";
import path from "node:path";
import { CliError, EXIT } from "./errors.js";
import { installFromSource } from "./install.js";
import { hostSystem, runCommand } from "./system.js";
import { resolveXdg } from "./xdg.js";

const HELP = `Usage: storybench __install --source DIR --commit SHA --remote URL --ref REF [--docker-version VERSION]

Internal exact-release installer handoff.

Seeds the app-owned mirror, exports and verifies the exact commit, builds and verifies the paired
images, atomically selects the release, installs the launcher and unit, and never starts the service.

Options:
  --source VALUE          Absolute clean source checkout
  --commit VALUE          Exact full commit ID
  --remote VALUE          Recorded credential-free origin fetch URL
  --ref VALUE             Recorded source branch/ref
  --docker-version VALUE  Docker server version recorded by preflight
  --help                  Show this help`;

function parse(tokens) {
  const allowed = new Set(["source", "commit", "remote", "ref", "docker-version"]);
  const options = {};
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token === "--help" || token === "-h") return { help: true };
    if (!token.startsWith("--")) throw new CliError(`Unexpected installer argument: ${token}`, { exitCode: EXIT.USAGE });
    const [name, inline] = token.slice(2).split(/=(.*)/s, 2);
    if (!allowed.has(name)) throw new CliError(`Unknown option --${name}`, { exitCode: EXIT.USAGE });
    const value = inline ?? tokens[++index];
    if (value === undefined || (inline === undefined && value.startsWith("--"))) throw new CliError(`--${name} requires a value`, { exitCode: EXIT.USAGE });
    if (options[name] !== undefined) throw new CliError(`--${name} was given more than once`, { exitCode: EXIT.USAGE });
    options[name] = value;
  }
  for (const name of ["source", "commit", "remote", "ref"])
    if (!options[name]) throw new CliError(`--${name} is required`, { exitCode: EXIT.USAGE, hint: "Run the repository's ./install.sh bootstrap." });
  return { options };
}

export async function runInstallEntry(argv, overrides = {}) {
  const stdout = overrides.stdout ?? process.stdout, stderr = overrides.stderr ?? process.stderr;
  try {
    const parsed = parse(argv);
    if (parsed.help) { stdout.write(`${HELP}\n`); return EXIT.OK; }
    const env = overrides.env ?? process.env;
    const home = overrides.home ?? env.HOME ?? os.homedir();
    const context = {
      env, home, cwd: overrides.cwd ?? process.cwd(), xdg: resolveXdg({ env, home }),
      nodePath: overrides.nodePath ?? process.execPath,
      lockTimeoutMs: overrides.lockTimeoutMs ?? (Number(env.STORYBENCH_LOCK_TIMEOUT_MS) || 10_000),
      system: overrides.system ?? hostSystem({ env }), runCommand: overrides.runCommand ?? runCommand,
      out: (text) => stdout.write(`${text}\n`),
    };
    return await installFromSource(context, {
      source: path.resolve(parsed.options.source), commit: parsed.options.commit, remote: parsed.options.remote,
      ref: parsed.options.ref, dockerVersion: parsed.options["docker-version"],
    }, overrides.installAdapters);
  } catch (error) {
    if (error instanceof CliError) {
      stderr.write(`storybench: ${error.message}\n${error.hint ? `${error.hint}\n` : ""}`);
      return error.exitCode;
    }
    stderr.write(`storybench: ${error?.message || "unexpected failure"}\n`);
    return EXIT.FAILED;
  }
}

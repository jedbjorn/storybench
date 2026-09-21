// Read-only installation diagnostics. Output is deliberately bounded and content-free:
// credential checks report availability only, never hashes, tokens or file contents.
import { accessSync, constants, existsSync, lstatSync, realpathSync } from "node:fs";
import path from "node:path";
import { inspectDataRoot } from "../services/data-root.js";
import { readCredential } from "../runtime/credentials.js";
import { readReleaseManifest } from "../runtime/manifest.js";
import { readConfig } from "./config.js";
import { EXIT } from "./errors.js";
import { readInstallReceipt } from "./install.js";
import { manifestFile } from "./release.js";
import { runCommand } from "./system.js";
import { unitName } from "./unit.js";

function oneLine(value) { return String(value || "").trim().split("\n")[0]; }

export async function runDoctor(context) {
  const run = context.runCommand ?? runCommand;
  let failures = 0, warnings = 0;
  const report = (level, label, detail) => {
    if (level === "FAIL") failures++;
    if (level === "WARN") warnings++;
    context.out(`${level} ${label}: ${detail}`);
  };
  const command = async (name, args, validate = () => true) => {
    try {
      const result = await run(name, args, { timeoutMs: 30_000, env: context.env });
      if (result.code !== 0 || !validate(result.stdout)) report("FAIL", name, `unavailable (${oneLine(result.stderr) || `exit ${result.code}`})`);
      else report("PASS", name, oneLine(result.stdout) || "available");
      return result;
    } catch (error) { report("FAIL", name, `unavailable (${error.code || error.message})`); return null; }
  };

  await command("node", ["--version"], (out) => /^v(2[4-9]|[3-9]\d)\./.test(out.trim()));
  await command("npm", ["--version"]);
  await command("git", ["--version"]);
  const docker = await command("docker", ["info", "--format", "{{.ServerVersion}}"]).catch(() => null);
  // The executable is useful even before init; PATH absence is actionable but not a broken install.
  const pathEntries = String(context.env.PATH || "").split(":").map((entry) => path.resolve(entry || "."));
  report(pathEntries.includes(path.resolve(context.xdg.bin)) ? "PASS" : "WARN", "PATH",
    pathEntries.includes(path.resolve(context.xdg.bin)) ? `${context.xdg.bin} is present` : `${context.xdg.bin} is not on PATH`);

  for (const [label, target] of [["config", context.xdg.config], ["data", context.xdg.share], ["state", context.xdg.state], ["runtime", context.xdg.lockDir]]) {
    try {
      let current = target;
      while (!existsSync(current)) current = path.dirname(current);
      const info = lstatSync(current);
      accessSync(current, constants.R_OK | constants.W_OK);
      if (typeof process.getuid === "function" && info.uid !== process.getuid()) report("FAIL", `XDG ${label}`, `${current} belongs to another user`);
      else if (info.mode & 0o002) report("FAIL", `XDG ${label}`, `${current} is writable by other users`);
      else report("PASS", `XDG ${label}`, `${target} is owned and writable`);
    } catch (error) { report("FAIL", `XDG ${label}`, `${target} is not usable (${error.code || error.message})`); }
  }

  const file = manifestFile({ env: context.env });
  const release = await readReleaseManifest(file);
  if (!release.ok) report("FAIL", "release manifest", release.reason);
  else {
    report("PASS", "release manifest", `${release.manifest.id} (commit ${release.manifest.source.commit})`);
    const receipt = readInstallReceipt(path.join(path.dirname(file), "install.json"), release.manifest);
    report(receipt.ok ? "PASS" : "FAIL", "install receipt", receipt.ok ? `installed ${receipt.receipt.installedAt}` : receipt.reason);
    try {
      const active = realpathSync(context.xdg.current);
      const runningFrom = realpathSync(path.dirname(file));
      report(active === runningFrom ? "PASS" : "FAIL", "release pointer", active === runningFrom ? active : `current selects ${active}, CLI runs ${runningFrom}`);
    } catch (error) { report("FAIL", "release pointer", `cannot resolve current (${error.code || error.message})`); }
    const remote = release.manifest.source.remote;
    const mirror = await run("git", ["--git-dir", context.xdg.mirror, "cat-file", "-e", `${release.manifest.source.commit}^{commit}`], { timeoutMs: 30_000, env: context.env })
      .catch(() => ({ code: 1 }));
    report(mirror.code === 0 ? "PASS" : "FAIL", "source mirror", mirror.code === 0 ? "exact release commit is available for updates" : "exact release commit is missing from the app-owned mirror");
    if (!remote) report("WARN", "source access", "the release does not record an origin URL");
    else {
      const result = await run("git", ["ls-remote", "--exit-code", remote, release.manifest.source.ref || "HEAD"], { timeoutMs: 30_000, env: context.env }).catch((error) => ({ code: 1, stderr: error.code || error.message }));
      report(result.code === 0 ? "PASS" : "FAIL", "source access", result.code === 0 ? "recorded origin/ref is readable" : `recorded origin/ref is not readable (git ls-remote exit ${result.code})`);
    }
    if (docker?.code === 0) {
      for (const role of ["app", "worker"]) {
        const expected = release.manifest.images[role].id;
        const inspect = await run("docker", ["image", "inspect", expected, "--format", "{{.Id}}"], { timeoutMs: 30_000, env: context.env });
        report(inspect.code === 0 && inspect.stdout.trim() === expected ? "PASS" : "FAIL", `${role} image`, inspect.code === 0 ? expected : "exact image is missing");
        if (inspect.code === 0) {
          const script = role === "worker"
            ? "node --version; ffmpeg -version | head -1; ffprobe -version | head -1; codex --version; claude --version"
            : "node --version; ffmpeg -version | head -1; ffprobe -version | head -1";
          const probe = await run("docker", ["run", "--rm", "--network", "none", expected, "sh", "-c", script], { timeoutMs: 120_000, env: context.env });
          report(probe.code === 0 && /^v(2[4-9]|[3-9]\d)\./.test(probe.stdout) ? "PASS" : "FAIL", `${role} packaged tools`,
            probe.code === 0 ? probe.stdout.trim().split("\n").join(", ") : `probe failed (${oneLine(probe.stderr) || `exit ${probe.code}`})`);
        }
      }
    }
  }

  const unit = unitName(context.env);
  try {
    const state = await context.system.unitState(unit);
    if (state.managerUnavailable) report("FAIL", "user service", "systemd --user is unavailable");
    else if (state.load === "not-found") report("FAIL", "user service", `${unit} is not loaded`);
    else report("PASS", "user service", `${unit} is ${state.load}, ${state.active}/${state.sub}`);
  } catch (error) { report("FAIL", "user service", error.message); }

  let config = null;
  try { config = readConfig(context.xdg.configFile); }
  catch (error) { report("FAIL", "configuration", error.message); }
  if (!config) report("WARN", "editor readiness", "not initialized; run `storybench init [DIR]`");
  else {
    report("PASS", "configured port", `127.0.0.1:${config.port}`);
    const root = inspectDataRoot(config.dataRoot);
    if (root.state !== "initialized") report("FAIL", "data root", `${config.dataRoot} is ${root.state}${root.detail ? ` (${root.detail})` : ""}`);
    else if (config.dataRootId && root.identity.id !== config.dataRootId) report("FAIL", "data root", "database identity does not match configuration");
    else if (release.ok && (root.schemaVersion < release.manifest.database.supportedSchema.min || root.schemaVersion > release.manifest.database.supportedSchema.max))
      report("FAIL", "data root", `schema ${root.schemaVersion} is outside release support ${release.manifest.database.supportedSchema.min}-${release.manifest.database.supportedSchema.max}`);
    else report("PASS", "data root", `identity ${root.identity.id}, schema ${root.schemaVersion}, ${root.counts.channels} channel record(s)`);
    for (const harness of ["codex", "claude"]) {
      const credential = config.credentials?.[harness] ?? path.join(context.home, harness === "codex" ? ".codex/auth.json" : ".claude/.credentials.json");
      const available = await readCredential(harness, credential);
      report(available.ok ? "PASS" : "WARN", `${harness} production`, available.ok ? "host login is present, readable and valid" : available.reason);
    }
    const health = await context.probeService(config.port);
    if (health.state === "running") {
      const mismatches = [];
      if (config.dataRootId && health.dataRootId !== config.dataRootId) mismatches.push("data-root identity");
      if (release.ok && health.release?.manifestId !== release.manifest.id) mismatches.push("release identity");
      report(mismatches.length ? "FAIL" : "PASS", "health", mismatches.length ? `running service mismatches ${mismatches.join(" and ")}` : `healthy on 127.0.0.1:${config.port}`);
    } else if (health.state === "other" || health.state === "unreachable") report("FAIL", "health", `port ${config.port} is occupied by another or unreachable service`);
    else report("PASS", "health", "service is stopped (editor can be started with `storybench up`)");
    if (!failures) report("PASS", "editor readiness", "installation and configured data root are ready");
  }
  context.out(`Doctor summary: ${failures} failure(s), ${warnings} warning(s).`);
  return failures ? EXIT.FAILED : EXIT.OK;
}

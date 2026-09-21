// Host adapters for the lifecycle commands: systemd user manager, journal, Docker (read-only queries) and the
// desktop opener. Every call passes an argument array (never shell text). Tests inject a fake with the same shape.
import { spawn } from "node:child_process";

export function runCommand(command, args, { timeoutMs = 120_000, env = process.env, input = null, cwd = undefined } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, cwd, stdio: [input == null ? "ignore" : "pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    const timer = timeoutMs ? setTimeout(() => child.kill("SIGTERM"), timeoutMs) : null;
    child.stdout.on("data", (chunk) => { if (stdout.length < 4_000_000) stdout += chunk; });
    child.stderr.on("data", (chunk) => { if (stderr.length < 64_000) stderr += chunk; });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code, signal) => { clearTimeout(timer); resolve({ code: code ?? (signal ? 128 : 1), stdout, stderr }); });
    if (input != null) child.stdin.end(input);
  });
}

export function hostSystem({ env = process.env } = {}) {
  const systemctl = (args, options = {}) => runCommand("systemctl", ["--user", ...args], { env, ...options });
  return {
    systemctl,
    async unitState(unit) {
      let result;
      try { result = await systemctl(["show", unit, "--timestamp=unix", "--property=LoadState,ActiveState,SubState,MainPID,ExecMainStartTimestamp,Result,FragmentPath"], { timeoutMs: 15_000 }); }
      catch (error) {
        // No systemctl at all: no user manager can be running the service.
        if (error.code === "ENOENT") return { load: "not-found", active: "inactive", sub: "dead", pid: null, managerUnavailable: true };
        throw error;
      }
      if (result.code !== 0) {
        if (/Failed to connect to (user scope )?bus|No medium found|has not been booted|XDG_RUNTIME_DIR/i.test(result.stderr))
          return { load: "not-found", active: "inactive", sub: "dead", pid: null, managerUnavailable: true };
        throw new Error(`systemctl --user show failed: ${result.stderr.trim().split("\n")[0] || `exit ${result.code}`}`);
      }
      const fields = Object.fromEntries(result.stdout.trim().split("\n").filter(Boolean).map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]));
      // --timestamp=unix gives "@<seconds>"; report ISO time.
      const started = /^@(\d+)$/.exec(fields.ExecMainStartTimestamp || "");
      return { load: fields.LoadState, active: fields.ActiveState, sub: fields.SubState, pid: Number(fields.MainPID) || null,
        startedAt: started ? new Date(Number(started[1]) * 1000).toISOString() : null, result: fields.Result || null, fragment: fields.FragmentPath || null };
    },
    daemonReload: () => systemctl(["daemon-reload"], { timeoutMs: 30_000 }),
    start: (unit) => systemctl(["start", unit], { timeoutMs: 60_000 }),
    stop: (unit, timeoutMs) => systemctl(["stop", unit], { timeoutMs }),
    resetFailed: (unit) => systemctl(["reset-failed", unit], { timeoutMs: 15_000 }),
    // Only this unit's journal: -u selects the unit's own processes and the manager's messages about it.
    journal(unit, { follow = false, lines = 200 } = {}) {
      return spawn("journalctl", ["--user", "-u", unit, "--no-pager", "-o", "short-iso", "-n", String(lines), ...(follow ? ["-f"] : [])], { env, stdio: ["ignore", "inherit", "inherit"] });
    },
    async containers(installId) {
      const result = await runCommand("docker", ["ps", "--no-trunc", "--filter", `label=io.storybench.install=${installId}`, "--format", "{{.ID}} {{.Label \"io.storybench.role\"}}"], { env, timeoutMs: 20_000 });
      if (result.code !== 0) return null;
      const containers = result.stdout.trim().split("\n").filter(Boolean).map((line) => { const [id, role] = line.split(" "); return { id, role, startedAt: null }; });
      if (containers.length) {
        const started = await runCommand("docker", ["inspect", "--format", "{{.Id}} {{.State.StartedAt}}", ...containers.map((container) => container.id)], { env, timeoutMs: 20_000 });
        if (started.code === 0) for (const line of started.stdout.trim().split("\n")) {
          const [id, at] = line.split(" ");
          const container = containers.find((value) => value.id === id);
          if (container && !Number.isNaN(Date.parse(at))) container.startedAt = new Date(at).toISOString();
        }
      }
      return containers;
    },
    open(url) {
      const opener = env.STORYBENCH_OPENER || "xdg-open";
      const child = spawn(opener, [url], { env, stdio: "ignore", detached: true });
      return new Promise((resolve, reject) => { child.on("error", reject); child.on("spawn", () => { child.unref(); resolve(); }); });
    },
  };
}

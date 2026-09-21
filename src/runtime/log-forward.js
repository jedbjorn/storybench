// Bounded forwarding of container diagnostics into the host journal (flag SC-101).
// `docker logs --follow` runs with an argv array (no shell). Each forwarded line is capped,
// forwarding is rate-limited per window with a dropped-line counter, and the follower is
// killed on stop. Worker containers forward only structured diagnostic lines from the
// worker launcher (allowlisted events), never harness prompt or model text.
import { spawn as nodeSpawn } from "node:child_process";
import { createInterface } from "node:readline";

export const WORKER_DIAGNOSTIC_EVENTS = Object.freeze(["worker.ready", "harness.started", "harness.exited", "launch.rejected"]);

// Keep only the launcher's own JSON diagnostics, re-serialised from known scalar fields.
export function workerDiagnostic(line) {
  let value;
  try { value = JSON.parse(line); } catch { return null; }
  if (!value || typeof value !== "object" || !WORKER_DIAGNOSTIC_EVENTS.includes(value.event)) return null;
  const pick = {};
  for (const key of ["event", "harness", "pid", "code", "signal", "uid"]) {
    const field = value[key];
    if (field === undefined) continue;
    if (field === null || ["string", "number"].includes(typeof field)) pick[key] = typeof field === "string" ? field.slice(0, 64) : field;
  }
  return pick;
}

export function capLine(line, maxBytes = 2048) {
  const buffer = Buffer.from(line, "utf8");
  if (buffer.length <= maxBytes) return { text: line, truncated: false };
  return { text: `${buffer.subarray(0, maxBytes).toString("utf8").replace(/�$/, "")}…`, truncated: true };
}

export function followContainerLogs({ containerId, event, fields = {}, log, filter = null, maxLineBytes = 2048, maxLinesPerWindow = 100, windowMs = 1000, since = null, spawn = nodeSpawn, now = Date.now }) {
  const args = ["logs", "--follow", ...(since ? ["--since", since] : []), containerId];
  const child = spawn("docker", args, { stdio: ["ignore", "pipe", "pipe"] });
  let windowStart = now(), inWindow = 0, dropped = 0, stopped = false;
  const flushDropped = () => {
    if (dropped) { log({ event: `${event}.dropped`, ...fields, dropped, level: "warn" }); dropped = 0; }
  };
  const handle = (stream) => (line) => {
    if (stopped || !line) return;
    const current = now();
    if (current - windowStart >= windowMs) { flushDropped(); windowStart = current; inWindow = 0; }
    if (inWindow >= maxLinesPerWindow) { dropped++; return; }
    if (filter) {
      const kept = filter(line);
      if (!kept) return;
      inWindow++;
      log({ event, ...fields, stream, diagnostic: kept });
      return;
    }
    inWindow++;
    const { text, truncated } = capLine(line, maxLineBytes);
    log({ event, ...fields, stream, line: text, ...(truncated ? { truncated: true } : {}) });
  };
  const readers = [["stdout", child.stdout], ["stderr", child.stderr]].map(([name, stream]) => {
    const reader = createInterface({ input: stream, crlfDelay: Infinity });
    reader.on("line", handle(name));
    return reader;
  });
  child.on("error", () => {});
  return {
    child,
    get dropped() { return dropped; },
    stop() {
      if (stopped) return;
      flushDropped();
      stopped = true;
      for (const reader of readers) reader.close();
      if (child.exitCode == null) child.kill("SIGTERM");
    },
  };
}

// App-side clients for the private runtime channels:
//  - controlRequest(): one JSON request to the host lifecycle entry point's control socket.
//  - connectHarness(): open the worker's harness socket and get a child-process-like
//    object (stdin/stdout/stderr/kill/exit) that existing adapters such as
//    CodexConnection can use through their injectable `spawn`.
import { connect } from "node:net";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { access } from "node:fs/promises";

export class ControlError extends Error {
  constructor(code, message) { super(message); this.name = "ControlError"; this.code = code; }
}

export function controlRequest(socketPath, body, { timeoutMs = 120_000 } = {}) {
  return new Promise((resolve, reject) => {
    const socket = connect(socketPath);
    let buffer = "";
    const timer = setTimeout(() => { socket.destroy(); reject(new ControlError("CONTROL_TIMEOUT", `Runtime control timed out: ${body.op}`)); }, timeoutMs);
    socket.setEncoding("utf8");
    socket.on("connect", () => socket.write(JSON.stringify(body) + "\n"));
    socket.on("data", (chunk) => { buffer += chunk; });
    socket.on("error", (error) => { clearTimeout(timer); reject(new ControlError("CONTROL_UNAVAILABLE", `Runtime control unavailable: ${error.message}`)); });
    socket.on("end", () => {
      clearTimeout(timer);
      try {
        const reply = JSON.parse(buffer);
        if (reply.ok) resolve(reply.result);
        else reject(new ControlError(reply.code || "CONTROL_REJECTED", reply.error || "Runtime control rejected the request"));
      } catch { reject(new ControlError("CONTROL_PROTOCOL", "Runtime control returned an invalid reply")); }
    });
  });
}

async function waitForPath(file, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try { await access(file); return; }
    catch { if (Date.now() > deadline) throw new ControlError("WORKER_NOT_READY", "Worker harness socket did not appear"); }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

class SocketChild extends EventEmitter {
  constructor(socket, pid) {
    super();
    this.pid = pid;
    this.exitCode = null;
    this.stdin = socket;
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.socket = socket;
    socket.on("close", () => {
      this.exitCode ??= 0;
      this.stdout.end();
      this.stderr.end();
      this.emit("exit", this.exitCode, null);
      this.emit("close", this.exitCode, null);
    });
    socket.on("error", (error) => this.emit("error", error));
  }
  kill() { this.socket.destroy(); return true; }
}

// header: { harness: "codex" } or { harness: "claude", model, resume? }
export async function connectHarness(socketPath, header, { readyTimeoutMs = 20_000 } = {}) {
  await waitForPath(socketPath, readyTimeoutMs);
  const socket = connect(socketPath);
  await new Promise((resolve, reject) => { socket.once("connect", resolve); socket.once("error", reject); });
  socket.write(JSON.stringify(header) + "\n");
  let pending = Buffer.alloc(0);
  const ack = await new Promise((resolve, reject) => {
    const onData = (chunk) => {
      pending = Buffer.concat([pending, chunk]);
      const newline = pending.indexOf(10);
      if (newline < 0) return;
      socket.off("data", onData);
      socket.pause();
      try { resolve(JSON.parse(pending.subarray(0, newline).toString("utf8"))); }
      catch { reject(new ControlError("HARNESS_PROTOCOL", "Worker sent an invalid harness acknowledgement")); }
      pending = pending.subarray(newline + 1);
    };
    socket.on("data", onData);
    socket.once("error", reject);
    socket.once("close", () => reject(new ControlError("HARNESS_CLOSED", "Worker closed the harness socket before starting")));
  });
  if (ack.storybench !== "started") { socket.destroy(); throw new ControlError(ack.code || "HARNESS_START_FAILED", ack.error || "Worker could not start the harness"); }
  const child = new SocketChild(socket, ack.pid);
  if (pending.length) child.stdout.write(pending);
  socket.pipe(child.stdout);
  socket.resume();
  return child;
}

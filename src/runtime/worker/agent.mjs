#!/usr/bin/env node
// Worker-side harness launcher (runs as the worker container's main process under
// docker --init). It listens on the request's harness socket and, per connection, starts
// exactly one harness from a fixed launch table, piping the socket to its stdio.
// Harness processes run in their own process group; closing the socket kills the group.
// Stop is enforced by the host removing the whole container.
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { chmod, rm } from "node:fs/promises";

const SOCKET = "/run/storybench/request/worker/harness.sock";
const MCP_CONFIG = "/run/storybench/request/app/mcp.json";
const MCP_BRIDGE = "/opt/storybench/app/src/runtime/worker/mcp-bridge.mjs";
const HARNESS = process.env.STORYBENCH_HARNESS;
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._:\-[\]]{0,79}$/;
const SESSION = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

// Codex: app-server over stdio; Storybench tools arrive as app-server dynamic tools.
// Integrations the worker does not use are disabled; command execution stays enabled.
const CODEX_DISABLED = ["apps", "plugins", "browser_use", "computer_use", "in_app_browser", "multi_agent", "image_generation"];

export function launchArgv(header) {
  if (!header || typeof header !== "object") throw new Error("Launch header must be an object");
  if (header.harness !== HARNESS) throw new Error(`This worker only runs ${HARNESS}`);
  const extra = Object.keys(header).filter((key) => !["harness", "model", "resume", "sessionId", "effort"].includes(key));
  if (extra.length) throw new Error(`Unexpected launch fields: ${extra.join(", ")}`);
  if (header.harness === "codex") {
    if (header.model !== undefined || header.resume !== undefined || header.sessionId !== undefined || header.effort !== undefined) throw new Error("Codex model, effort and thread are selected over the app-server protocol");
    // Storybench tools reach Codex through the same request-scoped MCP bridge as Claude: in
    // code mode an MCP tool returns a structured CallToolResult whose image blocks the model
    // forwards with image(...), whereas a dynamic tool's output is flattened to a string.
    return ["codex", ["app-server", "--listen", "stdio://",
      "-c", 'mcp_servers.storybench.command="node"', "-c", `mcp_servers.storybench.args=["${MCP_BRIDGE}"]`,
      "-c", "mcp_servers.storybench.startup_timeout_sec=20", "-c", "mcp_servers.storybench.tool_timeout_sec=120",
      ...CODEX_DISABLED.flatMap((feature) => ["--disable", feature])]];
  }
  if (header.harness === "claude") {
    if (!MODEL.test(header.model ?? "")) throw new Error("Claude launch needs a plain model identifier");
    if (header.resume !== undefined && header.resume !== null && !SESSION.test(header.resume)) throw new Error("Claude resume must be a session UUID");
    if (header.sessionId !== undefined && !SESSION.test(header.sessionId)) throw new Error("Claude sessionId must be a UUID");
    if (header.sessionId !== undefined && header.resume) throw new Error("Give either resume or sessionId, not both");
    if (header.effort !== undefined && !/^[a-z]{2,12}$/.test(header.effort)) throw new Error("Claude effort must be a plain level name");
    return ["claude", [
      "-p", "--output-format", "stream-json", "--input-format", "stream-json", "--verbose",
      "--model", header.model, "--mcp-config", MCP_CONFIG, "--strict-mcp-config",
      "--dangerously-skip-permissions",
      ...(header.resume ? ["--resume", header.resume] : []),
      ...(header.sessionId ? ["--session-id", header.sessionId] : []),
      ...(header.effort ? ["--effort", header.effort] : []),
    ]];
  }
  throw new Error("Unsupported harness");
}

function handle(socket) {
  let buffer = Buffer.alloc(0);
  socket.on("error", () => {});
  const onData = (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    const newline = buffer.indexOf(10);
    if (newline < 0) { if (buffer.length > 16_384) socket.destroy(); return; }
    socket.off("data", onData);
    socket.pause();
    let command, args;
    try { [command, args] = launchArgv(JSON.parse(buffer.subarray(0, newline).toString("utf8"))); }
    catch (error) {
      console.error(JSON.stringify({ event: "launch.rejected", harness: HARNESS }));
      socket.end(JSON.stringify({ storybench: "error", code: "INVALID_LAUNCH", error: error.message }) + "\n");
      return;
    }
    const rest = buffer.subarray(newline + 1);
    const child = spawn(command, args, { cwd: process.cwd(), env: process.env, stdio: ["pipe", "pipe", "inherit"], detached: true });
    const killGroup = (signal) => { try { process.kill(-child.pid, signal); } catch { /* gone */ } };
    child.once("error", (error) => socket.end(JSON.stringify({ storybench: "error", code: "SPAWN_FAILED", error: error.message }) + "\n"));
    child.once("spawn", () => {
      socket.write(JSON.stringify({ storybench: "started", pid: child.pid, harness: HARNESS }) + "\n");
      if (rest.length) child.stdin.write(rest);
      socket.pipe(child.stdin);
      child.stdout.pipe(socket);
      socket.resume();
      console.error(JSON.stringify({ event: "harness.started", harness: HARNESS, pid: child.pid }));
    });
    child.once("exit", (code, signal) => {
      console.error(JSON.stringify({ event: "harness.exited", harness: HARNESS, code, signal }));
      killGroup("SIGKILL");
      socket.end();
    });
    socket.once("close", () => { killGroup("SIGTERM"); setTimeout(() => killGroup("SIGKILL"), 3000).unref(); });
  };
  socket.on("data", onData);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await rm(SOCKET, { force: true });
  const server = createServer(handle);
  server.listen(SOCKET, async () => {
    await chmod(SOCKET, 0o600);
    console.error(JSON.stringify({ event: "worker.ready", harness: HARNESS, uid: process.getuid() }));
  });
  process.once("SIGTERM", () => { server.close(); process.exit(0); });
}

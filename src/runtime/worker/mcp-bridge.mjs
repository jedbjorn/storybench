#!/usr/bin/env node
// Storybench MCP stdio server inside the worker (for Claude Code and Codex). It holds no
// authority of its own: every tools/list and tools/call is forwarded to the app over the
// request's bridge socket with the request-scoped token, and the app decides.
import { connect } from "node:net";
import { createInterface } from "node:readline";

import { readFileSync } from "node:fs";

// The socket and request token come from the environment (Claude's --mcp-config) or, for
// Codex (configured with a fixed command), from the app-written request config on the
// read-only app mount.
const REQUEST_CONFIG = "/run/storybench/request/app/mcp.json";
function fromRequestConfig() {
  try { return JSON.parse(readFileSync(REQUEST_CONFIG, "utf8")).mcpServers.storybench.env; } catch { return {}; }
}
const configured = process.env.STORYBENCH_BRIDGE_TOKEN ? {} : fromRequestConfig();
const SOCKET = process.env.STORYBENCH_BRIDGE_SOCKET ?? configured.STORYBENCH_BRIDGE_SOCKET;
const TOKEN = process.env.STORYBENCH_BRIDGE_TOKEN ?? configured.STORYBENCH_BRIDGE_TOKEN;

function forward(message) {
  return new Promise((resolve, reject) => {
    const socket = connect(SOCKET);
    let buffer = "";
    socket.setEncoding("utf8");
    socket.on("connect", () => socket.write(JSON.stringify({ token: TOKEN, ...message }) + "\n"));
    socket.on("data", (chunk) => { buffer += chunk; });
    socket.on("error", reject);
    socket.on("end", () => {
      try {
        const reply = JSON.parse(buffer);
        if (reply.ok) resolve(reply.result);
        else reject(new Error(reply.error || "Storybench bridge rejected the call"));
      } catch { reject(new Error("Storybench bridge returned an invalid reply")); }
    });
  });
}

const send = (message) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\n");

async function dispatch(message) {
  const { id, method, params } = message;
  if (method === "initialize")
    return { protocolVersion: params?.protocolVersion || "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "storybench", version: "0.1.0" } };
  if (method === "ping") return {};
  if (method === "tools/list") return forward({ op: "tools/list" });
  if (method === "tools/call") return forward({ op: "tools/call", name: params?.name, arguments: params?.arguments ?? {} });
  if (id === undefined) return undefined;
  const error = new Error(`Method not found: ${method}`);
  error.rpcCode = -32601;
  throw error;
}

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on("line", async (line) => {
  if (!line.trim()) return;
  let message;
  try { message = JSON.parse(line); }
  catch { send({ id: null, error: { code: -32700, message: "Parse error" } }); return; }
  try {
    const result = await dispatch(message);
    if (message.id !== undefined && result !== undefined) send({ id: message.id, result });
  } catch (error) {
    if (message.id !== undefined) send({ id: message.id, error: { code: error.rpcCode ?? -32603, message: error.message } });
  }
});
lines.on("close", () => process.exit(0));

// App-side request bridge: a unix socket in the request's app-owned directory, mounted
// read-only into that request's worker. The worker's MCP stdio server forwards tool calls
// here with the request token; authority comes from the app-bound scope, not the caller.
import { createServer } from "node:net";
import { timingSafeEqual } from "node:crypto";
import { chmod, rm } from "node:fs/promises";
import { toMcpResult } from "./tools.js";
import { RESEARCH_TRANSPORT_BYTES } from "../store.js";
import { toolErrorText } from "../codex.js";

const MAX_BYTES = RESEARCH_TRANSPORT_BYTES;

function tokenMatches(expected, supplied) {
  const a = Buffer.from(String(expected));
  const b = Buffer.from(String(supplied ?? ""));
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function startBridge({ socketPath, token, tools, onCall = () => {} }) {
  if (typeof token !== "string" || token.length < 32) throw new Error("Bridge token must be at least 32 characters");
  await rm(socketPath, { force: true });
  const server = createServer((socket) => {
    let buffer = "", bytes = 0, handled = false;
    socket.setEncoding("utf8");
    socket.on("error", () => {});
    socket.on("data", async (chunk) => {
      if (handled) return;
      buffer += chunk;
      bytes += Buffer.byteLength(chunk, "utf8");
      if (bytes > MAX_BYTES) {
        handled = true;
        return socket.end(JSON.stringify({ ok: false, error: `Tool request exceeds the ${MAX_BYTES} byte transport limit; shorten it before saving` }) + "\n");
      }
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      handled = true;
      socket.pause();
      let reply;
      try {
        const message = JSON.parse(buffer.slice(0, newline));
        if (!tokenMatches(token, message.token)) reply = { ok: false, error: "Bridge token rejected" };
        else if (message.op === "tools/list") reply = { ok: true, result: { tools: tools.definitions } };
        else if (message.op === "tools/call") {
          onCall({ name: message.name, arguments: message.arguments });
          try { reply = { ok: true, result: toMcpResult(await tools.call(message.name, message.arguments)) }; }
          catch (error) { reply = { ok: true, result: { isError: true, content: [{ type: "text", text: toolErrorText(error) }] } }; }
        } else reply = { ok: false, error: "Unsupported bridge operation" };
      } catch { reply = { ok: false, error: "Invalid bridge message" }; }
      socket.end(JSON.stringify(reply) + "\n");
    });
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(socketPath, resolve); });
  await chmod(socketPath, 0o600);
  return { close: () => new Promise((resolve) => server.close(() => resolve())) };
}

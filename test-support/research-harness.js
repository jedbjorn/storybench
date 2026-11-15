import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { WorkerCodexConnection } from '../src/runtime/harnesses.js';
import { startBridge } from '../src/runtime/bridge.js';

function jsonRpc(child) {
  const pending = new Map(); let serial = 1;
  const lines = createInterface({ input: child.stdout });
  lines.on('line', line => { const message = JSON.parse(line); const receive = pending.get(message.id); if (receive) { pending.delete(message.id); receive(message); } });
  return (method, params = {}) => new Promise((resolve, reject) => {
    const id = serial++; const timer = setTimeout(() => reject(new Error(`No reply to ${method}`)), 3000);
    pending.set(id, message => { clearTimeout(timer); if (message.error) reject(new Error(message.error.message)); else resolve(message.result); });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}
export async function nativeFixture(t, harness, tools, dir) {
  if (harness === 'codex') {
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.exitCode = null;
    child.kill = () => { child.exitCode = 0; child.emit('exit', 0); };
    const replies = new Map(); let serial = 100;
    child.stdin = new Writable({ write(chunk, _encoding, callback) {
      for (const line of String(chunk).trim().split('\n')) {
        const request = JSON.parse(line);
        if (request.method === 'initialize') child.stdout.write(JSON.stringify({ id: request.id, result: {} }) + '\n');
        if (request.result && replies.has(request.id)) { const receive = replies.get(request.id); replies.delete(request.id); setImmediate(() => receive(request.result)); }
      }
      callback();
    } });
    const connection = await new WorkerCodexConnection({ child, cwd: dir, tools, dynamicTools: true }).open();
    t.after(() => connection.close());
    return {
      definitions: connection.dynamicTools.map(({ type, ...spec }) => spec),
      call: (name, args = {}) => new Promise(resolve => {
        const id = serial++;
        replies.set(id, reply => resolve({ failed: !reply.success, text: reply.contentItems[0].text }));
        child.stdout.write(JSON.stringify({ id, method: 'item/tool/call', params: { tool: name, arguments: args, callId: `call-${id}` } }) + '\n');
      }),
    };
  }
  const socketPath = path.join(dir, `bridge-${harness}.sock`), token = 'r'.repeat(64);
  const bridge = await startBridge({ socketPath, token, tools });
  const child = spawn(process.execPath, ['src/runtime/worker/mcp-bridge.mjs'], { env: { ...process.env, STORYBENCH_BRIDGE_SOCKET: socketPath, STORYBENCH_BRIDGE_TOKEN: token }, stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(async () => { child.stdin.end(); child.kill(); await bridge.close(); });
  const rpc = jsonRpc(child);
  await rpc('initialize', { protocolVersion: '2025-06-18' });
  return {
    definitions: (await rpc('tools/list')).tools,
    async call(name, args = {}) { const result = await rpc('tools/call', { name, arguments: args }); return { failed: Boolean(result.isError), text: result.content[0].text }; },
  };
}

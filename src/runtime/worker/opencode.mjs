import { startWorkerGatewayAdapter, GATEWAY_MOUNT } from '../gateway-relay.js';
// A per-turn CLI wrapper. Stable Storybench session ids map to OpenCode native ids;
// provider errors and stderr never cross the worker boundary with credential content.
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { openCodeConfig, openCodeFailure, openCodeRunEvent, TOOL_DISCIPLINE } from '../opencode.js';
// A failed turn names its stage on stderr, which the launcher passes to the host's
// diagnostic filter. The error itself may quote a token or a payload and is not written.
let stage = 'config', adapter;
const record = (detail) => console.error(JSON.stringify(openCodeFailure(stage, detail)));
const home = '/storybench/home';
async function prepare() {
  const header = JSON.parse(process.argv[2]);
  const route = JSON.parse(process.env.STORYBENCH_ROUTE);
  const lines = createInterface({ input: process.stdin });
  const payload = await new Promise((resolve) => lines.once('line', (line) => resolve(JSON.parse(line)))); lines.close();
  stage = 'mcp';
  const mcp = JSON.parse(await readFile('/run/storybench/request/app/mcp.json', 'utf8')).mcpServers.storybench;
  let transportKey;
  if (route.localRelay) {
    stage = 'relay';
    const binding = JSON.parse(await readFile(`${GATEWAY_MOUNT}/binding.json`, 'utf8'));
    if (binding.requestId !== process.env.STORYBENCH_REQUEST_ID || binding.source !== route.id || binding.protocol !== route.protocol) throw new Error('Gateway request binding mismatch');
    adapter = await startWorkerGatewayAdapter({ socketPath: `${GATEWAY_MOUNT}/relay.sock`, binding });
    route.baseUrl = adapter.baseUrl; transportKey = binding.token;
  }
  stage = 'config';
  const config = openCodeConfig(route, { model: header.model, mcp, transportKey });
  await mkdir(`${home}/config`, { recursive: true });
  await writeFile(`${home}/discipline.md`, TOOL_DISCIPLINE);
  config.instructions.push(`${home}/discipline.md`);
  await writeFile(`${home}/config/opencode.json`, JSON.stringify(config));
  const files = [];
  for (const [index, image] of (payload.images || []).entries()) {
    const file = `/tmp/storybench-image-${index}.png`; await writeFile(file, Buffer.from(image.data, 'base64')); files.push(file);
  }
  stage = 'session';
  const stateFile = `/storybench/session/opencode/${header.sessionId}.json`;
  let native = null;
  try { native = JSON.parse(await readFile(stateFile, 'utf8')).session; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return { header, payload, config, files, stateFile, native };
}
const prepared = await prepare().catch(() => null);
if (!prepared) { record(); await adapter?.close(); process.exit(1); }
const { header, payload, config, files, stateFile } = prepared;
let { native } = prepared;
if (header.resume && !native) { record(); console.log(JSON.stringify({ type: 'storybench.complete', ok: false })); await adapter?.close(); process.exit(1); }
const child = spawn('opencode', ['run', '--pure', '--format', 'json', '--model', config.model, ...(native ? ['--session', native] : []), ...(header.effort ? ['--variant', header.effort] : []), ...files.flatMap((file) => ['--file', file]), '--', payload.text], {
  env: { ...process.env, OPENCODE_CONFIG: `${home}/config/opencode.json`, XDG_CONFIG_HOME: `${home}/config`, XDG_DATA_HOME: '/storybench/session/opencode/data', XDG_CACHE_HOME: `${home}/cache`, OPENCODE_DISABLE_CLAUDE_CODE: '1' }, stdio: ['ignore', 'pipe', 'ignore'],
});
let failed = false, pending = Promise.resolve();
createInterface({ input: child.stdout }).on('line', (line) => {
  pending = pending.then(async () => {
    let event; try { event = JSON.parse(line); } catch { return; }
    const { session, failed: errored, output } = openCodeRunEvent(event, native);
    if (session !== native) { native = session; await writeFile(stateFile, JSON.stringify({ session: native })); }
    if (errored) failed = true;
    if (output) console.log(JSON.stringify(output));
  });
});
child.once('error', () => { failed = true; });
child.once('close', async (code, signal) => {
  await pending; await adapter?.close();
  const ok = code === 0 && !failed;
  if (!ok) { stage = code === 0 ? 'opencode-event' : 'opencode-exit'; record({ code, signal }); }
  console.log(JSON.stringify({ type: 'storybench.complete', ok })); process.exitCode = ok ? 0 : 1;
});

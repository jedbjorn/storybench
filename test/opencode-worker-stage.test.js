import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openCodeFailure } from '../src/runtime/opencode.js';
import { workerDiagnostic, WORKER_FAILURE_STAGES } from '../src/runtime/log-forward.js';

const WRAPPER = fileURLToPath(new URL('../src/runtime/worker/opencode.mjs', import.meta.url));
const SECRET = 'sk-fixture-provider-key-0123456789';
const header = { harness: 'opencode', model: 'fixture-model', sessionId: '11111111-2222-4333-8444-555555555555' };

// Run the real per-turn wrapper outside a worker: the request mounts are absent, so it fails
// during setup, before any OpenCode process starts.
function runWrapper(route) {
  const child = spawn(process.execPath, [WRAPPER, JSON.stringify(header)], { env: { PATH: process.env.PATH, STORYBENCH_ROUTE: route, FIXTURE_API_KEY: SECRET }, stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; }); child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.stdin.on('error', () => {});
  child.stdin.end(JSON.stringify({ text: `Prompt quoting ${SECRET}`, images: [] }) + '\n');
  return new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code) => resolve({ code, stdout, stderr })); });
}

test('a failure record names a stage and an exit, and has no room for anything else', () => {
  assert.deepEqual(openCodeFailure('opencode-exit', { code: 1, signal: null }), { event: 'harness.failed', harness: 'opencode', stage: 'opencode-exit', code: 1 });
  assert.deepEqual(openCodeFailure('opencode-exit', { code: null, signal: 'SIGKILL' }), { event: 'harness.failed', harness: 'opencode', stage: 'opencode-exit', signal: 'SIGKILL' });
  assert.deepEqual(openCodeFailure('mcp'), { event: 'harness.failed', harness: 'opencode', stage: 'mcp' });
  assert.deepEqual(openCodeFailure('opencode-exit', { code: SECRET, signal: SECRET, error: SECRET }), { event: 'harness.failed', harness: 'opencode', stage: 'opencode-exit' });
});

test('the OpenCode wrapper records the failed setup stage and none of the route, key or prompt', async () => {
  // An unreadable route is a config failure; the parse error would quote the route text.
  const config = await runWrapper(`{"id":"gateway-fixture","baseUrl":"https://fixture.test/v1","key":"${SECRET}"`);
  assert.equal(config.code, 1);
  assert.deepEqual(config.stderr.trim().split('\n').map((line) => JSON.parse(line)), [{ event: 'harness.failed', harness: 'opencode', stage: 'config' }]);
  // A valid route with no request mount fails reading the Storybench MCP entry.
  const mcp = await runWrapper(JSON.stringify({ id: 'gateway-fixture', protocol: 'openai', name: 'Fixture', baseUrl: `https://fixture.test/v1?unused=${SECRET}`, keyEnv: 'FIXTURE_API_KEY' }));
  assert.equal(mcp.code, 1);
  const records = mcp.stderr.trim().split('\n').map((line) => JSON.parse(line));
  assert.deepEqual(records, [{ event: 'harness.failed', harness: 'opencode', stage: 'mcp' }]);
  for (const run of [config, mcp]) {
    assert.ok(!run.stderr.includes(SECRET) && !run.stdout.includes(SECRET), 'no credential or prompt text leaves the wrapper');
    assert.equal(run.stdout, '', 'a turn that never reached OpenCode reports no completion');
  }
  // What the host journal keeps of that line.
  assert.deepEqual(workerDiagnostic(mcp.stderr.trim()), { event: 'harness.failed', harness: 'opencode', stage: 'mcp' });
  assert.ok(WORKER_FAILURE_STAGES.includes(records[0].stage));
});

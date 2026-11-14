import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import { mkdtemp, rm, stat, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { startGatewayRelay, startWorkerGatewayAdapter, gatewayRequestPath, isHostLocalGateway } from '../src/runtime/gateway-relay.js';
import { createProviderService } from '../src/runtime/providers.js';

async function fixture(t, { protocol = 'openai', key = 'selected-secret', handler, timeoutMs = 500, adapterTimeoutMs = timeoutMs + 100, tls = false } = {}) {
 const root = await mkdtemp(path.join(os.tmpdir(), 'sb-relay-')); t.after(() => rm(root, { recursive: true, force: true }));
 const seen = [];
 const onRequest = (req, res) => { seen.push({ url: req.url, headers: req.headers }); if (handler) return handler(req, res); res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ ok: true })); };
 let server;
 if (tls) {
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(root,'key'), '-out', path.join(root,'cert'), '-subj', '/CN=localhost', '-days', '1'], { stdio: 'ignore' });
  server = https.createServer({ key: await readFile(path.join(root,'key')), cert: await readFile(path.join(root,'cert')) }, onRequest);
 } else server = http.createServer(onRequest);
 await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
 t.after(() => { server.closeAllConnections(); return new Promise((resolve) => server.close(resolve)); });
 const baseUrl = `${tls ? 'https' : 'http'}://127.0.0.1:${server.address().port}/v1/pinned`;
 const route = { id: 'gateway-test', custom: true, protocol, baseUrl, key };
 const socketPath = path.join(root, 'private', 'relay.sock');
 const relay = await startGatewayRelay({ socketPath, route, requestId: 'req-one', timeoutMs }); t.after(() => relay.close());
 const adapter = await startWorkerGatewayAdapter({ socketPath, binding: relay.binding, timeoutMs: adapterTimeoutMs }); t.after(() => adapter.close());
 const headers = protocol === 'anthropic' ? { 'x-api-key': relay.binding.token } : { Authorization: `Bearer ${relay.binding.token}` };
 return { root, server, baseUrl, route, socketPath, relay, adapter, headers, seen };
}
function privateRequest(f, { target = '/v1/pinned/messages?query=kept', headers = {}, binding = f.relay.binding } = {}) {
 return new Promise((resolve, reject) => {
  const req = http.request({ socketPath: f.socketPath, path: target, headers: { host: 'storybench-relay', 'x-storybench-token': binding.token, 'x-storybench-request': binding.requestId, 'x-storybench-source': binding.source, ...headers } }, (res) => {
   let body = ''; res.on('data', (part) => { body += part; }); res.on('end', () => resolve({ status: res.statusCode, body }));
  }); req.on('error', reject); req.end();
 });
}
for (const protocol of ['openai','anthropic']) test(`${protocol}: saved endpoint, path/query and selected credential stay host-bound`, async (t) => {
 const f = await fixture(t, { protocol });
 assert.equal((await stat(f.socketPath)).mode & 0o777, 0o600);
 assert.equal((await stat(path.dirname(f.socketPath))).mode & 0o777, 0o700);
 assert.equal(new URL(f.adapter.baseUrl).hostname, '127.0.0.1');
 const service = createProviderService({ directory: path.join(f.root, 'providers') });
 await service.saveGateway({ id: f.route.id, name: 'Pinned', baseUrl: f.baseUrl, protocol, models: ['fake'] });
 await service.replace(f.route.id, 'selected-secret'); await service.models(f.route.id);
 const saved = await service.route(f.route.id); assert.equal(saved.baseUrl, f.baseUrl);
 const response = await fetch(`${f.adapter.baseUrl}/messages?query=kept`, { method: 'POST', headers: f.headers, body: '{"model":"fake"}' });
 assert.equal(response.status, 200);
 assert.equal(f.seen.at(-1).url, '/v1/pinned/messages?query=kept');
 assert.ok(f.seen.some(({ url }) => url === '/v1/pinned/models'));
 for (const observed of f.seen) {
  assert.equal(protocol === 'anthropic' ? observed.headers['x-api-key'] : observed.headers.authorization, protocol === 'anthropic' ? 'selected-secret' : 'Bearer selected-secret');
  assert.ok(!JSON.stringify(observed).includes(f.relay.binding.token));
 }
 assert.equal(isHostLocalGateway(saved), true);
 assert.equal(isHostLocalGateway({ ...saved, custom: false }), false);
});
test('rejects wrong credentials, request/source/authority mismatches, absolute targets and path escapes', async (t) => {
 const f = await fixture(t);
 for (const target of ['http://evil.test/v1/pinned/messages', '//evil.test/v1/pinned', '/v1/pinned/../outside', '/v1/pinned/%2e%2e/outside', '/v1/pinned/%252e%252e/outside', '/v1/pinned%2f../outside', '/v1/other', '/v1/pinnedness/messages']) {
  assert.equal((await privateRequest(f, { target })).status, 400, target);
 }
 for (const headers of [{ 'x-storybench-token': 'wrong' }, { 'x-storybench-request': 'req-two' }, { 'x-storybench-source': 'gateway-other' }, { authorization: 'Bearer unrelated-key' }, { 'x-api-key': 'unrelated-key' }]) assert.equal((await privateRequest(f, { headers })).status, 403);
 assert.equal((await privateRequest(f, { headers: { host: 'other-host' } })).status, 400);
 assert.equal((await fetch(`${f.adapter.baseUrl}/messages`, { headers: { Authorization: 'Bearer unrelated-key' } })).status, 403);
 assert.equal(f.seen.length, 0);
 assert.equal(gatewayRequestPath('/v1/pinned/messages?url=https://other.test', '/v1/pinned'), '/v1/pinned/messages?url=https://other.test');
 assert.equal(gatewayRequestPath('/v1/space%20name/messages?query=kept', '/v1/space%20name'), '/v1/space%20name/messages?query=kept');
});
test('optional-key gateways send no credential; rotation cannot change an active binding', async (t) => {
 const optional = await fixture(t, { key: null });
 await fetch(`${optional.adapter.baseUrl}/messages`, { headers: optional.headers });
 assert.equal(optional.seen.at(-1).headers.authorization, undefined);
 assert.equal(optional.seen.at(-1).headers['x-api-key'], undefined);
 const first = await fixture(t);
 first.route.key = 'rotated-secret';
 await fetch(`${first.adapter.baseUrl}/messages`, { headers: first.headers });
 assert.equal(first.seen.at(-1).headers.authorization, 'Bearer selected-secret');
 const next = await startGatewayRelay({ socketPath: path.join(first.root, 'next', 'relay.sock'), route: first.route, requestId: 'req-next' }); t.after(() => next.close());
 const second = { ...first, socketPath: path.join(first.root, 'next', 'relay.sock'), relay: next };
 await privateRequest(second);
 assert.equal(first.seen.at(-1).headers.authorization, 'Bearer rotated-secret');
});
test('redirects never forward credentials or reach the redirected authority; provider errors are sanitized', async (t) => {
 let redirectHits = 0;
 const other = http.createServer((_req, res) => { redirectHits++; res.end(); });
 await new Promise((resolve) => other.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise((resolve) => other.close(resolve)));
 let status = 302;
 const f = await fixture(t, { handler: (_req, res) => { res.writeHead(status, { location: `http://127.0.0.1:${other.address().port}/leak` }); res.end('selected-secret'); } });
 const redirected = await privateRequest(f); assert.equal(redirected.status, 502); assert.ok(!redirected.body.includes('selected-secret')); assert.equal(redirectHits, 0);
 status = 401; const rejected = await privateRequest(f); assert.equal(rejected.status, 401); assert.match(rejected.body, /rejected credential/); assert.ok(!rejected.body.includes('selected-secret'));
});
test('upstream TLS verification remains enabled and sends no request to a self-signed peer', async (t) => {
 const f = await fixture(t, { tls: true });
 const result = await privateRequest(f); assert.equal(result.status, 502); assert.equal(f.seen.length, 0); assert.ok(!result.body.includes('selected-secret'));
});
test('streaming forwards before upstream completion; cancellation aborts upstream; timeout is loud', async (t) => {
 let closedResolve; const closed = new Promise((resolve) => { closedResolve = resolve; });
 const f = await fixture(t, { timeoutMs: 100, handler: (req, res) => { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write('data: first\n\n'); req.socket.once('close', closedResolve); } });
 const controller = new AbortController();
 const response = await fetch(`${f.adapter.baseUrl}/messages`, { headers: f.headers, signal: controller.signal });
 const reader = response.body.getReader(); assert.match(Buffer.from((await reader.read()).value).toString(), /first/);
 controller.abort(); await Promise.race([closed, new Promise((_, reject) => setTimeout(() => reject(new Error('upstream not aborted')), 1000).unref())]);
 const stalled = await fixture(t, { timeoutMs: 50, handler: () => {} });
 const result = await privateRequest(stalled); assert.equal(result.status, 504); assert.match(result.body, /timed out/);
});
for (const stage of ['relay', 'adapter']) test(`${stage} timeout after the first streamed chunk aborts the downstream response`, async (t) => {
 let closeResolve; const upstreamClosed = new Promise((resolve) => { closeResolve = resolve; });
 const f = await fixture(t, {
  timeoutMs: stage === 'relay' ? 100 : 1000, adapterTimeoutMs: stage === 'adapter' ? 100 : 1000,
  handler: (req, res) => { req.socket.once('close', closeResolve); res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write('data: first\n\n'); },
 });
 const response = await fetch(`${f.adapter.baseUrl}/messages`, { headers: f.headers });
 assert.equal(response.status, 200);
 const reader = response.body.getReader();
 assert.equal(Buffer.from((await reader.read()).value).toString(), 'data: first\n\n');
 await assert.rejects(reader.read());
 await Promise.race([upstreamClosed, new Promise((_, reject) => setTimeout(() => reject(new Error('upstream not aborted')), 1000).unref())]);
});
test('close aborts inflight requests, removes socket, is idempotent and rejects cross-request reuse', async (t) => {
 let closeResolve; const upstreamClosed = new Promise((resolve) => { closeResolve = resolve; });
 const first = await fixture(t, { handler: (req, res) => { res.writeHead(200); res.write('started'); req.socket.once('close', closeResolve); } });
 const response = await fetch(`${first.adapter.baseUrl}/messages`, { headers: first.headers });
 await response.body.getReader().read();
 await first.relay.close(); await first.relay.close(); await upstreamClosed;
 await assert.rejects(stat(first.socketPath), { code: 'ENOENT' });
 const second = await fixture(t);
 assert.equal((await privateRequest(second, { binding: first.relay.binding })).status, 403);
 assert.equal(second.seen.length, 0);
 await first.adapter.close();
 await assert.rejects(fetch(`${first.adapter.baseUrl}/messages`, { headers: first.headers }));
});
test('an upstream disconnect aborts the response instead of completing a truncated stream', async (t) => {
 let disconnect;
 const f = await fixture(t, { handler: (_req, res) => { res.writeHead(200); res.write('first'); disconnect = () => res.destroy(); } });
 const response = await fetch(`${f.adapter.baseUrl}/messages`, { headers: f.headers });
 const reader = response.body.getReader(); assert.match(Buffer.from((await reader.read()).value).toString(), /first/);
 disconnect(); await assert.rejects(reader.read());
});

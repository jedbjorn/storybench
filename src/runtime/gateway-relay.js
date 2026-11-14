// Request-scoped host-local gateway transport (spec #18 generation 2).
// The host alone pins the upstream. The worker's HTTP adapter has no URL selector.
import http from 'node:http';
import https from 'node:https';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { chmod, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

export const GATEWAY_MOUNT = '/run/storybench/gateway';
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const inputs = ['content-type', 'accept', 'anthropic-version', 'anthropic-beta', 'openai-beta'];
const outputs = ['content-type', 'content-encoding', 'cache-control'];
const headersOf = (headers, names) => Object.fromEntries(names.filter((name) => typeof headers[name] === 'string').map((name) => [name, headers[name]]));
const fail = (response, status, message) => { if (!response.headersSent) response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify({ error: message })); };

export function isHostLocalGateway(route) {
  if (!route.custom) return false;
  const hostname = new URL(route.baseUrl).hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const addresses = Object.values(os.networkInterfaces()).flat().filter(Boolean).map(({ address }) => address.toLowerCase());
  return hostname === 'localhost' || hostname === '::1' || /^127\./.test(hostname) || hostname === os.hostname().toLowerCase() || addresses.includes(hostname);
}

export function gatewayRequestPath(target, basePath) {
  if (typeof target !== 'string' || !target.startsWith('/') || target.startsWith('//') || /[\\\x00-\x20#]/.test(target)) return null;
  const raw = target.split('?')[0];
  // Do not allow a backend's decoding/normalization to escape the pinned prefix.
  if (/%(?:2f|5c|25)/i.test(raw)) return null;
  let decoded; try { decoded = decodeURIComponent(raw); } catch { return null; }
  if (decoded.split('/').some((part) => part === '.' || part === '..') || /[\\\x00-\x1f]/.test(decoded)) return null;
  let prefix; try { prefix = decodeURIComponent(basePath.replace(/\/$/, '')); } catch { return null; }
  if (prefix && decoded !== prefix && !decoded.startsWith(`${prefix}/`)) return null;
  return target;
}

// Keep streaming/backpressure in Node's HTTP pipes; destroying either downstream
// closes the upstream immediately. Error bodies and redirect locations are private.
function forward(incoming, response, open, options, { timeoutMs, active }) {
  const upstream = open(options);
  active.add(upstream);
  upstream.setTimeout(timeoutMs, () => { upstream.destroy(); fail(response, 504, 'Gateway timed out'); });
  incoming.once('aborted', () => upstream.destroy());
  response.once('close', () => { if (!response.writableEnded) upstream.destroy(); });
  upstream.once('close', () => active.delete(upstream));
  upstream.once('error', () => { if (!response.destroyed && !response.writableEnded) fail(response, 502, 'Gateway request failed'); });
  upstream.once('response', (result) => {
    if (result.statusCode >= 300 && result.statusCode < 400) { result.destroy(); fail(response, 502, 'Gateway redirects are not allowed'); return; }
    if (result.statusCode >= 400) {
      const status = result.statusCode; result.destroy();
      fail(response, status, status === 401 || status === 403 ? 'Gateway rejected credential' : status === 404 ? 'Gateway model or endpoint not found' : 'Gateway request failed'); return;
    }
    response.writeHead(result.statusCode, headersOf(result.headers, outputs));
    result.once('error', () => response.destroy());
    result.pipe(response);
  });
  incoming.pipe(upstream);
}

function lifecycle(server, active, socketPath = null) {
  const sockets = new Set(); let closing;
  server.on('connection', (socket) => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  return async () => {
    closing ||= (async () => {
      for (const request of active) request.destroy();
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
      if (socketPath) await rm(socketPath, { force: true });
    })();
    return closing;
  };
}

export async function startGatewayRelay({ socketPath, route, requestId, timeoutMs = 120000 }) {
  const target = new URL(route.baseUrl), basePath = target.pathname.replace(/\/$/, '');
  const { key, protocol } = route;
  if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password || target.search || target.hash) throw new Error('Invalid saved gateway target');
  if (!gatewayRequestPath(`${basePath || ''}/`, basePath)) throw new Error('Invalid saved gateway base path');
  const binding = { requestId, source: route.id || route.source, token: randomBytes(32).toString('hex'), basePath, protocol };
  const active = new Set();
  const server = http.createServer((incoming, response) => {
    if (!same(incoming.headers['x-storybench-token'], binding.token) || incoming.headers['x-storybench-request'] !== binding.requestId || incoming.headers['x-storybench-source'] !== binding.source) { fail(response, 403, 'Gateway request binding mismatch'); return; }
    if (incoming.headers.authorization || incoming.headers['x-api-key'] || incoming.headers['proxy-authorization']) { fail(response, 403, 'Worker credentials are not accepted by the host relay'); return; }
    const requestPath = gatewayRequestPath(incoming.url, basePath);
    if (!requestPath || incoming.headers.host !== 'storybench-relay') { fail(response, 400, 'Gateway target mismatch'); return; }
    if (!['GET', 'POST', 'DELETE', 'HEAD', 'OPTIONS'].includes(incoming.method)) { fail(response, 405, 'Gateway method not allowed'); return; }
    const headers = headersOf(incoming.headers, inputs);
    if (key) {
      if (protocol === 'anthropic') headers['x-api-key'] = key;
      else headers.authorization = `Bearer ${key}`;
    }
    if (protocol === 'anthropic') headers['anthropic-version'] ||= '2023-06-01';
    forward(incoming, response, target.protocol === 'https:' ? https.request : http.request,
      { protocol: target.protocol, hostname: target.hostname.replace(/^\[|\]$/g, ''), port: target.port || undefined, method: incoming.method, path: requestPath, headers }, { timeoutMs, active });
  });
  server.requestTimeout = timeoutMs;
  await mkdir(path.dirname(socketPath), { recursive: true, mode: 0o700 });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(socketPath, resolve); });
  try { await chmod(socketPath, 0o600); }
  catch (error) { await lifecycle(server, active, socketPath)(); throw error; }
  return { binding, close: lifecycle(server, active, socketPath) };
}

export async function startWorkerGatewayAdapter({ socketPath, binding, timeoutMs = 120000 }) {
  const active = new Set();
  const server = http.createServer((incoming, response) => {
    // The SDK authenticates to this loopback adapter with the transport capability,
    // never the host's provider key. Neither adapter accepts an alternate upstream.
    const authorization = binding.protocol === 'anthropic' ? incoming.headers['x-api-key'] : incoming.headers.authorization?.replace(/^Bearer /, '');
    if (!same(authorization, binding.token)) { fail(response, 403, 'Gateway adapter binding mismatch'); return; }
    const requestPath = gatewayRequestPath(incoming.url, binding.basePath);
    if (!requestPath) { fail(response, 400, 'Gateway target mismatch'); return; }
    forward(incoming, response, http.request, { socketPath, method: incoming.method, path: requestPath, headers: {
      ...headersOf(incoming.headers, inputs), host: 'storybench-relay', 'x-storybench-token': binding.token,
      'x-storybench-request': binding.requestId, 'x-storybench-source': binding.source,
    } }, { timeoutMs, active });
  });
  server.requestTimeout = timeoutMs;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return { baseUrl: `http://127.0.0.1:${server.address().port}${binding.basePath}`, close: lifecycle(server, active) };
}

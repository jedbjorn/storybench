// Host-only provider state. Pattern ported from Subfloor's layered provider catalogue;
// secrets are separate from metadata and never returned by this service.
import { readFile, mkdir, open, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { acquireLock } from './credentials.js';
import { RuntimeError } from './validate.js';

export const PROVIDERS = Object.freeze({
  anthropic: { name: 'Anthropic', harness: 'claude', env: 'ANTHROPIC_API_KEY', protocol: 'anthropic', baseUrl: 'https://api.anthropic.com/v1' },
  openai: { name: 'OpenAI', harness: 'codex', env: 'OPENAI_API_KEY', protocol: 'openai', baseUrl: 'https://api.openai.com/v1' },
  deepseek: { name: 'DeepSeek', harness: 'opencode', env: 'DEEPSEEK_API_KEY', protocol: 'openai', baseUrl: 'https://api.deepseek.com' },
  'ollama-cloud': { name: 'Ollama Cloud', harness: 'opencode', env: 'OLLAMA_API_KEY', protocol: 'openai', baseUrl: 'https://ollama.com/v1' },
  moonshotai: { name: 'Moonshot AI', harness: 'opencode', env: 'MOONSHOT_API_KEY', protocol: 'openai', baseUrl: 'https://api.moonshot.ai/v1' },
});
export const providerDirectory = () => path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'storybench');
const fail = (message) => new RuntimeError('PROVIDER_UNAVAILABLE', message, { status: 409 });
const ID = /^gateway-[a-z0-9_-]{1,40}$/;
export function gatewayDefinition(input) {
  if (!ID.test(input.id || '') || typeof input.name !== 'string' || !input.name.trim() || input.name.length > 100) throw fail('Give the gateway an id and display name');
  let url; try { url = new URL(input.baseUrl); } catch { throw fail('Give a valid gateway URL'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw fail('Gateway URL must be HTTP(S), without credentials or query');
  if (!['openai', 'anthropic'].includes(input.protocol)) throw fail('Choose OpenAI-compatible or Anthropic protocol');
  if (!Array.isArray(input.models) || input.models.length > 200 || input.models.some((id) => typeof id !== 'string' || !/^[\w][\w.:[\]/-]{0,159}$/.test(id))) throw fail('Models must be plain identifiers');
  return { id: input.id, name: input.name.trim(), baseUrl: url.href.replace(/\/$/, ''), protocol: input.protocol, models: [...new Set(input.models)], harness: 'opencode', env: `STORYBENCH_GATEWAY_${input.id.slice(8).replace(/-/g, '_').toUpperCase()}_KEY`, custom: true };
}
async function atomic(file, bytes) {
  const temp = `${file}.${randomUUID()}.tmp`;
  const handle = await open(temp, 'wx', 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
  try { await rename(temp, file); } finally { await rm(temp, { force: true }); }
}
async function optional(file) { try { return await readFile(file, 'utf8'); } catch (error) { if (error.code === 'ENOENT') return ''; throw fail('Cannot read provider configuration'); } }
export function parseProviderEnv(text) {
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (!match) throw fail('Invalid providers.env line; use NAME=value');
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    values[match[1]] = value;
  }
  return values;
}
export function createProviderService({ directory = providerDirectory(), fetchImpl = fetch, now = Date.now } = {}) {
  const envFile = path.join(directory, 'providers.env'), metadataFile = path.join(directory, 'providers.json');
  const cache = new Map(), statuses = new Map();
  let capabilities = null, capabilitiesAt = 0;
  async function modelCapabilities() {
    if (capabilities && now() - capabilitiesAt < 3600000) return capabilities;
    try {
      const response = await fetchImpl('https://models.dev/api.json', { signal: AbortSignal.timeout(10000), redirect: 'error' });
      if (!response.ok) throw new Error();
      capabilities = await response.json(); capabilitiesAt = now();
    } catch { /* Keep stale metadata; absence is explicitly unverified. */ }
    return capabilities || {};
  }
  async function definitions() {
    let gateways; try { gateways = JSON.parse(await optional(metadataFile) || '[]'); } catch { throw fail('Invalid gateway configuration'); }
    return { ...PROVIDERS, ...Object.fromEntries(gateways.map((value) => { const def = gatewayDefinition(value); return [def.id, def]; })) };
  }
  async function definition(source) { const def = (await definitions())[source]; if (!def) throw fail('Unknown inference source'); return def; }
  async function mutate(action) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const release = await acquireLock(path.join(directory, 'providers.lock'));
    if (!release) throw fail('Provider configuration is being saved; retry');
    try { return await action(); } finally { await release(); }
  }
  async function keyFor(def) { return parseProviderEnv(await optional(envFile))[def.env] || null; }
  async function probe(def, key) {
    const url = new URL(`${def.baseUrl}/models`);
    try {
      const response = await fetchImpl(url, { headers: def.protocol === 'anthropic' ? { ...(key ? { 'x-api-key': key } : {}), 'anthropic-version': '2023-06-01' } : key ? { Authorization: `Bearer ${key}` } : {}, signal: AbortSignal.timeout(10000), redirect: 'error' });
      if ([404, 405].includes(response.status)) return { status: 'Not checked', models: null };
      if ([401, 403].includes(response.status)) return { status: 'Key rejected', models: null };
      if (!response.ok) return { status: 'Unreachable', models: null };
      const body = await response.json();
      const models = (body.data || body.models || []).map((model) => model.id || model.name).filter((id) => typeof id === 'string');
      return { status: 'Connected', models };
    } catch { return { status: 'Unreachable', models: null }; }
  }
  async function status(source) {
    const def = await definition(source), key = await keyFor(def);
    const info = await stat(envFile).catch(() => null);
    const observed = statuses.get(source);
    return { ...def, id: source, status: !key && !def.custom ? 'No key' : observed?.key === key ? observed.status : 'Not checked', suffix: key?.length > 4 ? key.slice(-4) : null,
      warning: info && (info.mode & 0o077) ? 'providers.env permissions should be 0600' : null };
  }
  async function test(source) {
    const def = await definition(source), key = await keyFor(def);
    if (!key && !def.custom) return status(source);
    const result = await probe(def, key); statuses.set(source, { key, status: result.status }); cache.delete(source);
    return status(source);
  }
  async function replace(source, candidate, { saveUnchecked = false } = {}) {
    const def = await definition(source);
    if (typeof candidate !== 'string' || !candidate || candidate.length > 16000 || /[\s\x00-\x1f"']/.test(candidate)) throw fail('Key must be one non-empty line');
    const result = await probe(def, candidate);
    if (result.status !== 'Connected' && !(result.status === 'Not checked' && saveUnchecked)) throw fail(result.status === 'Not checked' ? 'No model-list endpoint; explicitly save as Not checked' : result.status);
    await mutate(async () => { const values = parseProviderEnv(await optional(envFile)); values[def.env] = candidate; await atomic(envFile, Object.entries(values).map(([name, value]) => `${name}=${value}\n`).join('')); });
    statuses.set(source, { key: candidate, status: result.status }); cache.delete(source);
    return status(source);
  }
  async function remove(source) {
    const def = await definition(source);
    await mutate(async () => { const values = parseProviderEnv(await optional(envFile)); delete values[def.env]; await atomic(envFile, Object.entries(values).map(([name, value]) => `${name}=${value}\n`).join('')); });
    statuses.delete(source); cache.delete(source); return status(source);
  }
  async function saveGateway(input) {
    const def = gatewayDefinition(input);
    await mutate(async () => { const defs = await definitions(); defs[def.id] = def; await atomic(metadataFile, JSON.stringify(Object.values(defs).filter((value) => value.custom))); });
    cache.delete(def.id); return status(def.id);
  }
  async function route(source) {
    const def = await definition(source), key = await keyFor(def);
    if (!key && !def.custom) throw fail('No key; open Providers to configure this source');
    return { ...def, key };
  }
  async function models(source, { refresh = false } = {}) {
    const def = await definition(source), key = await keyFor(def), cached = cache.get(source);
    if (!key && !def.custom) return { ...await status(source), available: false, reason: 'No key; open Providers', models: [] };
    if (cached && cached.key === key && !refresh && now() - cached.at < 3600000) return cached.value;
    const result = await probe(def, key); statuses.set(source, { key, status: result.status });
    if (['Key rejected', 'Unreachable'].includes(result.status)) {
      if (cached && cached.key === key && result.status !== 'Key rejected') return { ...cached.value, stale: true, discoveryError: result.status };
      return { source, harness: def.harness, available: false, reason: result.status, models: [] };
    }
    const floor = { openai: ['gpt-4o'], anthropic: ['claude-sonnet-4-5'], deepseek: ['deepseek-chat'], moonshotai: ['kimi-k2.5'] };
    const ids = result.models?.length ? result.models : def.models?.length ? def.models : floor[source] || [];
    const metadata = def.custom ? {} : (await modelCapabilities())[source]?.models || {};
    const value = { source, harness: def.harness, available: true, reason: null, exactModelIds: result.models === null, models: ids.map((id) => {
      const info = metadata[id], inputModalities = info?.modalities?.input || null;
      const eligible = Boolean(info?.tool_call && inputModalities?.includes('image') && inputModalities?.includes('text'));
      return { id, displayName: info?.name || id, efforts: [], eligible, eligibilityReason: !info ? 'Unverified capabilities' : !inputModalities?.includes('image') ? 'No image input' : !info.tool_call ? 'No tool calling' : !inputModalities?.includes('text') ? 'No text input' : null, inputModalities };
    }), stale: false };
    cache.set(source, { key, at: now(), value }); return value;
  }
  return { definitions, status, test, replace, remove, saveGateway, route, models, list: async () => Promise.all(Object.keys(await definitions()).map(status)) };
}

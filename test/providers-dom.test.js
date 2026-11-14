import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { ChatSettings } from '../public/chat-settings.js';
import { SettingsPages } from '../public/settings-pages.js';
test('picker labels capability risk, hides ineligible models, and saves the provider source', async () => {
 const dom = new JSDOM('<div id="panel"></div>'); const panel = dom.window.document.querySelector('#panel'); const calls = [];
 const settings = new ChatSettings({ api: async (url, options) => { calls.push([url, JSON.parse(options.body)]); return {}; } });
 settings.catalog = { available: true, harnesses: [{ source: 'gateway-local', harness: 'opencode', available: true, models: [{ id: 'vision', eligible: true, efforts: [] }, { id: 'text', eligible: false, eligibilityReason: 'No image input', efforts: [] }] }] };
 settings.open(panel, { id: 'chat', episodeId: 'ep', settings: { harness: 'opencode', inferenceSource: 'gateway-local', revision: 1 } });
 assert.equal(panel.querySelector('[data-settings-harness]').value, 'gateway-local');
 assert.ok(!panel.querySelector('[data-settings-models]').textContent.includes('text'));
 const all = panel.querySelector('[data-settings-show-all]'); all.checked = true; all.dispatchEvent(new dom.window.Event('change'));
 assert.match(panel.querySelector('[data-settings-models]').textContent, /No image input; use at your own risk/);
 panel.querySelector('[data-settings-model]').value = 'vision';
 await panel.querySelector('form').onsubmit({ preventDefault() {} });
 assert.equal(calls[0][1].source, 'gateway-local'); assert.equal(calls[0][1].harness, 'opencode');
 dom.window.close();
});
test('Providers masks stored credentials, clears replacement field, and submits only the chosen key', async (t) => {
 const dom = new JSDOM('<div id="providersEditor"></div>');
 const previous = globalThis.document; globalThis.document = dom.window.document; t.after(() => { globalThis.document = previous; dom.window.close(); });
 const calls = [];
 const pages = new SettingsPages({ toast() {}, setStatus() {}, api: async (url, options) => {
  if (options) { calls.push({ url, body: options.body && JSON.parse(options.body) }); return {}; }
  if (url === '/api/providers') return [{ id: 'openai', name: 'OpenAI', status: 'Connected', suffix: '1234' }];
  return { available: true, harnesses: [] };
 } });
 await pages.openProviders();
 const form = document.querySelector('[data-provider]'); assert.match(form.textContent, /••••1234/);
 form.elements.key.value = 'new-secret';
 await form.onsubmit({ preventDefault() {} });
 assert.deepEqual(calls, [{ url: '/api/providers/openai', body: { key: 'new-secret', saveUnchecked: false } }]);
 assert.equal(document.querySelector('input[name="key"]').value, '');
});

test('picker requires an OpenCode model, offers variants and keeps native login defaults', async () => {
 const dom = new JSDOM('<div id="panel"></div>'); const panel = dom.window.document.querySelector('#panel');
 const settings = new ChatSettings({ api: async () => ({}) });
 settings.catalog = { available: true, harnesses: [
  { source: 'deepseek', harness: 'opencode', available: true, models: [{ id: 'deepseek-chat', eligible: true, efforts: ['low', 'high'] }] },
  ...['codex', 'claude'].map((harness) => ({ source: `${harness}-login`, harness, available: true, models: [{ id: 'verified', eligible: true, efforts: ['high'] }, { id: 'unknown', eligible: false, eligibilityReason: 'Unverified capabilities', efforts: [] }] })),
 ] };
 for (const defaultMode of [false, true]) {
  settings.open(panel, { id: 'chat', episodeId: 'ep', settings: { harness: 'opencode', inferenceSource: 'deepseek', revision: 1 } }, { defaultMode });
  const model = panel.querySelector('[data-settings-model]'), source = panel.querySelector('[data-settings-harness]');
  assert.equal(model.required, true);
  assert.match(model.placeholder, /required/);
  assert.equal(panel.querySelector('form').checkValidity(), false);
  model.value = 'deepseek-chat'; model.dispatchEvent(new dom.window.Event('input'));
  assert.match(panel.querySelector('[data-settings-effort]').textContent, /high/);
  for (const harness of ['codex', 'claude']) {
   source.value = `${harness}-login`; source.dispatchEvent(new dom.window.Event('change'));
   assert.equal(model.required, false);
   assert.equal(model.placeholder, 'Harness default');
   assert.equal(panel.querySelector('form').checkValidity(), true);
   assert.match(panel.querySelector('[data-settings-models]').textContent, /verified/);
   assert.doesNotMatch(panel.querySelector('[data-settings-models]').textContent, /unknown/);
  }
 }
 dom.window.close();
});

test('Providers separates explicit CLI logins, API keys and custom gateways using the public schema', async (t) => {
 const dom = new JSDOM('<div id="providersEditor"></div>');
 const previous = globalThis.document; globalThis.document = dom.window.document;
 t.after(() => { globalThis.document = previous; dom.window.close(); });
 const providers = [
  { id: 'openai', name: 'OpenAI', harness: 'codex', status: 'No key' },
  { id: 'gateway-studio', name: 'Studio gateway', custom: true, harness: 'opencode', status: 'Unreachable' },
  { id: 'deepseek', name: 'DeepSeek', harness: 'opencode', status: 'Key rejected' },
 ];
 const harnesses = [
  { source: 'codex-login', harness: 'codex', available: true },
  { source: 'claude-login', harness: 'claude', available: false, reason: 'No Claude login found' },
  // No-key API entries really have id, not source. This used to create duplicate login cards.
  ...providers.map(provider => ({ ...provider, available: false, reason: 'No key; open Providers', models: [] })),
 ];
 const calls = [];
 const pages = new SettingsPages({ toast() {}, setStatus() {}, api: async (url, options) => {
  if (options) { calls.push({ url, method: options.method }); throw new Error('Still unreachable'); }
  return url === '/api/providers' ? providers : { available: true, harnesses };
 } });
 await pages.openProviders();
 const group = title => document.querySelector(`[aria-labelledby="${title}"]`);
 assert.deepEqual([...group('providerLoginsTitle').querySelectorAll('h3')].map(el => el.textContent), ['Codex', 'Claude Code']);
 assert.match(group('providerLoginsTitle').textContent, /No Claude login found/);
 assert.deepEqual([...group('providerKeysTitle').querySelectorAll('[data-provider]')].map(el => el.dataset.provider), ['openai', 'deepseek']);
 assert.equal(group('providerGatewaysTitle').querySelector('[data-provider]').dataset.provider, 'gateway-studio');
 assert.doesNotMatch(document.body.textContent, /No key; open Providers|opencode login/);
 assert.match(group('providerKeysTitle').textContent, /Key rejected/);
 const gateway = document.querySelector('[data-provider="gateway-studio"]');
 await gateway.querySelector('[data-test]').onclick();
 assert.deepEqual(calls, [{ url: '/api/providers/gateway-studio/test', method: 'POST' }]);
 assert.equal(gateway.querySelector('[data-status]').textContent, 'Still unreachable');
});

test('Providers reports a failed login catalogue without showing stale connected logins', async (t) => {
 const dom = new JSDOM('<div id="providersEditor"></div>');
 const previous = globalThis.document; globalThis.document = dom.window.document;
 t.after(() => { globalThis.document = previous; dom.window.close(); });
 const pages = new SettingsPages({ toast() {}, setStatus() {}, api: async url => {
  if (url === '/api/providers') return [];
  throw new Error('Login discovery unavailable');
 } });
 pages.models.catalog = { harnesses: [{ source: 'codex-login', harness: 'codex', available: true }] };
 await pages.openProviders();
 assert.match(document.body.textContent, /Login discovery unavailable/);
 assert.doesNotMatch(document.body.textContent, /Connected/);
});

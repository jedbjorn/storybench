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

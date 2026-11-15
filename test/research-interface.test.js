import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import jsdom from 'jsdom';
const { JSDOM, requestInterceptor } = jsdom;
import { createApp } from '../src/server.js';
import { RESEARCH_LIMITS, RESEARCH_TRANSPORT_BYTES } from '../src/store.js';
import { createStoryRenderer } from '../src/story-editor.js';
import { ResearchEditor } from '../public/research-workspace.js';

async function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'sb-research-ui-'));
  const app = await createApp({ workspace: root });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await app.close(); rmSync(root, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const api = async (url, options = {}) => {
    const response = await fetch(base + url, { ...options, headers: { 'content-type': 'application/json', ...options.headers } });
    const data = await response.json();
    if (!response.ok) throw Object.assign(new Error(data.error), data, { status: response.status });
    return data;
  };
  return { ...app, base, api, production: (kind = 'video') => app.store.createEpisode({ kind, channelId: app.store.getDefaultChannel().id }) };
}
function editor(t, api, options = {}) {
  const requests = [];
  const dom = new JSDOM('<section id="research"></section>', { url: 'https://app.test/', resources: { interceptors: [requestInterceptor(request => { requests.push(request.url); return new Response(''); })] }, runScripts: 'dangerously' });
  t.after(() => dom.window.close());
  const root = dom.window.document.querySelector('section');
  const instance = new ResearchEditor({ root, api, renderMarkdown: createStoryRenderer(), confirm: () => true, ...options });
  const click = selector => root.querySelector(selector).click();
  const input = (selector, value) => { const field = root.querySelector(selector); field.value = value; field.dispatchEvent(new dom.window.Event('input', { bubbles: true })); };
  return { instance, root, dom, requests, click, input };
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

test('HTTP research is shared by both kinds at every stage and archived, validates atomically and checks ownership', async t => {
  const f = await fixture(t);
  const channel = f.store.createChannel('Other');
  for (const kind of ['deck', 'video']) {
    let p = f.production(kind);
    const endpoint = `/api/episodes/${p.id}/research`;
    for (const stage of ['Scaffold', 'Draft', 'Final', 'Published']) {
      p = f.store.updateEpisode(p.id, p.revision, { state: stage });
      const record = await f.api(endpoint);
      const saved = await f.api(endpoint, { method: 'PUT', body: JSON.stringify({ expectedResearchRevision: record.researchRevision, summary: `${kind} ${stage}`, links: [{ url: 'http://example.com', title: '', note: '' }] }) });
      assert.equal(saved.actor, 'human');
      assert.equal(saved.summary, `${kind} ${stage}`);
      assert.deepEqual(f.store.getResearch(p.id), saved);
      const before = f.store.getResearch(p.id);
      for (const bad of [null, [], { expectedResearchRevision: saved.researchRevision, summary: 4, links: [] }, { expectedResearchRevision: saved.researchRevision, summary: '', links: [{ url: 'javascript:alert(1)' }] }, { expectedResearchRevision: saved.researchRevision, summary: 'x'.repeat(RESEARCH_LIMITS.summaryBytes + 1), links: [] }]) {
        await assert.rejects(f.api(endpoint, { method: 'PUT', body: JSON.stringify(bad) }), e => [400, 413].includes(e.status));
        assert.deepEqual(f.store.getResearch(p.id), before);
      }
      await assert.rejects(f.api(endpoint, { method: 'PUT', body: JSON.stringify({ expectedResearchRevision: record.researchRevision, summary: 'stale', links: [] }) }), e => e.status === 409 && assert.deepEqual(e.current, saved) === undefined);
      await assert.rejects(f.api(endpoint, { headers: { 'x-storybench-channel': channel.id } }), e => [403, 404, 409].includes(e.status));
    }
    p = f.store.updateEpisode(p.id, p.revision, { archived: true });
    assert.equal((await f.api(endpoint)).summary, `${kind} Published`);
    const current = await f.api(endpoint);
    assert.equal((await f.api(endpoint, { method: 'PUT', body: JSON.stringify({ expectedResearchRevision: current.researchRevision, summary: 'Archived edit', links: [] }) })).summary, 'Archived edit');
  }
  await assert.rejects(f.api('/api/episodes/missing/research'), e => e.status === 404);
  const pending = f.production();
  f.store.db.prepare('UPDATE channels SET pending_delete_id=? WHERE id=?').run('pending', pending.channelId);
  for (const method of ['GET', 'PUT']) await assert.rejects(f.api(`/api/episodes/${pending.id}/research`, { method, ...(method === 'PUT' ? { body: '{}' } : {}) }), e => e.status === 410);
});

test('HTTP transport accepts heavily escaped valid complete records and returns clear bounded oversize errors', async t => {
  const f = await fixture(t), p = f.production();
  const endpoint = `/api/episodes/${p.id}/research`;
  const body = { expectedResearchRevision: 1, summary: 'a'.repeat(RESEARCH_LIMITS.summaryBytes), links: Array.from({ length: 100 }, (_, i) => ({ id: `link_${i}`, url: `https://example.com/${'x'.repeat(4096)}` })) };
  const escaped = JSON.stringify(body).replace(/[a-z]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
  assert.ok(Buffer.byteLength(escaped) > 6_500_000);
  const saved = await f.api(endpoint, { method: 'PUT', body: escaped });
  assert.deepEqual({ summary: saved.summary, links: saved.links }, { summary: body.summary, links: body.links });
  await assert.rejects(f.api(endpoint, { method: 'PUT', body: JSON.stringify({ padding: 'x'.repeat(RESEARCH_TRANSPORT_BYTES + 1) }) }), e => e.status === 413 && /transport limit/.test(e.message));
  assert.deepEqual(f.store.getResearch(p.id), saved);
});

test('two human editors preserve all stale draft text/links, reconcile explicitly, and reopen link CRUD with stable order/IDs', async t => {
  const f = await fixture(t), p = f.production('deck');
  const a = editor(t, f.api), b = editor(t, f.api);
  await Promise.all([a.instance.open(p.id), b.instance.open(p.id)]);
  a.instance.edit(); b.instance.edit();
  a.input('[data-research-summary]', '# Saved findings');
  for (const [index, url] of ['https://example.com/one', 'http://example.com/two'].entries()) {
    a.click('[data-research-add]');
    a.input(`[data-link-index="${index}"] [data-link-field="url"]`, url);
    a.input(`[data-link-index="${index}"] [data-link-field="title"]`, `Source ${index}`);
    a.input(`[data-link-index="${index}"] [data-link-field="note"]`, `Full note ${index}`);
  }
  const ids = a.instance.draft.links.map(link => link.id);
  a.click('[data-link-index="0"] [data-research-down]');
  assert.deepEqual(a.instance.draft.links.map(link => link.id), ids.toReversed());
  const winner = await a.instance.save();
  b.input('[data-research-summary]', '# My entire unsaved summary');
  b.click('[data-research-add]'); b.input('[data-link-field="url"]', 'https://example.com/pending'); b.input('[data-link-field="note"]', 'Preserve this note');
  const pending = structuredClone(b.instance.draft);
  assert.equal(await b.instance.save(), null);
  assert.deepEqual(b.instance.draft, pending);
  assert.equal(b.instance.record.researchRevision, 1, 'conflict does not implicitly rebase the draft');
  assert.deepEqual(JSON.parse(b.root.querySelector('[data-research-current]').value), winner);
  assert.deepEqual(f.store.getResearch(p.id), winner);
  b.click('[data-research-reconcile]');
  assert.deepEqual(b.instance.draft, pending);
  const reconciled = await b.instance.save();
  assert.equal(reconciled.researchRevision, 3);
  await a.instance.refresh();
  assert.equal(a.root.querySelector('[data-research-read] h1').textContent, 'My entire unsaved summary');
  a.instance.edit(); a.click('[data-research-add]'); a.input('[data-link-index="1"] [data-link-field="url"]', 'https://example.com/extra');
  a.click('[data-link-index="0"] [data-research-remove]');
  const final = await a.instance.save();
  assert.equal(final.links.length, 1);
  const reopened = editor(t, f.api); await reopened.instance.open(p.id);
  assert.deepEqual(reopened.instance.record, final);
  assert.equal(reopened.root.querySelector('[data-research-sources] a').href, 'https://example.com/extra');
});

test('server failures preserve draft and leave guard stays open; Save, Cancel, Discard and Stay behave explicitly', async t => {
  const f = await fixture(t), p = f.production(); let fail = false, confirm = false;
  const e = editor(t, (url, options) => options?.method === 'PUT' && fail ? Promise.reject(Object.assign(new Error('Service unavailable'), { status: 503 })) : f.api(url, options), { confirm: () => confirm });
  await e.instance.open(p.id); e.instance.edit(); e.input('[data-research-summary]', 'pending summary');
  e.click('[data-research-add]'); e.input('[data-link-field="url"]', 'https://example.com');
  const pending = structuredClone(e.instance.draft);
  e.click('[data-research-cancel]'); assert.deepEqual(e.instance.draft, pending);
  let leave = e.instance.requestLeave(); await tick();
  assert.equal(e.dom.window.document.activeElement.hasAttribute('data-research-stay'), true);
  e.click('[data-research-stay]'); assert.equal(await leave, 'stay'); assert.deepEqual(e.instance.draft, pending);
  fail = true; leave = e.instance.requestLeave(); await tick(); e.click('[data-research-leave-save]');
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(e.instance.draft, pending); assert.match(e.root.textContent, /draft preserved.*Service unavailable/);
  assert.equal(e.root.querySelector('[data-research-leave]').hasAttribute('open'), true);
  fail = false; e.click('[data-research-leave-save]'); assert.equal(await leave, 'save');
  assert.equal(f.store.getResearch(p.id).summary, pending.summary);
  e.instance.edit(); e.input('[data-research-summary]', 'discard me');
  leave = e.instance.requestLeave(); await tick(); e.click('[data-research-discard]'); assert.equal(await leave, 'discard');
  assert.equal(e.instance.draft, null); assert.equal(e.instance.record.summary, pending.summary);
  e.instance.edit(); e.input('[data-research-summary]', 'cancel me'); confirm = true; e.click('[data-research-cancel]');
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(e.instance.draft, null); assert.equal(f.store.getResearch(p.id).summary, pending.summary);
});

test('summary read/preview cannot execute HTML/scripts or load remote resources; source links require deliberate action', async t => {
  const f = await fixture(t), p = f.production();
  const summary = '# Findings\n\n<script>window.researchExecuted = true</script><iframe src="https://evil.test/frame"></iframe><img src="https://evil.test/raw" onerror="window.researchExecuted=true">\n\n![pixel](https://evil.test/pixel)\n\n[safe](https://example.com) [bad](javascript:alert(1)) [relative](/api/state)';
  f.store.saveResearch(p.id, 1, { summary, links: [{ url: 'https://example.com/source', title: '<img src="https://evil.test/title">', note: '<script>bad</script>' }] });
  const e = editor(t, f.api); await e.instance.open(p.id); e.instance.edit(); e.click('[data-research-preview]');
  assert.equal(e.root.querySelectorAll('img, iframe, script, video, audio, object, embed, link, style').length, 0);
  assert.equal(e.dom.window.researchExecuted, undefined);
  assert.deepEqual(e.requests, []);
  const anchors = [...e.root.querySelectorAll('[data-research-preview-body] a[href]')];
  assert.deepEqual(anchors.map(a => a.href), ['https://example.com/']);
  assert.ok(anchors.every(a => a.target === '_blank' && a.rel.includes('noreferrer')));
});

test('idle refresh accepts agent updates; open editors and stale asynchronous replies never replace a draft or another production', async t => {
  const f = await fixture(t), p = f.production(), other = f.production('deck');
  const e = editor(t, f.api); await e.instance.open(p.id);
  const agent = f.store.saveResearch(p.id, 1, { summary: 'Agent findings', links: [] }, 'agent');
  await e.instance.refresh(); assert.deepEqual(e.instance.record, agent);
  e.instance.edit(); const openRecord = e.instance.record;
  f.store.saveResearch(p.id, 2, { summary: 'New agent findings', links: [] }, 'agent');
  await e.instance.refresh(); assert.equal(e.instance.record, openRecord, 'even a clean open editor is protected');
  e.input('[data-research-summary]', 'Unsaved text'); await e.instance.refresh(); assert.equal(e.instance.draft.summary, 'Unsaved text');
  assert.equal(await e.instance.open(other.id), false); assert.equal(e.instance.episodeId, p.id);
  let resolveOld;
  const r = editor(t, async url => url.includes(p.id) ? new Promise(resolve => { resolveOld = resolve; }) : f.api(url));
  const first = r.instance.open(p.id); await r.instance.open(other.id); resolveOld(agent); await first;
  assert.equal(r.instance.record.episodeId, other.id);
  let refreshReply; const latest = f.store.getResearch(p.id);
  const race = editor(t, f.api); await race.instance.open(p.id);
  race.instance.api = async () => new Promise(resolve => { refreshReply = resolve; });
  const refresh = race.instance.refresh(); race.instance.edit(); race.input('[data-research-summary]', 'Typed during refresh'); refreshReply(latest); await refresh;
  assert.equal(race.instance.draft.summary, 'Typed during refresh');
});

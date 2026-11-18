// Spec #35 Chat, C7 and C11, in the real workspace page. Replies and the report are stored
// directly; no provider or agent turn runs, and github.com is a stand-in route.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { chromium, firefox } from 'playwright-core';
import { createApp } from '../src/server.js';
import { reportAddress } from '../src/upstream-report.js';
import { listenInRange } from '../test-support/loopback-port.js';

const TITLE = 'Deck export drops the last slide';
// A report body with its own Markdown, including a fenced block, so the draft's fence is longer.
const BODY = [
  '## What happened', '', 'Exporting a **12-slide** deck wrote 11 slides. See [the log](https://example.com/log) and `build_deck`.', '',
  '1. Open the deck', '2. Build it', '', '```', 'build_deck -> completed, slides: 11', '```', '',
  '> Tool diagnostic: <b>not</b> markup & not *rendered*', '', '- Storybench 0.1.0  ', '- Harness: Claude', '',
].join('\n');
const DRAFT = `The link did not work, so here is the draft. It has **not been submitted**.\n\n**Title:** ${TITLE}\n\n\`\`\`\`markdown\n${BODY}\`\`\`\`\n`;

for (const engine of [chromium, firefox]) test(`${engine.name()}: a report link opens the prefilled form in a new tab without opener access, and a fallback draft shows verbatim`, { timeout: 60_000 }, async t => {
  // Nothing in this test may reach the internet: any request that is not loopback and not
  // answered by the stand-in below goes to a dead proxy and fails.
  const browser = await engine.launch({ ...(engine === chromium ? { channel: 'chromium' } : {}), proxy: { server: 'http://127.0.0.1:9', bypass: '127.0.0.1' } });
  t.after(() => browser.close());
  const workspace = await mkdtemp(path.join(tmpdir(), 'sb-upstream-chat-'));
  const app = await createApp({ workspace });
  t.after(async () => { await app.close(); await rm(workspace, { recursive: true, force: true }); });
  const episode = app.store.createEpisode({ title: 'Upstream report' });
  const chat = app.chat.create(episode.id, { name: 'Report proof' });
  const report = app.store.createUpstreamReport({ id: '0123456789abcdef', episodeId: episode.id, conversationId: chat.id, requestId: 'request_one', kind: 'bug', title: TITLE, body: BODY });
  const add = (text) => app.store.addConversationMessage({ conversationId: chat.id, role: 'assistant', text }).id;
  const linked = add(`The report is prepared, not submitted. [Open the report on GitHub](/report/${report.reportId}) in your default browser.\n\n` +
    'Not links: [health](/api/health) [other](/report/../api/health) [short](/report/abc) [query](/report/0123456789abcdef?next=https://evil.example)');
  const draft = add(DRAFT);
  const port = await listenInRange(app.server), base = `http://127.0.0.1:${port}`;
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  // The GitHub stand-in. Firefox follows a redirect without offering the follow-up request to
  // a route, so the browser's own request for the short link is answered here: the app's
  // redirect is read without following it, recorded, and a blank form page is shown instead.
  const redirects = [];
  await context.route(`${base}/report/**`, async route => {
    const response = await route.fetch({ maxRedirects: 0 });
    redirects.push({ url: route.request().url(), navigation: route.request().isNavigationRequest(), status: response.status(), location: response.headers().location });
    return route.fulfill({ contentType: 'text/html', body: '<title>New issue</title><h1>Stand-in form</h1>' });
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${base}/?channel=${episode.channelId}&episode=${episode.id}`);
  const bubble = id => page.locator(`[data-message-id="${id}"]`);
  await bubble(draft).locator('pre').waitFor();

  // C7: one clickable link, opening a new tab that cannot reach the workspace window.
  const links = await bubble(linked).evaluate(node => [...node.querySelectorAll('a')].map(a => [a.textContent, a.getAttribute('href'), a.target, a.rel]));
  assert.deepEqual(links, [['Open the report on GitHub', `/report/${report.reportId}`, '_blank', 'noreferrer noopener']]);
  assert.match(await bubble(linked).textContent(), /Not links: health other short query/);
  assert.equal(app.store.getUpstreamReport(report.reportId).openedAt, null);
  const [tab] = await Promise.all([context.waitForEvent('page'), bubble(linked).locator('a').click()]);
  await tab.waitForLoadState('domcontentloaded');
  assert.equal(await tab.title(), 'New issue');
  assert.deepEqual(redirects, [{ url: `${base}/report/${report.reportId}`, navigation: true, status: 302, location: reportAddress(report) }]);
  const target = new URL(redirects[0].location);
  assert.equal(`${target.origin}${target.pathname}`, 'https://github.com/jedbjorn/storybench/issues/new');
  assert.equal(target.searchParams.get('template'), 'bug_report.md');
  assert.equal(target.searchParams.get('title'), TITLE);
  assert.equal(target.searchParams.get('body'), BODY);
  assert.equal(await tab.evaluate(() => window.opener), null);
  assert.equal(await tab.evaluate(() => document.referrer), '');
  // The workspace stays where it was, and the report changed only by being opened.
  assert.equal(new URL(page.url()).origin, base);
  const after = app.store.getUpstreamReport(report.reportId);
  assert.ok(after.openedAt);
  assert.deepEqual({ ...after, openedAt: null }, report);
  assert.equal(app.store.db.prepare('SELECT COUNT(*) n FROM upstream_reports').get().n, 1);

  // C11: the draft's fenced body is one code block whose text is the source, Markdown markers included.
  const shown = await bubble(draft).evaluate(node => ({
    blocks: node.querySelectorAll('pre > code').length, text: node.querySelector('pre > code').textContent,
    rendered: node.querySelector('pre').querySelectorAll('strong, em, a, h2, li, blockquote, b').length,
    title: node.querySelector('.chat-markdown').textContent.includes('Title: Deck export drops the last slide'),
    selectable: getComputedStyle(node.querySelector('pre > code')).userSelect,
  }));
  assert.equal(shown.text, BODY);
  assert.deepEqual({ ...shown, text: undefined }, { blocks: 1, text: undefined, rendered: 0, title: true, selectable: shown.selectable });
  assert.notEqual(shown.selectable, 'none');
  // Selecting the block yields the same text a creator would copy.
  const selected = await bubble(draft).evaluate(node => { const range = document.createRange(); range.selectNodeContents(node.querySelector('pre > code')); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); return selection.toString(); });
  assert.equal(selected.replace(/\n$/, ''), BODY.replace(/\n$/, ''));
  assert.deepEqual(errors, []);
  if (process.env.STORYBENCH_CHAT_EVIDENCE) {
    await mkdir(process.env.STORYBENCH_CHAT_EVIDENCE, { recursive: true });
    for (const [name, id] of [['link', linked], ['draft', draft]]) {
      await bubble(id).scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(process.env.STORYBENCH_CHAT_EVIDENCE, `upstream-report-${name}-${engine.name()}.png`) });
    }
  }
});

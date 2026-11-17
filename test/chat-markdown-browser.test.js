// Spec #30 Chat Markdown A1, A2 and A4 in the real workspace page. Replies are
// stored directly; no provider or agent turn runs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { chromium, firefox } from 'playwright-core';
import { createApp } from '../src/server.js';
import { listenInRange } from '../test-support/loopback-port.js';

const FORMATTED = [
  '# Plan heading', '## Second heading', '### Third heading',
  'First paragraph with **bold**, *italic*, ~~struck~~ and `inline code`.',
  'Line one\nline two', '> Quoted note', '1. First\n2. Second\n   - Nested bullet\n     - Deeper bullet',
  '- Loose bullet', '```\nfenced();\n```', '    indented();', '| Slide | Card |\n|---|---|\n| 1 | Title |',
  '---', 'Source: [guide](https://example.com/guide)',
].join('\n\n');
const HOSTILE = [
  '<script>window.__chatInjected = 1</script>', '<img src="/api/health?pixel" onerror="window.__chatInjected = 2">',
  '[run](javascript:window.__chatInjected=3) [relative](story.md) [mail](mailto:team@example.com) [site](https://example.com/a)',
  '![tracker](https://tracker.example/pixel.png) ![local](/api/health?image)',
].join('\n\n');
const WIDE = [`\`\`\`\n${'x'.repeat(200)}\n\`\`\``,
  `| ${Array.from({ length: 10 }, (_, i) => `Column heading ${i + 1}`).join(' | ')} |\n|${'---|'.repeat(10)}\n| ${Array.from({ length: 10 }, (_, i) => `Cell value number ${i + 1}`).join(' | ')} |`,
].join('\n\n');

for (const engine of [chromium, firefox]) test(`${engine.name()}: assistant replies render as safe Markdown, creator text stays literal, wide blocks scroll in place`, { timeout: 60_000 }, async t => {
  const browser = await engine.launch(engine === chromium ? { channel: 'chromium' } : {});
  t.after(() => browser.close());
  const workspace = await mkdtemp(path.join(tmpdir(), 'sb-chat-markdown-'));
  const app = await createApp({ workspace });
  t.after(async () => { await app.close(); await rm(workspace, { recursive: true, force: true }); });
  const episode = app.store.createEpisode({ title: 'Markdown replies' });
  const chat = app.chat.create(episode.id, { name: 'Markdown proof' });
  const add = (role, text) => app.store.addConversationMessage({ conversationId: chat.id, role, text }).id;
  const creator = add('user', FORMATTED), formatted = add('assistant', FORMATTED), hostile = add('assistant', HOSTILE), wide = add('assistant', WIDE);
  const port = await listenInRange(app.server), base = `http://127.0.0.1:${port}`;
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const requests = [], errors = [];
  page.on('request', request => requests.push(request.url()));
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${base}/?channel=${episode.channelId}&episode=${episode.id}`);
  await page.locator(`[data-message-id="${wide}"] .chat-table`).waitFor();
  const bubble = id => page.locator(`[data-message-id="${id}"]`);

  // A1: every supported element is its HTML element; the creator bubble shows raw characters.
  const elements = await bubble(formatted).evaluate(node => {
    const body = node.querySelector('.chat-markdown'), count = selector => body.querySelectorAll(selector).length;
    return { tag: node.tagName, h1: count('h1'), h2: count('h2'), h3: count('h3'), strong: count('strong'), em: count('em'), s: count('s'),
      inlineCode: count(':not(pre) > code'), pre: count('pre > code'), ol: count('ol'), nested: count('ol li > ul li > ul li'), ul: count('ul'),
      blockquote: count('blockquote'), table: count('.chat-table > table th'), hr: count('hr'), br: count('p > br'), link: count('a[href="https://example.com/guide"]'),
      headingSize: parseFloat(getComputedStyle(body.querySelector('h1')).fontSize) / parseFloat(getComputedStyle(body.querySelector('p')).fontSize) };
  });
  assert.deepEqual({ ...elements, headingSize: undefined }, { tag: 'DIV', h1: 1, h2: 1, h3: 1, strong: 1, em: 1, s: 1, inlineCode: 1, pre: 2, ol: 1, nested: 1, ul: 3,
    blockquote: 1, table: 2, hr: 1, br: 1, link: 1, headingSize: undefined });
  assert.ok(elements.headingSize <= 1.2, `heading stays near body size (${elements.headingSize})`);
  assert.equal(await bubble(creator).locator('span').textContent(), FORMATTED);
  assert.equal(await bubble(creator).locator('strong, h1, li, table, a').count(), 0);

  // A2: markup is text, no script runs, only http/https/mailto links are live, nothing leaves the app origin.
  const safety = await bubble(hostile).evaluate(node => ({
    injected: window.__chatInjected ?? null, text: node.textContent,
    dangerous: node.querySelectorAll('script, img, iframe, object, embed, [onerror], [src]').length,
    links: [...node.querySelectorAll('a')].map(a => [a.textContent, a.getAttribute('href'), a.target, a.rel]),
  }));
  assert.equal(safety.injected, null);
  assert.equal(safety.dangerous, 0);
  assert.match(safety.text, /<script>window\.__chatInjected = 1<\/script>/);
  assert.match(safety.text, /<img src="\/api\/health\?pixel" onerror="window\.__chatInjected = 2">/);
  assert.match(safety.text, /run relative mail site/);
  assert.match(safety.text, /tracker local/);
  assert.deepEqual(safety.links, [
    ['mail', 'mailto:team@example.com', '_blank', 'noreferrer noopener'],
    ['site', 'https://example.com/a', '_blank', 'noreferrer noopener'],
    ['tracker', 'https://tracker.example/pixel.png', '_blank', 'noreferrer noopener'],
  ]);
  await bubble(hostile).locator('p', { hasText: 'run relative' }).click();
  assert.equal(await page.evaluate(() => window.__chatInjected ?? null), null);
  assert.deepEqual(requests.filter(url => new URL(url).origin !== base), []);
  assert.deepEqual(requests.filter(url => /pixel|image/.test(url)), []);

  // A4: the 200-character line and ten-column table scroll inside their own blocks.
  await bubble(wide).scrollIntoViewIfNeeded();
  const geometry = await page.evaluate(id => {
    const node = document.querySelector(`[data-message-id="${id}"]`), scroller = document.querySelector('[data-chat-messages]');
    const sideways = el => el.scrollWidth - el.clientWidth;
    return { page: sideways(document.documentElement), transcript: sideways(scroller), pre: sideways(node.querySelector('pre')), table: sideways(node.querySelector('.chat-table')),
      inside: node.getBoundingClientRect().right <= scroller.getBoundingClientRect().right };
  }, wide);
  assert.ok(geometry.page <= 0 && geometry.transcript <= 0, JSON.stringify(geometry));
  assert.ok(geometry.pre > 0 && geometry.table > 0, JSON.stringify(geometry));
  assert.equal(geometry.inside, true);
  assert.deepEqual(errors, []);
  if (process.env.STORYBENCH_CHAT_EVIDENCE) {
    await mkdir(process.env.STORYBENCH_CHAT_EVIDENCE, { recursive: true });
    for (const [name, id] of [['formatted', formatted], ['hostile', hostile], ['wide', wide]]) {
      await bubble(id).scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(process.env.STORYBENCH_CHAT_EVIDENCE, `chat-markdown-${name}-${engine.name()}.png`) });
    }
  }
});

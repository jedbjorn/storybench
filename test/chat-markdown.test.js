// Spec #30 Chat Markdown: renderer rules (A3) and partial replies in the transcript.
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { ChatWorkspace } from '../public/chat-workspace.js';
import { createChatRenderer } from '../src/story-editor.js';

const fragment = (html) => JSDOM.fragment(html);

test('bare scheme addresses link; file-like words and scheme-less text stay plain', () => {
  const render = createChatRenderer();
  const html = fragment(render('Read https://example.com/guide then story.md, index.html, Final.mp4, example.com, //cdn.example.com, ftp://files.example and a@example.com.'));
  assert.deepEqual([...html.querySelectorAll('a')].map((a) => [a.getAttribute('href'), a.textContent, a.target, a.rel]),
    [['https://example.com/guide', 'https://example.com/guide', '_blank', 'noreferrer noopener']]);
  for (const word of ['story.md', 'index.html', 'Final.mp4', 'example.com', '//cdn.example.com', 'ftp://files.example', 'a@example.com']) assert.match(html.textContent, new RegExp(word.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')));
  assert.equal(fragment(render('mailto:team@example.com')).querySelector('a').getAttribute('href'), 'mailto:team@example.com');
});

test('only http, https and mailto destinations are clickable; images load nothing; raw HTML is text', () => {
  const render = createChatRenderer();
  const html = fragment(render([
    '[web](https://example.com) [plain](http://example.com) [mail](mailto:a@example.com)',
    '[script](javascript:alert(1)) [mixed](JaVaScRiPt:alert(1)) [data](data:text/html,x) [relative](story.md) [root](/api/health) [file](file:///etc/passwd)',
    '![remote](https://tracker.example/pixel.png) ![local](/api/health) ![inline](data:image/png;base64,AAAA)',
    '<script>alert(1)</script><img src=x onerror=alert(1)><a href="javascript:alert(1)">raw</a>',
  ].join('\n\n')));
  assert.deepEqual([...html.querySelectorAll('a')].map((a) => [a.textContent, a.getAttribute('href'), a.target, a.rel]), [
    ['web', 'https://example.com', '_blank', 'noreferrer noopener'],
    ['plain', 'http://example.com', '_blank', 'noreferrer noopener'],
    ['mail', 'mailto:a@example.com', '_blank', 'noreferrer noopener'],
    ['remote', 'https://tracker.example/pixel.png', '_blank', 'noreferrer noopener'],
  ]);
  assert.equal(html.querySelectorAll('img, script, iframe, [onerror], [src]').length, 0);
  assert.match(html.textContent, /script mixed data relative root file/);
  assert.match(html.textContent, /remote local inline/);
  assert.match(html.textContent, /<script>alert\(1\)<\/script><img src=x onerror=alert\(1\)><a href="javascript:alert\(1\)">raw<\/a>/);
});

test('single line breaks stay breaks and tables sit in their own scroll block', () => {
  const html = fragment(createChatRenderer()('one\ntwo\n\n| a | b |\n|---|---|\n| 1 | 2 |'));
  assert.equal(html.querySelectorAll('p br').length, 1);
  assert.equal(html.querySelector('.chat-table > table th').textContent, 'a');
});

test('failed and interrupted partial replies render as Markdown and keep their label and Retry; creator text stays literal', async (t) => {
  const dom = new JSDOM('<main id="chat"></main>');
  const root = dom.window.document.querySelector('#chat');
  dom.window.ResizeObserver = class { observe() {} disconnect() {} };
  const text = '**Partial** list:\n\n- one\n- `two`';
  const chat = { id: 'chat', name: 'Work', state: 'interrupted', draft: '', events: [],
    messages: [{ id: 'u1', role: 'user', state: 'failed', text }, { id: 'a1', role: 'assistant', state: 'failed', text },
      { id: 'u2', role: 'user', state: 'interrupted', text }, { id: 'a2', role: 'assistant', state: 'streaming', text }],
    runs: [{ id: 'run-1', state: 'failed', originatingMessageId: 'u1' }] };
  const api = async (url) => url.endsWith('/chats') ? [{ id: 'chat', name: 'Work', state: chat.state, draft: '' }] : structuredClone(chat);
  const workspace = new ChatWorkspace({ root, api, getEpisode: () => ({ id: 'episode' }), renderMarkdown: createChatRenderer() });
  t.after(() => { workspace.close(); dom.window.close(); });
  await workspace.open(); clearInterval(workspace.pollTimer);
  for (const [id, label] of [['a1', 'Failed · partial response'], ['a2', 'Interrupted · partial response']]) {
    const bubble = root.querySelector(`[data-message-id="${id}"]`);
    assert.equal(bubble.tagName, 'DIV');
    assert.equal(bubble.querySelector('.chat-markdown strong').textContent, 'Partial');
    assert.deepEqual([...bubble.querySelectorAll('.chat-markdown li')].map((li) => li.textContent), ['one', 'two']);
    assert.equal(bubble.querySelector('.chat-markdown code').textContent, 'two');
    assert.equal(bubble.querySelector('.chat-response-outcome').textContent, label);
  }
  assert.equal(root.querySelector('[data-message-id="u1"] [data-chat-retry]').dataset.chatRetry, 'run-1');
  for (const id of ['u1', 'u2']) {
    const bubble = root.querySelector(`[data-message-id="${id}"]`);
    assert.equal(bubble.querySelector('span').textContent, text);
    assert.equal(bubble.querySelectorAll('strong, li, code').length, 0);
  }
});

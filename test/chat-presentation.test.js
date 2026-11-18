import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { ChatWorkspace } from '../public/chat-workspace.js';
import { createChatRenderer } from '../src/story-editor.js';

async function fixture(t, { animated = false } = {}) {
  const dom = new JSDOM('<main class="chat"></main>');
  const view = dom.window, root = view.document.querySelector('main');
  const frames = new Map(), observers = new Set();
  let frameId = 0, draws = 0, hidden = false;
  const reduced = new view.EventTarget(); reduced.matches = false;
  view.matchMedia = () => reduced;
  Object.defineProperty(view.document, 'hidden', { get: () => hidden });
  if (animated) {
    view.requestAnimationFrame = fn => { frames.set(++frameId, fn); return frameId; };
    view.cancelAnimationFrame = id => frames.delete(id);
    view.HTMLCanvasElement.prototype.getContext = () => new Proxy({ globalAlpha: 1 }, { get: (target, key) => {
      if (key === 'clearRect') return () => draws++;
      if (key.startsWith('create')) return () => ({ addColorStop() {} });
      return target[key] ?? (() => {});
    } });
  }
  view.ResizeObserver = class {
    constructor(fn) { this.fn = fn; observers.add(this); }
    observe() {}
    disconnect() { observers.delete(this); }
  };
  let episode = { id: 'episode', kind: 'deck' };
  const chats = [{ id: 'one', name: 'One', state: 'idle', messages: [], events: [], draft: '' }, { id: 'two', name: 'Two', state: 'idle', messages: [], draft: '' }];
  let intercept;
  const api = async (url, options = {}) => {
    if (intercept) { const result = intercept(url, options); if (result) return result; }
    if (url.endsWith('/chats')) return structuredClone(chats);
    return structuredClone(chats.find(chat => url.endsWith(chat.id)) ?? {});
  };
  const workspace = new ChatWorkspace({ root, api, getEpisode: () => episode, renderMarkdown: createChatRenderer() });
  t.after(() => { workspace.close(); dom.window.close(); });
  await workspace.open();
  clearInterval(workspace.pollTimer);
  return { view, root, workspace, chats, frames, observers, reduced, draws: () => draws,
    hide(value) { hidden = value; view.document.dispatchEvent(new view.Event('visibilitychange')); },
    intercept(fn) { intercept = fn; },
    async switch(id) { workspace.selectConversation(id); await workspace.refresh(workspace.generation, episode.id, id); },
    async episode(id) { episode = { id }; await workspace.open(); clearInterval(workspace.pollTimer); },
    refresh: () => workspace.refreshList(workspace.generation, episode.id, { preserveSelection: true }) };
}
const user = (id, state = 'running') => ({ id, role: 'user', state, text: 'Immediate user request' });
const assistant = (id, state = 'streaming', text = 'Secret partial') => ({ id, role: 'assistant', state, text });

test('partial text stays hidden, canvas/history survive polls, terminal response appears immediately', async t => {
  const f = await fixture(t, { animated: true });
  f.chats[0].state = 'running';
  f.chats[0].messages = [assistant(1, 'completed', 'Saved history'), user(2), assistant(3)];
  await f.refresh();
  const canvas = f.root.querySelector('canvas'), history = f.root.querySelector('[data-message-id="1"]');
  assert.equal(canvas.width, 900); assert.equal(canvas.height, 900);
  assert.match(f.root.textContent, /Saved history.*Immediate user request/s);
  assert.doesNotMatch(f.root.textContent, /Secret partial/);
  for (const text of ['Secret partial more', 'Secret partial final']) {
    f.chats[0].messages[2].text = text; await f.refresh();
    assert.equal(f.root.querySelector('canvas'), canvas);
    assert.equal(f.root.querySelector('[data-message-id="1"]'), history);
    assert.doesNotMatch(f.root.textContent, /Secret partial/);
    assert.equal(f.frames.size, 1);
  }
  f.chats[0].state = 'idle'; f.chats[0].messages[2].state = 'completed';
  await f.refresh();
  assert.match(f.root.textContent, /Secret partial final/);
  assert.equal(f.root.querySelector('canvas'), null); assert.equal(f.frames.size, 0);
  assert.equal(f.root.querySelector('[data-message-id="1"]'), history);
});

test('errors and stops reveal terminal partials honestly, including stale streaming rows on later requests', async t => {
  for (const state of ['error', 'interrupted']) {
    const f = await fixture(t, { animated: true });
    const terminal = state === 'error' ? 'failed' : 'interrupted';
    Object.assign(f.chats[0], { state: 'running', messages: [user(1), assistant(2)] });
    await f.refresh();
    Object.assign(f.chats[0], { state, error: 'Connection ended', messages: [user(1, terminal), assistant(2)] });
    await f.refresh();
    assert.equal(f.frames.size, 0);
    assert.match(f.root.querySelector('.chat-response-outcome').textContent, new RegExp(terminal, 'i'));
    assert.match(f.root.textContent, /Secret partial/);
    Object.assign(f.chats[0], { state: 'running', error: null });
    f.chats[0].messages.push(user(3), assistant(4, 'streaming', 'Next hidden chunk'));
    await f.refresh();
    assert.match(f.root.textContent, /Secret partial/);
    assert.doesNotMatch(f.root.textContent, /Next hidden chunk/);
    assert.equal(f.frames.size, 1);
  }
});

test('animation suspends for hidden tabs and reduced motion and cleans up on navigation/close', async t => {
  const f = await fixture(t, { animated: true });
  f.chats[0].state = 'queued'; await f.refresh();
  assert.equal(f.frames.size, 1);
  f.hide(true); const draws = f.draws();
  assert.equal(f.frames.size, 0); assert.equal(f.draws(), draws);
  f.hide(false); assert.equal(f.frames.size, 1);
  f.reduced.matches = true; f.reduced.dispatchEvent(new f.view.Event('change'));
  assert.equal(f.frames.size, 0); assert.ok(f.draws() > draws);
  f.reduced.matches = false; f.reduced.dispatchEvent(new f.view.Event('change'));
  assert.equal(f.frames.size, 1);
  const old = f.workspace.transcript;
  await f.switch('two');
  assert.equal(f.frames.size, 0); assert.equal(f.root.querySelector('canvas'), null);
  assert.equal(old.disposed, true); assert.equal(f.observers.size, 1);
  await f.switch('one'); assert.equal(f.frames.size, 1);
  f.workspace.close(); assert.equal(f.frames.size, 0); assert.equal(f.observers.size, 0);
  f.hide(false); assert.equal(f.frames.size, 0);
});

test('jump or scrolling back to the end resumes following; polls, sends and layout preserve pause', async t => {
  const f = await fixture(t);
  const scroller = f.root.querySelector('[data-chat-messages]'), jump = f.root.querySelector('[data-chat-jump]');
  let height = 1000, top = 0;
  Object.defineProperties(scroller, {
    scrollHeight: { get: () => height }, clientHeight: { get: () => 200 },
    scrollTop: { get: () => top, set: value => { top = Math.min(Math.max(0, value), height - 200); } },
  });
  await f.refresh(); assert.equal(top, 800);
  scroller.dispatchEvent(new f.view.WheelEvent('wheel', { deltaY: -50 }));
  scroller.scrollTop = 500; scroller.dispatchEvent(new f.view.Event('scroll'));
  assert.equal(jump.hidden, false); assert.equal(jump.textContent, ''); assert.equal(jump.getAttribute('aria-label'), 'Jump to end');
  height = 1200; await f.refresh(); assert.equal(top, 500);
  scroller.dispatchEvent(new f.view.Event('load')); assert.equal(top, 500);
  f.root.querySelector('[data-chat-draft]').value = 'new request';
  await f.root.querySelector('[data-chat-send]').onclick(); assert.equal(top, 500);
  // Scrolling back to the end resumes following, as Jump to end does.
  scroller.scrollTop = 1000; scroller.dispatchEvent(new f.view.Event('scroll'));
  assert.equal(f.workspace.transcript.following, true); assert.equal(jump.hidden, true);
  height = 1400; await f.refresh(); assert.equal(top, 1200);
  scroller.scrollTop = 700; scroller.dispatchEvent(new f.view.Event('scroll'));
  assert.equal(f.workspace.transcript.following, false); assert.equal(jump.hidden, false);
  jump.click(); assert.equal(top, 1200); assert.equal(jump.hidden, true);
  height = 1600; [...f.observers][0].fn(); assert.equal(top, 1400);
  // Native scrollbar/keyboard scrolling up is also intent; a layout clamp is not.
  scroller.scrollTop = 900; scroller.dispatchEvent(new f.view.Event('scroll'));
  assert.equal(f.workspace.transcript.following, false);
  await f.switch('two'); assert.equal(f.workspace.transcript.following, true);
  await f.episode('other'); assert.equal(f.workspace.transcript.following, true);
});

test('out-of-order polls and A/B/A navigation cannot restore stale pending output', async t => {
  const f = await fixture(t);
  let release;
  f.intercept(url => url.endsWith('/one') ? new Promise(resolve => { release = resolve; }) : null);
  const stale = f.workspace.refresh(f.workspace.generation, 'episode', 'one');
  f.intercept(null);
  f.chats[0].messages = [assistant(1, 'completed', 'Finished newest response')];
  await f.refresh();
  release({ ...f.chats[0], state: 'running', messages: [assistant(1)] }); await stale;
  assert.match(f.root.textContent, /Finished newest response/); assert.equal(f.root.querySelector('canvas'), null);
  f.intercept(url => url.endsWith('/one') ? new Promise(resolve => { release = resolve; }) : null);
  const previousVisit = f.workspace.refresh(f.workspace.generation, 'episode', 'one');
  f.intercept(null); await f.switch('two'); await f.switch('one');
  release({ ...f.chats[0], state: 'running', messages: [assistant(1)] }); await previousVisit;
  assert.equal(f.root.querySelector('canvas'), null);
});

test('a pending send from a previous episode cannot clear the current send state', async t => {
  const f = await fixture(t);
  const releases = [];
  f.intercept(url => url.endsWith('/messages') ? new Promise(resolve => releases.push(resolve)) : null);
  f.root.querySelector('[data-chat-draft]').value = 'First episode request';
  const first = f.root.querySelector('[data-chat-send]').onclick();
  while (!releases.length) await new Promise(resolve => setTimeout(resolve, 0));
  await f.episode('next');
  assert.equal(f.workspace.sending, false);
  f.root.querySelector('[data-chat-draft]').value = 'Next episode request';
  const next = f.root.querySelector('[data-chat-send]').onclick();
  while (releases.length < 2) await new Promise(resolve => setTimeout(resolve, 0));
  releases[0]({}); await first;
  assert.equal(f.workspace.sending, true);
  assert.equal(f.root.querySelector('[data-chat-draft]').value, 'Next episode request');
  releases[1]({}); await next;
  assert.equal(f.workspace.sending, false);
});

test('a stale conversation list cannot unselect a newly created conversation', async t => {
  const f = await fixture(t);
  let release;
  f.intercept(url => url.endsWith('/chats') ? new Promise(resolve => { release = resolve; }) : null);
  const stale = f.refresh();
  f.intercept(null);
  f.chats.push({ id: 'new', state: 'idle', messages: [] });
  await f.switch('new');
  release([f.chats[0]]); await stale;
  assert.equal(f.workspace.currentId, 'new');
});

test('failed request Retry remains delegated through the stable transcript', async t => {
  const f = await fixture(t);
  Object.assign(f.chats[0], { state: 'error', error: 'Failed', messages: [user(1, 'failed'), assistant(2, 'failed')], runs: [{ id: 'retry-run', state: 'failed', originatingMessageId: 1 }] });
  await f.refresh();
  const calls = [];
  f.intercept((url, options) => {
    if (!url.endsWith('/retry')) return null;
    calls.push({ url, options });
    Object.assign(f.chats[0], { state: 'queued', error: null });
    return Promise.resolve({});
  });
  await f.root.querySelector('[data-chat-messages]').onclick({ target: f.root.querySelector('[data-chat-retry]') });
  assert.equal(calls.length, 1); assert.match(calls[0].url, /production-requests\/retry-run\/retry$/);
  assert.ok(JSON.parse(calls[0].options.body).clientRequestId);
  assert.ok(f.root.querySelector('canvas'));
  assert.match(f.root.textContent, /Failed · partial response/);
});

// Spec #40 E4: the live status line renders under the chat animation, changes phase, counts the
// turn from the run's startedAt, and leaves with the turn without touching the transcript.
// Isolated app + a scripted adapter; no provider calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { chromium, firefox } from 'playwright-core';
import { createApp } from '../src/server.js';
import { listenInRange } from '../test-support/loopback-port.js';

// The browser's clock runs seven minutes fast: the timer stays right only through the server offset.
const SKEW_MS = 7 * 60 * 1000;

for (const engine of [chromium, firefox]) test(`${engine.name()}: E4 the turn status line shows the phase and timer and leaves with the turn`, { timeout: 90_000 }, async t => {
  const browser = await engine.launch(engine === chromium ? { channel: 'chromium' } : {});
  t.after(() => browser.close());
  const workspace = await mkdtemp(path.join(tmpdir(), 'sb-turn-status-'));
  let adapter, turn = 0;
  const app = await createApp({ workspace, chatOptions: { codexFactory: async options => {
    adapter = options;
    return { startThread: async () => `thread-${options.conversationId}`, resumeThread: async id => id, close() {},
      startTurn: async () => {
        const id = `turn-${++turn}`;
        queueMicrotask(() => options.onEvent({ method: 'turn/started', params: { turn: { id } } }));
        return id;
      },
      interrupt: async () => options.onEvent({ method: 'turn/completed', params: { turn: { id: `turn-${turn}`, status: 'interrupted' } } }),
    };
  } } });
  t.after(async () => { await app.close(); await rm(workspace, { recursive: true, force: true }); });
  const episode = app.store.createEpisode({ title: 'Turn status proof' });
  const chat = app.chat.create(episode.id, { name: 'Status proof' });
  app.store.addConversationMessage({ conversationId: chat.id, role: 'user', state: 'completed', text: 'Earlier request' });
  app.store.addConversationMessage({ conversationId: chat.id, role: 'assistant', state: 'completed', text: 'Earlier reply' });
  const port = await listenInRange(app.server);
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(10_000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(skew => { const real = Date.now; Date.now = () => real() + skew; }, SKEW_MS);

  const tool = (method, name) => adapter.onEvent({ method, params: { turnId: `turn-${turn}`, item: { type: 'mcpToolCall', tool: name, status: method === 'item/started' ? 'inProgress' : 'completed' } } });
  const line = page.locator('.chat-response-animation .chat-turn-status');
  const transcriptItems = () => page.locator('.chat-transcript > :not(.chat-response-animation)').count();
  const showsLabel = label => page.waitForFunction(label => document.querySelector('[data-turn-label]')?.textContent === label, label);
  const spoken = () => page.locator('.chat-response-animation').evaluate(node => {
    const copy = node.cloneNode(true);
    copy.querySelectorAll('[aria-hidden="true"]').forEach(hidden => hidden.remove());
    return { role: node.getAttribute('role'), text: copy.textContent.trim() };
  });
  const timerSeconds = async () => {
    const text = await page.locator('[data-turn-timer]').textContent(), match = text.match(/^ · (\d+):(\d\d)$/);
    assert.ok(match, `timer reads " · m:ss" (${JSON.stringify(text)})`);
    return Number(match[1]) * 60 + Number(match[2]);
  };

  await page.goto(`http://127.0.0.1:${port}/episodes?channel=${episode.channelId}&episode=${episode.id}`);
  await page.getByText('Earlier reply').waitFor();
  await page.fill('[data-chat-draft]', 'Research, then build the video');
  await page.press('[data-chat-draft]', 'Enter');
  await line.waitFor();
  await showsLabel('Thinking');
  const items = await transcriptItems();

  // The line sits directly under the animation, inside it.
  const geometry = await page.locator('.chat-response-animation').evaluate(node => {
    const canvas = node.querySelector('canvas').getBoundingClientRect(), status = node.querySelector('.chat-turn-status').getBoundingClientRect();
    return { below: status.top >= canvas.bottom - 1 && status.top - canvas.bottom < 12, last: node.lastElementChild.classList.contains('chat-turn-status') };
  });
  assert.deepEqual(geometry, { below: true, last: true });

  tool('item/started', 'read_research');
  await showsLabel('Researching');
  assert.deepEqual(await spoken(), { role: 'status', text: 'Researching' }, 'the status region announces the label only');
  assert.equal(await page.locator('[data-turn-timer]').getAttribute('aria-hidden'), 'true');

  tool('item/completed', 'read_research');
  tool('item/started', 'build_deck');
  await showsLabel('Building the video');
  assert.deepEqual(await spoken(), { role: 'status', text: 'Building the video' });

  // The timer counts from the run's startedAt in server time, despite the browser's skewed clock.
  const [run] = app.store.listProductionRuns({ conversationId: chat.id }).filter(entry => ['starting', 'running'].includes(entry.state));
  assert.ok(run?.startedAt, 'the turn has a running production run');
  const shown = await timerSeconds(), expected = (Date.now() - Date.parse(run.startedAt)) / 1000;
  assert.ok(Math.abs(shown - expected) <= 2, `timer ${shown} s vs run elapsed ${expected.toFixed(1)} s`);
  await page.waitForFunction(previous => {
    const match = document.querySelector('[data-turn-timer]')?.textContent.match(/(\d+):(\d\d)$/);
    return match && Number(match[1]) * 60 + Number(match[2]) > previous;
  }, shown);

  assert.equal(await transcriptItems(), items, 'tool activity adds nothing to the transcript');

  tool('item/completed', 'build_deck');
  adapter.onEvent({ method: 'item/agentMessage/delta', params: { turnId: `turn-${turn}`, itemId: 'reply', delta: 'Built the video.' } });
  adapter.onEvent({ method: 'turn/completed', params: { turn: { id: `turn-${turn}`, status: 'completed' } } });
  await page.getByText('Built the video.').waitFor();
  await page.locator('.chat-response-animation').waitFor({ state: 'detached' });
  assert.equal(await page.locator('.chat-turn-status').count(), 0, 'the line is gone when the turn ends');
  assert.equal(await transcriptItems(), items + 1, 'only the reply joined the transcript');
  assert.deepEqual(errors, []);
});

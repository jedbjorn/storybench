// Spec #42 A11 (Feature #24 task #115): the Agents panel keeps agent job rows across turns, the
// conversation reads "Waiting for agents (n)" between turns, wake and chain-limit lines are app
// lines, and Stop ends the jobs with no turn active. Isolated app, a scripted parent harness and
// the scripted job launcher; no provider calls. STORYBENCH_CHAT_EVIDENCE saves screenshots.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { chromium, firefox } from 'playwright-core';
import { createApp } from '../src/server.js';
import { listenInRange } from '../test-support/loopback-port.js';
import { CATALOG, fakeLauncher } from './agent-job-fixtures.js';

const until = async (check, timeout = 10_000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const value = check(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 10)); }
  throw new Error('timed out');
};

for (const engine of [chromium, firefox]) test(`${engine.name()}: A11 agent job rows persist across turns, the chat waits for them, and Stop ends them`, { timeout: 90_000 }, async t => {
  const browser = await engine.launch(engine === chromium ? { channel: 'chromium' } : {});
  t.after(() => browser.close());
  const workspace = await mkdtemp(path.join(tmpdir(), 'sb-agents-panel-'));
  // Parent turns run until the test completes them.
  const turns = [];
  const codexFactory = async options => ({
    startThread: async () => `thread-${options.conversationId}`, resumeThread: async id => id, close() {},
    startTurn: async () => {
      const id = `turn-${turns.length + 1}`;
      turns.push({ id, tools: options.tools, onEvent: options.onEvent,
        reply: text => options.onEvent({ method: 'item/agentMessage/delta', params: { turnId: id, itemId: `reply-${id}`, delta: text } }),
        complete: () => options.onEvent({ method: 'turn/completed', params: { turn: { id, status: 'completed' } } }) });
      queueMicrotask(() => options.onEvent({ method: 'turn/started', params: { turn: { id } } }));
      return id;
    },
    interrupt: async (_thread, id) => options.onEvent({ method: 'turn/completed', params: { turn: { id, status: 'interrupted' } } }),
  });
  // Agent jobs run until the test ends them.
  const held = [];
  const hold = connection => { held.push(connection); };
  const fake = fakeLauncher([hold, hold]);
  const app = await createApp({ workspace, chatOptions: { codexFactory, agentJobLauncher: fake.launcher, catalog: { list: async () => CATALOG } } });
  t.after(async () => { await app.close(); await rm(workspace, { recursive: true, force: true }); });
  const episode = app.store.createEpisode({ title: 'Agents panel proof' });
  const chat = app.chat.create(episode.id, { name: 'Jobs proof' });
  app.store.db.prepare("UPDATE conversations SET harness='codex',inference_source='codex-login',model='gpt-5.5',effort='medium' WHERE id=?").run(chat.id);
  const port = await listenInRange(app.server);
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(10_000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const evidence = process.env.STORYBENCH_CHAT_EVIDENCE;
  const shot = async name => { if (evidence) { await mkdir(evidence, { recursive: true }); await page.screenshot({ path: path.join(evidence, `agents-panel-${name}-${engine.name()}.png`) }); } };
  const status = page.locator('[data-chat-status]');
  const rows = () => page.locator('.chat-agent').evaluateAll(nodes => nodes.map(node => [...node.children].map(child => child.textContent.replace(/ · \d+:\d\d$/, ''))));

  await page.goto(`http://127.0.0.1:${port}/episodes?channel=${episode.channelId}&episode=${episode.id}`);
  await page.fill('[data-chat-draft]', 'Research the topic in the background');
  await page.press('[data-chat-draft]', 'Enter');
  const first = await until(() => turns[0]);
  await first.tools.start_agent_job({ brief: 'Collect three facts about the topic.', label: 'Collect facts' });
  await first.tools.start_agent_job({ brief: 'List two sources.', label: 'Find sources', harness: 'claude', model: 'sonnet' });
  await until(() => held.length === 2);
  const [facts, sources] = ['Collect facts', 'Find sources'].map(label => held.find(connection => connection.job.label === label));
  facts.emit('context/usage', { tokens: 18_400 });
  facts.emit('item/started', { item: { type: 'dynamicToolCall', tool: 'read_research', status: 'inProgress' } });
  sources.emit('item/agentMessage/delta', { itemId: 'r', delta: 'Two sources in sources.md.' });
  sources.emit('turn/completed', { turn: { id: 'turn-1', status: 'completed' } });
  first.reply('Started two agent jobs; I will report when they finish.');
  first.complete();

  // The finished job wakes the parent once: an app line, never a creator bubble.
  const wake = await until(() => turns[1]);
  const wakeLine = page.locator('.chat-app-line', { hasText: 'Agent results: Find sources (Done)' });
  await wakeLine.waitFor();
  assert.equal(await page.locator('.chat-user', { hasText: 'Agent results' }).count(), 0, 'the wake line is not a creator message');
  wake.reply('Integrated the two sources.');
  wake.complete();
  await page.getByText('Integrated the two sources.').waitFor();

  // A later turn ran and ended; the running job keeps the conversation waiting.
  await status.filter({ hasText: 'Waiting for agents (1)' }).waitFor();
  await page.click('[data-chat-history-toggle]');
  await page.waitForFunction(() => document.querySelectorAll('.chat-agent').length === 3);
  assert.deepEqual(await rows(), [
    ['Assistant', 'gpt-5.5 | — tokens', 'Waiting for agents (1)'],
    ['Collect facts', 'Codex · gpt-5.5 | 18k', 'Running · Researching'],
    ['Find sources', 'Claude Code · sonnet | —', 'Done'],
  ]);
  const stop = page.locator('[data-chat-stop]');
  assert.equal(await stop.isVisible(), true, 'Stop is available with no turn active');
  assert.equal(await stop.getAttribute('aria-label'), 'Stop background agents');
  // The chain-limit line is an app line too (fixture message; A6 proves when the app adds it).
  app.store.addConversationMessage({ conversationId: chat.id, role: 'system', text: 'Agent results are waiting. They will be included with your next message.' });
  await page.locator('.chat-app-line', { hasText: 'Agent results are waiting' }).waitFor();
  await shot('waiting');

  await stop.click();
  await page.waitForFunction(() => [...document.querySelectorAll('.chat-agent')].some(node => node.textContent.includes('Collect facts') && node.textContent.includes('Stopped')));
  await stop.waitFor({ state: 'hidden' });
  assert.doesNotMatch(await status.textContent(), /Waiting for agents/);
  assert.equal((await rows())[0][2], 'Done', 'the conversation no longer waits');
  assert.equal(app.store.db.prepare('SELECT state FROM agent_jobs WHERE label=?').get('Collect facts').state, 'cancelled');
  assert.equal(turns.length, 2, 'Stop starts no wake turn');
  // Stop sits outside the drawer, so pressing it closed the drawer; reopen it for the evidence.
  if (await page.locator('[data-chat-history-drawer]').isHidden()) await page.click('[data-chat-history-toggle]');
  await page.locator('.chat-agent', { hasText: 'Stopped' }).waitFor();
  await shot('stopped');
  assert.deepEqual(errors, []);
});

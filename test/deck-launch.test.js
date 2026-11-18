// Spec #44 "Agent guidance and launch" (task #124), A9: a deck production's agent knows the
// standards, the effective theme with each role's source and the deck design defaults from its
// first turn, read_deck returns the design, and save_deck accepts an agent change to a creator-set role.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.js';
import { createChatService } from '../src/chat.js';
import { TEMPLATE_COLORS } from '../src/deck-data.js';
import { TOOL_DELIVERED } from '../src/tool-delivery.js';

const until = async (check) => { for (let i = 0; i < 400; i++) { if (check()) return; await new Promise((resolve) => setTimeout(resolve, 10)); } throw new Error('Timed out'); };
const slides = [{ id: 'opening', title: 'Hello', layout: 'statement', body: 'Offline' }];

function fixture(t, onTurn = () => {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'sb-deck-launch-')), store = new Store(root);
  const prompts = [];
  const factory = async (options) => ({
    startThread: async () => 'thread', resumeThread: async () => 'thread', close() {},
    async startTurn(_id, prompt) {
      prompts.push(prompt); onTurn(options.tools, prompts.length);
      queueMicrotask(() => options.onEvent({ method: 'turn/completed', params: { turn: { id: `turn-${prompts.length}`, status: 'completed' } } }));
      return `turn-${prompts.length}`;
    },
  });
  const chat = createChatService({ store, codexFactory: factory });
  t.after(async () => { await chat.close(); store.close(); rmSync(root, { recursive: true, force: true }); });
  return { store, chat, prompts };
}
const turn = async ({ chat, prompts }, episodeId, conversationId, text) => {
  const before = prompts.length;
  await chat.send(episodeId, conversationId, text);
  await until(() => prompts.length > before && chat.get(episodeId, conversationId).state === 'idle');
  return prompts.at(-1);
};

test('A9: the first deck turn carries the standards, each theme role with its source and the deck design defaults', async t => {
  let read, saved;
  const f = fixture(t, (tools, n) => {
    if (n !== 2) return;
    const research = tools.read_research(); research[TOOL_DELIVERED](); read = tools.read_deck();
    // The agent changes a creator-set (channel) role; the app records it as the agent's and does not refuse it.
    saved = tools.save_deck({ expectedRevision: read.revision, slides: read.slides, design: { ...read.design, theme: { ...read.design.theme, colors: { ...read.design.theme.colors, base: '#202020' } } } });
  });
  const { store, chat } = f;
  const deck = store.createEpisode({ kind: 'deck', title: 'Launch' });
  const channel = store.getBrandStandards(deck.channelId);
  store.saveBrandStandards(deck.channelId, channel.revision, { colors: ['#102030', null, null], fonts: ['Lato'], stylePrompt: 'Calm and spare' });
  store.saveDeck(deck.id, 1, slides, 'human', { theme: { colors: { accent: '#C03060' } }, stageText: { align: 'center', style: 'card' } });
  store.saveDeck(deck.id, 2, slides, 'agent', { ...store.getDeck(deck.id).design, theme: { colors: { accent: '#C03060' }, fonts: { accent: 'Poppins' } } });
  const conversation = chat.create(deck.id);

  const first = await turn(f, deck.id, conversation.id, 'Make me a deck');
  assert.match(first, /Channel brand standards for this turn[^\n]*#102030[^\n]*Calm and spare/, 'the standards are carried');
  const line = first.split('\n').find(entry => entry.startsWith('Deck theme for this turn'));
  assert.ok(line, 'the first turn carries the deck theme line');
  for (const role of [
    'base #102030 (Brand Standards (creator))',
    'accent #C03060 (deck, set by creator)',
    `background unset (your choice; template ${TEMPLATE_COLORS.background})`,
    'base Lato (Brand Standards (creator))',
    'accent Poppins (deck, chosen by agent)',
    'alternate unset (your choice; template Manrope)',
  ]) assert.ok(line.includes(role), `${role} in: ${line}`);
  assert.ok(line.indexOf('colours base') < line.indexOf('; fonts base'), 'colour roles, then font roles');
  assert.deepEqual(JSON.parse(/Deck design defaults[^:]*: (\{.*\})\. read_deck/.exec(line)[1]), { stageText: { style: 'card', align: 'center' } });

  // read_deck returns the design; save_deck records the agent's change to a creator-set role.
  const second = await turn(f, deck.id, conversation.id, 'Use a darker text colour');
  assert.deepEqual(read.design.stageText, { style: 'card', align: 'center' });
  assert.deepEqual(read.design.theme.setBy, { colors: { accent: 'creator' }, fonts: { accent: 'agent' } });
  assert.equal(saved.design.theme.colors.base, '#202020');
  assert.deepEqual(saved.design.theme.setBy, { colors: { base: 'agent', accent: 'creator' }, fonts: { accent: 'agent' } });
  assert.ok(second.includes('base #102030 (Brand Standards (creator))'), 'the turn that saved was launched before the save');
  const third = await turn(f, deck.id, conversation.id, 'Thanks');
  assert.ok(third.includes('base #202020 (deck, chosen by agent)'), 'the next turn names the agent as the source');
  assert.equal(store.getBrandStandards(deck.channelId).colorRoles.base, '#102030', "the channel's standards are unchanged");
});

test('a deck with nothing set says every role and design value is the agent\'s choice; video turns carry no deck line', async t => {
  const f = fixture(t), { store, chat } = f;
  const deck = store.createEpisode({ kind: 'deck', title: 'Blank' });
  const line = (await turn(f, deck.id, chat.create(deck.id).id, 'Ideas please')).split('\n').find(entry => entry.startsWith('Deck theme for this turn'));
  for (const role of ['base', 'accent', 'background']) assert.ok(line.includes(`${role} unset (your choice; template ${TEMPLATE_COLORS[role]})`), line);
  assert.match(line, /fonts base unset \(your choice; template Manrope\), accent unset[^,]*, alternate unset/);
  assert.match(line, /Deck design defaults[^:]*: none set\./);
  const video = store.createEpisode({ title: 'Video' });
  assert.doesNotMatch(await turn(f, video.id, chat.create(video.id).id, 'Hello'), /Deck theme for this turn|Deck design defaults/);
});

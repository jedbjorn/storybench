import test from 'node:test';
import assert from 'node:assert/strict';
import { searchProductions } from '../public/production-search.js';

const production = (id, title, channelName = 'Science', stage = 'Draft') => ({ id, title, channelName, stage, updatedAt: '2026-11-15T12:00:00Z' });
const items = [production('ecology', 'Écological Skill Acquisition'), production('tools', 'Learning Tools', 'Education', 'Final')];

test('production search handles typos, transpositions, accents, partial names and combined metadata', () => {
  for (const query of ['ecological', 'ecologcal', 'ecolgoical', 'écolo', 'science aquisition drfat']) {
    assert.deepEqual(searchProductions(items, query).map((item) => item.id), ['ecology'], query);
  }
  assert.deepEqual(searchProductions(items, 'learn educ fin').map((item) => item.id), ['tools']);
  assert.deepEqual(searchProductions(items, 'learning scaffold'), []);
  assert.deepEqual(searchProductions(items, 'xyzzy'), []);
  assert.deepEqual(searchProductions(items, '   '), items);
});

test('exact production names outrank fuzzy and channel matches', () => {
  const values = [production('typo', 'Scince', 'Other'), production('channel', 'Other'), production('exact', 'Science')];
  assert.deepEqual(searchProductions(values, 'science').map((item) => item.id), ['exact', 'channel', 'typo']);
});

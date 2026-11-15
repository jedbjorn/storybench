import test from 'node:test';
import assert from 'node:assert/strict';
import { checkCorrectionLoop } from '../src/runtime/deck-qa-loop-check.js';

test('create and edit correction loops retain exact-build reports through all native image routes', {timeout:120000}, async()=>{
  const result=await checkCorrectionLoop();assert.deepEqual(Object.keys(result),['codex','claude','opencode']);
});

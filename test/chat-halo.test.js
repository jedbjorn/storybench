// Drawing-command snapshots taken from data-treatment="halo" in the approved
// clear-horizon-suns.html, SHA-256 8cd2f67fd236d6ba76587461aa6dbe7f9154a5b2e4bca94d6a9eca6231a8a0d0.
// This guards the palette, native geometry, both flashes and seamless wrap.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { drawHaloSun } from '../public/chat-halo.js';

function drawingHash(draw, phase, mode) {
  const hash = createHash('sha256');
  const record = (...args) => hash.update(JSON.stringify(args));
  let gradient = 0;
  const context = new Proxy({ globalAlpha: 1 }, {
    get(target, key) {
      if (key in target) return target[key];
      if (key.startsWith('create')) return (...args) => {
        const id = ++gradient; record(key, id, ...args);
        return { id, addColorStop: (...stops) => record('colorStop', id, ...stops) };
      };
      return (...args) => record(key, ...args);
    },
    set(target, key, value) { record(key, value); target[key] = value; return true; },
  });
  draw(context, phase, mode);
  return hash.digest('hex');
}

const approved = {
  "presentation:0": "c4e1998854acd28810e41831420a6231553d281c1e33a83c5abd87e4691745f7",
  "presentation:0.25": "e92eb3ecf0aced9656f313ef4828123c55efd171acbb0130c8b07428e2362b3b",
  "presentation:0.49": "b6b162148fb3f9babf85dc9a8bcf99660d05f00f3c30d6c48367179a137fc71f",
  "presentation:0.64": "35574a25499003803903866fd015783b2c2d4829cfc0d0d2bbeeb728db0809c9",
  "presentation:0.9": "31b9a1c154c4591bdd0db0451059343a62bd1c7f5a1dece892ea3258c724149c",
  "presentation:1": "c4e1998854acd28810e41831420a6231553d281c1e33a83c5abd87e4691745f7",
  "video:0": "5cbb9591f9ec13c46b02b242cd9b061ac472c6cc70b4428810532d85c41c6caf",
  "video:0.25": "bd7337a8f7898e7ef4f915ae7b11e178a9fa3a078795fa9be3bf3c2181cdad6f",
  "video:0.49": "b2dff88a422f4fe6ed652716d65082ea75c5b3391b3c114c97dc6d07f7735660",
  "video:0.64": "c3b1b84ceb4de0c62708d0e74c1ecfd84e9e365006a63428fad5486668830678",
  "video:0.9": "10938dec6aafaa812da9961d70fb04763dfc9d0ccbbe5294d2b3fb04e4c9b689",
  "video:1": "5cbb9591f9ec13c46b02b242cd9b061ac472c6cc70b4428810532d85c41c6caf"
};

test('selected Halo Sun retains the approved drawing at key phases for deck and video', () => {
  for (const [frame, hash] of Object.entries(approved)) {
    const [mode, phase] = frame.split(':');
    assert.equal(drawingHash(drawHaloSun, Number(phase), mode), hash, frame);
  }
  for (const mode of ['presentation', 'video']) assert.equal(approved[mode + ':0'], approved[mode + ':1']);
});

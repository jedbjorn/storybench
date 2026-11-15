import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { FONTS, fontCatalog, fontPath } from '../src/fonts.js';

test('twenty bundled families retain pinned original files, real weights and redistribution notices', () => {
  const sources = JSON.parse(readFileSync(new URL('../src/font-assets/sources.json', import.meta.url)));
  assert.equal(sources.fonts.length, 20);
  assert.equal(FONTS.length, 26);
  assert.equal(new Set(FONTS.map(font => font.family)).size, 26);
  for (const source of sources.fonts) {
    const font = FONTS.find(font => font.id === source.id);
    assert.equal(font.family, source.family);
    assert.ok(fontCatalog().find(value => value.id === font.id).available);
    assert.match(source.upstream, new RegExp(`/${sources.sourceCommit}/ofl/${source.id}/$`));
    for (const weight of ['regular', 'bold']) {
      const bytes = readFileSync(fontPath(font, weight));
      assert.equal(bytes.readUInt32BE(), 0x00010000, 'TrueType sfnt signature');
      assert.equal(createHash('sha256').update(bytes).digest('hex'), source.sha256[weight]);
      assert.equal(font[weight], source[weight]);
    }
    assert.notEqual(source.sha256.regular, source.sha256.bold);
    assert.match(readFileSync(new URL(`../src/font-assets/${source.id}/OFL.txt`, import.meta.url), 'utf8'), /SIL OPEN FONT LICENSE/);
  }
  assert.equal(fontPath(null), null);
  assert.equal(fontPath(FONTS[0], '../regular'), null);
  assert.equal(fontPath({ stems: ['/missing/'], regular: 'font.ttf' }), null);
});

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { importMedia } from '../src/media.js';

function ffmpeg(args) {
  const result = spawnSync('ffmpeg', ['-v', 'error', '-threads', '1', ...args], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}

async function fixtureWorkspace() {
  const workspace = await mkdtemp(join(tmpdir(), 'storybench-media-'));
  const fixtures = join(workspace, 'fixtures');
  await mkdir(fixtures);
  return { workspace, fixtures };
}

async function digest(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

test('import preserves its source, publishes a managed copy, thumbnail, and deduplicates', async () => {
  const { workspace, fixtures } = await fixtureWorkspace();
  const source = join(fixtures, 'odd source.mp4');
  ffmpeg(['-f', 'lavfi', '-i', 'color=c=red:s=320x182:r=30:d=0.5', '-pix_fmt', 'yuv420p', source]);
  const before = await digest(source);
  const first = await importMedia({ workspace, sourcePath: source });
  const second = await importMedia({ workspace, sourcePath: source });

  assert.equal(await digest(source), before);
  assert.equal(first.hash, second.hash);
  assert.equal(first.path, second.path);
  assert.equal(first.kind, 'video');
  assert.equal(first.width, 320);
  assert.ok(first.thumbnailPath);
  assert.equal(await digest(join(workspace, first.path)), first.hash);
  await readFile(join(workspace, first.thumbnailPath));

  // A syntactically valid but semantically invalid analysis cache is never trusted.
  const probeCache = join(workspace, 'cache', `${first.hash}-probe-v1.json`);
  await writeFile(probeCache, JSON.stringify({ kind: 'video' }));
  const repaired = await importMedia({ workspace, sourcePath: source });
  assert.equal(repaired.width, 320);
  assert.equal(JSON.parse(await readFile(probeCache, 'utf8')).hash, first.hash);
});

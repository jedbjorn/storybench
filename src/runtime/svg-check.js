// Role-specific production-path entrypoints for exact-image installation checks.
// Browser/install integration composes this result; it makes no browser claim.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { Store } from '../store.js';
import { createLibraryService } from '../library.js';
import { createScopedTools } from './tools.js';
import { createDeckService } from '../deck-service.js';
import { parseSvg, SVG_PROFILE } from '../svg.js';
import { renderSvg } from '../svg-render.js';
import { runChecked } from './image-check.js';
import { HeavyJobQueue } from '../job-runner.js';

export const SVG_CHECK_VERSION = 2;
export const illustrationURL = new URL('./fixtures/svg-illustration.svg', import.meta.url);
export const invalidURL = new URL('./fixtures/svg-invalid.svg', import.meta.url);
const call = async (tools, name, args) => JSON.parse((await tools.call(name, args)).text);
export function assertPng(bytes) {
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.ok(bytes.readUInt32BE(16) > 0 && bytes.readUInt32BE(20) > 0 && bytes.length > 1000, 'nonempty rendered geometry');
}

export async function smokeSvg(role) {
  if (!['app', 'worker'].includes(role)) throw new Error('SVG smoke role must be app or worker');
  const root = await mkdtemp(path.join(os.tmpdir(), 'sb-svg-check-'));
  let store, decks;
  try {
    const source = await readFile(illustrationURL), invalid = await readFile(invalidURL);
    const parsed = parseSvg(source); assert.equal(parsed.width, 800); assert.ok(parsed.groupIds.includes('plan'));
    assert.throws(() => parseSvg(invalid), /unsupported element script/);
    assertPng(await renderSvg(source)); // Actually loads native @resvg bindings and packaged fonts.
    const result = { role, checkVersion: SVG_CHECK_VERSION, profile: SVG_PROFILE, parser: true, nativeRasterInspection: true, invalidRejected: true };
    if (role === 'worker') {
      await writeFile(path.join(root, 'authored.svg'), source);
      runChecked('resvg', [path.join(root, 'authored.svg'), path.join(root, 'inspection.png')]);
      assertPng(await readFile(path.join(root, 'inspection.png')));
      return { ...result, authoringCommand: true };
    }
    store = new Store(root);
    const first = store.createEpisode({ kind: 'deck', title: 'Vector source' });
    const destination = store.createEpisode({ kind: 'deck', title: 'Vector reuse' });
    for (const episode of [first, destination]) store.ensureEpisodeDirectories(episode.id);
    const library = createLibraryService({ workspace: root, store });
    const imported = await library.registerFile({ episodeId: first.id, readable: Readable.from(source), fileName: 'illustration.svg', contentType: 'image/svg+xml', selectedCategory: 'Graphics' });
    assert.deepEqual(await readFile(path.join(root, imported.asset.path)), source);
    assertPng(await readFile(path.join(root, imported.asset.thumbnailPath)));
    const scope = { requestId: 'svg-smoke', conversationId: 'svg-smoke', harness: 'codex', model: 'fixture', channelId: first.channelId, episodeId: first.id,
      dataRoot: root, episodeDir: store.episodeDirectory(first.id), workDir: store.episodeWorkDirectory(first.id) };
    const tools = createScopedTools(scope, { store, library });
    await writeFile(path.join(scope.workDir, 'editable.svg'), source);
    const registered = await call(tools, 'register_work_file', { path: 'work/editable.svg' });
    assert.equal(registered.editableSource, 'work/editable.svg');
    const inspection = await tools.call('inspect_image', { itemId: registered.libraryItemId });
    assertPng(Buffer.from(inspection.images[0].data, 'base64'));
    const summary = await call(tools, 'inspect_media', { itemId: registered.libraryItemId });
    assert.equal(summary.svgProfile, SVG_PROFILE);
    const reused = await library.reuseItem({ source: { episodeId: first.id, itemId: registered.libraryItemId }, destination: { episodeId: destination.id } });
    assert.equal(reused.item.provenance.reusedFrom.itemId, registered.libraryItemId);
    const saved = store.saveDeck(destination.id, 1, [
      { id: 'illustration', title: 'Shared plan', layout: 'full-media', media: { itemId: reused.item.id, alt: 'Three workspaces and a landscape' }, notes: 'Observe, connect, plan.' },
      { id: 'staged', title: 'From seeing to planning', layout: 'process', vector: { itemId: reused.item.id, alt: 'Three illustrated planning steps' },
        stages: ['observe', 'connect', 'plan'].map(id => ({ id: `stage_${id}`, title: id, svgGroupIds: [id], afterMs: 1000 })) },
      { id: 'gallery', title: 'Look again', layout: 'statement', subnav: [{ id: 'detail', label: 'Editable source', itemId: reused.item.id }] },
    ]);
    const queue = new HeavyJobQueue();
    decks = createDeckService({ store, queue });
    const job = decks.enqueue({ episodeId: destination.id, expectedRevision: saved.revision });
    await queue.draining;
    const completed = decks.getJob(destination.id, job.id);
    assert.equal(completed.state, 'completed', completed.error);
    const dir = path.dirname(path.join(root, completed.outputPath)), vector = completed.snapshot.manifest.assets[0];
    assert.equal(vector.svgProfile, SVG_PROFILE);
    assert.deepEqual(await readFile(path.join(dir, vector.file)), source);
    const zip = await readFile(path.join(root, completed.outputPath));
    assert.ok(zip.includes(source));
    const html = await readFile(path.join(dir, 'index.html'), 'utf8');
    assert.match(html, /id="_sbv1-plan"/); assert.match(html, /id="_sbv2-plan"/);
    assert.match(html, /<g data-vector-step="2" data-vector-group="plan"><g id="_sbv2-plan"/);
    assert.deepEqual(completed.snapshot.slides[1].stages[2].svgGroupIds, ['plan']);
    await assert.rejects(library.registerFile({ episodeId: first.id, readable: Readable.from(invalid), fileName: 'bad.svg', selectedCategory: 'Graphics' }), /unsupported element script/);
    return { ...result, import: true, registration: true, reuse: true, imageTool: true, savedStaticExport: true, savedStagedExport: true, retainedZipSource: true };
  } finally { await decks?.close(); store?.close(); await rm(root, { recursive: true, force: true }); }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await smokeSvg(process.argv[2]))); }
  catch (error) { console.error(`SVG ${process.argv[2]} smoke: ${error.message}`); process.exitCode = 1; }
}

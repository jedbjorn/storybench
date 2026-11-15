// Only the application's stored, uncompressed ZIP format is accepted. The saved
// digest binds all bytes (including scripts) to the successful production build.
import path from 'node:path';
import { constants } from 'node:fs';
import { open, realpath, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

export const MAX_BUNDLE_BYTES = 256 * 1024 * 1024;
export function unpackDeckZip(bytes) {
  if (bytes.length > MAX_BUNDLE_BYTES || bytes.length < 22) throw new Error('Deck ZIP exceeds QA bounds or is empty');
  const files = new Map(); let offset = 0;
  while (offset + 30 <= bytes.length && bytes.readUInt32LE(offset) === 0x04034b50) {
    const flags = bytes.readUInt16LE(offset + 6), compression = bytes.readUInt16LE(offset + 8);
    const size = bytes.readUInt32LE(offset + 18), nameSize = bytes.readUInt16LE(offset + 26), extra = bytes.readUInt16LE(offset + 28);
    const name = bytes.subarray(offset + 30, offset + 30 + nameSize).toString('utf8');
    const start = offset + 30 + nameSize + extra, end = start + size;
    if (flags || compression || extra || size !== bytes.readUInt32LE(offset + 22) || end > bytes.length ||
        !/^[a-zA-Z0-9_.\/-]+$/.test(name) || name.split('/').some(p => !p || p === '.' || p === '..') || files.has(name) || files.size >= 4096)
      throw new Error('Unsupported or unsafe deck ZIP entry');
    files.set(name, bytes.subarray(start, end)); offset = end;
  }
  if (!files.has('index.html') || !files.has('presenter.html') || !files.has('manifest.json') || bytes.readUInt32LE(offset) !== 0x02014b50)
    throw new Error('Incomplete deck ZIP');
  return files;
}
export async function extractBuild(store, episodeId, jobId, destination) {
  store.requireProductionKind(episodeId, 'deck');
  const job = store.getJob(jobId);
  if (!job || job.episodeId !== episodeId || job.kind !== 'deck' || job.state !== 'completed') throw new Error('QA requires a completed build belonging to this deck');
  if (!job.snapshot?.bundleSha256) throw new Error('Rebuild this older deck output to establish its immutable QA identity');
  const parent = path.join(store.episodeDirectory(episodeId), 'outputs', 'decks', job.id);
  const source = path.join(parent, 'bundle.zip');
  if (path.resolve(store.workspace, job.outputPath) !== source || await realpath(source) !== source) throw new Error('Unsafe deck build path');
  const handle = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW);
  let bytes;
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_BUNDLE_BYTES) throw new Error('Deck bundle exceeds the 256 MiB QA limit');
    bytes = await handle.readFile();
  } finally { await handle.close(); }
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (digest !== job.snapshot.bundleSha256) throw new Error('Deck ZIP changed since build; rebuild before QA');
  const files = unpackDeckZip(bytes), manifest = JSON.parse(files.get('manifest.json'));
  if (manifest.productionId !== episodeId || manifest.sourceRevision !== job.revision ||
      JSON.stringify([...files.keys()].sort()) !== JSON.stringify([...manifest.files].sort())) throw new Error('Deck ZIP manifest differs from its build');
  for (const [name, data] of files) {
    const target = path.join(destination, name);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, data, { flag: 'wx', mode: 0o400 });
  }
  return { job, parent, files: [...files.keys()], bundleSha256: digest, sourceRevision: job.revision };
}

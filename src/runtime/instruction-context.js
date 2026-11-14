// Native sessions may retain instructions/tools. Persist their effective context by
// segment in the app-owned render area, independent of changing per-turn boot values.
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

const hash = (value) => createHash('sha256').update(value).digest('hex');
export const contextFingerprint = (kind, templates, definitions) => hash(JSON.stringify({ kind,
  boot: templates.boot, skills: templates.skills, definitions }));

export async function bindInstructionContext(connection, { episodeDir, segmentId, version }) {
  const file = path.join(episodeDir, '.storybench', 'segments', `${hash(segmentId)}.json`);
  const previous = await readFile(file, 'utf8').catch((error) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  const remember = async (id) => {
    await mkdir(path.dirname(file), { recursive: true });
    const temp = `${file}.tmp`;
    await writeFile(temp, JSON.stringify({ version, nativeSessionId: id }), { mode: 0o600 });
    await rename(temp, file);
    return id;
  };
  const start = connection.startThread.bind(connection), resume = connection.resumeThread.bind(connection);
  connection.startThread = async () => remember(await start());
  connection.resumeThread = async (id) => {
    const saved = previous ? JSON.parse(previous) : null;
    if (saved?.version === version && saved.nativeSessionId === id) return remember(await resume(id));
    const next = await start();
    connection.segmentTransition = { previousThreadId: id, threadId: next, reason: 'instruction-context-changed' };
    // Chat moves this fresh session to a fresh segment/worker before sending input.
    return next;
  };
  return connection;
}

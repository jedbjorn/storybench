import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DECK_CHECK_VERSION, DECK_PROFILE, DECK_TEMPLATE_VERSION } from './deck-evidence.js';

const cache = new Map();
const identity = release => JSON.stringify([release?.commit, release?.images, process.version, DECK_CHECK_VERSION]);
const unknown = { vector: { state: 'unverified', reason: 'Startup diagnostic has not completed.' }, browser: { state: 'unverified', reason: 'Startup diagnostic has not completed.' } };
export function getDeckReadiness(release = null) {
  return { source: release ? 'installed runtime startup' : 'local development startup (no release receipt)',
    profile: DECK_PROFILE, template: DECK_TEMPLATE_VERSION, ...(cache.get(identity(release))?.result ?? unknown) };
}

export function startDeckReadiness(release = null) {
  const key = identity(release);
  if (cache.has(key)) return cache.get(key).pending;
  const entry = {};
  cache.set(key, entry);
  entry.pending = new Promise(resolve => {
    const child = spawn(process.execPath, [fileURLToPath(new URL('./deck-startup-check.js', import.meta.url))], {
      detached: true, stdio: ['ignore', 'pipe', 'ignore'],
      env: { PATH: process.env.PATH, HOME: process.env.HOME, ...(process.env.PLAYWRIGHT_BROWSERS_PATH ? { PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH } : {}) },
    });
    let output = '', expired = false;
    const kill = () => { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already exited */ } };
    const timer = setTimeout(() => { expired = true; kill(); }, 25_000);
    const finish = value => { clearTimeout(timer); entry.result = value; resolve(getDeckReadiness(release)); };
    const failed = { vector: { state: 'unavailable', reason: 'Startup diagnostic failed or exceeded 25 seconds; run doctor.' }, browser: { state: 'unavailable', reason: 'Startup diagnostic failed or exceeded 25 seconds; run doctor.' } };
    child.stdout.on('data', bytes => { output += bytes; if (output.length > 8192) kill(); });
    child.on('error', () => finish(failed));
    child.on('close', code => {
      if (expired || code !== 0) return finish(failed);
      try {
        const value = JSON.parse(output);
        if (!['ready', 'unavailable'].includes(value.vector?.state) || !['ready', 'unavailable'].includes(value.browser?.state)) return finish(failed);
        finish(value);
      } catch { finish(failed); }
    });
  });
  return entry.pending;
}

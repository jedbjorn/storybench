// Disposable network-disabled image check; no user data or provider calls.
import { fileURLToPath } from 'node:url';
import { smokeSvg } from './svg-check.js';
import { DECK_CHECK_VERSION, DECK_TEMPLATE_VERSION, validateDeckCheck } from './deck-evidence.js';

export async function checkDeckImage(role) {
  const svg = await smokeSvg(role);
  const browser = role === 'app' ? await (await import('./browser-check.js')).smokeBrowser() : undefined;
  return validateDeckCheck({ role, checkVersion: DECK_CHECK_VERSION, template: DECK_TEMPLATE_VERSION, svg, ...(browser ? { browser } : {}) }, role);
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await checkDeckImage(process.argv[2]))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}

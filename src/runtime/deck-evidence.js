// Content-free, versioned evidence contract shared by host and app. No browser imports.
export const DECK_CHECK_VERSION = 1;
// staged-svg-2: the audience runtime reports its viewed position to an embedding frame.
export const DECK_TEMPLATE_VERSION = 'staged-svg-2';
export const DECK_PROFILE = 'storybench-svg-1';
const routes = ['codex', 'claude', 'opencode'];
const requiredSvg = ['parser', 'nativeRasterInspection', 'invalidRejected'];
const requiredApp = ['import', 'registration', 'reuse', 'imageTool', 'savedStaticExport', 'savedStagedExport', 'retainedZipSource'];
const requiredRoute = ['imageBlocks', 'delivered', 'presenter', 'mp4Playback', 'webmPlayback', 'stagedInteraction', 'contactSheet', 'evidenceRetained'];
const version = value => typeof value === 'string' && /^[\w.+-]{1,64}$/.test(value);

export function validateDeckCheck(value, role) {
  const fail = component => { throw new Error(`${role} deck check: missing or incompatible ${component} evidence`); };
  if (!['app', 'worker'].includes(role) || value?.role !== role || value.checkVersion !== DECK_CHECK_VERSION) fail('role/check version');
  if (value.template !== DECK_TEMPLATE_VERSION || value.svg?.profile !== DECK_PROFILE || value.svg?.checkVersion !== 2 || value.svg.role !== role) fail('SVG profile/template');
  for (const key of [...requiredSvg, ...(role === 'app' ? requiredApp : ['authoringCommand'])]) if (value.svg[key] !== true) fail(`SVG ${key}`);
  if (role === 'worker') return value;
  if (value.browser?.checkVersion !== 1 || value.browser.exactZip !== true) fail('browser ZIP');
  for (const key of ['controller', 'revision', 'actualVersion']) if (!version(value.browser.browser?.[key])) fail(`browser ${key}`);
  if (value.browser.browser.actualVersion !== value.browser.browser.browserVersion) fail('matching packaged browser/controller');
  for (const route of routes) for (const key of requiredRoute) if (value.browser.routes?.[route]?.[key] !== true) fail(`${route} ${key}`);
  return value;
}

export function bindDeckEvidence(checks, commit, images) {
  const evidence = { checkVersion: DECK_CHECK_VERSION, commit, images: { ...images }, roles: checks };
  validateDeckEvidence(evidence, { commit, images });
  return evidence;
}

export function validateDeckEvidence(value, identity) {
  if (value?.checkVersion !== DECK_CHECK_VERSION || value.commit !== identity.commit) throw new Error('Deck evidence commit/check version mismatch');
  for (const role of ['app', 'worker']) {
    if (!/^sha256:[a-f0-9]{64}$/.test(value.images?.[role] ?? '') || value.images[role] !== identity.images?.[role]) throw new Error(`Deck evidence ${role} image mismatch`);
    validateDeckCheck(value.roles?.[role], role);
  }
  return value;
}

// Only known scalar facts cross the health/request boundary, never arbitrary receipt fields.
export function deckEvidenceSummary(value, identity) {
  try { validateDeckEvidence(value, identity); } catch { return { state: 'unverified', reason: 'No current exact-image SVG/browser deck receipt; run the normal update and doctor checks.' }; }
  const browser = value.roles.app.browser.browser;
  return { state: 'ready', checkVersion: DECK_CHECK_VERSION, profile: DECK_PROFILE, template: DECK_TEMPLATE_VERSION,
    browser: { controller: browser.controller, revision: browser.revision, actualVersion: browser.actualVersion },
    imageTransport: routes, codecs: ['h264/aac', 'vp8/vorbis'], source: 'exact-image installation checks' };
}

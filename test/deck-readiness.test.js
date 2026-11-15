import test from 'node:test';
import assert from 'node:assert/strict';
import { deckCheckFixture } from '../test-support/deck-evidence.js';
import { bindDeckEvidence, validateDeckCheck, deckEvidenceSummary } from '../src/runtime/deck-evidence.js';
import { createManifest, releaseIdentity, validateManifest, manifestId } from '../src/runtime/manifest.js';
import { releaseFromEnv } from '../src/runtime/health.js';
import { describeCapabilities } from '../src/runtime/capabilities.js';
import { checkImage } from '../src/runtime/image-verification.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const images = { app: `sha256:${'a'.repeat(64)}`, worker: `sha256:${'b'.repeat(64)}` }, commit = 'c'.repeat(40);
const receipt = () => bindDeckEvidence({ app: deckCheckFixture('app'), worker: deckCheckFixture('worker') }, commit, images);

test('deck image validation rejects skipped, wrong-role, old and incomplete evidence', async () => {
  for (const change of [v => v.checkVersion = 0, v => v.role = 'worker', v => v.svg.savedStagedExport = 'skipped',
    v => delete v.browser.browser.actualVersion, v => v.browser.routes.opencode.delivered = false,
    v => v.browser.routes.codex.mp4Playback = 'unverified']) {
    const value = deckCheckFixture('app'); change(value);
    assert.throws(() => validateDeckCheck(value, 'app'), /evidence/);
  }
  const calls = [];
  const value = await checkImage(async (command, args, options) => {
    calls.push({ command, args, options }); return { code: 0, stdout: JSON.stringify(deckCheckFixture('app')) };
  }, images.app, 'app', 'deck');
  assert.equal(value.svg.savedStagedExport, true);
  assert.ok(calls[0].args.includes(images.app));
  assert.ok(calls[0].args.includes('none'));
  assert.ok(calls[0].args.includes('--memory'));
  assert.equal(calls[0].options.timeoutMs, 300_000);
  await assert.rejects(checkImage(async () => ({ code: 1, stderr: 'browser launch failed' }), images.app, 'app', 'deck'), /app image deck failed: browser launch failed/);
});

test('structured deck identity survives manifest/health/request serialization without private fields or model claims', () => {
  const deck = receipt(); deck.roles.app.private = '/secret/user-content';
  const manifest = createManifest({ packageName: 'storybench', packageVersion: '0.1.0', commit, images, deck, schema: { min: 0, max: 99 } });
  const identity = releaseIdentity(validateManifest(JSON.parse(JSON.stringify(manifest))));
  const release = releaseFromEnv({ STORYBENCH_RELEASE: JSON.stringify(identity) });
  assert.equal(release.deckReadiness.state, 'ready');
  assert.deepEqual(release.deckReadiness.imageTransport, ['codex', 'claude', 'opencode']);
  assert.ok(!JSON.stringify(release).includes('/secret'));
  const capabilities = describeCapabilities({ scope: { harness: 'opencode', model: 'unknown' }, served: [{ name: 'inspect_deck_qa' }, { name: 'build_deck' }, { name: 'open_deck_qa' }], release });
  assert.equal(capabilities.deck.installation.state, 'ready');
  assert.equal(capabilities.deck.screenshotInput.state, 'unverified');
  assert.equal(capabilities.imageInput.verified, false);
  const textOnly = describeCapabilities({ scope: { harness: 'opencode' }, served: [{ name: 'build_deck' }], release });
  assert.equal(textOnly.deck.screenshotInput.state, 'unavailable');
  const mismatch = structuredClone(manifest); mismatch.runtime.deck.images.worker = images.app; mismatch.id = manifestId(mismatch);
  assert.throws(() => validateManifest(mismatch), /image mismatch/);
  assert.equal(deckEvidenceSummary(deck, { commit: 'd'.repeat(40), images }).state, 'unverified');
  const legacy = createManifest({ packageName: 'storybench', packageVersion: '0.1.0', commit, images, schema: { min: 0, max: 99 } });
  assert.equal(releaseFromEnv({ STORYBENCH_RELEASE: JSON.stringify(releaseIdentity(legacy)) }).deckReadiness.state, 'unverified');
});

test('missing packaged browser leaves vector drafts available and reports a specific unavailable capability', async () => {
  const { stdout } = await promisify(execFile)(process.execPath, [fileURLToPath(new URL('../src/runtime/deck-startup-check.js', import.meta.url))], {
    timeout: 20_000, env: { PATH: process.env.PATH, HOME: process.env.HOME, PLAYWRIGHT_BROWSERS_PATH: '/nonexistent-storybench-browser-fixture' },
  });
  const result = JSON.parse(stdout);
  assert.equal(result.vector.state, 'ready');
  assert.equal(result.browser.state, 'unavailable');
  assert.match(result.browser.reason, /browser launch/);
  assert.ok(!stdout.includes('/nonexistent'));
});

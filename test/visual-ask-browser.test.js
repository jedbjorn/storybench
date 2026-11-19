// Spec #46 task #133 (Iterations), in the browser (Chromium and Firefox, app served on loopback): the
// slide editor's Visual card offers Ask for another. It closes the editor and fills the chat composer with
// a note naming the slide (number and title), the picked asset and its iteration, and sends nothing. With
// no picked asset it is disabled with the reason. STORYBENCH_EVIDENCE_DIR saves screenshots.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import { chromium, firefox } from 'playwright-core';
import { createApp } from '../src/server.js';
import { createLibraryService } from '../src/library.js';
import { listenInRange } from '../test-support/loopback-port.js';

async function launch(type) {
  let browser = await type.launch().catch(() => null);
  if (!browser && type === chromium && existsSync('/usr/bin/chromium')) browser = await chromium.launch({ executablePath: '/usr/bin/chromium' }).catch(() => null);
  return browser;
}
const evidence = async (page, name) => {
  if (!process.env.STORYBENCH_EVIDENCE_DIR) return;
  await mkdir(process.env.STORYBENCH_EVIDENCE_DIR, { recursive: true });
  await page.screenshot({ path: path.join(process.env.STORYBENCH_EVIDENCE_DIR, name) });
};

for (const type of [chromium, firefox]) test(`Iterations ${type.name()}: Ask for another from the Visual card fills the composer with a note naming the slide and the iteration`, { timeout: 120000 }, async t => {
  const browser = await launch(type);
  if (!browser) return t.skip(`No launchable ${type.name()} on this seat`);
  t.after(() => browser.close());
  const workspace = await mkdtemp(path.join(tmpdir(), 'sb-visual-ask-'));
  const app = await createApp({ workspace });
  t.after(async () => { await app.close(); await rm(workspace, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${await listenInRange(app.server)}`;
  const episode = app.store.createEpisode({ kind: 'deck', title: 'Visual ask deck' });
  app.store.ensureEpisodeDirectories(episode.id);
  // The floor plan in two iterations: v2 is picked on slide 02, v1 a candidate of slide 01 (no pick).
  const library = createLibraryService({ workspace, store: app.store });
  const source = await readFile(new URL('../src/runtime/fixtures/svg-illustration.svg', import.meta.url), 'utf8');
  const register = name => library.registerFile({ episodeId: episode.id, readable: Readable.from(Buffer.from(source.replace('</svg>', `<!-- ${name} --></svg>`))), fileName: `${name}.svg`, selectedCategory: 'Graphics' });
  const v1 = await register('plan-v1'), v2 = await register('plan-v2');
  const iterate = (item, iteration) => app.store.db.prepare('UPDATE library_items SET iteration_group=?,iteration=?,label=? WHERE id=?').run(v1.id, iteration, 'Floor plan', item.id);
  iterate(v1, 1); iterate(v2, 2);
  app.store.saveDeck(episode.id, 1, [
    { id: 'empty', title: 'Nothing picked', layout: 'full-media', body: 'No pick yet.', candidates: [{ itemId: v1.id, alt: '' }] },
    { id: 'plan', title: 'Observe, connect, plan', layout: 'process', body: 'Three steps.', vector: { itemId: v2.id, alt: 'Plan' }, stages: [{ id: 's1', title: 'Observe', svgGroupIds: ['observe'] }] },
  ], 'human');
  const revision = app.store.getDeck(episode.id).revision;

  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } }); page.setDefaultTimeout(15000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const sent = []; page.on('request', request => { if (request.method() === 'POST' && /\/(messages|production-requests)$/.test(new URL(request.url()).pathname)) sent.push(request.url()); });
  await page.goto(`${base}/?channel=${episode.channelId}&episode=${episode.id}`);
  const openEditor = async index => {
    const card = page.locator(`#deckSlides [data-slide-index="${index}"]`);
    if (!(await card.evaluate(node => node.classList.contains('is-open')))) await card.locator('.slide-card-summary').click();
    await card.locator('[data-slide-edit]').click();
    await page.locator(`#slideEditor .deck-slide[data-slide-index="${index}"]`).waitFor();
    const visual = page.locator('#slideEditor [data-card="visual"]');
    if (!(await visual.evaluate(node => node.open))) await visual.locator('summary').click();
    return visual;
  };

  // No picked asset: the control is there, disabled, with the reason.
  let visual = await openEditor(0);
  const disabled = visual.locator('[data-ask-another]');
  assert.equal(await disabled.isDisabled(), true);
  assert.equal(await disabled.getAttribute('title'), 'Star a candidate first: Ask for another makes a new iteration of the pick.');
  await evidence(page, `ask-${type.name()}-1-no-pick.png`);
  await page.click('[data-editor-close]');
  await page.locator('#slideEditor').waitFor({ state: 'hidden' });

  // The picked drawing: Ask for another closes the editor and the note waits in the composer, unsent.
  visual = await openEditor(1);
  await evidence(page, `ask-${type.name()}-2-visual-card.png`);
  await visual.locator('[data-ask-another]').click();
  await page.locator('#slideEditor').waitFor({ state: 'hidden' });
  const draft = page.locator('[data-chat-draft]');
  assert.equal(await draft.inputValue(), `On slide 02 “Observe, connect, plan” (plan): make another iteration of its picked visual “Floor plan” (library item ${v2.id}, v2). `
    + `Register it with iterationOf ${v2.id} and add it to this slide's candidates, unstarred unless I say to use it. What to change: `);
  assert.equal(await draft.evaluate(node => document.activeElement === node && node.selectionStart === node.value.length), true, 'the caret waits at the end of the note');
  await evidence(page, `ask-${type.name()}-3-composer.png`);
  await page.waitForTimeout(300);
  assert.deepEqual(sent, [], 'nothing was sent');
  assert.equal(app.store.getDeck(episode.id).revision, revision, 'asking saved nothing');
  assert.deepEqual(errors, []);
});

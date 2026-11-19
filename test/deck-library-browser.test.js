// Spec #46 task #129, E9 library half in the browser (Chromium and Firefox, app on loopback): the deck Media
// Library groups By slide (default) and By type with On slide / Candidate / dimmed tiles, Not on any slide
// yet, References and audio; the Not on a slide filter; no categories or category drag for decks; Use on
// slide; the asset preview's iteration strip, Ask for another, On slides list (Use, remove refused while
// starred, Candidate for a slide) and read-only drawing parts; the server's delete guard; deleting an
// unpicked candidate; Clean up deleting only the ticked iterations. A video production's library is
// unchanged. STORYBENCH_EVIDENCE_DIR saves screenshots.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import { chromium, firefox } from 'playwright-core';
import { createApp } from '../src/server.js';
import { createLibraryService } from '../src/library.js';
import { listenInRange } from '../test-support/loopback-port.js';

const exec = promisify(execFile);
async function launch(type) {
  let browser = await type.launch().catch(() => null);
  if (!browser && type === chromium && existsSync('/usr/bin/chromium')) browser = await chromium.launch({ executablePath: '/usr/bin/chromium' }).catch(() => null);
  return browser;
}
const evidence = async (name, bytes) => {
  if (!process.env.STORYBENCH_EVIDENCE_DIR) return;
  await mkdir(process.env.STORYBENCH_EVIDENCE_DIR, { recursive: true });
  await writeFile(path.join(process.env.STORYBENCH_EVIDENCE_DIR, name), bytes);
};

for (const type of [chromium, firefox]) test(`E9 ${type.name()}: the deck Media Library by slide and by type, the asset preview, the delete guard and Clean up; video unchanged`, { timeout: 180000 }, async t => {
  const browser = await launch(type);
  if (!browser) return t.skip(`No launchable ${type.name()} on this seat`);
  t.after(() => browser.close());
  const workspace = await mkdtemp(path.join(tmpdir(), 'sb-deck-library-browser-'));
  const app = await createApp({ workspace });
  t.after(async () => { await app.close(); await rm(workspace, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${await listenInRange(app.server)}`;
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } }); page.setDefaultTimeout(15000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const dialogs = []; page.on('dialog', dialog => { dialogs.push(dialog.message()); dialog.accept(); });
  const api = async (method, url, body, headers = {}) => {
    const response = await page.request.fetch(`${base}${url}`, { method, data: body, headers });
    assert.ok(response.ok(), `${method} ${url}: ${response.status()} ${await response.text()}`);
    return response.json();
  };

  // Fixture: a deck with the floor plan drawing in three iterations, photos (two of them one group of two),
  // a pasted reference and narration audio; and a video production with one image.
  const deck = await api('POST', '/api/episodes', { kind: 'deck', title: 'Library deck' });
  const scope = `?channel=${deck.channelId}`;
  const library = createLibraryService({ workspace, store: app.store });
  const svg = await readFile(new URL('../src/runtime/fixtures/svg-illustration.svg', import.meta.url), 'utf8');
  const register = async (episodeId, fileName, bytes) => library.registerFile({ episodeId, readable: Readable.from(bytes), fileName, selectedCategory: 'Graphics' });
  const iterate = (item, of, iteration) => app.store.db.prepare('UPDATE library_items SET iteration_group=?,iteration=?,label=? WHERE id=?').run(of.id, iteration, 'Floor plan', item.id);
  const plan = [];
  for (const n of [1, 2, 3]) plan.push(await register(deck.id, `plan-v${n}.svg`, Buffer.from(svg.replace('</svg>', `<!-- v${n} --></svg>`))));
  iterate(plan[0], plan[0], 1); iterate(plan[1], plan[0], 2); iterate(plan[2], plan[0], 3);
  const png = async (name, color) => {
    const file = path.join(workspace, `${name}.png`);
    await exec('ffmpeg', ['-v', 'error', '-nostdin', '-f', 'lavfi', '-i', `color=c=${color}:s=320x180:d=1`, '-frames:v', '1', file]);
    return api('POST', `/api/episodes/${deck.id}/library/files${scope}`, await readFile(file), { 'content-type': 'image/png', 'x-file-name': `${name}.png`, 'x-library-label': name, 'x-library-category': 'Graphics' });
  };
  const hero = await png('hero', 'red'), sky = await png('sky', 'blue'), spare1 = await png('spare', 'green'), spare2 = await png('spare-wide', 'yellow');
  app.store.db.prepare('UPDATE library_items SET iteration_group=?,iteration=2 WHERE id=?').run(spare1.id, spare2.id);
  const notes = await api('POST', `/api/episodes/${deck.id}/library/text${scope}`, { title: 'Site notes', text: 'The site faces south.' });
  const wav = path.join(workspace, 'voice.wav');
  await exec('ffmpeg', ['-v', 'error', '-nostdin', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', wav]);
  const voice = await api('POST', `/api/episodes/${deck.id}/library/files${scope}`, await readFile(wav), { 'content-type': 'audio/wav', 'x-file-name': 'voice.wav', 'x-library-label': 'Voice', 'x-library-category': 'Narration' });
  const groupIds = JSON.parse(app.store.db.prepare('SELECT metadata FROM assets a JOIN library_items l ON l.asset_id=a.id WHERE l.id=?').get(plan[1].id).metadata).svgGroupIds;
  assert.ok(groupIds.includes('observe'));
  app.store.saveDeck(deck.id, app.store.getDeck(deck.id).revision, [
    { id: 'plan', title: 'The plan', layout: 'process', vector: { itemId: plan[1].id, alt: 'Plan v2' }, candidates: [{ itemId: plan[0].id, alt: 'Plan v1' }], stages: [{ id: 's1', title: 'Observe', svgGroupIds: ['observe'] }] },
    { id: 'hero', title: 'The hero', layout: 'text-media', media: { itemId: hero.id, alt: 'Hero' }, candidates: [{ itemId: sky.id, alt: 'Sky' }] },
    { id: 'words', title: 'In words', layout: 'statement' },
  ]);
  const slides = async () => (await api('GET', `/api/episodes/${deck.id}/slides${scope}`)).slides;
  const section = key => page.locator(`[data-library-section="${key}"]`);
  const tile = (key, id) => section(key).locator(`[data-library-item="${id}"]`);
  const ids = async locator => locator.locator('[data-library-item]').evaluateAll(nodes => nodes.map(node => node.dataset.libraryItem));
  const pressed = name => page.locator('#libraryDeckBar button', { hasText: name });

  // Video production: today's four category groups with the drag grip; no deck controls.
  const video = await api('POST', '/api/episodes', { title: 'Video', channelId: deck.channelId });
  const file = path.join(workspace, 'still.png');
  await exec('ffmpeg', ['-v', 'error', '-nostdin', '-f', 'lavfi', '-i', 'color=c=gray:s=320x180:d=1', '-frames:v', '1', file]);
  const still = await api('POST', `/api/episodes/${video.id}/library/files${scope}`, await readFile(file), { 'content-type': 'image/png', 'x-file-name': 'still.png', 'x-library-label': 'Still', 'x-library-category': 'B-roll' });
  await page.goto(`${base}/${scope}&episode=${video.id}`);
  await page.click('[data-tab="media"]');
  await page.locator(`[data-library-category="B-roll"] [data-library-item="${still.id}"]`).waitFor();
  assert.deepEqual(await page.locator('[data-library-category]').evaluateAll(nodes => nodes.map(node => node.dataset.libraryCategory)), ['Reference', 'B-roll', 'Narration', 'Graphics']);
  assert.equal(await page.locator('[data-library-grip]').count(), 1);
  assert.ok(await page.locator('#libraryDeckBar').isHidden());
  await page.click(`[data-library-item="${still.id}"] .library-thumb`);
  assert.ok(await page.locator('#libraryEditForm [data-library-category-field]').isVisible(), 'video items keep their category');
  assert.ok(await page.locator('#libraryAssetDeck').isHidden());
  await page.click('#previewModal [data-preview-close]');
  await evidence(`e9-${type.name()}-0-video-library.png`, await page.screenshot());

  // Deck: By slide is the default; slides with candidates, then Not on any slide yet, then References and audio.
  await page.goto(`${base}/${scope}&episode=${deck.id}`);
  await page.click('[data-tab="media"]');
  await tile('slide-plan', plan[1].id).waitFor();
  assert.equal(await pressed('By slide').getAttribute('aria-pressed'), 'true');
  assert.deepEqual(await page.locator('[data-library-section]').evaluateAll(nodes => nodes.map(node => node.dataset.librarySection)), ['slide-plan', 'slide-hero', 'unused', 'context']);
  assert.deepEqual(await ids(section('slide-plan')), plan.map(item => item.id), 'the plan slide holds the whole iteration group, v1..v3');
  assert.match(await tile('slide-plan', plan[1].id).innerText(), /On slide/);
  assert.match(await tile('slide-plan', plan[0].id).innerText(), /Candidate[\s\S]*Use on slide/);
  assert.ok(await tile('slide-plan', plan[2].id).evaluate(node => node.classList.contains('library-dimmed')), 'v3 is dimmed on the plan slide');
  assert.match(await tile('slide-plan', plan[1].id).innerText(), /Floor plan\s*v2/);
  assert.deepEqual(await ids(section('slide-hero')), [hero.id, sky.id]);
  assert.deepEqual(await ids(section('unused')), [spare1.id, spare2.id]);
  assert.deepEqual((await ids(section('context'))).sort(), [notes.id, voice.id].sort());
  // No categories or category drag for decks; the import has no category either.
  assert.equal(await page.locator('[data-library-category]').count(), 0);
  assert.equal(await page.locator('[data-library-grip]').count(), 0);
  await page.click('#openLibraryImport');
  assert.ok(await page.locator('#libraryImportCategoryField').isHidden());
  await page.keyboard.press('Escape');
  await evidence(`e9-${type.name()}-1-by-slide.png`, await page.screenshot({ fullPage: true }));

  // Asset preview of v2: the iteration strip, its slides (remove refused while starred) and its parts, read-only.
  await page.click(`[data-library-section="slide-plan"] [data-library-item="${plan[1].id}"] .library-thumb`);
  const panel = page.locator('#libraryAssetDeck');
  await panel.waitFor();
  assert.deepEqual(await panel.locator('[data-asset-iteration]').evaluateAll(nodes => nodes.map(node => [node.textContent, node.getAttribute('aria-pressed')])), [['v1', 'false'], ['v2', 'true'], ['v3', 'false']]);
  assert.ok(await page.locator('#libraryEditForm [data-library-category-field]').isHidden(), 'decks do not show categories');
  assert.match(await panel.locator('[data-asset-slide-row="plan"]').innerText(), /01\s*The plan\s*★ On slide/);
  assert.ok(await panel.locator('[data-asset-remove="plan"]').isDisabled(), 'a starred asset cannot be removed from its slide');
  assert.deepEqual(await panel.locator('.library-parts li').allInnerTexts(), groupIds);
  assert.equal(await panel.locator('.library-parts input, .library-parts select, .library-parts button').count(), 0, 'parts are read-only');
  await evidence(`e9-${type.name()}-2-asset-preview.png`, await page.screenshot());
  // Flip to v1: a candidate of the plan slide. Candidate for a slide adds it to the hero slide (a drawing slot).
  await panel.locator('[data-asset-iteration]', { hasText: 'v1' }).click();
  await panel.locator('[aria-pressed="true"]', { hasText: 'v1' }).waitFor();
  assert.ok(await panel.locator('[data-asset-use="plan"]').isVisible());
  await panel.locator('[data-asset-pick]').click();
  assert.deepEqual(await panel.locator('[data-asset-slide] option').allInnerTexts(), ['02 The hero'], 'only slides whose type has a drawing slot, and not already holding it');
  await panel.locator('[data-asset-add]').click();
  await panel.locator('[data-asset-slide-row="hero"]').waitFor();
  assert.deepEqual((await slides())[1].candidates.map(value => value.itemId), [sky.id, plan[0].id]);
  // Use on the plan slide stars v1; v2 returns to the candidates. Remove takes v1 off the hero slide.
  await panel.locator('[data-asset-use="plan"]').click();
  await panel.locator('[data-asset-slide-row="plan"] .library-state.on').waitFor();
  let saved = await slides();
  assert.equal(saved[0].vector.itemId, plan[0].id);
  assert.deepEqual(saved[0].candidates.map(value => value.itemId), [plan[1].id]);
  assert.equal(saved[0].pickSetBy, 'creator');
  assert.deepEqual(saved[0].stages[0].svgGroupIds, ['observe'], 'the step keeps its part');
  await panel.locator('[data-asset-remove="hero"]').click();
  await panel.locator('[data-asset-slide-row="hero"]').waitFor({ state: 'detached' });
  assert.deepEqual((await slides())[1].candidates.map(value => value.itemId), [sky.id]);
  await evidence(`e9-${type.name()}-3-asset-preview-v1-used.png`, await page.screenshot());
  // Ask for another: the request waits in the chat composer, naming the asset and its group.
  await panel.locator('[data-asset-ask]').click();
  await page.locator('#previewModal').waitFor({ state: 'hidden' });
  const draft = await page.locator('[data-chat-draft]').inputValue();
  assert.match(draft, new RegExp(`Make another iteration of “Floor plan” \\(library item ${plan[0].id}, v1\\)\\. Register it with iterationOf ${plan[0].id}`));
  await page.locator('[data-chat-draft]').fill('');
  // The label is shared by the iteration group: renaming v1 in its preview renames v2 and v3.
  await tile('slide-plan', plan[0].id).locator('.library-thumb').click();
  await page.locator('#libraryEditForm [name="label"]').fill('Ground floor');
  await page.locator('#libraryEditForm button.primary').click();
  await page.locator('#previewModal').waitFor({ state: 'hidden' });
  await section('slide-plan').locator('[data-library-item] b').filter({ hasText: 'Ground floor' }).nth(2).waitFor();
  assert.deepEqual(plan.map(value => app.store.getLibraryItem(deck.id, value.id).label), ['Ground floor', 'Ground floor', 'Ground floor']);

  // Use on slide from a Candidate tile: sky becomes the hero pick, hero returns to the candidates.
  await tile('slide-hero', sky.id).locator('[data-library-use]').click();
  await section('slide-hero').locator(`.library-on[data-library-item="${sky.id}"]`).waitFor();
  saved = await slides();
  assert.deepEqual([saved[1].media.itemId, saved[1].candidates.map(value => value.itemId)], [sky.id, [hero.id]]);
  assert.match(await tile('slide-hero', hero.id).innerText(), /Candidate/);

  // By type: Drawings, Images, Video, Audio, References; tiles say where they are used.
  await pressed('By type').click();
  await section('drawing').waitFor();
  assert.deepEqual(await page.locator('[data-library-section]').evaluateAll(nodes => nodes.map(node => node.dataset.librarySection)), ['drawing', 'image', 'video', 'audio', 'reference']);
  assert.deepEqual(await ids(section('drawing')), plan.map(item => item.id));
  assert.match(await tile('drawing', plan[0].id).innerText(), /On 01/);
  assert.match(await tile('drawing', plan[1].id).innerText(), /Candidate for 01/);
  assert.match(await tile('drawing', plan[2].id).innerText(), /Not on a slide/);
  assert.match(await tile('image', hero.id).innerText(), /Candidate for 02/);
  assert.deepEqual([await ids(section('audio')), await ids(section('reference'))], [[voice.id], [notes.id]]);
  await evidence(`e9-${type.name()}-4-by-type.png`, await page.screenshot({ fullPage: true }));
  // The Not on a slide filter, By type and By slide.
  await pressed('Not on a slide').click();
  await section('reference').waitFor({ state: 'detached' });
  assert.deepEqual(await ids(page.locator('#libraryGroups')), [plan[2].id, spare1.id, spare2.id]);
  await pressed('By slide').click();
  await section('slide-plan').waitFor({ state: 'detached' });
  assert.deepEqual(await page.locator('[data-library-section]').evaluateAll(nodes => nodes.map(node => node.dataset.librarySection)), ['unused']);
  assert.deepEqual(await ids(section('unused')), [plan[2].id, spare1.id, spare2.id]);
  await evidence(`e9-${type.name()}-5-not-on-a-slide.png`, await page.screenshot());
  await pressed('All').click();
  await section('slide-plan').waitFor();

  // Delete guard: the server refuses a starred asset; the library says so without asking.
  const item = id => app.store.getLibraryItem(deck.id, id);
  const refused = await page.request.fetch(`${base}/api/episodes/${deck.id}/library/${plan[0].id}${scope}`, { method: 'DELETE',
    data: { expectedRevision: item(plan[0].id).revision, expectedEpisodeRevision: app.store.getDeck(deck.id).revision } });
  assert.equal(refused.status(), 409);
  assert.match((await refused.json()).error, /“Ground floor” is starred on slide 01; star another there first/);
  await tile('slide-plan', plan[0].id).locator('[data-library-delete]').click();
  await page.locator('#toast').filter({ hasText: 'is starred on slide 01' }).waitFor();
  assert.ok(item(plan[0].id), 'the starred asset stays');
  assert.equal(dialogs.length, 0);
  // Deleting an unpicked candidate removes it from the candidate lists.
  await tile('slide-plan', plan[1].id).locator('[data-library-delete]').click();
  await tile('slide-plan', plan[1].id).waitFor({ state: 'detached' });
  assert.match(dialogs.at(-1), /It is a candidate on slide 01 and will be removed from it/);
  assert.equal(item(plan[1].id), null);
  assert.deepEqual((await slides())[0].candidates ?? [], []);

  // Clean up offers only eligible iterations (v3 and both spares) and deletes only the ticked ones.
  await page.click('#openLibraryCleanup');
  const rows = page.locator('#libraryCleanupRows input');
  assert.deepEqual(await rows.evaluateAll(nodes => nodes.map(node => node.value)), [plan[2].id, spare1.id, spare2.id]);
  assert.ok(await page.locator('#libraryCleanupSubmit').isDisabled());
  await page.locator(`#libraryCleanupRows input[value="${plan[2].id}"]`).check();
  await page.locator(`#libraryCleanupRows input[value="${spare2.id}"]`).check();
  assert.equal(await page.locator('#libraryCleanupSubmit').innerText(), 'Delete 2 selected');
  await evidence(`e9-${type.name()}-6-clean-up.png`, await page.screenshot());
  await page.click('#libraryCleanupSubmit');
  await page.locator('#toast').filter({ hasText: '2 iterations deleted' }).waitFor();
  assert.deepEqual([item(plan[2].id), item(spare2.id)], [null, null]);
  assert.ok(item(spare1.id) && item(plan[0].id) && item(hero.id) && item(sky.id), 'unticked and in-use items stay');
  assert.deepEqual(await ids(section('unused')), [spare1.id]);
  await evidence(`e9-${type.name()}-7-after-clean-up.png`, await page.screenshot({ fullPage: true }));
  assert.deepEqual(errors, []);
});

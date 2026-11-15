import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { createApp } from '../src/server.js';
import { listenInRange } from '../test-support/loopback-port.js';

test('deck workspace creates, edits, reopens and keeps video controls separate', {timeout:20000}, async t => {
  let browser;
  try { browser = await chromium.launch(); }
  catch { if (existsSync('/usr/bin/chromium')) browser = await chromium.launch({executablePath:'/usr/bin/chromium'}).catch(()=>null); }
  if (!browser) return t.skip('No launchable Chromium on this seat');
  t.after(()=>browser.close());
  const root=mkdtempSync(path.join(tmpdir(),'storybench-deck-browser-'));
  const app=await createApp({workspace:root});
  t.after(async()=>{await app.close();rmSync(root,{recursive:true,force:true});});
  const video=app.store.createEpisode({title:'Video remains'});
  const port=await listenInRange(app.server);
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${port}/episodes?channel=${video.channelId}`);
  await page.click('#episodeRailToggle');
  await page.selectOption('#productionKind','deck');
  await page.click('#newEpisode');
  await page.waitForFunction(()=>document.querySelector('#addCard').textContent.includes('Add slide'));
  assert.equal(await page.locator('#preview').isVisible(),false);
  assert.equal(await page.locator('[data-tab="final"]').isVisible(),false);
  assert.equal(await page.locator('#productionReferencesLabel').textContent(), 'Deck references');
  await page.locator('[data-chat-draft]').waitFor();
  assert.match(await page.locator('[data-chat-draft]').getAttribute('placeholder'), /deck assistant/);
  await page.waitForFunction(() => document.querySelector('[data-chat-messages]').textContent.includes('this deck'));
  await page.click('[data-tab="media"]');
  assert.equal(await page.locator('#mediaPanel h2').textContent(), 'Deck library');
  await page.click('[data-tab="board"]');
  await page.click('#addCard');
  await page.locator('[data-slide-field="title"]').waitFor();
  await page.fill('[data-slide-field="title"]','A clear opening');
  await page.locator('[data-slide-field="title"]').press('Tab');
  await page.waitForFunction(()=>document.querySelector('#saveState').textContent.startsWith('Saved'));
  await page.fill('[data-slide-field="notes"]','Invite a question');
  await page.locator('[data-slide-field="notes"]').press('Tab');
  await page.waitForFunction(()=>document.querySelector('#saveState').textContent.startsWith('Saved'));
  await page.fill('[data-slide-field="body"]', 'A small idea becomes a clear story.\nGather the material, shape the sequence, share the result.');
  await page.locator('[data-slide-field="body"]').press('Tab');
  await page.waitForFunction(()=>document.querySelector('#saveState').textContent.startsWith('Saved'));
  await page.click('[data-slide-action="add-stages"]');
  await page.waitForFunction(()=>document.querySelector('#saveState').textContent.startsWith('Saved'));
  const deck=app.store.listEpisodes().find(p=>p.kind==='deck');
  assert.equal(app.store.getDeck(deck.id).slides[0].title,'A clear opening');
  await page.reload();
  await page.locator('[data-slide-field="notes"]').waitFor();
  assert.equal(await page.inputValue('[data-slide-field="notes"]'),'Invite a question');
  assert.equal(await page.locator('[data-part="stages"]').count(),1);
  if (process.env.STORYBENCH_DECK_EVIDENCE) {
    mkdirSync(process.env.STORYBENCH_DECK_EVIDENCE, { recursive: true });
    await page.locator('.workspace').evaluate(el => { el.scrollTop = 0; });
    await page.screenshot({ path: path.join(process.env.STORYBENCH_DECK_EVIDENCE, 'ui-polish-r2-synthetic-deck-desktop.png'), fullPage: true });
  }
  for (const width of [600, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.ok((await page.locator('.workspace').boundingBox()).width >= width - 16, 'Deck navigation does not squeeze slides');
    assert.ok((await page.locator('.deck-slide > label > [data-slide-field="body"]').boundingBox()).width >= width * .75, 'Slide text has room to edit');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    if (process.env.STORYBENCH_DECK_EVIDENCE) await page.screenshot({ path: path.join(process.env.STORYBENCH_DECK_EVIDENCE, `ui-polish-r2-synthetic-deck-${width}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.click('#episodeRailToggle');
  await page.click(`#episodes [data-id="${video.id}"] [data-episode-select]`);
  assert.equal(await page.locator('#preview').isVisible(),true);
  assert.equal(await page.locator('#deckSlides').isVisible(),false);
  assert.equal(await page.locator('#productionReferencesLabel').textContent(), 'Episode references');
  assert.deepEqual(errors,[]);
});

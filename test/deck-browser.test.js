import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { chromium } from 'playwright-core';
import { createApp } from '../src/server.js';
import { listenInRange } from '../test-support/loopback-port.js';
import { createLibraryService } from '../src/library.js';
import { motionSvg } from '../test-support/motion-deck.js';

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
  const savedResponse = () => page.waitForResponse(response => response.request().method() === 'PUT' && /\/api\/episodes\/[^/]+$/.test(new URL(response.url()).pathname));
  const added = savedResponse();
  await page.click('#addCard');
  assert.equal((await added).status(),200);
  await page.waitForFunction(()=>document.querySelector('#saveState').textContent.startsWith('Saved'));
  await page.locator('[data-slide-field="title"]').waitFor();
  const titleSaved = savedResponse();
  await page.fill('[data-slide-field="title"]','A clear opening');
  await page.locator('[data-slide-field="title"]').press('Tab');
  assert.equal((await titleSaved).status(),200);
  await page.waitForFunction(()=>document.querySelector('#saveState').textContent.startsWith('Saved'));
  const notesSaved = savedResponse();
  await page.fill('[data-slide-field="notes"]','Invite a question');
  await page.locator('[data-slide-field="notes"]').press('Tab');
  assert.equal((await notesSaved).status(),200);
  await page.waitForFunction(()=>document.querySelector('#saveState').textContent.startsWith('Saved'));
  const bodySaved = savedResponse();
  await page.fill('[data-slide-field="body"]', 'A small idea becomes a clear story.\nGather the material, shape the sequence, share the result.');
  await page.locator('[data-slide-field="body"]').press('Tab');
  assert.equal((await bodySaved).status(),200);
  await page.waitForFunction(()=>document.querySelector('#saveState').textContent.startsWith('Saved'));
  const stagesSaved = savedResponse();
  await page.click('[data-slide-action="add-stages"]');
  assert.equal((await stagesSaved).status(),200);
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
    const availableWidth = width - (await page.locator('#episodeRailToggle').boundingBox()).width;
    assert.ok((await page.locator('.workspace').boundingBox()).width >= availableWidth - 16, 'Deck workspace uses the available width beside the rail');
    assert.ok((await page.locator('.deck-slide > label > [data-slide-field="body"]').boundingBox()).width >= availableWidth * .75, 'Slide text has room to edit');
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

// Spec #34 B11: the Slides editor edits a stage's timing and motion kind, and saving, duplicating
// and reordering leave `from` and `changes`, which it only lists, exactly as they were saved.
test('slide editor edits stage timing and motion and keeps from and changes', {timeout:30000}, async t => {
  let browser;
  try { browser = await chromium.launch(); }
  catch { if (existsSync('/usr/bin/chromium')) browser = await chromium.launch({executablePath:'/usr/bin/chromium'}).catch(()=>null); }
  if (!browser) return t.skip('No launchable Chromium on this seat');
  t.after(()=>browser.close());
  const root=mkdtempSync(path.join(tmpdir(),'storybench-deck-motion-editor-'));
  const app=await createApp({workspace:root});
  t.after(async()=>{await app.close();rmSync(root,{recursive:true,force:true});});
  const deck=app.store.createEpisode({kind:'deck',title:'Motion editor'});
  app.store.ensureEpisodeDirectories(deck.id);
  const art=await createLibraryService({workspace:root,store:app.store}).registerFile({episodeId:deck.id,readable:Readable.from(motionSvg),fileName:'art.svg',selectedCategory:'Graphics'});
  const from={y:-40,opacity:0}, travel=[{groupId:'dot',to:{x:360}}], settle=[{groupId:'dot',to:{scale:2,opacity:0.5}},{groupId:'track',to:{opacity:0.25}}];
  app.store.saveDeck(deck.id,1,[
    {id:'moving',title:'Moving',layout:'full-media',vector:{itemId:art.id,alt:'A track and a dot'},stages:[
      {id:'draw',title:'Draw',svgGroupIds:['track'],motion:'draw',trigger:'auto',afterMs:300,durationMs:1000,holdMs:200,easing:'linear'},
      {id:'arrive',title:'Arrive',svgGroupIds:['dot'],motion:'enter',from,trigger:'auto',afterMs:0,durationMs:400},
      {id:'travel',title:'Travel',changes:travel,trigger:'auto',afterMs:0,durationMs:2000,easing:'linear'},
      {id:'settle',title:'Settle',changes:settle,afterMs:500,durationMs:1000,holdMs:250,easing:'ease-in-out'}]},
    {id:'plain',title:'Plain',layout:'statement',stages:[{id:'point',title:'Point'}]}]);
  const port=await listenInRange(app.server);
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${port}/episodes?channel=${deck.channelId}&episode=${deck.id}`);
  const stage=(slide,index,field)=>page.locator(`[data-slide-index="${slide}"] [data-part="stages"][data-part-index="${index}"] [data-slide-${field.includes('-')?'action':'field'}="${field}"]`);
  // The board renders again once the library arrives; the group options mark that render.
  const ready=()=>page.locator('[data-slide-field="svgGroupIds"] option').first().waitFor({state:'attached'});
  await ready();
  const saved=()=>page.waitForFunction(()=>document.querySelector('#saveState').textContent.startsWith('Saved'));
  const slides=()=>app.store.getDeck(deck.id).slides;
  const motion=slide=>slide.stages.map(({title,from,changes})=>({title,from,changes}));
  const kept=[{title:'Draw',from:undefined,changes:undefined},{title:'Arrive',from,changes:undefined},{title:'Travel',from:undefined,changes:travel},{title:'Settle',from:undefined,changes:settle}];

  // The saved values are shown; an unset field shows its standard choice; changes are counted, not edited.
  const shown=async(slide,index)=>Object.fromEntries(await Promise.all(['trigger','afterMs','durationMs','holdMs','easing','motion'].map(async field=>[field,await stage(slide,index,field).inputValue()])));
  assert.deepEqual(await shown(0,0),{trigger:'auto',afterMs:'300',durationMs:'1000',holdMs:'200',easing:'linear',motion:'draw'});
  assert.deepEqual(await shown(0,3),{trigger:'',afterMs:'500',durationMs:'1000',holdMs:'250',easing:'ease-in-out',motion:''});
  assert.deepEqual(await shown(1,0),{trigger:'',afterMs:'',durationMs:'',holdMs:'',easing:'',motion:''});
  const notes=()=>page.locator('[data-slide-index="0"] [data-part="stages"]').evaluateAll(rows=>rows.map(row=>row.querySelector('[data-stage-changes]')?.dataset.stageChanges ?? null));
  assert.deepEqual(await notes(),[null,'0','1','2']);
  assert.match(await page.locator('[data-slide-index="0"] [data-part-index="3"] [data-stage-changes]').textContent(),/2 changes/);
  assert.deepEqual(await stage(1,0,'motion').locator('option').allTextContents(),['Fade'],'a text-only stage can only fade');

  // Every timing and motion-kind field edits and saves.
  const type=async(slide,index,field,value)=>{ await stage(slide,index,field).fill(value); await stage(slide,index,field).press('Tab'); await saved(); };
  const pick=async(slide,index,field,value)=>{ await stage(slide,index,field).selectOption(value); await saved(); };
  await type(0,0,'afterMs','400'); await type(0,0,'durationMs','1500'); await type(0,0,'holdMs','350');
  await pick(0,0,'easing','ease-out'); await pick(0,0,'trigger','manual'); await pick(0,0,'motion','');
  await pick(0,2,'easing','ease-in'); await type(0,3,'holdMs',''); await pick(0,3,'trigger','auto');
  await pick(1,0,'trigger','auto'); await type(1,0,'afterMs','0'); await type(1,0,'durationMs','800');
  let now=slides();
  assert.deepEqual(now[0].stages[0],{id:'draw',svgGroupIds:['track'],title:'Draw',body:'',afterMs:400,durationMs:1500,holdMs:350,trigger:'manual',easing:'ease-out'});
  assert.equal(now[0].stages[2].easing,'ease-in');
  assert.equal(now[0].stages[3].trigger,'auto');
  assert.equal(Object.hasOwn(now[0].stages[3],'holdMs'),false,'an emptied field is unset, not zero');
  assert.deepEqual({...now[1].stages[0],id:undefined,title:undefined,body:undefined},{id:undefined,title:undefined,body:undefined,afterMs:0,durationMs:800,trigger:'auto'});
  assert.deepEqual(motion(now[0]),kept,'saving keeps from and changes');

  // Reordering stages and slides, then duplicating, moves and copies them untouched.
  await stage(0,3,'part-up').click(); await saved();
  await page.click('[data-slide-index="0"] > header [data-slide-action="down"]'); await saved();
  await page.click('[data-slide-index="1"] > header [data-slide-action="duplicate"]'); await saved();
  now=slides();
  const reordered=[kept[0],kept[1],kept[3],kept[2]];
  assert.deepEqual(now.map(slide=>slide.title),['Plain','Moving','Moving (copy)']);
  assert.deepEqual(motion(now[1]),reordered,'reordering keeps from and changes');
  assert.deepEqual(motion(now[2]),reordered,'a duplicate carries the same from and changes');
  assert.deepEqual(now[2].stages.map(({id,...rest})=>rest),now[1].stages.map(({id,...rest})=>rest));

  await page.reload();
  await ready();
  assert.deepEqual(await shown(1,0),{trigger:'manual',afterMs:'400',durationMs:'1500',holdMs:'350',easing:'ease-out',motion:''});
  assert.deepEqual(await shown(2,2),{trigger:'auto',afterMs:'500',durationMs:'1000',holdMs:'',easing:'ease-in-out',motion:''});
  if (process.env.STORYBENCH_DECK_EVIDENCE) {
    mkdirSync(process.env.STORYBENCH_DECK_EVIDENCE, { recursive: true });
    await stage(1,1,'durationMs').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(process.env.STORYBENCH_DECK_EVIDENCE, 'slide-editor-motion-desktop.png') });
  }
  await page.setViewportSize({ width: 390, height: 1000 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'stage fields fit a narrow window');
  if (process.env.STORYBENCH_DECK_EVIDENCE) { await stage(1,1,'durationMs').scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(process.env.STORYBENCH_DECK_EVIDENCE, 'slide-editor-motion-390.png') }); }
  assert.deepEqual(errors,[]);
});

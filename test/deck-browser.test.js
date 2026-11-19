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

// Slides (spec #46): a slide's fields are in the slide editor, opened from its card in the slide list.
async function openEditor(page, index) {
  if (await page.locator('#slideEditor[open]').count()) await page.click('[data-editor-close]');
  const card = page.locator(`#deckSlides [data-slide-index="${index}"]`);
  if (!(await card.evaluate(node => node.classList.contains('is-open')))) await card.locator('.slide-card-summary').click();
  await card.locator('[data-slide-action="edit"]').click();
  await page.locator(`#slideEditor .deck-slide[data-slide-index="${index}"]`).waitFor();
}
// Opens one element card of the open slide (spec #46 'Element Cards'), unless it is open already.
async function openCard(page, key) {
  const card = page.locator(`#slideEditor [data-card="${key}"]`);
  if (!(await card.evaluate(node => node.open))) await card.locator('summary').click();
}

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
  await page.locator('#addSlide').waitFor();
  assert.equal(await page.locator('#addCard').isVisible(),false);
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
  await page.click('#addSlide');
  assert.equal((await added).status(),200);
  await page.waitForFunction(()=>document.querySelector('#saveState').textContent.startsWith('Saved'));
  await openEditor(page, 0);
  for (const key of ['title', 'body', 'more']) await openCard(page, key);
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
  await page.selectOption('#slideEditor [data-add-element]', 'step');
  assert.equal((await stagesSaved).status(),200);
  await page.waitForFunction(()=>document.querySelector('#saveState').textContent.startsWith('Saved'));
  const deck=app.store.listEpisodes().find(p=>p.kind==='deck');
  assert.equal(app.store.getDeck(deck.id).slides[0].title,'A clear opening');
  await page.reload();
  await page.locator('#deckSlides [data-slide-index="0"]').waitFor();
  assert.match(await page.locator('#deckSlides [data-slide-index="0"]').textContent(), /01\s*A clear opening\s*A small idea becomes a clear story\./, 'the card shows number, title and the body first line');
  await openEditor(page, 0);
  for (const key of ['body', 'more']) await openCard(page, key);
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
    assert.ok((await page.locator('#slideEditor [data-card="body"] [data-slide-field="body"]').boundingBox()).width >= (await page.locator('#slideEditor').boundingBox()).width * .75, 'Slide text has room to edit');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    if (process.env.STORYBENCH_DECK_EVIDENCE) await page.screenshot({ path: path.join(process.env.STORYBENCH_DECK_EVIDENCE, `ui-polish-r2-synthetic-deck-${width}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.click('[data-editor-close]');
  await page.click('#episodeRailToggle');
  await page.click(`#episodes [data-id="${video.id}"] [data-episode-select]`);
  assert.equal(await page.locator('#preview').isVisible(),true);
  assert.equal(await page.locator('#deckSlides').isVisible(),false);
  assert.equal(await page.locator('#productionReferencesLabel').textContent(), 'Episode references');
  assert.deepEqual(errors,[]);
});

// Spec #34 B11, under spec #46's step cards: a step's Starts, Wait before and Speed edit through presets;
// exact values, motion, easing, hold, start states and moves stay with the assistant and are shown (a
// Custom value, the read-only motion line), never rewritten. Saving, duplicating and reordering leave
// `from` and `changes` exactly as they were saved; unstarring the drawing drops what only its parts carried.
test('slide editor edits step timing by preset and keeps motion, from and changes', {timeout:30000}, async t => {
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
  const step=(slide,index)=>page.locator(`#slideEditor .deck-slide[data-slide-index="${slide}"] [data-part="stages"][data-part-index="${index}"]`);
  // The editor renders again once the library arrives; the drawing's candidate tile marks that render.
  const ready=()=>page.locator('#slideEditor [data-candidate-star]').first().waitFor({state:'attached'});
  await page.locator('#deckSlides [data-slide-index="0"]').waitFor();
  await openEditor(page,0);
  await ready();
  const saved=()=>page.waitForFunction(()=>document.querySelector('#saveState').textContent.startsWith('Saved'));
  const slides=()=>app.store.getDeck(deck.id).slides;
  const motion=slide=>slide.stages.map(({title,from,changes})=>({title,from,changes}));
  const kept=[{title:'Draw',from:undefined,changes:undefined},{title:'Arrive',from,changes:undefined},{title:'Travel',from:undefined,changes:travel},{title:'Settle',from:undefined,changes:settle}];
  const openStep=async(slide,index)=>{ if (!(await page.locator(`#slideEditor .deck-slide[data-slide-index="${slide}"]`).count())) await openEditor(page,slide);
    const card=step(slide,index).locator('details'); if (!(await card.evaluate(node=>node.open))) await card.locator('summary').click(); };
  // What a step card shows: the pressed preset of each row (or Custom with its value) and the motion line.
  const shown=async(slide,index)=>{ await openStep(slide,index);
    const row=key=>step(slide,index).locator(`[data-step-row="${key}"] [aria-pressed="true"]`).allTextContents();
    return { starts:await row('trigger'), wait:await row('afterMs'), speed:await row('durationMs'), motion:await step(slide,index).locator('[data-motion-line]').textContent() }; };
  assert.deepEqual(await shown(0,0),{starts:['After previous'],wait:['Short'],speed:['Custom 1 s'],motion:'Draws its strokes, at an even pace, then holds 0.2 s'});
  assert.deepEqual(await shown(0,1),{starts:['After previous'],wait:['None'],speed:['Fast'],motion:'Enters from its start state'});
  assert.deepEqual(await shown(0,3),{starts:['After previous'],wait:['Custom 0.5 s'],speed:['Custom 1 s'],motion:'Fades its parts in, easing in and out, moves 2 parts, then holds 0.25 s'});
  assert.deepEqual(await shown(1,0),{starts:['On click'],wait:['None'],speed:[],motion:'Fades in'});
  assert.match(await step(1,0).locator('[data-step-row="durationMs"]').textContent(),/Standard/,'an unset speed is the standard fade');

  // Each preset writes its exact value and saves; nothing else on the step changes.
  const choose=async(slide,index,key,label)=>{ await openStep(slide,index); await step(slide,index).locator(`[data-step-row="${key}"]`).getByRole('button',{name:label,exact:true}).click(); await saved(); };
  await openEditor(page,0);
  await choose(0,0,'durationMs','Slow'); await choose(0,0,'afterMs','Long'); await choose(0,0,'trigger','On click');
  await choose(0,2,'durationMs','Fast');
  await page.click('[data-editor-nav="1"]'); await page.locator('#slideEditor .deck-slide[data-slide-index="1"]').waitFor();
  await choose(1,0,'trigger','After previous'); await choose(1,0,'durationMs','Medium');
  let now=slides();
  assert.deepEqual(now[0].stages[0],{id:'draw',svgGroupIds:['track'],title:'Draw',body:'',afterMs:2500,durationMs:1600,holdMs:200,trigger:'manual',easing:'linear',motion:'draw'});
  assert.equal(now[0].stages[2].durationMs,400);
  assert.deepEqual({...now[1].stages[0],id:undefined,title:undefined,body:undefined},{id:undefined,title:undefined,body:undefined,durationMs:800,trigger:'auto'});
  assert.deepEqual(motion(now[0]),kept,'saving keeps from and changes');

  // Reordering stages and slides, then duplicating, moves and copies them untouched.
  await page.click('[data-editor-nav="-1"]'); await page.locator('#slideEditor .deck-slide[data-slide-index="0"]').waitFor();
  await openStep(0,3);
  await step(0,3).getByRole('button',{name:'Move step 4 earlier'}).click(); await saved();
  await page.click('[data-editor-close]');
  await page.click('#deckSlides [data-slide-index="0"] [data-slide-action="down"]'); await saved();
  await page.click('#deckSlides [data-slide-index="1"] [data-slide-action="duplicate"]'); await saved();
  now=slides();
  const reordered=[kept[0],kept[1],kept[3],kept[2]];
  assert.deepEqual(now.map(slide=>slide.title),['Plain','Moving','Moving (copy)']);
  assert.deepEqual(motion(now[1]),reordered,'reordering keeps from and changes');
  assert.deepEqual(motion(now[2]),reordered,'a duplicate carries the same from and changes');
  assert.deepEqual(now[2].stages.map(({id,...rest})=>rest),now[1].stages.map(({id,...rest})=>rest));

  // Unstarring the drawing drops what only its parts can carry, so the slide still saves; timing stays and
  // the drawing stays a candidate.
  await openEditor(page,2);
  await openCard(page,'visual');
  await page.click(`#slideEditor [data-candidate-star="${art.id}"]`); await saved();
  now=slides();
  assert.equal(now[2].vector,undefined);
  assert.deepEqual(now[2].candidates,[{itemId:art.id,alt:'A track and a dot'}]);
  assert.deepEqual(now[2].stages.map(({id,body,...rest})=>rest),[
    {title:'Draw',afterMs:2500,durationMs:1600,holdMs:200,trigger:'manual',easing:'linear'},
    {title:'Arrive',afterMs:0,durationMs:400,trigger:'auto'},
    {title:'Settle',afterMs:500,durationMs:1000,holdMs:250,easing:'ease-in-out'},
    {title:'Travel',afterMs:0,durationMs:400,trigger:'auto',easing:'linear'}]);
  assert.deepEqual(motion(now[1]),reordered,'the slide that kept its SVG is untouched');

  await page.reload();
  await page.locator('#deckSlides [data-slide-index="1"]').waitFor();
  await openEditor(page,1);
  await ready();
  assert.deepEqual(await shown(1,0),{starts:['On click'],wait:['Long'],speed:['Slow'],motion:'Draws its strokes, at an even pace, then holds 0.2 s'});
  assert.deepEqual(await shown(2,2),{starts:['After previous'],wait:['Custom 0.5 s'],speed:['Custom 1 s'],motion:'Fades in, easing in and out, then holds 0.25 s'});
  if (process.env.STORYBENCH_DECK_EVIDENCE) {
    mkdirSync(process.env.STORYBENCH_DECK_EVIDENCE, { recursive: true });
    await openEditor(page,1);
    await openStep(1,1);
    await step(1,1).scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(process.env.STORYBENCH_DECK_EVIDENCE, 'slide-editor-motion-desktop.png') });
  }
  await page.setViewportSize({ width: 390, height: 1000 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'stage fields fit a narrow window');
  if (process.env.STORYBENCH_DECK_EVIDENCE) { await step(1,1).scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(process.env.STORYBENCH_DECK_EVIDENCE, 'slide-editor-motion-390.png') }); }
  assert.deepEqual(errors,[]);
});

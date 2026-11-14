import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, symlink, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Store } from '../src/store.js';
import { createDeckService } from '../src/deck-service.js';
import { HeavyJobQueue } from '../src/job-runner.js';
import { createApp } from '../src/server.js';
import { listDraftCleanup } from '../src/services/outputs.js';
const slides = [{id:'opening',title:'Hello <script>',layout:'statement',body:'Offline',notes:'Pause'}];
async function fixture(t) {
 const root = await mkdtemp(path.join(os.tmpdir(),'sb-build-')), store = new Store(root), decks = createDeckService({store});
 t.after(async()=>{await decks.close();store.close();await rm(root,{recursive:true,force:true});});
 const deck = store.createEpisode({kind:'deck',title:'Synthetic'}); store.saveDeck(deck.id,1,slides);
 return {root,store,decks,id:deck.id};
}
async function terminal(decks,id,job) {
 for(let n=0;n<200;n++) { const value=decks.getJob(id,job.id); if(!['queued','running'].includes(value.state)) return value; await new Promise(r=>setTimeout(r,5)); }
 throw new Error('build timed out');
}
test('saved revision publishes atomic portable files and ZIP; failures preserve previous success and cleanup excludes deck',async t=>{
 const {root,store,decks,id}=await fixture(t);
 assert.throws(()=>decks.enqueue({episodeId:id,expectedRevision:1}),/Stale/);
 assert.throws(()=>decks.enqueue({episodeId:store.createEpisode().id,expectedRevision:1}),/requires a deck/);
 const job=await terminal(decks,id,decks.enqueue({episodeId:id,expectedRevision:2}));
 assert.equal(job.state,'completed',job.error);
 const base=path.dirname(path.join(root,job.outputPath));
 for(const file of job.snapshot.manifest.files) assert.ok((await readFile(path.join(base,file))).length);
 const html=await readFile(path.join(base,'index.html'),'utf8'); assert.match(html,/Hello &lt;script&gt;/); assert.doesNotMatch(html,/<script>Hello/);
 const zip=await readFile(path.join(base,'bundle.zip')); assert.equal(zip.readUInt32LE(),0x04034b50);
 let at=0; for(const name of job.snapshot.manifest.files) {
  assert.equal(zip.readUInt32LE(at),0x04034b50); const size=zip.readUInt32LE(at+18),length=zip.readUInt16LE(at+26);
  assert.equal(zip.subarray(at+30,at+30+length).toString(),name);
  assert.deepEqual(zip.subarray(at+30+length,at+30+length+size),await readFile(path.join(base,name)));at+=30+length+size;
 }
 assert.deepEqual(await listDraftCleanup(store,id),[]);
 store.saveDeck(id,2,[{...slides[0],layout:'text-media'}]);
 const failed=await terminal(decks,id,decks.enqueue({episodeId:id,expectedRevision:3})); assert.equal(failed.state,'failed'); assert.equal(store.getJob(job.id).state,'completed'); assert.ok((await readFile(path.join(base,'index.html'))).length);
});
test('missing and symlink media fail before publication with a slide diagnostic',async t=>{
 const {root,store,decks,id}=await fixture(t); await mkdir(path.join(root,'media'),{recursive:true});
 const asset=store.saveAsset({name:'missing.png',kind:'image',path:'media/missing.png',hash:'missing'}), item=store.attachLibraryItem(id,asset.id,{category:'B-roll'});
 store.saveDeck(id,2,[{...slides[0],layout:'text-media',media:{itemId:item.id,alt:'Missing'}}]);
 const failed=await terminal(decks,id,decks.enqueue({episodeId:id,expectedRevision:3})); assert.equal(failed.state,'failed');assert.equal(failed.outputPath,null);
 await writeFile(path.join(root,'real.png'),'image'); await symlink(path.join(root,'real.png'),path.join(root,'media/missing.png'));
 const unsafe=await terminal(decks,id,decks.enqueue({episodeId:id,expectedRevision:3})); assert.equal(unsafe.state,'failed');assert.match(unsafe.error,/unsafe media/);
});
test('active and queued cancellation leave no completed partial output',async t=>{
 const {store,id}=await fixture(t), queue=new HeavyJobQueue(), decks=createDeckService({store,queue}); t.after(()=>decks.close());
 let release; const gate=new Promise(r=>release=r); queue.enqueue('block',()=>gate);
 const queued=decks.enqueue({episodeId:id,expectedRevision:2}); decks.cancelJob(id,queued.id);assert.equal(store.getJob(queued.id).state,'cancelled');release();
 const active=decks.enqueue({episodeId:id,expectedRevision:2});decks.cancelJob(id,active.id);const done=await terminal(decks,id,active);assert.equal(done.state,'cancelled');assert.equal(done.outputPath,null);
});
test('HTTP build dispatch is production scoped, preview is opaque sandbox and ZIP is downloadable',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'sb-deck-http-')),app=await createApp({workspace:root});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(async()=>{await app.close();await rm(root,{recursive:true,force:true});});
 const base=`http://127.0.0.1:${app.server.address().port}`, deck=app.store.createEpisode({kind:'deck'});app.store.saveDeck(deck.id,1,slides);
 const response=await fetch(`${base}/api/episodes/${deck.id}/deck-build`,{method:'POST',body:JSON.stringify({expectedRevision:2,episodeId:'attacker'})});assert.equal(response.status,202);
 const job=await terminal(app.decks,deck.id,await response.json());assert.equal(job.state,'completed',job.error);
 const preview=await fetch(`${base}/api/jobs/${job.id}/deck/index.html`);assert.equal(preview.status,200);assert.match(preview.headers.get('content-security-policy'),/sandbox allow-scripts/);assert.doesNotMatch(preview.headers.get('content-security-policy'),/allow-same-origin/);
 const zip=await fetch(`${base}/api/jobs/${job.id}/deck/bundle.zip`);assert.match(zip.headers.get('content-disposition'),/attachment/);
 assert.equal((await fetch(`${base}/api/jobs/${job.id}/deck/not-in-manifest`)).status,404);
});

test('editable eight-slide demo: manual DOM edit, fake-agent bridge save/build, HTTP preview/ZIP, reopen and rebuild',async t=>{
 const { createDemo }=await import('../scripts/create-deck-demo.mjs');
 const { JSDOM }=await import('jsdom');
 const { deckBoardHTML,bindDeckBoard }=await import('../public/deck-workspace.js');
 const { startBridge }=await import('../src/runtime/bridge.js');
 const { mergeTools }=await import('../src/runtime/app-runtime.js');
 const { selectKindTools }=await import('../src/runtime/kinds.js');
 const { connect }=await import('node:net');
 const root=await mkdtemp(path.join(os.tmpdir(),'sb-author-'));
 let app; t.after(async()=>{await app?.close();await rm(root,{recursive:true,force:true});});
 const rpc=(socketPath,token,name,args)=>new Promise((resolve,reject)=>{
  const client=connect(socketPath);let bytes='';client.on('connect',()=>client.write(JSON.stringify({token,op:'tools/call',name,arguments:args})+'\n'));client.on('data',data=>bytes+=data);client.on('error',reject);client.on('end',()=>{try {const result=JSON.parse(bytes).result;if(result.isError) reject(new Error(result.content[0].text));else resolve(JSON.parse(result.content[0].text));}catch(error){reject(error);}});
 });
 let turn=0, agentError;
 const factory=async options=>({startThread:async()=> `thread_${turn+1}`,resumeThread:async id=> id,close(){},async startTurn(threadId){
  const turnId=`turn_${++turn}`;
  queueMicrotask(async()=>{
   let bridge;
   try {
    options.onEvent({method:'turn/started',params:{threadId,turn:{id:turnId}}});
    const socketPath=path.join(root,'fake-agent.sock'),token='d'.repeat(64);
    const tools=selectKindTools(mergeTools({definitions:[],call:async()=>{}},options.tools),'deck');
    bridge=await startBridge({socketPath,token,tools});
    const current=await rpc(socketPath,token,'read_deck',{});
    current.slides[1].body=`Agent revision ${turn}`;
    const saved=await rpc(socketPath,token,'save_deck',{expectedRevision:current.revision,slides:current.slides});
    await assert.rejects(rpc(socketPath,token,'save_deck',{expectedRevision:current.revision,slides:current.slides}),/Stale/);
    const job=await rpc(socketPath,token,'build_deck',{expectedRevision:saved.revision});
    const done=await rpc(socketPath,token,'await_job',{jobId:job.id,timeoutSeconds:5});assert.equal(done.state,'completed',done.error);
   } catch(error){agentError=error;} finally {await bridge?.close();options.onEvent({method:'turn/completed',params:{threadId,turn:{id:turnId,status:'completed'}}});}
  });return turnId;
 }});
 app=await createApp({workspace:root,chatOptions:{codexFactory:factory}});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r)); const base=`http://127.0.0.1:${app.server.address().port}`;
 const deck=await createDemo(app.store), slides=structuredClone(deck.slides);
 assert.equal(slides.length,8);assert.equal(new Set(slides.map(s=>s.layout)).size,7);
 const dom=new JSDOM('<main></main>'),board=dom.window.document.querySelector('main'); board.innerHTML=deckBoardHTML(slides,app.store.listEpisodeLibrary(deck.id),[]);
 bindDeckBoard(board,{getSlides:()=>slides,onDirty(){},onSave(){},render(){}});
 const notes=board.querySelector('[data-slide-field="notes"]');notes.value='Manual notes: welcome and pause.';notes.dispatchEvent(new dom.window.Event('input',{bubbles:true}));dom.window.close();
 const manual=await fetch(`${base}/api/episodes/${deck.id}/slides`,{method:'PUT',body:JSON.stringify({expectedRevision:deck.revision,slides})});assert.equal(manual.status,200);
 // All three production adapters use these same scoped handlers and MCP bridge;
 // runtime-kinds.test additionally proves native definitions/list filtering for each.
 for(const round of [1,2,3]) {
  const chat=app.chat.create(deck.id,{name:`Fake bridge round ${round}`});await app.chat.send(deck.id,chat.id,'Refine the explanation and build');
  for(let n=0;n<500 && app.chat.get(deck.id,chat.id).state!=='idle';n++) await new Promise(r=>setTimeout(r,10));
  if(agentError) throw agentError;assert.equal(app.chat.get(deck.id,chat.id).state,'idle',JSON.stringify(app.chat.get(deck.id,chat.id))); 
 }
 const job=app.store.listJobs(deck.id).find(j=>j.state==='completed');assert.ok(job);
 const html=await (await fetch(`${base}/api/jobs/${job.id}/deck/index.html`)).text(),page=new JSDOM(html);
 assert.equal(page.window.document.querySelectorAll('.slide').length,8);assert.equal(page.window.document.querySelectorAll('[data-step]').length,4);assert.equal(page.window.document.querySelectorAll('[data-gallery]').length,2);assert.ok(page.window.document.querySelector('video'));assert.match(html,/Manual notes/);page.window.close();
 assert.ok(job.snapshot.manifest.files.some(f=>f.endsWith('.webm')));assert.ok(job.snapshot.manifest.files.some(f=>f.endsWith('.png')));
 await app.close();app=null;
 const reopened=new Store(root),decks=createDeckService({store:reopened});
 try {
  const current=reopened.getDeck(deck.id);assert.equal(current.slides[1].body,'Agent revision 3');
  current.slides[7].body='A new question after reopening';const saved=reopened.saveDeck(deck.id,current.revision,current.slides);
  const rebuilt=await terminal(decks,deck.id,decks.enqueue({episodeId:deck.id,expectedRevision:saved.revision}));assert.equal(rebuilt.state,'completed',rebuilt.error);assert.notEqual(rebuilt.id,job.id);
 } finally {await decks.close();reopened.close();}
});

test('built demo presenter targets the selected gallery view and pauses hidden or background playback', async t => {
 const { createDemo } = await import('../scripts/create-deck-demo.mjs');
 const { JSDOM } = await import('jsdom');
 const { root, store, decks } = await fixture(t);
 const deck = await createDemo(store);
 // A second video view catches implementations that always target the first video.
 deck.slides[6].subnav.push({ id: 'motion-two', label: 'Second motion', itemId: deck.slides[6].subnav[1].itemId });
 const saved = store.saveDeck(deck.id, deck.revision, deck.slides);
 const job = await terminal(decks, deck.id, decks.enqueue({ episodeId: deck.id, expectedRevision: saved.revision }));
 assert.equal(job.state, 'completed', job.error);
 const base = path.dirname(path.join(root, job.outputPath));
 const dom = new JSDOM(await readFile(path.join(base, 'index.html'), 'utf8'), {
  url: 'file:///export/index.html#demo', runScripts: 'outside-only', pretendToBeVisual: true,
 });
 t.after(() => dom.window.close());
 const w = dom.window, d = w.document, sent = [];
 let hidden = false, channel;
 Object.defineProperty(d, 'hidden', { get: () => hidden });
 w.matchMedia = () => ({ matches: false, addEventListener() {} });
 w.HTMLMediaElement.prototype.pause = function () { this.playing = false; };
 w.HTMLMediaElement.prototype.play = function () { this.playing = true; this.plays++; return Promise.resolve(); };
 const videos = [...d.querySelectorAll('#demo video')];
 assert.equal(videos.length, 2);
 videos.forEach(video => {
  video.plays = 0;
  Object.defineProperty(video, 'paused', { get: () => !video.playing });
 });
 const popup = { closed: false, postMessage: data => sent.push(data) };
 w.open = url => { channel = new URL(url).hash.slice(1); return popup; };
 w.eval(await readFile(path.join(base, 'audience.js'), 'utf8'));
 d.getElementById('presenter-open').click();
 const command = name => w.dispatchEvent(new w.MessageEvent('message', {
  source: popup, data: { type: 'deck-command', channel, command: name },
 }));
 const select = n => d.querySelector(`#demo [data-gallery="${n}"]`).click();
 const flush = () => new Promise(setImmediate);
 const state = () => sent.at(-1).state.video;

 select(0);
 for (const name of ['video-toggle', 'video-restart']) command(name);
 await flush();
 assert.equal(state(), null);
 assert.deepEqual(videos.map(video => video.plays), [0, 0]);

 select(1); assert.equal(state().paused, true);
 command('video-toggle'); await flush();
 assert.equal(videos[0].playing, true); assert.equal(state().paused, false);
 command('video-toggle'); assert.equal(videos[0].playing, false);
 videos[0].currentTime = 12;
 command('video-restart'); await flush();
 assert.equal(videos[0].currentTime, 0); assert.equal(videos[0].playing, true);
 select(2);
 assert.equal(videos[0].playing, false); assert.equal(state().paused, true);
 command('video-toggle'); await flush();
 assert.equal(videos[1].playing, true); assert.equal(videos[0].playing, false);
 assert.equal(state().paused, false);
 select(0); assert.equal(videos[1].playing, false); assert.equal(state(), null);

 // Switching views before the deferred play starts must not start hidden media.
 select(1); const plays = videos[0].plays;
 command('video-toggle'); select(0); await flush();
 assert.equal(videos[0].plays, plays);
 // A browser play promise can also resolve after the view has changed.
 let resolvePlay;
 videos[0].play = () => new Promise(resolve => { resolvePlay = () => { videos[0].playing = true; resolve(); }; });
 select(1); command('video-toggle'); await Promise.resolve();
 select(0); resolvePlay(); await flush();
 assert.equal(videos[0].playing, false); assert.equal(state(), null);

 select(2); command('video-toggle'); await flush();
 command('next'); assert.equal(videos[1].playing, false);
 command('video-toggle'); await flush(); assert.equal(state(), null);
 command('previous'); assert.equal(state().paused, true);
 command('video-toggle'); await flush();
 hidden = true; d.dispatchEvent(new w.Event('visibilitychange'));
 assert.equal(videos[1].playing, false);
 command('video-toggle'); await flush(); assert.equal(videos[1].playing, false);
 hidden = false; d.dispatchEvent(new w.Event('visibilitychange'));
 command('video-toggle'); await flush();
 w.dispatchEvent(new w.Event('pagehide')); assert.equal(videos[1].playing, false);
});

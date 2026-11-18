import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, mkdir, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { smokeBrowser, browserFixture } from '../src/runtime/browser-check.js';
import { createScopedTools } from '../src/runtime/tools.js';
import { selectKindTools } from '../src/runtime/kinds.js';
import { unpackDeckZip, extractBuild } from '../src/deck-qa-bundle.js';
import { zipBundle } from '../src/deck-service.js';
import { describeCapabilities, IMAGE_ROUTE_PROOF } from '../src/runtime/capabilities.js';

// Required production QA proof: missing browser is a failure, never a skip.
test('packaged deck QA operates through each native MCP route with real images/media/presenter', {timeout:90000}, async()=>{
  const result=await smokeBrowser();assert.equal(Object.keys(result.routes).length,3);
});

test('QA binds immutable builds, filters image tools, rejects foreign sessions and cleans up request cancellation', {timeout:30000}, async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'sb-qa-negative-'));let f;
  t.after(async()=>{await f?.close();await rm(root,{recursive:true,force:true});});
  f=await browserFixture(root);
  const scoped=createScopedTools(f.scope('codex'),{store:f.store}),other=createScopedTools({...f.scope('claude'),requestId:'other'},{store:f.store});
  t.after(()=>Promise.all([scoped.close(),other.close()]));
  const tools=selectKindTools(scoped,'deck'),textTools=selectKindTools(scoped,'deck',{supportsImages:false});
  assert.ok(!textTools.definitions.some(d=>d.name==='inspect_deck_qa'));
  await assert.rejects(textTools.call('inspect_deck_qa',{}),/unavailable/);
  const video=selectKindTools(scoped,'video');assert.ok(!video.definitions.some(d=>d.name==='open_deck_qa'));
  const capabilities=describeCapabilities({scope:f.scope('codex'),served:tools.definitions,release:{tools:{codex:IMAGE_ROUTE_PROOF.codex.version}}});
  assert.equal(capabilities.imageInput.verified,false);assert.match(capabilities.imageInput.reason,/legacy/);
  const foreign=f.store.createEpisode({kind:'deck',title:'Another production'});
  const foreignTools=createScopedTools({...f.scope('codex'),episodeId:foreign.id},{store:f.store});
  await assert.rejects(foreignTools.call('open_deck_qa',{jobId:f.job.id}),/belonging to this deck/);
  await foreignTools.close();
  const data=async(name,args)=>JSON.parse((await tools.call(name,args)).text);
  const opened=await data('open_deck_qa',{jobId:f.job.id});const sessionId=opened.sessionId;
  await assert.rejects(other.call('inspect_deck_qa',{sessionId}),/another request/);
  await assert.rejects(tools.call('act_deck_qa',{sessionId,action:'goto',url:'file:///etc/passwd'}),/Unsupported/);
  await assert.rejects(tools.call('act_deck_qa',{sessionId,action:'wait',milliseconds:999999}),/0–2000/);
  await assert.rejects(tools.call('inspect_deck_qa',{sessionId,clip:{x:-1,y:0,width:100,height:100}}),/inside the viewport/);
  const shot=JSON.parse((await tools.call('inspect_deck_qa',{sessionId})).text);
  const file=path.join(root,opened.artifactRoot,shot.screenshots[0].file);assert.ok((await readFile(file)).length>1000);
  // A direct app result is NOT evidence that a model received the screenshot.
  await scoped.close();
  const record=JSON.parse(await readFile(path.join(root,opened.artifactRoot,'session.json'),'utf8'));
  assert.equal(record.lifecycle,'request-ended');assert.equal(record.qaStatus,'incomplete');assert.equal(record.screenshots[0].delivered,false);
  await assert.rejects(scoped.call('open_deck_qa',{jobId:f.job.id}),/ended/);
  const bundle=path.join(root,f.job.outputPath),bytes=await readFile(bundle);await writeFile(bundle,Buffer.concat([bytes,Buffer.from('changed')]));
  const fresh=createScopedTools(f.scope('codex'),{store:f.store});t.after(()=>fresh.close());
  await assert.rejects(fresh.call('open_deck_qa',{jobId:f.job.id}),/changed since build/);
  await writeFile(bundle,bytes);

  const beforeTemps=(await readdir(os.tmpdir())).filter(n=>n.startsWith('storybench-qa-'));
  const cancelled=createScopedTools(f.scope('codex'),{store:f.store});
  const opening=cancelled.call('open_deck_qa',{jobId:f.job.id});
  const rejected=assert.rejects(opening,/ended|closed/);
  await cancelled.close();await rejected;
  assert.deepEqual((await readdir(os.tmpdir())).filter(n=>n.startsWith('storybench-qa-')).sort(),beforeTemps.sort(),'cancel during startup removes extraction/profile');
  const temp=path.join(root,'extracted');await mkdir(temp);await extractBuild(f.store,f.episode.id,f.job.id,temp);
  assert.deepEqual(await readFile(path.join(temp,'index.html')),unpackDeckZip(bytes).get('index.html'));
  for(const name of ['../escape','/absolute','assets/../../escape','a\\b']) {
    const bad=new Map([['index.html','x'],['presenter.html','x'],['manifest.json','{}'],[name,'escape']]);
    assert.throws(()=>unpackDeckZip(zipBundle(bad)),/unsafe/);
  }
});

test('browser blocks outside destinations and records network errors without returning host content', {timeout:20000}, async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'sb-qa-boundary-'));let f,scoped;
  t.after(async()=>{await scoped?.close();await f?.close();await rm(root,{recursive:true,force:true});});
  f=await browserFixture(root);
  const file=path.join(root,f.job.outputPath),files=unpackDeckZip(await readFile(file));
  // Fault-injection only: emulate a compromised exporter, rebind its stored hash.
  files.set('index.html',Buffer.from('<html><body><a id="outside" href="file:///etc/passwd">outside</a><img src="http://127.0.0.1:8872/private"><script>fetch("https://example.invalid/private").catch(()=>{})</script></body></html>'));
  const bytes=zipBundle(files);await writeFile(file,bytes);
  const injected=Object.create(f.store);injected.getJob=()=>({...f.job,snapshot:{...f.job.snapshot,bundleSha256:createHash('sha256').update(bytes).digest('hex')}});
  scoped=createScopedTools(f.scope('codex'),{store:injected});
  const opened=JSON.parse((await scoped.call('open_deck_qa',{jobId:f.job.id})).text),sessionId=opened.sessionId;
  const result=JSON.parse((await scoped.call('check_deck_qa',{sessionId,checks:['resources']})).text);
  assert.equal(result.results.resources.status,'fail');assert.ok(result.results.resources.details.errors.some(e=>e.type==='blocked-resource'));
  await assert.rejects(scoped.call('act_deck_qa',{sessionId,action:'click',selector:'#outside'}),/closed|destroyed|navigation/);
  await assert.rejects(scoped.call('inspect_deck_qa',{sessionId}),/closed|unknown/);
});

test('a QA session is still open after ten minutes and expires at fifteen, as open_deck_qa reports and describes', {timeout:30000}, async t=>{
  const { QA_LIMITS } = await import('../src/deck-qa.js'), { DECK_QA_DEFINITIONS } = await import('../src/deck-qa-tools.js');
  assert.equal(QA_LIMITS.lifetimeMs,900_000);
  assert.match(DECK_QA_DEFINITIONS.find(d=>d.name==='open_deck_qa').description,/fifteen minute lifetime/);
  const root=await mkdtemp(path.join(os.tmpdir(),'sb-qa-lifetime-'));let f,scoped;
  t.after(async()=>{await scoped?.close();await f?.close();await rm(root,{recursive:true,force:true});});
  f=await browserFixture(root);scoped=createScopedTools(f.scope('codex'),{store:f.store});
  // Controlled clock for minute-scale timers only; browser and operation timeouts stay real.
  const realSet=globalThis.setTimeout,realClear=globalThis.clearTimeout,pending=new Set();let now=0;
  globalThis.setTimeout=(fn,ms,...args)=>{
    if(ms<60_000) return realSet(fn,ms,...args);
    const timer={at:now+ms,fn:()=>fn(...args),unref(){return timer;},ref(){return timer;}};pending.add(timer);return timer;
  };
  globalThis.clearTimeout=timer=>pending.has(timer)?pending.delete(timer):realClear(timer);
  t.after(()=>{globalThis.setTimeout=realSet;globalThis.clearTimeout=realClear;});
  const advance=ms=>{now+=ms;for(const timer of [...pending]) if(timer.at<=now){pending.delete(timer);timer.fn();}};
  const opened=JSON.parse((await scoped.call('open_deck_qa',{jobId:f.job.id})).text),sessionId=opened.sessionId;
  assert.equal(opened.limits.lifetimeMs,900000);assert.equal(pending.size,1);
  const lifecycle=async()=>JSON.parse(await readFile(path.join(root,opened.artifactRoot,'session.json'),'utf8')).lifecycle;
  advance(600_000);
  assert.ok(JSON.parse((await scoped.call('check_deck_qa',{sessionId,checks:['console']})).text).results.console,'usable at ten minutes');
  assert.equal(await lifecycle(),'open');
  advance(299_999);assert.equal(pending.size,1,'still open just before fifteen minutes');
  advance(1);assert.equal(pending.size,0);
  for(let n=0;n<200 && await lifecycle()!=='expired';n++) await new Promise(resolve=>realSet(resolve,25));
  assert.equal(await lifecycle(),'expired');
  await assert.rejects(scoped.call('inspect_deck_qa',{sessionId}),/closed, expired/);
});

// Spec #34 Motion QA, beyond the three-route proof in browser-check.js.
test('motion QA refuses malformed requests, counts every frame, and reports rather than passes what it cannot observe', {timeout:90000}, async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'sb-qa-motion-'));let f,scoped;
  t.after(async()=>{await scoped?.close();await f?.close();await rm(root,{recursive:true,force:true});});
  f=await browserFixture(root);scoped=createScopedTools(f.scope('codex'),{store:f.store});
  const data=async(name,args)=>JSON.parse((await scoped.call(name,args)).text);
  const opened=await data('open_deck_qa',{jobId:f.job.id,viewport:{width:640,height:360}}),sessionId=opened.sessionId;
  const session=async()=>JSON.parse(await readFile(path.join(root,opened.artifactRoot,'session.json'),'utf8'));
  // A slide without stages still reports a timeline, and has nothing to seek into.
  assert.deepEqual(opened.state.timeline.stages,[]);assert.equal(opened.state.timeline.state,'complete');
  await assert.rejects(scoped.call('act_deck_qa',{sessionId,action:'seek',timeMs:1}),/0–0 ms/);
  await data('act_deck_qa',{sessionId,action:'click',selector:'[data-go="5"]'});
  for(const frames of [{},{timesMs:[]},{timesMs:[0,'1']},{timesMs:[-1]},{timesMs:[0],count:2},{fromMs:0,toMs:2000},{fromMs:0,toMs:2000,count:1},
    {fromMs:0,toMs:2000,count:9},{fromMs:500,toMs:500,count:2},{fromMs:0,toMs:2001,count:2}])
    await assert.rejects(scoped.call('inspect_deck_qa',{sessionId,frames}),/Frames take timesMs/,JSON.stringify(frames));
  await assert.rejects(scoped.call('inspect_deck_qa',{sessionId,frames:{timesMs:[0]},clip:{x:0,y:0,width:10,height:10}}),/without a crop/);
  await assert.rejects(scoped.call('inspect_deck_qa',{sessionId,frames:{timesMs:[0]},slideIds:['motion']}),/omit slideIds/);
  for(const timeMs of [-1,'500',NaN]) await assert.rejects(scoped.call('act_deck_qa',{sessionId,action:'seek',timeMs}),/Seek time must be/);
  assert.equal((await session()).screenshots.length,0,'a refused request captures nothing');
  // Frames are screenshots: each counts toward the session limit, and a batch that would pass it is refused whole.
  const first=await data('inspect_deck_qa',{sessionId,frames:{timesMs:[500,1500]}});
  assert.equal(first.screenshots.length,2);
  let record=await session();
  assert.equal(record.screenshots.length,2);assert.equal(record.filmstrips.length,1);
  assert.deepEqual(record.screenshots.map(s=>[s.frame.timeMs,s.fullResolutionDelivered]),[[500,false],[1500,false]]);
  for(const frame of record.screenshots) assert.ok((await readFile(path.join(root,opened.artifactRoot,frame.file))).length>1000,'each frame keeps its own full-resolution artifact');
  for(let n=0;n<14;n++) await data('inspect_deck_qa',{sessionId,frames:{fromMs:0,toMs:2000,count:8}});
  await assert.rejects(scoped.call('inspect_deck_qa',{sessionId,frames:{fromMs:0,toMs:2000,count:8}}),/Screenshot batch limit/);
  record=await session();assert.equal(record.screenshots.length,114);assert.equal(record.filmstrips.length,15);
  // Print and reduced motion show the final state: the check says so instead of timing nothing.
  await data('act_deck_qa',{sessionId,action:'emulate',reducedMotion:'reduce'});
  const reduced=(await data('check_deck_qa',{sessionId,checks:['motion']})).results.motion;
  assert.equal(reduced.status,'unverified');assert.match(reduced.reason,/reduced motion/);
  await data('act_deck_qa',{sessionId,action:'emulate'});
  // Presenter reads the audience's timeline, and a stage that waits for a person is reported as such.
  await data('act_deck_qa',{sessionId,action:'click',selector:'[data-go="1"]'});
  await data('act_deck_qa',{sessionId,action:'click',selector:'#presenter-open'});
  await data('act_deck_qa',{sessionId,action:'wait',milliseconds:150});
  const sought=(await data('act_deck_qa',{sessionId,pageId:'presenter-1',action:'seek',timeMs:300})).state;
  assert.equal(sought.pageId,'presenter-1');assert.equal(sought.timeline.slideId,'stages');assert.equal(sought.timeline.timeMs,300);
  assert.equal((await data('check_deck_qa',{sessionId})).results.motion,undefined,'the default check set does not replay the slide');
});

test('the motion check restarts a one-slide deck through Replay and never passes a stage that waits for a person', {timeout:60000}, async t=>{
  const { Store } = await import('../src/store.js'), { createDeckService } = await import('../src/deck-service.js'), { HeavyJobQueue } = await import('../src/job-runner.js');
  const root=await mkdtemp(path.join(os.tmpdir(),'sb-qa-solo-'));
  const store=new Store(root),episode=store.createEpisode({kind:'deck',title:'One slide'});store.ensureEpisodeDirectories(episode.id);
  const queue=new HeavyJobQueue(),decks=createDeckService({store,queue});let scoped;
  t.after(async()=>{await scoped?.close();await decks.close();store.close();await rm(root,{recursive:true,force:true});});
  const saved=store.saveDeck(episode.id,1,[{id:'solo',title:'Three beats',layout:'statement',stages:[
    {id:'one',title:'One',trigger:'auto',afterMs:300},{id:'two',title:'Two',trigger:'auto',afterMs:0,durationMs:300},{id:'three',title:'Three',trigger:'manual'},{id:'four',title:'Four',trigger:'auto',afterMs:100}]}]);
  const pending=decks.enqueue({episodeId:episode.id,expectedRevision:saved.revision});await queue.draining;
  const job=decks.getJob(episode.id,pending.id);assert.equal(job.state,'completed',job.error);
  scoped=createScopedTools({episodeId:episode.id,channelId:episode.channelId,requestId:'solo',conversationId:'solo',harness:'codex',model:'fixture',dataRoot:root,
    episodeDir:store.episodeDirectory(episode.id),workDir:store.episodeWorkDirectory(episode.id)},{store});
  const data=async(name,args)=>JSON.parse((await scoped.call(name,args)).text);
  const sessionId=(await data('open_deck_qa',{jobId:job.id})).sessionId;
  const motion=(await data('check_deck_qa',{sessionId,checks:['motion']})).results.motion;
  assert.equal(motion.status,'pass',JSON.stringify(motion));
  assert.deepEqual(motion.details.stages.map(row=>[row.id,row.savedStartMs,row.status]),[['one',300,'on-time'],['two',300,'on-time'],['three',750,'manual'],['four',850,'manual']]);
  for(const row of motion.details.stages.slice(0,2)) assert.ok(Math.abs(row.deltaMs)<=250 && row.observedStartMs>=250,JSON.stringify(row));
  for(const row of motion.details.stages.slice(2)) assert.equal(row.observedStartMs,null);
  assert.deepEqual(motion.details.reentry,{method:'replay',stillWhileAway:null,restarted:true,ahead:false});
  assert.match(motion.reason,/2 waiting for a person/);
});

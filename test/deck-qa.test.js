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

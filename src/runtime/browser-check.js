// Non-skipping exact-image browser/bridge proof. No provider credentials or calls.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import { Store } from '../store.js';
import { createLibraryService } from '../library.js';
import { createDeckService } from '../deck-service.js';
import { HeavyJobQueue } from '../job-runner.js';
import { createScopedTools } from './tools.js';
import { selectKindTools } from './kinds.js';
import { startBridge } from './bridge.js';
import { runChecked } from './image-check.js';
import { BROWSER_IDENTITY } from '../deck-qa.js';

export async function browserFixture(root) {
  const store=new Store(root),episode=store.createEpisode({kind:'deck',title:'Packaged browser proof'});
  store.ensureEpisodeDirectories(episode.id);
  const library=createLibraryService({workspace:root,store});
  const source=await readFile(new URL('./fixtures/svg-illustration.svg',import.meta.url));
  const svg=await library.registerFile({episodeId:episode.id,readable:Readable.from(source),fileName:'diagram.svg',selectedCategory:'Graphics'});
  const media=[];
  for(const extension of ['mp4','webm']) {
    const file=path.join(root,`sample.${extension}`);
    runChecked('ffmpeg',['-v','error','-f','lavfi','-i','testsrc2=size=160x90:rate=10','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','3',
      '-c:v',extension==='mp4'?'libx264':'libvpx','-threads','1','-pix_fmt','yuv420p','-c:a',extension==='mp4'?'aac':'libvorbis',file]);
    media.push(await library.registerFile({episodeId:episode.id,readable:Readable.from(await readFile(file)),fileName:`sample.${extension}`,selectedCategory:'B-roll'}));
  }
  const saved=store.saveDeck(episode.id,1,[
    {id:'opening',title:'A local plan',body:'Vector illustration with bundled fonts.',layout:'full-media',media:{itemId:svg.id},notes:'Private presenter notes'},
    {id:'stages',title:'Observe, connect, plan',layout:'process',vector:{itemId:svg.id},notes:'Three steps',stages:['observe','connect','plan'].map(id=>({id,title:id,svgGroupIds:[id],afterMs:200}))},
    ...media.map((m,i)=>({id:`video-${i}`,title:i?'WebM playback':'MP4 playback',layout:'full-media',media:{itemId:m.id},notes:'Start playback from Presenter'})),
    {id:'video-reused',title:'Reused MP4 playback',layout:'full-media',media:{itemId:media[0].id},notes:'Independent playback of the same asset'},
    {id:'gallery',title:'Compare views',layout:'statement',subnav:[{id:'first',label:'First',itemId:svg.id},{id:'second',label:'Second',itemId:svg.id}],notes:'Compare two views'},
  ]);
  const queue=new HeavyJobQueue(),decks=createDeckService({store,queue});
  const pending=decks.enqueue({episodeId:episode.id,expectedRevision:saved.revision});await queue.draining;
  const job=decks.getJob(episode.id,pending.id);assert.equal(job.state,'completed',job.error);
  const scope=harness=>({episodeId:episode.id,channelId:episode.channelId,requestId:`qa-${harness}`,conversationId:`qa-${harness}`,harness,model:'automated-fixture',dataRoot:root,episodeDir:store.episodeDirectory(episode.id),workDir:store.episodeWorkDirectory(episode.id)});
  return {store,episode,job,scope,async close(){await decks.close();store.close();}};
}

// Scripted native MCP client exercises the same subprocess and socket used by all
// three harnesses. This proves image-block delivery, not live model interpretation.
export async function bridgeClient(root, scoped, harness) {
  const tools=selectKindTools(scoped,'deck'),socketPath=path.join(root,`${harness}.sock`),token=randomBytes(32).toString('hex');
  const bridge=await startBridge({socketPath,token,tools});
  const child=spawn(process.execPath,[fileURLToPath(new URL('./worker/mcp-bridge.mjs',import.meta.url))],{
    env:{PATH:process.env.PATH,STORYBENCH_BRIDGE_SOCKET:socketPath,STORYBENCH_BRIDGE_TOKEN:token},stdio:['pipe','pipe','pipe']});
  let sequence=0;const pending=new Map();
  createInterface({input:child.stdout}).on('line',line=>{const reply=JSON.parse(line),p=pending.get(reply.id);if(!p)return;pending.delete(reply.id);clearTimeout(p.timer);reply.error?p.reject(new Error(reply.error.message)):p.resolve(reply.result);});
  const rpc=(method,params)=>new Promise((resolve,reject)=>{
    const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(new Error(`MCP ${harness} ${method} timed out`));},30_000);
    pending.set(id,{resolve,reject,timer});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');
  });
  return {list:()=>rpc('tools/list'),async call(name,args){const result=await rpc('tools/call',{name,arguments:args});if(result.isError)throw new Error(result.content[0].text);return {data:JSON.parse(result.content[0].text),content:result.content};},
    async close(){await scoped.close();child.stdin.end();await new Promise(resolve=>child.once('exit',resolve));await bridge.close();}};
}

export async function smokeBrowser() {
  const root=await mkdtemp(path.join(os.tmpdir(),'sb-browser-check-'));let fixture;
  try {
    fixture=await browserFixture(root);const routes={};let schemas;
    for(const harness of ['codex','claude','opencode']) {
      const scoped=createScopedTools(fixture.scope(harness),{store:fixture.store});
      const client=await bridgeClient(root,scoped,harness);
      try {
        const list=(await client.list()).tools;if(schemas)assert.deepEqual(list,schemas);else schemas=list;
        const opened=(await client.call('open_deck_qa',{jobId:fixture.job.id})).data,sessionId=opened.sessionId;
        assert.equal(opened.bundleSha256,fixture.job.snapshot.bundleSha256);assert.equal(opened.sourceRevision,fixture.job.revision);
        const act=async args=>(await client.call('act_deck_qa',{sessionId,...args})).data;
        const inspect=async args=>(await client.call('inspect_deck_qa',{sessionId,...args}));
        const check=async args=>(await client.call('check_deck_qa',{sessionId,...args})).data;
        const shot=await inspect({});const image=shot.content.find(c=>c.type==='image');assert.equal(image.mimeType,'image/png');
        const png=Buffer.from(image.data,'base64');assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a');assert.ok(png.length>5000);
        await writeFile(path.join(root,'screenshot.png'),png);
        assert.equal(png.readUInt32BE(16),1280);assert.equal(png.readUInt32BE(20),720);
        runChecked('ffmpeg',['-v','error','-i',path.join(root,'screenshot.png'),'-f','null','-']);
        assert.ok(!shot.data.screenshots[0].state.text.includes('Private presenter notes'));
        await act({action:'click',selector:'#presenter-open'});
        await act({action:'wait',milliseconds:150});
        const basic=await check({checks:['console','resources','fonts','presenter']});
        for(const [name,value] of Object.entries(basic.results))assert.equal(value.status,'pass',`${harness} ${name}: ${JSON.stringify(value)}`);
        const presenter=(await inspect({pageId:'presenter-1'})).data;assert.match(presenter.screenshots[0].state.text,/Private presenter notes/);
        await act({pageId:'presenter-1',action:'select',selector:'#slide-select',value:'1'});
        await act({action:'wait',milliseconds:700});
        let state=(await inspect({})).data.screenshots[0].state;assert.equal(state.slideId,'stages');assert.equal(state.visibleGroups.length,3);
        await act({pageId:'presenter-1',action:'select',selector:'#stage-select',value:'0'});
        await act({action:'wait',milliseconds:300});
        state=(await inspect({})).data.screenshots[0].state;assert.deepEqual(state.stage,['0']);assert.equal(state.visibleGroups.length,1);
        await act({pageId:'presenter-1',action:'click',selector:'[data-command="replay"]'});
        await act({action:'wait',milliseconds:700});assert.equal((await inspect({})).data.screenshots[0].state.visibleGroups.length,3);
        // The first MP4 stays hidden at zero while the same asset plays on another slide.
        await act({pageId:'presenter-1',action:'select',selector:'#slide-select',value:'4'});
        await act({action:'wait',milliseconds:200});
        assert.equal((await check({checks:['media']})).results.media.status,'unverified');
        await act({pageId:'presenter-1',action:'click',selector:'[data-command="video-restart"]'});
        await act({action:'wait',milliseconds:500});
        await act({pageId:'presenter-1',action:'click',selector:'[data-command="video-toggle"]'});
        state=(await act({action:'wait',milliseconds:100})).state;
        const pausedVideo=state.media.find(m=>m.visible),hiddenCopy=state.media.find(m=>!m.visible && m.src===pausedVideo.src);
        assert.equal(state.slideId,'video-reused');assert.equal(pausedVideo.paused,true);
        assert.equal(hiddenCopy.time,0);assert.ok(pausedVideo.time>hiddenCopy.time);
        const paused=await check({checks:['media']});
        assert.equal(paused.results.media.status,'unverified',`${harness} paused duplicate: ${JSON.stringify(paused.results)}`);
        assert.equal(paused.results.media.details[0].advancing,false);
        assert.equal(paused.results.media.details[0].time,pausedVideo.time);
        await act({pageId:'presenter-1',action:'click',selector:'[data-command="video-toggle"]'});
        await act({action:'wait',milliseconds:100});
        const resumed=await check({checks:['media']});
        assert.equal(resumed.results.media.status,'pass',`${harness} resumed duplicate: ${JSON.stringify(resumed.results)}`);
        assert.equal(resumed.results.media.details[0].paused,false);
        assert.ok(resumed.results.media.details[0].time>pausedVideo.time);
        for(const i of [0,1]) {
          await act({pageId:'presenter-1',action:'select',selector:'#slide-select',value:String(i+2)});
          await act({action:'wait',milliseconds:200});
          await act({pageId:'presenter-1',action:'click',selector:'[data-command="video-restart"]'});
          await act({action:'wait',milliseconds:100});
          const playback=await check({checks:['media']});assert.equal(playback.results.media.status,'pass',`${harness} codec ${i}: ${JSON.stringify(playback.results)}`);
        }
        await act({action:'key',key:'End'});await act({action:'click',selector:'.slide:not([hidden]) [data-gallery="1"]'});
        state=(await inspect({})).data.screenshots[0].state;assert.deepEqual(state.gallery,['1']);
        const sheet=await inspect({slideIds:['opening','stages','gallery']});assert.ok(sheet.data.contactSheet);assert.equal(sheet.data.screenshots.length,3);
        await act({action:'resize',viewport:{width:640,height:480}});assert.equal((await inspect({clip:{x:0,y:0,width:320,height:240}})).data.screenshots[0].state.viewport.width,640);
        await act({action:'key',key:'Home'});await act({action:'click',selector:'#fullscreen'});
        const fullscreen=await check({checks:['fullscreen']});assert.ok(['pass','unverified'].includes(fullscreen.results.fullscreen.status));
        await act({action:'key',key:'Escape'});
        await act({action:'emulate',media:'print',reducedMotion:'reduce'});await inspect({});
        const closed=(await client.call('close_deck_qa',{sessionId})).data;assert.equal(closed.closed,true);assert.equal(closed.qaStatus,'incomplete');
        const retained=JSON.parse(await readFile(path.join(root,closed.evidence,'session.json'),'utf8'));assert.ok(retained.screenshots.every(s=>s.delivered));assert.ok(retained.coverage.length>6);
        await assert.rejects(client.call('inspect_deck_qa',{sessionId}),/closed|expired/);
        routes[harness]={imageBlocks:true,delivered:true,presenter:true,mp4Playback:true,webmPlayback:true,reusedVideoPauseAndPlayback:true,stagedInteraction:true,contactSheet:true,evidenceRetained:true,fullscreen:fullscreen.results.fullscreen.status};
      } finally {await client.close();}
    }
    return {checkVersion:1,browser:BROWSER_IDENTITY,exactZip:true,routes};
  } finally {await fixture?.close();await rm(root,{recursive:true,force:true});}
}
if(process.argv[1]===fileURLToPath(import.meta.url)) {
  try {console.log(JSON.stringify(await smokeBrowser()));}
  catch(error){console.error(error.stack);process.exitCode=1;}
}

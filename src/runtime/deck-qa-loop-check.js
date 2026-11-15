// Scripted create/edit acceptance through the native MCP image transport and real
// saved-deck/browser services. Assessments are fixture assertions, not a live model.
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from '../store.js';
import { HeavyJobQueue } from '../job-runner.js';
import { createDeckService } from '../deck-service.js';
import { createScopedTools } from './tools.js';
import { mergeTools } from './app-runtime.js';
import { bridgeClient } from './browser-check.js';

export async function checkCorrectionLoop() {
  const root=await mkdtemp(path.join(os.tmpdir(),'sb-qa-loop-')),store=new Store(root),queue=new HeavyJobQueue(),decks=createDeckService({store,queue});
  const results={};
  try {
    for(const harness of ['codex','claude','opencode']) {
      const episode=store.createEpisode({kind:'deck',title:'Correction fixture'});store.ensureEpisodeDirectories(episode.id);
      const scope={episodeId:episode.id,channelId:episode.channelId,requestId:`loop-${harness}`,conversationId:`loop-${harness}`,harness,model:'scripted-fixture',dataRoot:root,episodeDir:store.episodeDirectory(episode.id),workDir:store.episodeWorkDirectory(episode.id)};
      const scoped=createScopedTools(scope,{store});
      const merged=mergeTools(scoped,{
        read_deck:()=>store.getDeck(episode.id),
        save_deck:({expectedRevision,slides})=>store.saveDeck(episode.id,expectedRevision,slides,'agent'),
        build_deck:({expectedRevision})=>decks.enqueue({episodeId:episode.id,expectedRevision}),
        await_job:async({jobId})=>{await queue.draining;return decks.getJob(episode.id,jobId);},
      });
      const client=await bridgeClient(root,{...merged,close:()=>scoped.close()},harness);
      const call=async(name,args={})=>(await client.call(name,args)).data;
      const build=async()=>{
        const current=await call('read_deck'),pending=await call('build_deck',{expectedRevision:current.revision});
        const job=await call('await_job',{jobId:pending.id});assert.equal(job.state,'completed',job.error);return job;
      };
      const save=async(title)=>{
        const current=await call('read_deck');
        return call('save_deck',{expectedRevision:current.revision,slides:[{id:'opening',title,layout:'statement',notes:'Pause and explain.'}]});
      };
      try {
        let prior;
        for(const workflow of ['create','edit']) {
          await save('Crowded heading '.repeat(55));
          const defective=await build();
          if(prior) {const old=await call('get_deck_qa_report',{jobId:prior.id});assert.equal(old.stale,true);assert.equal(old.qaStatus,'incomplete');}
          let opened=await call('open_deck_qa',{jobId:defective.id}),sessionId=opened.sessionId;
          const inspect=async(pageId='audience')=>{
            const shot=await client.call('inspect_deck_qa',{sessionId,pageId});
            const image=shot.content.find(c=>c.type==='image');assert.ok(image,'real image block');
            assert.equal(Buffer.from(image.data,'base64').subarray(0,8).toString('hex'),'89504e470d0a1a0a');
            return shot.data.screenshots[0];
          };
          const bad=await inspect(),badCheck=await call('check_deck_qa',{sessionId,checks:['layout']});
          assert.equal(badCheck.results.layout.status,'fail','defect is observable in real browser bounds');
          const failed=await call('report_deck_qa',{sessionId,summary:'Scripted defect: crowded title exceeds viewport.',changesMade:[],reviews:[{artifactId:bad.artifactId,assessment:'Fixture title bounds extend beyond viewport; screenshot received.',findings:[{severity:'blocking',description:'Crowded opening heading.'}]}]});
          assert.equal(failed.qaStatus,'incomplete');assert.ok(failed.findings.length);
          await call('close_deck_qa',{sessionId});
          await save(workflow==='create'?'A clear plan':'A refined plan');
          const current=await call('read_deck');assert.equal(current.slides[0].id,'opening');assert.equal(current.slides[0].notes,'Pause and explain.');
          await assert.rejects(call('save_deck',{expectedRevision:current.revision-1,slides:current.slides}),/Stale/);
          const corrected=await build();assert.notEqual(corrected.snapshot.bundleSha256,defective.snapshot.bundleSha256);
          assert.equal((await call('get_deck_qa_report',{jobId:corrected.id})).qaStatus,'incomplete');
          opened=await call('open_deck_qa',{jobId:corrected.id});sessionId=opened.sessionId;
          const act=args=>call('act_deck_qa',{sessionId,...args});
          const check=checks=>call('check_deck_qa',{sessionId,checks});
          const reviews=[];
          const assess=async(pageId='audience')=>{
            const shot=await inspect(pageId);reviews.push({artifactId:shot.artifactId,assessment:`Scripted ${workflow} image receipt for ${shot.state.slideId}, ${pageId}; title and notes asserted from state, not live aesthetic judgment.`,findings:[]});
            return shot;
          };
          await act({action:'click',selector:'[data-go="0"]'});await act({action:'key',key:'Home'});
          await act({action:'click',selector:'#presenter-open'});await act({action:'wait',milliseconds:100});
          await act({pageId:'presenter-1',action:'select',selector:'#slide-select',value:'0'});
          await act({pageId:'presenter-1',action:'close-page'});
          await act({action:'click',selector:'#presenter-open'});await act({action:'wait',milliseconds:100});
          await act({action:'click',selector:'#fullscreen'});
          assert.equal((await check(['fullscreen'])).results.fullscreen.status,'pass');
          await act({action:'click',selector:'#fullscreen'});
          for(const viewport of [{width:1280,height:720},{width:960,height:720}]) {
            await act({action:'resize',viewport});await act({pageId:'presenter-2',action:'resize',viewport});
            const shot=await assess();assert.ok(shot.state.text.includes(current.slides[0].title));
            const notes=await assess('presenter-2');assert.equal(notes.state.notes,'Pause and explain.');
            const checked=await check(['console','resources','fonts','layout','presenter']);
            for(const [name,result] of Object.entries(checked.results)) assert.equal(result.status,'pass',`${workflow} ${name}: ${JSON.stringify(result)}`);
          }
          // Missing image assessments cannot pass, even after mechanical coverage.
          const incomplete=await call('report_deck_qa',{sessionId,summary:'Mechanical checks only',changesMade:[],reviews:[]});assert.equal(incomplete.qaStatus,'incomplete');
          await act({action:'emulate',reducedMotion:'reduce'});await assess();
          await act({action:'emulate',media:'print'});await assess();
          await act({action:'emulate',media:'screen',reducedMotion:'no-preference'});
          const report=await call('report_deck_qa',{sessionId,summary:`Scripted ${workflow} loop: shortened title, rebuilt, checked new images and notes. Human aesthetics pending.`,changesMade:['Shortened the saved title and rebuilt.'],reviews});
          assert.equal(report.qaStatus,'complete',JSON.stringify(report.missing));
          assert.equal(report.jobId,corrected.id);assert.equal(report.sourceRevision,corrected.revision);
          assert.ok(report.sessions[0].browser.actualVersion);assert.ok(report.reviewedImages.length>=6);
          await call('close_deck_qa',{sessionId});
          assert.equal((await call('get_deck_qa_report',{jobId:corrected.id})).qaStatus,'complete');
          const imageFile=path.join(root,report.reviewedImages[0].path),bytes=await readFile(imageFile);
          await writeFile(imageFile,'replaced');assert.equal((await call('get_deck_qa_report',{jobId:corrected.id})).qaStatus,'incomplete');await writeFile(imageFile,bytes);
          // A same-revision rebuild still needs new evidence; historical completion is stale.
          const rebuilt=await build();assert.notEqual(rebuilt.id,corrected.id);
          assert.equal((await call('get_deck_qa_report',{jobId:corrected.id})).stale,true);
          assert.equal((await call('get_deck_qa_report',{jobId:rebuilt.id})).qaStatus,'incomplete');
          prior=corrected;
        }
        results[harness]={create:true,edit:true,realImages:true,defectCorrected:true,staleRejected:true,missingEvidenceRejected:true};
      } finally {await client.close();}
    }
    return results;
  } finally {await decks.close();store.close();await rm(root,{recursive:true,force:true});}
}
if(process.argv[1]===fileURLToPath(import.meta.url)) {
  try {console.log(JSON.stringify(await checkCorrectionLoop()));}
  catch(error){console.error(error.stack);process.exitCode=1;}
}

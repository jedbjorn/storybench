import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateQa, recordReview } from '../src/deck-qa-report.js';

const shot={artifactId:'image',delivered:true,fullResolutionDelivered:true,clip:null,state:{pageId:'audience',slideId:'s',stage:[],gallery:[],viewport:{width:1280,height:720},emulation:{media:'screen',reducedMotion:'no-preference'}}};
const record=()=>({sessionId:'session',requestId:'request',bundleSha256:'digest',sourceRevision:2,lifecycle:'closed',screenshots:[structuredClone(shot)],reviews:[],changesMade:[],coverage:[],checks:[],actions:[],errors:[]});
const args={summary:'Visual findings',changesMade:[],reviews:[{artifactId:'image',assessment:'Actual image assessment for the opening state.',findings:[]}]};
const job={revision:2,snapshot:{bundleSha256:'digest',slides:[{id:'s',stages:[],subnav:[]}],library:[]}};

// Otherwise-complete evidence makes each negative case prove a completion gate.
function completeRecord() {
  const r=record();r.startedAt='2026-01-01T00:00:00.000Z';r.summary='All images inspected';r.screenshots=[];
  const addImage=state=>{
    const artifactId=`image-${r.screenshots.length}`;
    r.screenshots.push({...structuredClone(shot),artifactId,state});
    r.reviews.push({artifactId,assessment:'Inspected',findings:[]});
  };
  for(const viewport of [{width:1280,height:720},{width:960,height:720}]) {
    const state={...structuredClone(shot.state),viewport};
    addImage(state);addImage({...state,pageId:'presenter-1'});
    r.checks.push({at:'2026-01-01T00:00:01.000Z',state,results:Object.fromEntries(
      ['console','resources','fonts','layout','presenter','media','fullscreen'].map(name=>[name,{status:'pass'}]))});
  }
  addImage({...shot.state,emulation:{media:'print',reducedMotion:'no-preference'}});
  addImage({...shot.state,emulation:{media:'screen',reducedMotion:'reduce'}});
  r.actions=[
    {action:'click',pageId:'audience',selector:'#next',state:{...shot.state,fullscreen:true}},
    {action:'key',pageId:'audience',key:'Home',state:{...shot.state,fullscreen:false}},
    {action:'select',pageId:'presenter-1',selector:'#slide-select',state:shot.state},
    {action:'close-page',pageId:'presenter-1',state:shot.state},
    ...[1,2].map(()=>({action:'click',pageId:'audience',selector:'#presenter-open',state:shot.state})),
  ];
  return r;
}

const videoJob=()=>({...structuredClone(job),snapshot:{...structuredClone(job.snapshot),
  slides:[{id:'s',stages:[],subnav:[],media:{itemId:'movie'}}],library:[{id:'movie',asset:{kind:'video'}}]}});
const mediaActions=r=>r.checks.map(c=>({action:'click',pageId:'presenter-1',selector:'[data-command="video-restart"]',state:{...c.state,pageId:'presenter-1'}}));

test('video completion requires Presenter control at every applicable state even when playback advances or autoplays',()=>{
  for(const autoplay of [false,true]) {
    const video=videoJob();video.snapshot.slides[0].media.autoplay=autoplay;
    const r=completeRecord(),baseActions=[...r.actions],controls=mediaActions(r);
    assert.equal(evaluateQa(job,[r]).qaStatus,'complete');
    const incomplete=evaluateQa(video,[r]);
    assert.equal(incomplete.qaStatus,'incomplete');
    assert.equal(incomplete.missing.length,2);assert.ok(incomplete.missing.every(m=>m.includes('presenter media control')));
    for(const patch of [
      {action:'wait'}, {action:'key',key:'Home'}, {action:'select'}, {pageId:'audience'},
      {selector:'[data-command="video-toggle-lookalike"]'}, {selector:'[data-command="video-restart"] + button'},
      {state:{...controls[0].state,slideId:'other'}}, {state:{...controls[0].state,stage:['0']}},
      {state:{...controls[0].state,gallery:['0']}}, {state:{...controls[0].state,emulation:{media:'print',reducedMotion:'no-preference'}}},
    ]) {
      r.actions=[...baseActions,...controls.map(a=>({...a,...patch}))];
      assert.equal(evaluateQa(video,[r]).qaStatus,'incomplete',JSON.stringify(patch));
    }
    r.actions=[...baseActions,controls[0]];
    assert.equal(evaluateQa(video,[r]).missing.length,1,'normal viewport cannot cover constrained viewport');
    for(const selector of ['[data-command="video-restart"]',"[data-command='video-toggle']",'[data-command=video-toggle]']) {
      r.actions=[...baseActions,...controls.map(a=>({...a,selector}))];
      assert.equal(evaluateQa(video,[r]).qaStatus,'complete',selector);
    }
    r.checks[0].results.media.status='unverified';
    assert.equal(evaluateQa(video,[r]).qaStatus,'incomplete','control alone does not prove advancing playback');
  }
});

test('latest observation across interleaved closed sessions blocks on failure and clears only on a later pass',()=>{
  for(const name of ['console','resources','fonts','layout','presenter','media']) {
    const video=videoJob(),early=completeRecord();early.actions.push(...mediaActions(early));
    const later=record();later.sessionId='later';later.startedAt='2026-01-01T00:00:01.000Z';
    later.checks=[{at:'2026-01-01T00:00:02.000Z',state:shot.state,results:{[name]:{status:'pass'}}}];
    early.checks.push({at:'2026-01-01T00:00:03.000Z',state:shot.state,results:{[name]:{status:'fail'}}});
    for(const records of [[early,later],[later,early]]) {
      const report=evaluateQa(video,records);
      assert.equal(report.qaStatus,'incomplete',name);assert.equal(report.missing.length,1);
      assert.equal(report.checks.at(-1).results[name].status,'fail');
    }
    // A newer check of another state or diagnostic cannot clear the failure.
    later.checks.push({at:'2026-01-01T00:00:04.000Z',state:{...shot.state,slideId:'other'},results:{[name]:{status:'pass'}}},
      {at:'2026-01-01T00:00:04.000Z',state:shot.state,results:{fullscreen:{status:'pass'}}});
    assert.equal(evaluateQa(video,[early,later]).qaStatus,'incomplete',name);
    later.checks.push({at:'2026-01-01T00:00:05.000Z',state:shot.state,results:{[name]:{status:'pass'}}});
    assert.equal(evaluateQa(video,[early,later]).qaStatus,'complete',name);
  }
});

test('video controls cover each reveal and gallery combination independently',()=>{
  const video=videoJob();video.snapshot.slides[0].stages=[{},{}];
  video.snapshot.slides[0].subnav=[{itemId:'movie'},{itemId:'movie'}];
  const r=completeRecord();
  const expand=entries=>entries.flatMap(entry=>['0','1'].flatMap(stage=>['0','1'].map(gallery=>({
    ...entry,state:{...entry.state,stage:[stage],gallery:[gallery]},
  }))));
  r.screenshots=expand(r.screenshots);r.checks=expand(r.checks);
  r.actions.push(...['[data-command="replay"]','[data-stage="0"]','[data-gallery="1"]']
    .map(selector=>({action:'click',pageId:'audience',selector,state:shot.state})),...mediaActions(r));
  assert.equal(evaluateQa(video,[r]).qaStatus,'complete');
  r.actions.pop();
  const report=evaluateQa(video,[r]);
  assert.equal(report.qaStatus,'incomplete');assert.equal(report.missing.length,1);
  assert.match(report.missing[0],/presenter media control \[\["1"\],\["1"\]/);
});

test('equal observation times use session identity then in-session order regardless of input order',()=>{
  const a=completeRecord();a.sessionId='a';
  const b=record();b.sessionId='b';
  b.checks=[{at:a.checks[0].at,state:shot.state,results:{layout:{status:'fail'}}}];
  for(const records of [[a,b],[b,a]]) assert.equal(evaluateQa(job,records).qaStatus,'incomplete');
  b.checks.push({...b.checks[0],results:{layout:{status:'pass'}}});
  for(const records of [[a,b],[b,a]]) assert.equal(evaluateQa(job,records).qaStatus,'complete');
});

test('review accepts only delivered current-session images and preserves blocking findings',()=>{
  const r=record();r.screenshots[0].delivered=false;
  assert.throws(()=>recordReview(r,args),/delivered/);
  assert.equal(r.reviews.length,0);r.screenshots[0].delivered=true;
  assert.throws(()=>recordReview(r,{...args,reviews:[{...args.reviews[0],artifactId:'foreign'}]}),/delivered/);
  assert.throws(()=>recordReview(r,{...args,reviews:[args.reviews[0],args.reviews[0]]}),/Duplicate/);
  recordReview(r,{...args,reviews:[{...args.reviews[0],findings:[{severity:'blocking',description:'Title overlaps diagram'}]}]});
  assert.throws(()=>recordReview(r,args),/already reviewed/);
  const result=evaluateQa(job,[r]);assert.equal(result.qaStatus,'incomplete');assert.ok(result.missing.some(m=>m.includes('blocking visual')));
});

test('mechanical observations, contact sheets, crops and cancelled sessions do not supply reviewed state coverage',()=>{
  for(const change of [{delivered:false},{fullResolutionDelivered:false},{clip:{x:0,y:0,width:50,height:50}}]) {
    const r=record();recordReview(r,args);Object.assign(r.screenshots[0],change);
    assert.equal(evaluateQa(job,[r]).reviewedImages.length,0);
  }
  for(const lifecycle of ['request-ended','expired','failed','browser-disconnected','operation-timeout']) {
    const r=record();recordReview(r,args);r.lifecycle=lifecycle;
    assert.equal(evaluateQa(job,[r]).reviewedImages.length,0);
  }
  const r=record();recordReview(r,args);r.bundleSha256='old';assert.equal(evaluateQa(job,[r]).reviewedImages.length,0);
});

test('coverage requires each reveal/gallery combination, presenter, both viewport classes and applicable media checks',()=>{
  const r=record();recordReview(r,args);
  const complex={...job,snapshot:{...job.snapshot,slides:[{id:'s',stages:[{afterMs:100},{afterMs:100}],subnav:[{itemId:'movie'},{itemId:'image'}]}],library:[{id:'movie',asset:{kind:'video'}}]}};
  const report=evaluateQa(complex,[r]);
  for(const expected of ['constrained viewport','presenter image review','replay','manual stage selection','reveal timing','gallery navigation','advancing media','print image review','reduce image review'])
    assert.ok(report.missing.some(v=>v.includes(expected)),expected);
  assert.equal(report.qaStatus,'incomplete');
});

test('stage and gallery evidence requires an operation supported by the control',()=>{
  const complex={...job,snapshot:{...job.snapshot,slides:[{id:'s',stages:[{}],subnav:[{}]}]}};
  const r=record();
  // Persisted act_deck_qa shape, including irrelevant optional fields.
  const action=(action,selector,pageId='audience')=>({action,pageId,selector,key:'Home',value:'0',at:new Date().toISOString(),state:structuredClone(shot.state)});
  for(const operation of ['wait','key','resize','focus','emulate','close-page']) {
    r.actions=['[data-stage="0"]','#stage-select','[data-gallery="0"]'].map(selector=>action(operation,selector));
    const report=evaluateQa(complex,[r]);
    assert.ok(report.missing.includes('s: manual stage selection'),operation);
    assert.ok(report.missing.includes('s: gallery navigation'),operation);
  }
  r.actions=[action('click','#stage-select'),action('click','[data-stage-id="first"]'),action('click','[data-gallery-view="0"]')];
  assert.ok(evaluateQa(complex,[r]).missing.includes('s: manual stage selection'));
  assert.ok(evaluateQa(complex,[r]).missing.includes('s: gallery navigation'));
  for(const stage of [action('click','#s [data-stage="0"]'),action('select','#stage-select','presenter-1')]) {
    r.actions=[stage,action('click','.slide:not([hidden]) [data-gallery="0"]')];
    const report=evaluateQa(complex,[r]);
    assert.ok(!report.missing.includes('s: manual stage selection'));
    assert.ok(!report.missing.includes('s: gallery navigation'));
  }
});

test('only the active request/session or explicitly closed batches contribute evidence',()=>{
  const r=record();recordReview(r,args);r.lifecycle='open';
  r.coverage=[shot.state];r.checks=[{state:shot.state,results:{fullscreen:{status:'pass'}}}];
  r.actions=[{action:'click',pageId:'audience',selector:'#next',state:shot.state}];
  for(const active of [undefined,{sessionId:r.sessionId,requestId:'new-request'},{sessionId:'new-session',requestId:r.requestId},{}]) {
    const report=evaluateQa(job,[r],active);
    assert.deepEqual(report.reviewedImages,[]);assert.deepEqual(report.checks,[]);assert.deepEqual(report.coverage,[]);
    for(const missing of ['visual/narrative summary','audience navigation','actual fullscreen entry','normal viewport (at least 1200x700)'])
      assert.ok(report.missing.includes(missing),missing);
  }
  const active={sessionId:r.sessionId,requestId:r.requestId};
  const live=evaluateQa(job,[r],active);
  assert.equal(live.reviewedImages.length,1);assert.equal(live.checks.length,1);
  assert.ok(!live.missing.includes('visual/narrative summary'));assert.ok(!live.missing.includes('audience navigation'));
  const batch=record();recordReview(batch,args);batch.screenshots[0].artifactId='batch-image';batch.reviews[0].artifactId='batch-image';
  batch.screenshots[0].state.viewport={width:960,height:720};
  r.lifecycle='closed';
  const combined=evaluateQa(job,[r,batch]);
  assert.equal(combined.reviewedImages.length,2);assert.equal(combined.viewports.length,2);
  assert.ok(!combined.missing.includes('visual/narrative summary'));assert.ok(!combined.missing.includes('audience navigation'));
});

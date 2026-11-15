import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateQa, recordReview } from '../src/deck-qa-report.js';

const shot={artifactId:'image',delivered:true,fullResolutionDelivered:true,clip:null,state:{pageId:'audience',slideId:'s',stage:[],gallery:[],viewport:{width:1280,height:720},emulation:{media:'screen',reducedMotion:'no-preference'}}};
const record=()=>({sessionId:'session',requestId:'request',bundleSha256:'digest',sourceRevision:2,lifecycle:'closed',screenshots:[structuredClone(shot)],reviews:[],changesMade:[],coverage:[],checks:[],actions:[],errors:[]});
const args={summary:'Visual findings',changesMade:[],reviews:[{artifactId:'image',assessment:'Actual image assessment for the opening state.',findings:[]}]};
const job={revision:2,snapshot:{bundleSha256:'digest',slides:[{id:'s',stages:[],subnav:[]}],library:[]}};

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

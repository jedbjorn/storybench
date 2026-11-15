import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateQa, recordReview } from '../src/deck-qa-report.js';

const shot={artifactId:'image',delivered:true,fullResolutionDelivered:true,clip:null,state:{pageId:'audience',slideId:'s',stage:[],gallery:[],viewport:{width:1280,height:720},emulation:{media:'screen',reducedMotion:'no-preference'}}};
const record=()=>({bundleSha256:'digest',sourceRevision:2,lifecycle:'open',screenshots:[structuredClone(shot)],reviews:[],changesMade:[],coverage:[],checks:[],actions:[],errors:[]});
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

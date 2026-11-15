// App-owned browser tools. Inputs are generated immutable bundles, never arbitrary
// pages or scripts. No browser/profile is shared across productions or requests.
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, readFile, writeFile, rename, rm, realpath } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { chromium } from 'playwright-core';
import { Resvg } from '@resvg/resvg-js';
import { extractBuild } from './deck-qa-bundle.js';
import { getQaReport, recordReview } from './deck-qa-report.js';
import { withToolDelivery } from './tool-delivery.js';
const require = createRequire(import.meta.url);
export const QA_LIMITS = Object.freeze({ sessions: 2, lifetimeMs: 600_000, operationMs: 20_000, screenshots: 120, actions: 600, errors: 100 });
export const BROWSER_IDENTITY = Object.freeze({ controller: require('playwright-core/package.json').version,
  ...require(path.join(path.dirname(require.resolve('playwright-core/package.json')), 'browsers.json')).browsers.find(b => b.name === 'chromium') });
let active = 0;
const json = value => ({ text: JSON.stringify(value) });
const viewport = (value = {width:1280,height:720}) => {
  if (!Number.isInteger(value.width) || !Number.isInteger(value.height) || value.width < 320 || value.width > 1920 || value.height < 240 || value.height > 1080)
    throw new Error('QA viewport must be 320–1920 by 240–1080 pixels');
  return {width:value.width,height:value.height};
};
const boundedText = (value, name, max = 300) => {
  if (typeof value !== 'string' || !value.length || value.length > max) throw new Error(`Invalid ${name}`);
  return value;
};

// Runs in the browser, reads only. Visibility and bounds are candidates for review,
// not a claim of visual quality. Hidden notes are deliberately absent from audience text.
export function inspectPage() {
  const visible = e => e.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}) && !e.closest('[hidden]');
  const rect = e => { const r=e.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height}; };
  const slide = document.querySelector('.slide:not([hidden])');
  const elements = [...document.querySelectorAll('h1,h2,h3,p,li,button,select,svg,img,video,[data-vector-step]')].filter(visible).slice(0,300).map(e => ({
    tag:e.tagName.toLowerCase(),id:e.id || null,role:e.getAttribute('role'),label:e.getAttribute('aria-label'),text:(e.innerText || e.getAttribute('alt') || '').slice(0,500),
    bounds:rect(e),overflow:e.scrollWidth > e.clientWidth + 2 && e.clientWidth > 0,
  }));
  return {title:document.title,slideId:slide?.id ?? null,stage:[...(slide?.querySelectorAll('[data-stage][aria-pressed="true"]') || [])].map(e=>e.dataset.stage),
    visibleGroups:[...(slide?.querySelectorAll('[data-vector-step]') || [])].filter(visible).map(e=>e.dataset.vectorStep),
    gallery:[...(slide?.querySelectorAll('[data-gallery-view]:not([hidden])') || [])].map(e=>e.dataset.galleryView),
    text:document.body.innerText.slice(0,12000),elements,viewport:{width:innerWidth,height:innerHeight},
    fullscreen:Boolean(document.fullscreenElement),status:document.querySelector('#status')?.textContent || '',
    presenter:document.querySelector('#connection')?.textContent ?? null,notes:document.querySelector('#notes')?.textContent ?? null,
    fonts:[...document.fonts].map(f=>({family:f.family,status:f.status})),
    images:[...document.images].map(e=>({src:e.getAttribute('src'),loaded:e.complete && e.naturalWidth>0})),
    media:[...document.querySelectorAll('video')].map((e,index)=>({index,src:e.getAttribute('src'),visible:visible(e),readyState:e.readyState,error:e.error?.code ?? null,paused:e.paused,time:e.currentTime,duration:Number.isFinite(e.duration)?e.duration:null})),
    inventory:[...document.querySelectorAll('.slide')].map(e=>({slideId:e.id,title:e.dataset.title,stages:[...e.querySelectorAll('[data-stage]')].map(s=>s.dataset.stage),gallery:[...e.querySelectorAll('[data-gallery]')].map(g=>g.dataset.gallery)})),
    pageOverflow:document.documentElement.scrollWidth>innerWidth+2,
  };
}

export function createDeckQa({store,scope}) {
  let session = null, stopped = false, busy = false, closing = null;
  const requireSession = id => {
    if (!session || session.id !== id || session.closed || stopped) throw new Error('QA session is closed, expired, or belongs to another request; reopen the build');
    store.requireProductionKind(scope.episodeId,'deck');
    return session;
  };
  const persist = async s => {
    if (!s.evidenceDir) return;
    const file = path.join(s.evidenceDir,'session.json');
    await writeFile(`${file}.tmp`,JSON.stringify(s.record,null,2)); await rename(`${file}.tmp`,file);
  };
  async function close(reason = 'closed') {
    const s = session;
    if (!s) return {closed:true};
    if (closing) return closing;
    s.closed = true; clearTimeout(s.timer);
    closing = (async()=>{
      await s.initialized;
      await s.context?.close().catch(()=>{});
      await s.browser?.close().catch(()=>{});
      s.record.lifecycle = reason; s.record.closedAt = new Date().toISOString();
      if (reason !== 'closed') s.record.qaStatus = 'incomplete';
      await s.persistence?.catch(()=>{});
      try { await save(s); } finally {
        if(s.temp) await rm(s.temp,{recursive:true,force:true});
        active--; session = null; closing = null;
      }
      return {closed:true,sessionId:s.id,jobId:s.record.jobId,evidence:s.record.artifactRoot,qaStatus:s.record.qaStatus,reason};
    })();
    return closing;
  }
  const save = s => { s.persistence = (s.persistence || Promise.resolve()).then(()=>persist(s)); return s.persistence; };
  function pageFor(s,id='audience') {
    const page = s.pages.get(id);
    if (!page || page.isClosed()) throw new Error('Page is closed or unknown; open Presenter from the audience control');
    return page;
  }
  async function snapshot(s,page) {
    const state = await page.evaluate(inspectPage);
    state.pageId = [...s.pages].find(([,p])=>p===page)?.[0];
    if (state.pageId !== 'audience') {
      const audience = await pageFor(s).evaluate(inspectPage);
      state.slideId = audience.slideId; state.stage = audience.stage; state.gallery = audience.gallery;
    }
    state.emulation = s.emulations.get(state.pageId) ?? {media:'screen',reducedMotion:'no-preference'};
    state.pages = [...s.pages].filter(([,p])=>!p.isClosed()).map(([pageId])=>({pageId}));
    const key = JSON.stringify([state.pageId,state.slideId,state.stage,state.gallery,state.viewport,state.emulation]);
    if (!s.record.coverage.some(c=>c.key===key)) s.record.coverage.push({key,pageId:state.pageId,slideId:state.slideId,stage:state.stage,gallery:state.gallery,viewport:state.viewport,emulation:state.emulation});
    return state;
  }
  async function open(args) {
    if (session || active >= QA_LIMITS.sessions) throw new Error('QA browser capacity reached; close the existing session before opening another');
    boundedText(args.jobId,'build ID',100); const size = viewport(args.viewport);
    active++;
    const s = {id:randomUUID(),pages:new Map(),closed:false,record:{},emulations:new Map()};
    s.initialized = new Promise(resolve => {s.resolveInitialized=resolve;});
    session = s;
    try {
      s.temp = await mkdtemp(path.join(os.tmpdir(),'storybench-qa-'));
      const bundle = path.join(s.temp,'bundle');
      s.build = await extractBuild(store,scope.episodeId,args.jobId,bundle);
      if(s.closed) throw new Error('QA request ended during extraction');
      s.evidenceDir = path.join(s.build.parent,'qa',s.id);
      await mkdir(s.evidenceDir,{recursive:true,mode:0o700});
      if (await realpath(s.evidenceDir)!==s.evidenceDir) throw new Error('Unsafe QA evidence path');
      s.record = {version:2,sessionId:s.id,jobId:args.jobId,productionId:scope.episodeId,requestId:scope.requestId,conversationId:scope.conversationId,harness:scope.harness,model:scope.model,
        sourceRevision:s.build.sourceRevision,bundleSha256:s.build.bundleSha256,browser:BROWSER_IDENTITY,startedAt:new Date().toISOString(),
        artifactRoot:path.relative(store.workspace,s.evidenceDir),qaStatus:'incomplete',lifecycle:'open',screenshots:[],coverage:[],checks:[],actions:[],errors:[],reviews:[],changesMade:[]};
      const error = (type,message) => { if(s.record.errors.length<QA_LIMITS.errors) s.record.errors.push({type,message:String(message).replaceAll(s.temp,'<qa>').slice(0,1500)}); };
      // Whitelist environment: no inference, account, proxy or application credentials.
      // The full pinned Chromium channel includes the supported MP4/WebM decode path.
      s.browser = await chromium.launch({channel:'chromium',headless:true,timeout:10_000,
        env:{PATH:'/usr/bin:/bin',HOME:s.temp,TMPDIR:s.temp,LANG:'C.UTF-8'},
        args:['--disable-background-networking','--host-resolver-rules=MAP * ~NOTFOUND','--disable-extensions','--renderer-process-limit=2','--js-flags=--max-old-space-size=128']});
      if(s.closed) {await s.browser.close(); throw new Error('QA request ended during browser launch');}
      s.record.browser = {...BROWSER_IDENTITY,actualVersion:s.browser.version()};
      s.context = await s.browser.newContext({viewport:size,acceptDownloads:false,serviceWorkers:'block'});
      s.context.setDefaultTimeout(5000); s.context.setDefaultNavigationTimeout(5000);
      const allowed = url => {
        try { const u = new URL(url); return u.protocol==='file:' && s.build.files.includes(path.relative(bundle,fileURLToPath(u))) && fileURLToPath(u).startsWith(`${bundle}${path.sep}`); } catch {return false;}
      };
      await s.context.route('**/*',route=>{
        if(allowed(route.request().url())) return route.continue();
        error('blocked-resource',route.request().url()); return route.abort('blockedbyclient');
      });
      await s.context.routeWebSocket('**/*',ws=>{error('blocked-websocket',ws.url());ws.close();});
      let pageNumber = 0;
      s.context.on('page',page=>{
        if(s.pages.size>=4) {error('page-limit','Too many presenter pages');void page.close();return;}
        const id = pageNumber++ ? `presenter-${pageNumber-1}` : 'audience'; s.pages.set(id,page);
        page.on('pageerror',e=>error('page',e.message));
        page.on('console',m=>{if(m.type()==='error') error('console',m.text());});
        page.on('requestfailed',r=>error('resource',`${r.url()}: ${r.failure()?.errorText}`));
        page.on('dialog',d=>d.dismiss());
        page.on('framenavigated',frame=>{if(!allowed(frame.url()) && frame.url()!=='about:blank') {error('blocked-navigation',frame.url());void page.close();}});
      });
      s.browser.on('disconnected',()=>{if(!s.closed) void close('browser-disconnected').catch(()=>{});});
      const page = await s.context.newPage();
      await page.goto(pathToFileURL(path.join(bundle,'index.html')).href);
      await page.evaluate(()=>document.fonts.ready);
      s.timer=setTimeout(()=>void close('expired').catch(()=>{}),QA_LIMITS.lifetimeMs);s.timer.unref();
      const state = await snapshot(s,page); await save(s);
      return json({...s.record,state,limits:QA_LIMITS});
    } catch(error) { s.resolveInitialized(); await close('failed'); throw new Error(`Deck browser QA unavailable: ${error.message}. Preserve the draft and retry after correcting the named component.`); }
    finally {s.resolveInitialized();}
  }
  async function capture(s,page,clip) {
    if(s.record.screenshots.length>=QA_LIMITS.screenshots) throw new Error('Screenshot batch limit reached; close/reopen this build to continue');
    const size=page.viewportSize();
    if(clip && (!['x','y','width','height'].every(k=>Number.isInteger(clip[k])) || clip.x<0 || clip.y<0 || clip.width<1 || clip.height<1 || clip.x+clip.width>size.width || clip.y+clip.height>size.height)) throw new Error('Screenshot crop must be inside the viewport');
    const state=await snapshot(s,page);
    // In print CSS every slide is visible. Capture the selected article itself,
    // otherwise a later slide ID could be attached to an image of the first page.
    const printSlide=state.emulation.media==='print' && state.pageId==='audience' && !clip;
    const bytes=printSlide
      ? await page.locator(`article[id="${state.slideId}"]`).screenshot({type:'png',timeout:5000})
      : await page.screenshot({type:'png',...(clip?{clip}:{}),timeout:5000});
    if(s.closed) throw new Error('QA session closed during screenshot');
    if(bytes.length>4*1024*1024) throw new Error('Screenshot exceeds transport bound; use a smaller viewport or crop');
    const artifactId=randomUUID(),file=`${artifactId}.png`;
    await writeFile(path.join(s.evidenceDir,file),bytes,{flag:'wx'});
    const record={artifactId,file,state,clip:clip??null,sha256:createHash('sha256').update(bytes).digest('hex'),delivered:false,fullResolutionDelivered:false,createdAt:new Date().toISOString()};s.record.screenshots.push(record);
    return {bytes,record};
  }
  async function inspect(s,args) {
    const page=pageFor(s,args.pageId); const captures=[];
    if(args.slideIds) {
      if(args.pageId && args.pageId!=='audience' || args.clip || !Array.isArray(args.slideIds) || args.slideIds.length<1 || args.slideIds.length>6) throw new Error('Contact sheet requires 1–6 audience slide IDs and no crop');
      const inventory=(await snapshot(s,page)).inventory;
      for(const id of args.slideIds) {
        const index=inventory.findIndex(v=>v.slideId===id); if(index<0) throw new Error('Contact sheet slide not found');
        await page.locator(`[data-go="${index}"]`).click(); captures.push(await capture(s,page));
      }
    } else captures.push(await capture(s,page,args.clip));
    let image=captures[0].bytes,contactSheet=null;
    if(args.slideIds) {
      const width=640,height=360,rows=Math.ceil(captures.length/2);
      const svg=`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width*2}" height="${rows*height}"><rect width="100%" height="100%" fill="white"/>${captures.map((c,i)=>`<image x="${i%2*width}" y="${Math.floor(i/2)*height}" width="${width}" height="${height}" xlink:href="data:image/png;base64,${c.bytes.toString('base64')}"/>`).join('')}</svg>`;
      image=Buffer.from(new Resvg(svg).render().asPng());contactSheet=`${randomUUID()}.png`;
      await writeFile(path.join(s.evidenceDir,contactSheet),image,{flag:'wx'});
    }
    if(s.closed) throw new Error('QA session closed during inspection');
    await save(s);
    return withToolDelivery({text:JSON.stringify({sessionId:s.id,jobId:s.record.jobId,bundleSha256:s.record.bundleSha256,contactSheet,screenshots:captures.map(c=>c.record),errors:s.record.errors}),images:[{data:image.toString('base64'),mimeType:'image/png'}]},()=>{
      captures.forEach(c=>{c.record.delivered=true;c.record.fullResolutionDelivered=!args.slideIds;});void save(s).catch(()=>{});
    });
  }
  async function act(s,args) {
    s.record.qaStatus='incomplete';
    const page=pageFor(s,args.pageId);
    if(s.record.actions.length>=QA_LIMITS.actions) throw new Error('Action limit reached; reopen the same build to continue');
    switch(args.action) {
      case 'click': await page.locator(boundedText(args.selector,'selector')).click(); break;
      case 'key': {
        const key=boundedText(args.key,'key',30);
        if(!/^(ArrowUp|ArrowDown|ArrowLeft|ArrowRight|Home|End|Enter|Escape|Tab|Space|n|N)$/.test(key)) throw new Error('Unsupported presentation key');
        await page.keyboard.press(key); break;
      }
      case 'select': await page.locator(boundedText(args.selector,'selector')).selectOption(boundedText(args.value,'value',100)); break;
      case 'resize': await page.setViewportSize(viewport(args.viewport)); break;
      case 'wait': if(!Number.isInteger(args.milliseconds) || args.milliseconds<0 || args.milliseconds>2000) throw new Error('Wait must be 0–2000 ms'); await page.waitForTimeout(args.milliseconds); break;
      case 'focus': await page.bringToFront(); break;
      case 'emulate':
        if(!['screen','print'].includes(args.media??'screen') || !['reduce','no-preference'].includes(args.reducedMotion??'no-preference')) throw new Error('Unsupported media emulation');
        { const emulation={media:args.media??'screen',reducedMotion:args.reducedMotion??'no-preference'};s.emulations.set(args.pageId??'audience',emulation);await page.emulateMedia(emulation);break; }
      case 'close-page': if((args.pageId??'audience')==='audience') throw new Error('Use close_deck_qa to close the audience');await page.close(); break;
      default: throw new Error('Unsupported QA action');
    }
    const state=await snapshot(s,page.isClosed()?pageFor(s):page);
    if(s.closed) throw new Error('QA session closed during action');
    s.record.actions.push({action:args.action,pageId:args.pageId??'audience',selector:args.selector,key:args.key,value:args.value,at:new Date().toISOString(),state});
    await save(s);return json({state,errors:s.record.errors});
  }
  async function checks(s,args) {
    const requested=args.checks??['console','resources','fonts','media','layout','presenter','fullscreen'];
    if(!Array.isArray(requested) || requested.length<1 || requested.length>7 || requested.some(c=>!['console','resources','fonts','media','layout','presenter','fullscreen'].includes(c))) throw new Error('Unknown QA check set');
    const page=pageFor(s,args.pageId),before=await snapshot(s,page);
    if(requested.includes('media')) await page.waitForTimeout(400);
    const state=await snapshot(s,page),result={};
    const check=(status,reason,details)=>({status,reason,details});
    for(const name of requested) {
      if(name==='console') {const errors=s.record.errors.filter(e=>['console','page'].includes(e.type));result[name]=check(errors.length?'fail':'pass','Observed browser errors',errors);}
      if(name==='resources') {const errors=s.record.errors.filter(e=>!['console','page'].includes(e.type));result[name]=check(errors.length||state.images.some(i=>!i.loaded)?'fail':'pass','Observed local resources', {errors,images:state.images});}
      if(name==='fonts') result[name]=check(state.fonts.length && state.fonts.every(f=>f.status==='loaded')?'pass':'fail','Bundled font faces must actually load',state.fonts);
      if(name==='layout') {const candidates=state.elements.filter(e=>e.overflow || e.bounds.x< -2 || e.bounds.x+e.bounds.width>state.viewport.width+2 || e.bounds.y< -2 || e.bounds.y+e.bounds.height>state.viewport.height+2);result[name]=check(candidates.length||state.pageOverflow?'fail':'pass','Overflow candidates only; inspect the screenshot',candidates);}
      if(name==='media') {
        // Generated bundles keep a static media DOM; an asset URL can occur on many slides.
        const sameView=state.slideId===before.slideId && JSON.stringify([state.stage,state.gallery])===JSON.stringify([before.stage,before.gallery]);
        const media=state.media.filter(m=>m.visible).map(m=>{
          const previous=before.media[m.index];
          return {...m,advancing:Boolean(sameView && previous?.src===m.src && previous.visible && !previous.paused && !m.paused && m.time>previous.time)};
        });
        result[name]=check(!media.length?'unverified':media.some(m=>m.error)?'fail':media.every(m=>m.advancing)?'pass':'unverified','Only actual advancing playback proves decode; use Presenter media controls to start it',media);
      }
      if(name==='presenter') {
        const presenter=[...s.pages].find(([id,p])=>id!=='audience'&&!p.isClosed());
        if(!presenter) result[name]=check('unverified','Open Presenter through the audience control');
        else {const p=await presenter[1].evaluate(inspectPage),a=await pageFor(s).evaluate(inspectPage),slide=s.build.job.snapshot.slides.find(v=>v.id===a.slideId);
          result[name]=check(p.presenter?.startsWith('Connected') && p.notes===(slide?.notes??'') && p.text.includes(slide?.title)?'pass':'fail','Current presenter handshake, title and notes',{pageId:presenter[0],connection:p.presenter,slideId:a.slideId});}
      }
      if(name==='fullscreen') result[name]=check(state.fullscreen?'pass':'unverified',state.fullscreen?'document.fullscreenElement is set':state.status||'Not currently fullscreen; invoke the control. Physical display behavior is unverified.');
    }
    if(s.closed) throw new Error('QA session closed during checks');
    const entry={at:new Date().toISOString(),state,results:result};s.record.checks.push(entry);if(s.record.checks.length>120)s.record.checks.shift();await save(s);
    return json({jobId:s.record.jobId,bundleSha256:s.record.bundleSha256,...entry,coverage:s.record.coverage,qaStatus:'incomplete'});
  }
  return {
    async call(name,args={}) {
      if(stopped) throw new Error('QA request ended');
      if(name==='close_deck_qa') {requireSession(args.sessionId);return json(await close());}
      if(busy) throw new Error('A QA operation is already running; wait for its result');
      busy=true;let timer;
      try {
        return await Promise.race([(async()=>{
          if(name==='open_deck_qa') return open(args);
          if(name==='get_deck_qa_report') return json(await getQaReport(store,scope.episodeId,args.jobId));
          const s=requireSession(args.sessionId);
          if(name==='inspect_deck_qa') return inspect(s,args);
          if(name==='act_deck_qa') return act(s,args);
          if(name==='check_deck_qa') return checks(s,args);
          if(name==='report_deck_qa') {
            recordReview(s.record,args); await save(s);
            const report=await getQaReport(store,scope.episodeId,s.record.jobId);
            if(s.closed) throw new Error('QA session closed during reporting');
            s.record.qaStatus=report.qaStatus; await save(s); return json(report);
          }
          throw new Error('Unknown QA operation');
        })(),new Promise((_,reject)=>{timer=setTimeout(()=>{void close('operation-timeout').catch(()=>{});reject(new Error('QA operation timed out; evidence incomplete, reopen the build'));},QA_LIMITS.operationMs);})]);
      } finally {clearTimeout(timer);busy=false;}
    },
    async close() {stopped=true;return close('request-ended');},
  };
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.js';
import { validateSlides } from '../src/deck-data.js';
import { createRenderService } from '../src/render-service.js';
import { createApp } from '../src/server.js';
import { createChatService } from '../src/chat.js';
import { createV9ConversationPersistence } from '../src/runtime/conversation-persistence.js';
import { JSDOM } from 'jsdom';
import { slideListHTML, bindSlideList, layoutOptions } from '../public/deck-workspace.js';
import { elementCardsHTML, bindElementCards } from '../public/element-cards.js';
const slide = (id = 'slide_one') => ({ id, title: 'Opening', layout: 'statement', body: 'A useful idea', notes: 'Pause', targetMinutes: 1,
  stages: [{id: 'stage_one', title: 'First', body: 'Observe', afterMs: 200}], subnav: [{id: 'nav_one', label: 'Discover'}] });
function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'storybench-deck-'));
  let store = new Store(root);
  t.after(() => { store.close(); rmSync(root, {recursive:true, force:true}); });
  return { root, get store() { return store; }, reopen() { store.close(); store = new Store(root); return store; } };
}
test('v12 and post-inference migrations preserve IDs, paths, stories, cards and history; mixed reopen is repeat safe', t => {
  for (const version of [12,13]) {
    const f = fixture(t), s = f.store;
    const created = s.createEpisode({title:'Legacy'});
    const video = s.updateEpisode(created.id,1,{cards:[{id:'old_card',title:'Existing scene',type:'Video',notes:'Keep me'}]});
    const chat = createChatService({store:s}).create(video.id);
    const asset = s.saveAsset({name:'old.png',hash:'old-media',kind:'image',path:'media/old.png',metadata:{}});
    const member = s.attachLibraryItem(video.id,asset.id,{category:'B-roll'});
    const job = s.saveJob({episodeId:video.id,kind:'draft',state:'completed',revision:video.revision,outputPath:'exports/old.mp4',outputClass:'draft'});
    const chatBefore = s.requireConversation(chat.id);
    const before = { production: video, directory: s.episodeDirectory(video.id), story: s.getStory(video.id), history: s.listEpisodeHistory(video.id) };
    s.db.exec(`DROP TRIGGER episodes_kind_immutable; ALTER TABLE episodes DROP COLUMN kind; PRAGMA user_version=${version}`);
    if (version === 12) {
      s.db.exec(`ALTER TABLE conversations DROP COLUMN inference_source;
        ALTER TABLE conversation_segments DROP COLUMN inference_source;
        CREATE TABLE model_default(singleton INTEGER PRIMARY KEY CHECK(singleton=1),selection TEXT,revision INTEGER NOT NULL DEFAULT 1);
        INSERT INTO model_default SELECT 1,selection,revision FROM model_defaults WHERE mode='video';
        DROP TABLE model_defaults;`);
    }
    const migrated = f.reopen();
    assert.deepEqual(migrated.getEpisode(video.id), before.production);
    assert.deepEqual(migrated.requireConversation(chat.id), chatBefore);
    assert.deepEqual(migrated.getLibraryItem(video.id,member.id),member);
    assert.deepEqual(migrated.getJob(job.id),job);
    assert.equal(migrated.episodeDirectory(video.id), before.directory);
    assert.deepEqual(migrated.getStory(video.id), before.story);
    assert.deepEqual(migrated.listEpisodeHistory(video.id), before.history);
    assert.ok(existsSync(path.join(f.root, `storybench.pre-v${version + 1}.sqlite`)));
    const deck = migrated.createEpisode({title:'A deck', kind:'deck'});
    assert.equal(deck.kind,'deck'); assert.equal(deck.cards.length,0);
    assert.deepEqual(new Set(f.reopen().listEpisodes().map(p => p.kind)), new Set(['video','deck']));
  }
});
test('shared deck mutations persist stable slide/stage identities, conflict, undo and kind boundaries', t => {
  const f = fixture(t), s = f.store, deck = s.createEpisode({kind:'deck'}), video = s.createEpisode();
  assert.throws(() => s.createEpisode({kind:'bogus'}), /kind/);
  assert.throws(() => s.updateEpisode(deck.id,1,{kind:'video'}), /immutable/);
  assert.throws(() => s.db.prepare('UPDATE episodes SET kind=? WHERE id=?').run('video',deck.id), /immutable/);
  assert.throws(() => s.getDeck(video.id), /requires a deck/);
  const first = s.saveDeck(deck.id,1,[slide(),slide('slide_two')]);
  const reordered = s.saveDeck(deck.id,first.revision,[first.slides[1],first.slides[0]],'agent');
  assert.equal(reordered.slides[1].stages[0].id,'stage_one');
  assert.throws(() => s.saveDeck(deck.id,first.revision,[]), /Stale/);
  s.undoEpisode(deck.id,reordered.revision);
  assert.equal(f.reopen().getDeck(deck.id).slides[0].id,'slide_one');
  assert.throws(() => f.store.applyBrandingTemplate(deck.id,'anything'), /requires a video/);
});
test('invalid composition and dangling media fail plainly', t => {
  const {store:s} = fixture(t), deck = s.createEpisode({kind:'deck'});
  for (const change of [{title:''},{id:'../x'},{targetMinutes:-1},{targetMinutes:Infinity},{layout:'html'},{media:{itemId:'missing'}},{stages:[{id:'one', title:'x', afterMs:NaN}]},{sectionId:'missing'}]) {
    assert.throws(() => s.saveDeck(deck.id,1,[{...slide(),...change}]));
    assert.equal(s.getDeck(deck.id).revision,1);
  }
  assert.throws(() => validateSlides([slide(),slide()]),/Duplicate/);
});
test('manual board edits content, notes, layouts, reveals and columns without source editing', () => {
  const dom = new JSDOM('<main></main><ol></ol>'), root = dom.window.document.querySelector('main'), list = dom.window.document.querySelector('ol');
  const slides = [slide()]; let dirty = 0, saved = 0, changed = 0;
  // The editor: the header's layout choice and the slide's fields, under one [data-slide-index].
  const render = () => { root.innerHTML = `<div data-slide-index="0"><select data-slide-field="layout">${layoutOptions(slides[0].layout)}</select>${elementCardsHTML(slides[0],0,{ items: [], sections: [] })}</div>`; };
  render(); bindElementCards(root,{ getSlides:()=>slides,onDirty:()=>dirty++,onSave:()=>saved++,render });
  const edit = (selector,value) => { const el=root.querySelector(selector); el.value=value; el.dispatchEvent(new dom.window.Event('input',{bubbles:true})); el.dispatchEvent(new dom.window.Event('change',{bubbles:true})); };
  edit('[data-slide-field="notes"]','Explain this calmly'); edit('[data-slide-field="layout"]','columns');
  root.querySelector('[data-slide-action="add-columns"]').click();
  edit('[data-part="columns"] [data-slide-field="title"]','Option A');
  edit('[data-add-element]','step');
  // Columns stay saved, hidden, while a text-and-media layout shows its visual instead.
  edit('[data-slide-field="layout"]','text-media');
  assert.match(root.querySelector('[data-hidden-count]').textContent, /1 saved value hidden by this layout \(columns\)/);
  // The slide list duplicates, moves and deletes whole slides.
  const renderList = () => { list.innerHTML = slideListHTML(slides, [], null); };
  renderList(); bindSlideList(list,{ getSlides:()=>slides,getOpenId:()=>null,setOpenId(){},onPlay(){},onEdit(){},onChange:()=>{ changed++; renderList(); },confirm:()=>true });
  list.querySelector('[data-slide-action="duplicate"]').click();
  assert.equal(slides[0].notes,'Explain this calmly'); assert.equal(slides[0].columns[0].title,'Option A');
  assert.equal(slides[0].stages.length,2); assert.equal(slides[1].stages.length,2);
  assert.notEqual(slides[0].id,slides[1].id); assert.notEqual(slides[0].stages[0].id,slides[1].stages[0].id);
  list.querySelector('[data-slide-action="down"]').click(); assert.equal(slides[0].title,'Opening (copy)');
  list.querySelector('[data-slide-action="delete"]').click(); assert.equal(slides.length,1);
  assert.ok(dirty>0 && saved>0 && changed===3); dom.window.close();
});

test('deck media uses registered membership and survives reorder; deletion is refused while starred, then unlinks the candidate and keeps the source asset', t => {
  const {store:s} = fixture(t), source = s.createEpisode(), deck = s.createEpisode({kind:'deck'});
  const asset = s.saveAsset({name:'image.png',hash:'synthetic-image',kind:'image',path:'media/image.png',metadata:{}});
  const original = s.attachLibraryItem(source.id,asset.id,{category:'B-roll'});
  const item = s.attachLibraryItem(deck.id,asset.id,{category:'B-roll',label:'Plan',provenance:{sourceItemId:original.id}});
  const saved = s.saveDeck(deck.id,1,[{...slide(),media:{itemId:item.id,alt:'Synthetic visual'},subnav:[{id:'view',label:'Detail',itemId:item.id}]}]);
  assert.equal(saved.slides[0].media.itemId,item.id);
  // Delete guard (spec #46): a starred asset stays, and nothing changes.
  assert.throws(() => s.deleteLibraryItem(deck.id,item.id,item.revision,saved.revision), error => error.statusCode === 409 && /“Plan” is starred on slide 01/.test(error.message));
  assert.deepEqual(s.getDeck(deck.id).slides, saved.slides); assert.ok(s.getLibraryItem(deck.id,item.id));
  const unstarred = s.saveDeck(deck.id,saved.revision,[{...saved.slides[0],media:null,subnav:[],candidates:[{itemId:item.id,alt:'Synthetic visual'}]}]);
  const deleted = s.deleteLibraryItem(deck.id,item.id,item.revision,unstarred.revision);
  assert.equal(deleted.cards[0].candidates.length,0); assert.equal(s.getLibraryItem(deck.id,item.id),null);
  assert.ok(s.getLibraryItem(source.id,original.id)); assert.equal(s.getAsset(asset.id).path,'media/image.png');
});
test('new deck chats use deck defaults while existing video selections remain intact', t => {
  const {store:s} = fixture(t), deck=s.createEpisode({kind:'deck'}), video=s.createEpisode();
  const persistence = createV9ConversationPersistence(s), chat = createChatService({store:s,requestPersistence:persistence});
  const existing = chat.create(video.id);
  s.saveModelDefault(0,{harness:'opencode',source:'gateway-demo',model:'deck-model',effort:null},'deck');
  const created = chat.create(deck.id);
  assert.equal(persistence.getSettings(created.id).model,'deck-model');
  assert.equal(persistence.getSettings(existing.id).harness,'codex');
  assert.ok(s.listModelDefaults().some(row => row.mode === 'deck'));
});
test('HTTP creation and shared slide editing enforce kind, revision and channel; video render refuses deck', async t => {
  const root=mkdtempSync(path.join(os.tmpdir(),'storybench-deck-http-'));
  const app=await createApp({workspace:root});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await app.close();rmSync(root,{recursive:true,force:true});});
  const origin=`http://127.0.0.1:${app.server.address().port}`;
  const request = async (url,body,method='POST',channel=null) => {
    const response=await fetch(origin+url,{method,headers:{origin,'content-type':'application/json',...(channel?{'x-storybench-channel':channel}:{})},...(body?{body:JSON.stringify(body)}:{})});
    return {status:response.status,body:await response.json()};
  };
  const {body:deck,status}=await request('/api/episodes',{title:'HTTP deck',kind:'deck'});
  assert.equal(status,201); assert.equal(deck.kind,'deck');
  const url=`/api/episodes/${deck.id}/slides`;
  const saved=await request(url,{expectedRevision:1,slides:[slide()]},'PUT'); assert.equal(saved.status,200);
  assert.equal((await request(url,{expectedRevision:1,slides:[]},'PUT')).status,409);
  assert.equal((await request(url,null,'GET')).body.slides[0].notes,'Pause');
  const other=app.store.createChannel('Other'); assert.equal((await request(url,null,'GET',other.id)).status,409);
  assert.equal((await request(`/api/episodes/${deck.id}/render-plan`,null,'GET')).status,409);
  const renders=createRenderService({workspace:root,store:app.store}); t.after(()=>renders.close());
  assert.throws(()=>renders.validateRender(deck.id),/requires a video/);
});

test('graphics reject deck card targets at HTTP, service and publication boundaries without changing slides', async t => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'storybench-deck-graphics-'));
  let renderCalls = 0;
  const app = await createApp({ workspace: root, renderOptions: {
    renderGraphic: async ({ outputPath }) => {
      renderCalls++;
      writeFileSync(outputPath, 'synthetic graphic');
      return { path: outputPath, kind: 'image', width: 320, height: 180 };
    },
  } });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await app.close(); rmSync(root, { recursive: true, force: true }); });
  const s = app.store, deck = s.createEpisode({ kind: 'deck' });
  const asset = s.saveAsset({ name: 'image.png', hash: 'slide-media', kind: 'image', path: 'media/image.png' });
  const item = s.attachLibraryItem(deck.id, asset.id, { category: 'B-roll' });
  s.saveDeck(deck.id, 1, [{ ...slide(), eyebrow: 'Context', caption: 'Caption',
    columns: [{ title: 'Column', body: 'Detail' }], media: { itemId: item.id, alt: 'Visual' },
    subnav: [{ id: 'view', label: 'Detail', itemId: item.id }] }]);
  const before = s.db.prepare('SELECT * FROM episodes WHERE id=?').get(deck.id);
  const history = s.listEpisodeHistory(deck.id);
  const origin = `http://127.0.0.1:${app.server.address().port}`;
  const base = `/api/episodes/${deck.id}/graphics`;
  const request = (url, body, method = 'POST') => fetch(origin + url, { method,
    headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const input = { name: 'Graphic', recipe: { kind: 'still', width: 320, height: 180, layers: [] } };
  const targeted = { ...input, cardId: 'slide_one' };
  assert.equal((await request(base, targeted)).status, 409);
  assert.throws(() => app.renders.createGraphicRecipe(deck.id, targeted), /requires a video/);
  assert.throws(() => s.createGraphicRecipe(deck.id, { ...targeted, kind: 'still' }), /requires a video/);
  assert.deepEqual(s.listGraphicRecipes(deck.id), []);

  const created = await request(base, input);
  assert.equal(created.status, 201);
  const recipe = await created.json();
  assert.equal((await request(`${base}/${recipe.id}`, { ...targeted, expectedRecipeRevision: 1 }, 'PUT')).status, 409);
  assert.throws(() => app.renders.updateGraphicRecipe(deck.id, recipe.id, 1, targeted), /requires a video/);
  assert.equal(s.getGraphicRecipe(deck.id, recipe.id).revision, 1);

  // Simulate a previously accepted target, so dispatch cannot rely on creation validation.
  s.db.prepare('UPDATE graphic_recipes SET card_id=? WHERE id=?').run('slide_one', recipe.id);
  assert.equal((await request(`${base}/${recipe.id}/render`, { expectedRecipeRevision: 1 })).status, 409);
  assert.throws(() => app.renders.enqueueGraphic({ episodeId: deck.id, recipeId: recipe.id, expectedRecipeRevision: 1 }), /requires a video/);
  assert.deepEqual(s.listJobs(deck.id), []);
  assert.equal(renderCalls, 0);
  const candidate = { name: 'result.png', hash: 'result', kind: 'image', path: 'media/result.png' };
  assert.throws(() => s.publishGraphicOutput(deck.id, candidate, { recipeId: recipe.id, recipeRevision: 1,
    jobId: 'blocked', targetCard: { id: 'slide_one' }, expectedEpisodeRevision: 2 }), /requires a video/);
  assert.equal(s.getAssetByHash(candidate.hash, deck.channelId), undefined);
  assert.equal(s.listEpisodeLibrary(deck.id).length, 1);

  // Untargeted graphics remain reusable deck media, with no video-card mapping.
  s.db.prepare('UPDATE graphic_recipes SET card_id=NULL WHERE id=?').run(recipe.id);
  const accepted = await request(`${base}/${recipe.id}/render`, { expectedRecipeRevision: 1 });
  assert.equal(accepted.status, 202);
  const job = await accepted.json();
  for (let attempt = 0; attempt < 100 && ['queued', 'running'].includes(s.getJob(job.id).state); attempt++)
    await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(s.getJob(job.id).state, 'completed');
  assert.equal(s.getJob(job.id).snapshot.appliedToCard, false);
  assert.equal(s.listEpisodeLibrary(deck.id).length, 2);
  assert.deepEqual(s.db.prepare('SELECT * FROM episodes WHERE id=?').get(deck.id), before);
  assert.deepEqual(s.listEpisodeHistory(deck.id), history);
  assert.deepEqual(s.getDeck(deck.id).slides, JSON.parse(before.cards));
});

test('staged vector editor persists group mappings, reorder/duplicate identity and removal through saved data', t => {
  const f = fixture(t), s = f.store, deck = s.createEpisode({ kind: 'deck' });
  const asset = s.saveAsset({ name: 'plan.svg', hash: 'vector-editor', kind: 'image', path: 'media/plan.svg',
    metadata: { contentType: 'image/svg+xml', svgGroupIds: ['observe', 'connect', 'plan'] } });
  const item = s.attachLibraryItem(deck.id, asset.id, { category: 'Graphics' });
  const slides = [{ id: 'vector', title: 'A plan', layout: 'process', notes: 'Three steps' }];
  const dom = new JSDOM('<main></main>'), root = dom.window.document.querySelector('main');
  t.after(() => dom.window.close());
  const render = () => { root.innerHTML = `<div data-slide-index="0">${elementCardsHTML(slides[0], 0, { items: [item], sections: [] })}</div>`; };
  render(); bindElementCards(root, { getSlides: () => slides, getItems: () => [item], onDirty() {}, onSave() {}, render });
  const edit = (selector, value) => { const field = root.querySelector(selector); field.value = value; for (const name of ['input', 'change']) field.dispatchEvent(new dom.window.Event(name, { bubbles: true })); };
  // Star the drawing to create its first step, add the second, then assign the last part in the table.
  edit('[data-candidate-add]', item.id);
  root.querySelector(`[data-candidate-star="${item.id}"]`).click();
  edit('[data-slide-field="vectorAlt"]', 'Three parts of a shared plan');
  edit('[data-add-element]', 'step');
  assert.deepEqual(slides[0].stages.map(stage => stage.svgGroupIds), [['observe'], ['connect']]);
  const second = slides[0].stages[1].id;
  edit('[data-part-appears="plan"]', '1');
  root.querySelector('[data-part-index="1"] [data-slide-action="part-up"]').click();
  const list = dom.window.document.createElement('ol');
  list.innerHTML = slideListHTML(slides, [item], null);
  bindSlideList(list, { getSlides: () => slides, getOpenId: () => null, setOpenId() {}, onPlay() {}, onEdit() {}, onChange() {} });
  list.querySelector('[data-slide-action="duplicate"]').click();
  assert.equal(slides[0].stages[0].id, second);
  assert.deepEqual(slides[0].stages[0].svgGroupIds, ['connect', 'plan']);
  assert.notEqual(slides[0].stages[0].id, slides[1].stages[0].id);
  const saved = s.saveDeck(deck.id, 1, slides);
  assert.deepEqual(f.reopen().getDeck(deck.id).slides, saved.slides);
  // The starred SVG cannot be deleted (spec #46 delete guard); its mappings stay.
  assert.throws(() => f.store.deleteLibraryItem(deck.id, item.id, item.revision, saved.revision), /is starred on slide 01/);
  assert.deepEqual(f.store.getDeck(deck.id).slides, saved.slides);
  assert.ok(f.store.getAsset(asset.id));
});

test('vector mappings reject absent/duplicate groups, wrong assets and ambiguous compositions without saving', t => {
  const { store: s } = fixture(t), deck = s.createEpisode({ kind: 'deck' });
  const asset = s.saveAsset({ name: 'plan.svg', hash: 'vector-validation', kind: 'image', path: 'media/plan.svg',
    metadata: { contentType: 'image/svg+xml', svgGroupIds: ['one', 'two'] } });
  const item = s.attachLibraryItem(deck.id, asset.id, { category: 'Graphics' });
  const valid = { id: 'mapped', title: 'Mapped', layout: 'process', vector: { itemId: item.id, alt: 'Plan' }, stages: [
    { id: 'first', title: 'First', svgGroupIds: ['one'] }, { id: 'second', title: 'Second', svgGroupIds: ['two'] },
  ] };
  for (const mutate of [
    v => { v.stages[0].svgGroupIds = []; }, v => { v.stages[0].svgGroupIds = ['missing']; },
    v => { v.stages[0].svgGroupIds = ['one', 'one']; }, v => { v.stages[1].svgGroupIds = ['one']; },
    v => { v.stages[0].svgGroupIds = 'one'; }, v => { delete v.stages[0].svgGroupIds; },
    v => { delete v.vector; }, v => { v.vector.itemId = 'not-a-member'; },
    v => { v.media = { itemId: item.id }; }, v => { v.layout = 'columns'; },
    v => { v.stages[1].id = v.stages[0].id; }, v => { v.stages[1].afterMs = 3600001; },
  ]) {
    const value = structuredClone(valid); mutate(value);
    assert.throws(() => s.saveDeck(deck.id, 1, [value]));
    assert.equal(s.getDeck(deck.id).revision, 1);
  }
  const raster = s.saveAsset({ name: 'photo.png', hash: 'raster-validation', kind: 'image', path: 'media/photo.png' });
  const rasterItem = s.attachLibraryItem(deck.id, raster.id, { category: 'Graphics' });
  assert.throws(() => s.saveDeck(deck.id, 1, [{ ...valid, vector: { itemId: rasterItem.id } }]), /registered SVG/);
  const unrelated = s.createEpisode({ kind: 'deck' });
  assert.throws(() => s.saveDeck(unrelated.id, 1, [valid]), /library item not found/);
  assert.equal(s.saveDeck(deck.id, 1, [valid]).revision, 2);
});

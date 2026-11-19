import path from 'node:path';
import { constants } from 'node:fs';
import { mkdir, open, realpath, writeFile, rename, rm } from 'node:fs/promises';
import { buildDeck, DECK_STATE_REPORTING } from './deck-template/build.js';
import { HeavyJobQueue } from './job-runner.js';
import { StoreError } from './store.js';
import { createHash } from 'node:crypto';
import { looksLikeSvg, parseSvg } from './svg.js';
import { readFileSync } from 'node:fs';
import { effectiveDeckTheme, themeBuildValues, effectiveSlideDesign, slideHasVisual } from './deck-data.js';

// Uncompressed standard ZIP: portable, deterministic and no shell/archive dependency.
export function zipBundle(files) {
  const local = [], central = []; let offset = 0;
  for (const [name, value] of files) {
    const data = Buffer.from(value), filename = Buffer.from(name); let crc = 0xffffffff;
    for (const byte of data) { crc ^= byte; for (let i=0;i<8;i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
    crc = (crc ^ 0xffffffff) >>> 0;
    const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20,4); header.writeUInt32LE(crc,14); header.writeUInt32LE(data.length,18); header.writeUInt32LE(data.length,22); header.writeUInt16LE(filename.length,26);
    const entry = Buffer.alloc(46); entry.writeUInt32LE(0x02014b50); entry.writeUInt16LE(20,4); entry.writeUInt16LE(20,6); entry.writeUInt32LE(crc,16); entry.writeUInt32LE(data.length,20); entry.writeUInt32LE(data.length,24); entry.writeUInt16LE(filename.length,28); entry.writeUInt32LE(offset,42);
    local.push(header,filename,data); central.push(entry,filename); offset += header.length + filename.length + data.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(files.size,8); end.writeUInt16LE(files.size,10); end.writeUInt32LE(directory.length,12); end.writeUInt32LE(offset,16);
  return Buffer.concat([...local,directory,end]);
}
const CANVAS_FRAME = readFileSync(new URL('./deck-template/canvas-frame.js', import.meta.url));
// The build's input from the saved deck. Live inheritance (spec #44): each role is the deck theme's,
// else the channel's current Brand Standards, else the template's.
export function deckSnapshot(store, episodeId, deck = store.getDeck(episodeId)) {
  const theme = effectiveDeckTheme(store.getBrandStandards(deck.channelId), deck.design), { colors, fonts } = themeBuildValues(theme);
  // Publication checks the retained SVG itself, including for older saved mappings.
  const valid = store.validateDeckSlides(episodeId,deck.slides,deck.design,{checkRevealParts:false}), { theme:_theme, ...defaults } = deck.design ?? {};
  // Layout primitives: the deck defaults and each slide's effective values (slide, else deck, else template).
  const design = { deck:defaults, slides:Object.fromEntries(valid.map(slide => [slide.id,effectiveSlideDesign(defaults,slide.design,{hasVisual:slideHasVisual(slide)})])) };
  // The build reads only the picks in today's fields (decision #123): candidates and pickSetBy stay out.
  return { title:deck.title, slides:valid.map(({ candidates:_candidates, pickSetBy:_pickSetBy, ...slide }) => slide), story:deck.story, sourceRevision:deck.revision, fonts, colors, theme, design, library:store.listEpisodeLibrary(episodeId) };
}
// Reads the registered media of `slides` (verified against its hash) and builds them with the snapshot's theme.
async function assembleDeck(store, snapshot, slides, signal = null) {
  const assets = {}, provenance = {}, root = await realpath(store.workspace);
  async function media(itemId, slideId) {
    const item = snapshot.library.find(i => i.id === itemId), asset = item?.asset;
    if (!asset || !['image','video'].includes(asset.kind)) throw new Error(`Slide ${slideId}: missing image/video ${itemId}`);
    const source = path.resolve(root,asset.path);
    let actual;
    try { actual = await realpath(source); } catch { throw new Error(`Slide ${slideId}: missing media ${itemId}`); }
    if (!source.startsWith(root + path.sep) || actual !== source) throw new Error(`Slide ${slideId}: unsafe media path`);
    const handle = await open(source,constants.O_RDONLY | constants.O_NOFOLLOW);
    let bytes; try { if (!(await handle.stat()).isFile()) throw new Error('Media is not a file'); bytes = await handle.readFile(); } finally { await handle.close(); }
    if (createHash('sha256').update(bytes).digest('hex') !== asset.hash) throw new Error(`Slide ${slideId}: media ${itemId} differs from its registered source`);
    let vector;
    if (looksLikeSvg(bytes)) {
      try { vector = parseSvg(bytes); } catch (error) { throw new Error(`Slide ${slideId}, asset ${itemId}: ${error.message}`); }
    }
    const extension = vector && asset.kind === 'image' ? '.svg' : asset.kind === 'video'
      ? (bytes.subarray(4,8).toString() === 'ftyp' ? '.mp4' : bytes.subarray(0,4).toString('hex') === '1a45dfa3' ? '.webm' : null)
      : (bytes.subarray(0,8).toString('hex') === '89504e470d0a1a0a' ? '.png' : bytes.subarray(0,3).toString('hex') === 'ffd8ff' ? '.jpg' : bytes.subarray(0,3).toString() === 'GIF' ? '.gif' : bytes.subarray(8,12).toString() === 'WEBP' ? '.webp' : null);
    if (!extension) throw new Error(`Slide ${slideId}: unsupported media format; use supported SVG, PNG/JPEG/GIF/WebP or MP4/WebM`);
    const src = `assets/media_${asset.id.replace(/[^a-zA-Z0-9_-]/g,'_')}${extension}`;
    // Bundle provenance uses durable identities, never host paths or conversation content.
    provenance[itemId] = { itemId, assetId: asset.id, channelId: asset.channelId, sourceSha256: asset.hash, file: src,
      ...(vector ? { svgProfile: vector.profile, editableSource: src } : {}),
      ...(item.provenance?.reusedFrom ? { reusedFrom: { itemId: item.provenance.reusedFrom.itemId, assetId: item.provenance.reusedFrom.assetId, channelId: item.provenance.reusedFrom.channelId } } : {}) };
    assets[src] = bytes; return {type:asset.kind,src,alt:asset.name || 'Deck media'};
  }
  const built = [];
  for (const saved of slides) {
    signal?.throwIfAborted(); const slide = {...saved,subnav:undefined,design:snapshot.design.slides[saved.id]};
    if (saved.media) slide.media = {...await media(saved.media.itemId,saved.id),alt:saved.media.alt || saved.title};
    if (saved.vector) slide.vector = {...await media(saved.vector.itemId,saved.id),alt:saved.vector.alt || saved.title};
    slide.gallery = [];
    for (const entry of saved.subnav) slide.gallery.push({id:entry.id,label:entry.label,...(entry.itemId ? {media:await media(entry.itemId,saved.id)} : {})});
    built.push(slide);
  }
  return { files: buildDeck({title:snapshot.title,slides:built,fonts:snapshot.fonts,colors:snapshot.colors},{assets}), provenance };
}
export function createDeckService({ store, queue = new HeavyJobQueue(), onChange = () => {} }) {
  const update = (job, changes) => { const value = store.saveJob({...job,...changes}); onChange(job.episodeId); return value; };
  const getJob = (episodeId, jobId) => {
    store.requireProductionKind(episodeId,'deck'); const job = store.getJob(jobId);
    if (!job || job.episodeId !== episodeId || job.kind !== 'deck') throw new StoreError('Deck job not found',404);
    return job;
  };
  // The Slides canvas: one slide of the saved deck, built exactly as the bundle builds it, plus the
  // canvas bridge. One build per slide is kept for the frame's follow-up requests, so the slide list's
  // preview and the editor's canvas do not evict each other.
  const canvases = new Map();
  async function canvasFiles(episodeId, revision, slideId) {
    const deck = store.getDeck(episodeId);
    if (deck.revision !== revision) throw new StoreError('The deck changed; reload the canvas', 409);
    if (!deck.slides.some(slide => slide.id === slideId)) throw new StoreError('Slide not found', 404);
    const standardsRevision = store.getBrandStandards(deck.channelId).revision;
    const key = `${revision}:${slideId}:${standardsRevision}`, slot = `${episodeId}\n${slideId}`;
    let entry = canvases.get(slot);
    if (entry?.key !== key) {
      const snapshot = deckSnapshot(store, episodeId, deck);
      entry = { key, files: assembleDeck(store, snapshot, snapshot.slides.filter(slide => slide.id === slideId)).then(({ files }) => {
        files.set('index.html', Buffer.from(String(files.get('index.html')).replace('<script src="audience.js" defer></script>', `$&<script src="canvas-frame.js" data-standards-revision="${standardsRevision}" defer></script>`)));
        files.set('canvas-frame.js', CANVAS_FRAME);
        return files;
      }, error => { throw new StoreError(`This slide cannot be shown yet: ${error.message}`, 422); }) };
      canvases.delete(slot); canvases.set(slot, entry);
      while (canvases.size > 4) canvases.delete(canvases.keys().next().value);
      entry.files.catch(() => { if (canvases.get(slot) === entry) canvases.delete(slot); });
    }
    return entry.files;
  }
  async function canvasFile(episodeId, revision, slideId, name) {
    const files = await canvasFiles(episodeId, revision, slideId);
    if (!files.has(name)) throw new StoreError('Canvas file not found', 404);
    return files.get(name);
  }
  return {
    canvasFile,
    // The whole canvas build of one saved slide, for the slide editor's Markup capture.
    canvasFiles,
    hasActiveWork: () => Boolean(queue.active || queue.pending.length || queue.draining),
    getJob,
    enqueue({ episodeId, expectedRevision, requestId = null }) {
      queue.assertOpen(); const deck = store.getDeck(episodeId);
      if (deck.revision !== expectedRevision) throw new StoreError('Stale deck revision; save/reload before building',409);
      const snapshot = deckSnapshot(store, episodeId, deck);
      const job = store.saveJob({ episodeId, kind:'deck', state:'queued', revision:deck.revision, snapshot, outputClass:'deck_bundle', requestId });
      queue.enqueue(job.id, async signal => {
        let staging, published;
        try {
          update(job,{state:'running',progress:0.1}); signal.throwIfAborted();
          const root = await realpath(store.workspace);
          const { files, provenance } = await assembleDeck(store, snapshot, snapshot.slides, signal);
          const manifest = {sourceRevision:deck.revision,productionId:episodeId,stateReporting:DECK_STATE_REPORTING,fonts:snapshot.fonts,colors:snapshot.colors,theme:snapshot.theme,design:snapshot.design,assets:Object.values(provenance),files:[...files.keys(),'manifest.json']};
          files.set('manifest.json',JSON.stringify(manifest,null,2));
          const parent = path.join(store.episodeDirectory(episodeId),'outputs','decks');
          await mkdir(parent,{recursive:true});
          if (await realpath(parent) !== parent) throw new Error('Unsafe deck output directory');
          staging = path.join(parent,`.${job.id}.staging`); await mkdir(staging);
          for (const [name,bytes] of files) { signal.throwIfAborted(); await mkdir(path.dirname(path.join(staging,name)),{recursive:true}); await writeFile(path.join(staging,name),bytes,{flag:'wx'}); }
          const zip = zipBundle(files), bundleSha256 = createHash('sha256').update(zip).digest('hex');
          await writeFile(path.join(staging,'bundle.zip'),zip,{flag:'wx'});
          update(job,{state:'running',progress:0.9}); signal.throwIfAborted();
          published = path.join(parent,job.id); await rename(staging,published); staging = null;
          signal.throwIfAborted(); update(job,{state:'completed',progress:1,outputPath:path.relative(root,path.join(published,'bundle.zip')),snapshot:{...snapshot,manifest,bundleSha256}});
        } catch (error) {
          if (published) await rm(published,{recursive:true,force:true});
          update(job,{state:signal.aborted ? 'cancelled' : 'failed',error:error.message});
        } finally { if (staging) await rm(staging,{recursive:true,force:true}); }
      }, reason => update(job,{state:'cancelled',error:reason}));
      return job;
    },
    cancelJob(episodeId,jobId) { const job = getJob(episodeId,jobId); if (['queued','running'].includes(job.state)) queue.cancel(jobId); return getJob(episodeId,jobId); },
    close: () => queue.close(),
  };
}

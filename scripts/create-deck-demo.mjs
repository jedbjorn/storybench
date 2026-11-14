import path from 'node:path';
import { mkdir, mkdtemp, copyFile, rm } from 'node:fs/promises';
import os from 'node:os';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Store } from '../src/store.js';
import { openDataRoot } from '../src/services/data-root.js';
import { importMedia } from '../src/media.js';
import { demoSlides } from '../src/deck-demo.js';

// Explicit CLI entry only; importing the module is side-effect free.
export async function createDemo(store) {
  const temp=await mkdtemp(path.join(os.tmpdir(),'sb-demo-'));
  try {
    await copyFile(new URL('../src/deck-template/example-assets/example.png',import.meta.url),path.join(temp,'study.png'));
    await promisify(execFile)('ffmpeg',['-v','error','-f','lavfi','-i','testsrc2=size=640x360:rate=12','-t','2','-c:v','libvpx-vp9','-an',path.join(temp,'motion.webm')]);
    const deck=store.createEpisode({kind:'deck',title:'A clearer path — editable demo'}), items=[];
    for(const name of ['study.png','motion.webm']) {
      const media=await importMedia({workspace:store.workspace,sourcePath:path.join(temp,name),mediaDirectory:store.channelMediaDirectory(deck.channelId)});
      const asset=store.saveAsset({...media,channelId:deck.channelId});
      items.push(store.attachLibraryItem(deck.id,asset.id,{category:'B-roll',label:name}).id);
    }
    const story=store.getStory(deck.id);
    store.saveStory(deck.id,story.storyRevision,'# A clearer path\n\nA synthetic eight-slide narrative about learning together.\n\n## The experiment\n\nNotice, frame, try and learn.');
    return store.saveDeck(deck.id,store.getDeck(deck.id).revision,demoSlides(...items));
  } finally { await rm(temp,{recursive:true,force:true}); }
}
if(process.argv[1] === fileURLToPath(import.meta.url)) {
  const [flag,folder]=process.argv.slice(2);
  if(!['--workspace','--data-root'].includes(flag) || !folder || !path.isAbsolute(folder)) throw new Error('Usage: node scripts/create-deck-demo.mjs --workspace /absolute/demo-workspace (or --data-root /existing/root)');
  if(flag==='--workspace') await mkdir(folder,{recursive:true});
  const store=flag==='--data-root' ? openDataRoot(folder) : new Store(folder);
  try { const deck=await createDemo(store); console.log(JSON.stringify({id:deck.id,title:deck.title,slides:deck.slides.length,revision:deck.revision})); } finally { store.close(); }
}

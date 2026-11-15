import path from 'node:path';
import { mkdtemp, copyFile, rm } from 'node:fs/promises';
import os from 'node:os';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { importMedia } from './media.js';

// Synthetic content in the exact schema edited by the app and agent tools.
export function demoSlides(imageId, videoId, vectorId) {
  const slide = (id,layout,title,body,extra={}) => ({id,layout,title,body,eyebrow:'Field notes / 2030',targetMinutes:1,notes:`Explain “${title}” in your own words, then pause for questions.`,...extra});
  return [
    slide('opening','title','A clearer path to shared ideas','A small team turns scattered observations into one useful experiment.'),
    slide('problem','statement','The signal is already here','The challenge is giving people enough space to see it.',{notes:'Ask the audience where useful observations disappear in their own work.'}),
    slide('chapter','section','From observation to action','Three habits, one repeatable loop.'),
    slide('explain','text-media','Make the work visible','A simple visual gives the conversation somewhere to begin.',{media:{itemId:vectorId ?? imageId,alt:'Synthetic geometric landscape'},caption:'Original synthetic illustration; no private source assets.'}),
    slide('compare','columns','Choose the smallest useful experiment','Compare habits rather than people.',{columns:[{title:'Before',body:'Scattered notes\nUnspoken assumptions\nA large uncertain launch'},{title:'After',body:'One shared picture\nA question we can test\nA small reversible trial'}]}),
    slide('process','process','A loop that learns','Move from curiosity to evidence.',{...(vectorId ? {vector:{itemId:vectorId,alt:'Editable observation, connection and planning diagram'}} : {}),stages:[{id:'notice',title:'Notice',body:'Collect an observation.'},{id:'frame',title:'Frame',body:'Name the question.',afterMs:1800},{id:'try',title:'Try',body:'Run a small experiment.',afterMs:1800},{id:'learn',title:'Learn',body:'Keep the useful signal.',afterMs:1800}].map((stage,i)=>vectorId ? {...stage,svgGroupIds:[['landscape','observe','connect','plan'][i]]} : stage)}),
    slide('demo','full-media','See the experiment in motion','Use the views to compare a still with a short motion study.',{media:{itemId:videoId,alt:'Synthetic moving color study'},subnav:[{id:'still',label:'Still study',itemId:imageId},{id:'motion',label:'Motion study',itemId:videoId}],notes:'Play the short local video. Select each gallery view. Ask which representation communicates the idea more clearly.'}),
    slide('close','statement','One question. One experiment.','What could your team learn this week?',{notes:'Invite each participant to name one small experiment. End with a concrete next action.'}),
  ];
}

export async function createDemo(store) {
  const temp=await mkdtemp(path.join(os.tmpdir(),'sb-demo-'));
  try {
    await copyFile(new URL('./deck-template/example-assets/example.png',import.meta.url),path.join(temp,'study.png'));
    await promisify(execFile)('ffmpeg',['-v','error','-f','lavfi','-i','testsrc2=size=640x360:rate=12','-t','8','-c:v','libvpx-vp9','-threads','1','-an',path.join(temp,'motion.webm')]);
    const deck=store.createEpisode({kind:'deck',title:'A clearer path — editable demo'}), items=[];
    for(const name of ['study.png','motion.webm']) {
      const media=await importMedia({workspace:store.workspace,sourcePath:path.join(temp,name),mediaDirectory:store.channelMediaDirectory(deck.channelId)});
      const asset=store.saveAsset({...media,channelId:deck.channelId});
      items.push(store.attachLibraryItem(deck.id,asset.id,{category:'B-roll',label:name}).id);
    }
    store.ensureEpisodeDirectories(deck.id);
    const vectorPath=path.join(store.episodeWorkDirectory(deck.id),'editable-plan.svg');
    await copyFile(new URL('./runtime/fixtures/svg-illustration.svg',import.meta.url),vectorPath);
    const vector=await importMedia({workspace:store.workspace,sourcePath:vectorPath,mediaDirectory:store.channelMediaDirectory(deck.channelId)});
    const asset=store.saveAsset({...vector,channelId:deck.channelId});
    items.push(store.attachLibraryItem(deck.id,asset.id,{category:'Graphics',label:'Editable vector plan'}).id);
    const story=store.getStory(deck.id);
    store.saveStory(deck.id,story.storyRevision,'# A clearer path\n\nA synthetic eight-slide narrative about learning together.\n\n## The experiment\n\nNotice, frame, try and learn.');
    return store.saveDeck(deck.id,store.getDeck(deck.id).revision,demoSlides(...items));
  } finally { await rm(temp,{recursive:true,force:true}); }
}

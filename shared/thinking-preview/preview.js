(() => {
'use strict';
const kit={
 rect(c,x,y,w,h,color){c.fillStyle=color;c.fillRect(Math.round(x),Math.round(y),Math.round(w),Math.round(h));},
 line(c,x1,y1,x2,y2,color,width=1){c.strokeStyle=color;c.lineWidth=width;c.beginPath();c.moveTo(Math.round(x1)+.5,Math.round(y1)+.5);c.lineTo(Math.round(x2)+.5,Math.round(y2)+.5);c.stroke();},
 ease(t){t=Math.max(0,Math.min(1,t));return t*t*(3-2*t);},
 lerp(a,b,t){return a+(b-a)*t;},
 star(c,x,y,color,size=2){kit.rect(c,x-size,y,size*2+1,1,color);kit.rect(c,x,y-size,1,size*2+1,color);},
 tile(c,x,y,w,h,mode,color='#a9c990',variant=0){
 kit.rect(c,x+2,y+3,w,h,'#0b1419');kit.rect(c,x,y,w,h,'#3b5060');kit.rect(c,x+1,y+1,w-2,h-2,'#e7e5ce');kit.rect(c,x+3,y+3,w-6,h-6,color);
 if(mode==='video'){kit.rect(c,x+1,y+1,w-2,3,'#263a42');kit.rect(c,x+1,y+h-4,w-2,3,'#263a42');for(let i=3;i<w-3;i+=6){kit.rect(c,x+i,y+2,2,1,'#a4b0a3');kit.rect(c,x+i,y+h-3,2,1,'#a4b0a3');}kit.rect(c,x+5,y+h/2,w/3,h/3,'#637e69');kit.rect(c,x+w*.6,y+7,4,4,'#fff0ba');}
 else{kit.rect(c,x+5,y+5,w*.5,2,'#344f4a');for(let i=0;i<3;i++)kit.rect(c,x+5+i*5,y+h-6-(i+variant)%3*3,3,3+(i+variant)%3*3,'#557e73');}
 }
};
window.previewKit=kit;
const gallery=document.querySelector('#gallery');const views=[];
window.thinkingConcepts.sort((a,b)=>a.id-b.id).forEach(concept=>{
 const section=document.createElement('section');section.className='concept';section.innerHTML=`<div class="concept-heading"><span class="number">0${concept.id}</span><h2></h2></div><p class="description"></p><div class="pair"></div>`;
 section.querySelector('h2').textContent=concept.title;section.querySelector('.description').textContent=concept.description;
 for(const mode of ['video','presentation']){const figure=document.createElement('figure');figure.className='scene';figure.innerHTML='<canvas width="384" height="216" role="img"></canvas><figcaption><span></span><span class="stage-caption"></span></figcaption>';const canvas=figure.querySelector('canvas');canvas.setAttribute('aria-label',`${concept.title}, ${mode}: collecting thoughts, arranging, creating`);figure.querySelector('figcaption span').textContent=mode==='video'?'▸ Video':'▤ Presentation';section.querySelector('.pair').append(figure);views.push({concept,mode,ctx:canvas.getContext('2d'),caption:figure.querySelector('.stage-caption')});}gallery.append(section);
});
let elapsed=0,playing=!matchMedia('(prefers-reduced-motion: reduce)').matches,last=performance.now();const duration=12000;const names=['Collecting thoughts','Arranging ideas','Creating your story','Ready to share'];const play=document.querySelector('#play');const timeline=document.querySelector('#timeline');
function draw(){const whole=elapsed/duration;const t=Math.min(whole/.85,.999999);const phase=whole>=.85?3:Math.floor(t*3);for(const v of views){v.ctx.save();v.ctx.imageSmoothingEnabled=false;v.ctx.clearRect(0,0,384,216);v.concept.draw(v.ctx,t,v.mode,kit);v.ctx.restore();v.caption.textContent=phase===3?'Ready':v.concept.stages[phase];}document.querySelector('#clock').textContent=names[phase];document.querySelector('#response-status').textContent=phase===3?'Complete':names[phase]+'…';document.querySelector('#message').hidden=phase!==3;document.querySelector('#waiting').hidden=phase===3;document.querySelectorAll('[data-stage]').forEach(b=>b.classList.toggle('active',Number(b.dataset.stage)===phase));timeline.value=Math.round(whole*1000);play.textContent=playing?'Pause':'Play';}
play.onclick=()=>{playing=!playing;if(playing&&elapsed>=duration)elapsed=0;draw();};document.querySelector('#restart').onclick=()=>{elapsed=0;playing=true;draw();};document.querySelectorAll('[data-stage]').forEach(b=>b.onclick=()=>{const phase=Number(b.dataset.stage);elapsed=phase===3?duration*.92:duration*.85*(phase+.5)/3;playing=false;draw();});timeline.oninput=()=>{elapsed=Number(timeline.value)/1000*duration;playing=false;draw();};document.querySelector('#compact').onchange=e=>gallery.classList.toggle('compact',e.target.checked);
function frame(now){if(playing){elapsed+=Math.min(now-last,100);if(elapsed>=duration){if(document.querySelector('#loop').checked)elapsed%=duration;else{elapsed=duration;playing=false;}}}last=now;draw();requestAnimationFrame(frame);}requestAnimationFrame(frame);
})();

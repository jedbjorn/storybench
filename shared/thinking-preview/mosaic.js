/* Standalone canvas study, registered for the shared preview player. */
window.thinkingConcepts.push({id:5,title:'The mosaic',description:'A constellation of little ingredients becomes a composition. Precise, colorful, and quietly satisfying.',stages:['Gather the fragments','Find the composition','Bring it to life'],draw(c,t,mode,k){
 const {rect:r,line:l,ease:e,lerp:m,star:s}=k;const p=Math.min(2,Math.floor(t*3)),u=t*3-p;
 r(c,0,0,384,216,'#15212b');for(let y=8;y<216;y+=12)for(let x=8;x<384;x+=12)r(c,x,y,1,1,'#22313a');
 // Shallow stepped alcove and luminous work surface.
 r(c,59,30,266,151,'#1a2a35');r(c,63,26,258,159,'#1a2a35');r(c,78,176,228,4,'#344951');r(c,91,180,202,3,'#0e1b25');
 for(let i=0;i<12;i++){const a=i*.73+1.1,x=192+Math.cos(a)*142,y=104+Math.sin(a)*79;s(c,x,y,'#47545b',i%3===0?2:1);}
 const palette=['#e4b97c','#c98877','#9ebea6','#89aeb6','#d1cfab','#a79ac3'];const assemble=p===0?e(u)*.32:p===1?.32+e(u)*.68:1;
 for(let i=0;i<24;i++){
 const col=i%6,row=Math.floor(i/6),gx=115+col*26,gy=59+row*24;
 const angle=i*2.39996,sx=192+Math.cos(angle)*(78+(i%4)*17),sy=105+Math.sin(angle)*(42+(i%3)*13);
 let x=m(sx,gx,assemble),y=m(sy,gy,assemble);if(p===0){x+=Math.sin(u*5+i)*2*(1-u);y+=Math.cos(u*4+i)*2*(1-u);}
 const size=p===2?24:18+6*assemble;const color=palette[(i+row)%palette.length];r(c,x+2,y+3,size,21,'#0b1721');r(c,x,y,size,21,color);r(c,x+1,y+1,size-2,1,'#e8ddc0');r(c,x+1,y+19,size-2,2,'#596d6d');
 if(mode==='video'){r(c,x+2,y+3,3,2,'#44585c');r(c,x+size-5,y+3,3,2,'#44585c');r(c,x+4,y+13,8,4,'#597b74');r(c,x+11,y+9,8,8,'#78968b');r(c,x+15,y+6,3,3,'#f8e8b6');}
 else{r(c,x+4,y+5,size-8,2,'#53656a');r(c,x+4,y+10,6,6,'#718f87');r(c,x+13,y+10,7,1,'#53656a');r(c,x+13,y+13,5,1,'#53656a');}
 }
 if(p===1){const sweep=58+u*98;l(c,110,sweep,274,sweep,'#efe6b3');s(c,278,sweep,'#efe6b3',3);}
 if(p===2){
 const reveal=e(Math.min(1,u*2));c.globalAlpha=reveal;
 if(mode==='video'){
 r(c,109,52,166,108,'#253640');r(c,112,55,160,102,'#e5d5af');r(c,116,64,152,84,'#87aeb7');
 // A complete little landscape, alive inside a film frame.
 r(c,116,111,152,37,'#6c9384');r(c,130,101,59,19,'#6c9384');r(c,145,92,28,14,'#6c9384');r(c,194,118,74,30,'#405f62');r(c,213,106,55,20,'#405f62');r(c,228,96,25,16,'#405f62');
 r(c,230,75,11,11,'#fae4a1');const drift=Math.floor(u*12);r(c,143+drift,78,28,4,'#d9e0ca');r(c,149+drift,74,15,4,'#d9e0ca');r(c,190-drift,87,19,3,'#d9e0ca');
 for(let i=0;i<14;i++){r(c,117+i*11,58,5,3,'#314752');r(c,117+i*11,151,5,3,'#314752');}r(c,177,157,30,10,'#253640');r(c,190,160,3,4,'#e4d6b2');r(c,193,161,2,2,'#e4d6b2');
 }else{
 r(c,122,67,153,100,'#63797f');r(c,116,61,153,100,'#a5b5a3');r(c,109,54,153,100,'#e5d5b3');r(c,114,59,143,90,'#f0e5c9');r(c,122,67,74,5,'#344c54');r(c,122,78,47,2,'#91a498');r(c,122,85,58,2,'#91a498');r(c,122,98,50,39,'#90aca5');r(c,129,123,9,8,'#3f6966');r(c,142,114,9,17,'#3f6966');r(c,155,105,9,26,'#3f6966');r(c,183,100,62,3,'#6a8a83');r(c,183,109,56,2,'#a8b5a0');r(c,183,117,60,2,'#a8b5a0');r(c,183,125,41,2,'#a8b5a0');r(c,237,139,8,3,'#b28c68');
 }c.globalAlpha=1;
 for(let i=0;i<8;i++){const a=i*Math.PI/4,dist=90+Math.sin(u*Math.PI)*10;s(c,192+Math.cos(a)*dist,106+Math.sin(a)*70,u>.3?'#e9d3a1':'#8caa9b',i%2+1);}
 }
 // Phase markers are visual, not fake progress percentages.
 for(let i=0;i<3;i++)r(c,179+i*10,197,i===p?6:4,3,i===p?'#e3d9b4':'#41545b');
}});

import {chromium} from '@playwright/test';
import fs from 'node:fs/promises';
const label=process.argv.includes('--before')?'before':'after';
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:900}});
const results=[];
try{
 await page.goto('http://127.0.0.1:5173/',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__gallery&&!document.querySelector('.loading'));
 async function record(name,action){
  await page.evaluate(()=>{window.__motionFrames=[];window.__recordMotion=true;const take=t=>{const g=window.__gallery;window.__motionFrames.push({t,p:g.camera.position.toArray(),q:g.camera.quaternion.toArray(),moving:g.moving});if(window.__recordMotion)requestAnimationFrame(take);};requestAnimationFrame(take);});
  await action();await page.waitForFunction(()=>window.__gallery.moving);
  await page.waitForTimeout(700);await page.screenshot({path:`artifacts/camera-${label}-${name}-departure.png`});
  await page.waitForTimeout(1600);await page.screenshot({path:`artifacts/camera-${label}-${name}-travel.png`});
  await page.waitForFunction(()=>!window.__gallery.moving,null,{timeout:20000});
  const frames=await page.evaluate(()=>{window.__recordMotion=false;return window.__motionFrames;});
  let distance=0,maxTurn=0,maxFrameTurn=0;
  for(let i=1;i<frames.length;i++){const a=frames[i-1],b=frames[i],dt=(b.t-a.t)/1000;distance+=Math.hypot(...b.p.map((v,j)=>v-a.p[j]));const angle=2*Math.acos(Math.min(1,Math.abs(b.q.reduce((s,v,j)=>s+v*a.q[j],0))))*180/Math.PI;if(dt>.005){maxTurn=Math.max(maxTurn,angle/dt);maxFrameTurn=Math.max(maxFrameTurn,angle);}}
  results.push({name,distance,seconds:(frames.at(-1).t-frames[0].t)/1000,maxDegreesPerSecond:maxTurn,maxDegreesPerFrame:maxFrameTurn,minHeight:Math.min(...frames.map(f=>f.p[1])),maxHeight:Math.max(...frames.map(f=>f.p[1])),frames});
 }
 await record('court-to-01',()=>page.getByRole('button',{name:'01 SŌL 프로젝트 열기'}).click());
 await record('01-to-02',()=>page.getByRole('button',{name:'다음 작품',exact:true}).click());
 await record('02-to-court',()=>page.getByRole('button',{name:'작품 설명 닫기',exact:true}).click());
 await page.screenshot({path:`artifacts/camera-${label}-complete.png`});
 await fs.writeFile(`artifacts/camera-motion-${label}.json`,JSON.stringify(results,null,2));
 console.log(JSON.stringify(results.map(({frames,...r})=>r),null,2));
}finally{await browser.close();}

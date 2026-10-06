import {chromium} from '@playwright/test';
import fs from 'node:fs/promises';
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:1});
await page.goto('http://127.0.0.1:5173/',{waitUntil:'domcontentloaded'});
await page.waitForFunction(()=>window.__gallery&&!document.querySelector('.loading')&&!window.__gallery.moving);
const hardware=await page.evaluate(()=>{const r=window.__gallery.renderer,c=r.getContext(),ext=c.getExtension('WEBGL_debug_renderer_info');return {renderer:ext?c.getParameter(ext.UNMASKED_RENDERER_WEBGL):'unavailable',pixelRatio:r.getPixelRatio(),viewport:[innerWidth,innerHeight],triangles:r.info.render.triangles,drawCalls:r.info.render.calls};});
await page.getByRole('button',{name:'01 SŌL 프로젝트 열기'}).click();await page.waitForFunction(()=>!window.__gallery.moving);
const results=[];
for(let i=0;i<5;i++){
  await page.evaluate(()=>{window.__timing=new Promise(resolve=>{let start=0,last=-1,frames=0,times=[],prev=0;const tick=t=>{const g=window.__gallery;if(g.moving){if(!start)start=t;const frame=g.renderer.info.render.frame;if(frame!==last){frames++;last=frame;if(prev)times.push(t-prev);prev=t;}}else if(start){resolve({frames,durationMs:t-start,fps:frames*1000/(t-start),p95FrameMs:times.sort((a,b)=>a-b)[Math.floor(times.length*.95)]});return;}requestAnimationFrame(tick);};requestAnimationFrame(tick);});});
  await page.getByRole('button',{name:'다음 작품',exact:true}).click();results.push(await page.evaluate(()=>window.__timing));
}
const a=await page.evaluate(()=>window.__gallery.renderer.info.render.frame);await page.waitForTimeout(1000);const b=await page.evaluate(()=>window.__gallery.renderer.info.render.frame);
const report={hardware,transitions:results,averageFps:results.reduce((s,r)=>s+r.fps,0)/results.length,minimumTransitionFps:Math.min(...results.map(r=>r.fps)),idleFramesPerSecond:b-a,environment:'Installed Chrome, headless, local development server, warm textures. Not a real mobile device benchmark.'};
await fs.writeFile('artifacts/performance.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));await browser.close();

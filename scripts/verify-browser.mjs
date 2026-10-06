import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {isWalkable} from '../src/navigation.mjs';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {PerspectiveCamera,Raycaster,Vector3} from 'three';
const layout=JSON.parse(await fs.readFile('src/data/layout.json','utf8'));
const bytes=await fs.readFile('public/models/gallery.glb');
const model=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');model.scene.updateMatrixWorld(true);
const browser=await chromium.launch({channel:'chrome',headless:true});
const context=await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:1});
const page=await context.newPage(),errors=[],checks=[],screens=[];
page.on('pageerror',e=>errors.push(e.message));
const mark=(name,detail)=>{checks.push({name,pass:true,detail});console.log('PASS',name,detail??'');};
const waitScene=()=>page.waitForFunction(()=>window.__gallery&&!window.__gallery.moving&&!document.querySelector('.loading'),null,{timeout:30000});
const screenshot=async name=>{const path=`artifacts/${name}.png`;await page.screenshot({path});screens.push(path);};
try{
 await page.goto('http://127.0.0.1:5173/',{waitUntil:'networkidle'});await waitScene();
 assert.equal(await page.locator('.project-tile').count(),8);assert.equal(await page.locator('.is-flat').count(),0);await screenshot('verified-desktop-overview');mark('desktop 3D loads with eight projects');
 await page.getByRole('button',{name:'프로젝트 08',exact:true}).click();
 assert.equal(await page.locator('.museum-map g[role="button"]').count(),8);await screenshot('verified-museum-map');
 const mapRoom=page.getByRole('button',{name:'04 VERDANT 전시실로 이동',exact:true});await mapRoom.focus();await page.keyboard.press('Enter');await waitScene();
 assert.equal(await page.locator('#project-title').textContent(),'VERDANT');assert.equal(await page.locator('dialog[open]').count(),0);
 await page.keyboard.press('Escape');await waitScene();mark('courtyard building map opens a room by keyboard and closes its dialog');
 await page.mouse.move(980,650);await page.mouse.down();await page.mouse.move(1040,650,{steps:8});await page.mouse.up();
 const savedPosition=await page.evaluate(()=>window.__gallery.camera.position.toArray());
 const view=await page.evaluate(()=>{const c=window.__gallery.camera,r=document.querySelector('canvas').getBoundingClientRect();return {position:c.position.toArray(),quaternion:c.quaternion.toArray(),fov:c.fov,aspect:c.aspect,width:r.width,height:r.height};});
 const camera=new PerspectiveCamera(view.fov,view.aspect,.08,300);camera.position.fromArray(view.position);camera.quaternion.fromArray(view.quaternion);camera.updateMatrixWorld();let point;
 for(const a of layout.artworks)for(const fx of [-.42,-.2,0,.2,.42])for(const fy of [-.25,0,.25]){
  const p=new Vector3(a.position[0]+Math.cos(a.rotation)*a.width*fx+Math.sin(a.rotation)*.1,a.position[1]+a.height*fy,a.position[2]-Math.sin(a.rotation)*a.width*fx+Math.cos(a.rotation)*.1),q=p.clone().project(camera);
  const ray=new Raycaster(camera.position,p.clone().sub(camera.position).normalize(),.08,p.distanceTo(camera.position)-.03);
  if(!point&&Math.abs(q.x)<.93&&q.y>-.5&&q.y<.55&&!ray.intersectObject(model.scene,true).length)point={x:(q.x+1)*view.width/2,y:(1-q.y)*view.height/2,id:a.id};
 }
 assert.ok(point,'An artwork is visible through an open gallery entrance from the court');
 await page.mouse.click(point.x,point.y);await waitScene();assert.ok(page.url().endsWith('/'+point.id));
 await page.keyboard.press('Escape');await waitScene();const restoredPosition=await page.evaluate(()=>window.__gallery.camera.position.toArray());assert.ok(savedPosition.every((n,i)=>Math.abs(n-restoredPosition[i])<.01));mark('clicking the actual 3D canvas works; closing restores the user viewpoint');
 await page.getByRole('button',{name:'01 SŌL 프로젝트 열기'}).click();await waitScene();await screenshot('verified-desktop-detail');
 const names=['SŌL','FORM','AETHER','VERDANT','MONO','TIDE','OBJECTS','ATELIER'];
 for(let i=0;i<8;i++){
   assert.equal(await page.locator('#project-title').textContent(),names[i]);
   const camera=await page.evaluate(()=>window.__gallery.camera.position.toArray());
   assert.ok(isWalkable(layout,camera),'Camera stays in its independent room');
   await screenshot(`verified-room-${i+1}`);
   await page.getByRole('button',{name:'2번 이미지 보기'}).click();await page.waitForTimeout(150);
   assert.equal(await page.getByRole('button',{name:'2번 이미지 보기'}).getAttribute('aria-pressed'),'true');
   await page.getByRole('button',{name:'다음 작품',exact:true}).click();await waitScene();
 }
 mark('all eight projects: selection, camera focus, media and next navigation');
 await page.goBack();await waitScene();assert.equal(await page.locator('#project-title').textContent(),'ATELIER');
 await page.keyboard.press('ArrowLeft');await waitScene();assert.equal(await page.locator('#project-title').textContent(),'OBJECTS');
 await page.keyboard.press('Escape');await waitScene();assert.equal(await page.locator('.project-panel').count(),0);mark('history, keyboard navigation and close');
 await page.getByRole('button',{name:'03 AETHER 프로젝트 열기'}).click();await waitScene();await page.getByRole('button',{name:'3번 영상 보기'}).click();
 await page.waitForFunction(()=>window.__lastGalleryVideo?.readyState>=2);await page.getByRole('button',{name:'영상 재생',exact:true}).click();await page.waitForTimeout(350);
 assert.equal(await page.evaluate(()=>window.__lastGalleryVideo.paused),false);
 await page.getByRole('button',{name:'다음 작품',exact:true}).click();await waitScene();
 assert.equal(await page.evaluate(()=>window.__lastGalleryVideo.paused),true);assert.equal(await page.evaluate(()=>window.__lastGalleryVideo.getAttribute('src')),null);mark('video plays only on request and stops on project change');
 await page.goto('http://127.0.0.1:5173/#/project/sol');await waitScene();
 await page.route('**/art/sol-1.webp',route=>route.abort());await page.getByRole('button',{name:'2번 이미지 보기'}).click();await page.getByRole('alert').waitFor();
 await page.unroute('**/art/sol-1.webp');await page.getByRole('button',{name:'다시 불러오기',exact:true}).click();await page.getByRole('alert').waitFor({state:'detached'});mark('media failure message and successful retry');
 for(const size of [{width:390,height:844},{width:320,height:720}]){
   await page.setViewportSize(size);await waitScene();
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   for(const label of ['작품 설명 닫기','이전 작품','다음 작품']){const b=await page.getByRole('button',{name:label,exact:true}).boundingBox();assert.ok(b&&b.x>=0&&b.x+b.width<=size.width+1&&b.y+b.height<=size.height+1);}
   await screenshot(`verified-mobile-${size.width}`);mark(`mobile ${size.width}: visible controls and no overflow`);
 }
 await page.emulateMedia({reducedMotion:'reduce'});await page.getByRole('button',{name:'다음 작품',exact:true}).click();await page.waitForTimeout(90);assert.equal(await page.evaluate(()=>window.__gallery.moving),false);mark('reduced motion');
 await page.emulateMedia({reducedMotion:'no-preference'});await page.setViewportSize({width:1440,height:900});await waitScene();
 // ResizeObserver commits after setViewportSize resolves. Wait for it to settle
 // before measuring idle, rather than counting the responsive layout update.
 await page.evaluate(()=>new Promise(resolve=>{let frame=-1,stable=performance.now();const check=t=>{const g=window.__gallery,n=g.renderer.info.render.frame;if(n!==frame||g.moving){frame=n;stable=t;}if(t-stable>180)resolve();else requestAnimationFrame(check);};requestAnimationFrame(check);}));
 const idle0=await page.evaluate(()=>window.__gallery.renderer.info.render.frame);await page.waitForTimeout(500);const idle1=await page.evaluate(()=>window.__gallery.renderer.info.render.frame);assert.ok(idle1-idle0<=1);mark('on-demand rendering rests when idle',{extraFrames:idle1-idle0});
 // Rapid successive selections must resolve to the last project.
 await page.getByRole('button',{name:'다음 작품',exact:true}).click();await page.getByRole('button',{name:'다음 작품',exact:true}).click();await page.getByRole('button',{name:'다음 작품',exact:true}).click();await waitScene();assert.equal(await page.locator('#project-title').textContent(),'MONO');mark('rapid changes resolve to the final selection');
 await page.evaluate(()=>window.__gallery.renderer.getContext().getExtension('WEBGL_lose_context').loseContext());await page.locator('.flat-notice').waitFor();assert.equal(await page.locator('#project-title').textContent(),'MONO');mark('WebGL context loss preserves project content in image mode');
 await page.goto('http://127.0.0.1:5173/?view=flat#/project/tide');await page.locator('.flat-art img').waitFor();assert.equal(await page.locator('#project-title').textContent(),'TIDE');mark('direct project link and static fallback');
 assert.deepEqual(errors,[]);mark('no uncaught browser errors');
}catch(error){await screenshot('verification-failure');checks.push({name:'failure',pass:false,detail:error.stack});console.error(error);process.exitCode=1;}
finally{await fs.writeFile('artifacts/browser-checks.json',JSON.stringify({checks,errors,screens},null,2));await browser.close();}

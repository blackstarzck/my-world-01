import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PerspectiveCamera,Vector3} from 'three';
import {cameraPose,planRoute,clearSegment,isWalkable,routeMetrics,sampleRoute} from '../src/navigation.mjs';
import {createCameraMotion,sampleCameraMotion} from '../src/camera-motion.mjs';
const layout=JSON.parse(fs.readFileSync('src/data/layout.json','utf8'));
const design=JSON.parse(fs.readFileSync('assets/design/revision-d/drawing-dimensions.json','utf8'));
test('D floor plan: exact room bounds, artwork locations, clear dimensions and open entries',()=>{
  assert.equal(layout.rooms.length,8);
  assert.deepEqual(layout.footprint,[54,54]);assert.deepEqual(layout.court.bounds,[-8,-8,16,16]);
  for(const r of layout.rooms){const ref=design.rooms[r.id-1];assert.deepEqual(r.outerBounds,ref.b);assert.deepEqual(r.clearSize,ref.clearSize);assert.equal(r.h,12);assert.equal(r.screen,false);
    const art=layout.artworks[r.id-1];assert.ok(Math.abs(art.position[0]-ref.art[0])<.001&&Math.abs(art.position[2]-ref.art[1])<.001);
    assert.ok(clearSegment(layout,[r.door[0],2.3,r.door[1]],cameraPose(layout,r.project,false,1.04).position),'Every entry provides a direct route to its artwork');
  }
  assert.equal(new Set(layout.artworks.map(a=>a.id)).size,8);
});
test('desktop and mobile transitions between every pair of rooms avoid perimeter walls and artwork',()=>{
  for(const mobile of [false,true]){
    const cameras=[layout.overview.position,...layout.artworks.map(a=>cameraPose(layout,a.id,mobile,mobile?.983:1.04).position)];
    for(const from of cameras)for(const to of cameras){const route=planRoute(layout,from,to);assert.ok(route.every((p,i)=>isWalkable(layout,p)&&(!i||clearSegment(layout,route[i-1],p))));}
  }
});
test('an interrupted journey can reroute safely to the last selection',()=>{
  const to=cameraPose(layout,'atelier',false,1.04).position,route=planRoute(layout,layout.overview.position,to),metrics=routeMetrics(route);
  for(const t of [.08,.23,.47,.62,.84]){const from=sampleRoute(route,metrics,t),path=planRoute(layout,from,cameraPose(layout,'sol',false,1.04).position);assert.ok(path.every((p,i)=>!i||clearSegment(layout,path[i-1],p)));}
});
test('the court reaches the northwest gallery without touring the opposite corridor',()=>{
  const from=layout.overview.position,to=cameraPose(layout,'sol',false,1.04).position;
  const route=planRoute(layout,from,to);
  assert.ok(routeMetrics(route).total<36,'Use the open court instead of a 58 m detour');
  const first=route.find(p=>Math.hypot(p[0]-from[0],p[2]-from[2])>.1);
  assert.ok((first[0]-from[0])*(to[0]-from[0])+(first[2]-from[2])*(to[2]-from[2])>0,'Start toward the selected room');
});
test('desktop and mobile keep the same viewing height while changing galleries',()=>{
  for(const mobile of [false,true])for(const a of layout.artworks)assert.equal(cameraPose(layout,a.id,mobile,1.04).position[1],2.3);
});
test('every room is reached from the court within 3.2 seconds on desktop and mobile',()=>{
  for(const [mobile,aspect] of [[false,1.04],[true,.983]])for(const a of layout.artworks){
    const from=layout.overview,to=cameraPose(layout,a.id,mobile,aspect);
    const route=planRoute(layout,from.position,to.position),motion=createCameraMotion(route,from.target,to.target,from.fov,to.fov);
    assert.ok(motion.duration<=3.2,`${a.id}: ${motion.duration.toFixed(2)} seconds`);
    const end=sampleCameraMotion(motion,3.2);assert.ok(end.done);assert.deepEqual(end.position,to.position);
  }
});

test('camera turns are bounded, have no last-frame snap, and follow safe rounded paths',()=>{
  for(const [fromId,toId] of [[null,'sol'],['sol','form'],['form',null],['mono','atelier']]){
    const from=cameraPose(layout,fromId,false,1.04),to=cameraPose(layout,toId,false,1.04);
    const points=planRoute(layout,from.position,to.position),motion=createCameraMotion(points,from.target,to.target,from.fov,to.fov,!toId);
    let previous=sampleCameraMotion(motion,0);
    for(let t=1/60;t<motion.duration+1/60;t+=1/60){const p=sampleCameraMotion(motion,Math.min(t,motion.duration));
      assert.ok(Math.hypot(p.yaw-previous.yaw,p.pitch-previous.pitch)*60<3.41,'Keep turns below 3.3 degrees per frame at 60 fps');
      assert.ok(isWalkable(layout,p.position));assert.ok(clearSegment(layout,previous.position,p.position));previous=p;
    }
    assert.ok(previous.done);assert.deepEqual(previous.position,to.position);
    const f=new Vector3(Math.sin(previous.yaw)*Math.cos(previous.pitch),Math.sin(previous.pitch),Math.cos(previous.yaw)*Math.cos(previous.pitch));
    const target=new Vector3(...to.target).sub(new Vector3(...to.position)).normalize();assert.ok(f.angleTo(target)<.0001);
    if(!toId)assert.ok(motion.duration<6,'Return without rotating twice');
  }
});
test('camera speed and angular velocity remain continuous at motion joins',()=>{
  for(const [mobile,aspect] of [[false,1.04],[true,.983]])for(const art of layout.artworks){
    const from=layout.overview,to=cameraPose(layout,art.id,mobile,aspect);
    const motion=createCameraMotion(planRoute(layout,from.position,to.position),from.target,to.target,from.fov,to.fov),h=1e-5;
    for(const key of motion.keys.slice(1,-1)){
      const a=sampleCameraMotion(motion,key.time-h),b=sampleCameraMotion(motion,key.time),c=sampleCameraMotion(motion,key.time+h);
      const before=Math.hypot(...b.position.map((v,i)=>(v-a.position[i])/h)),after=Math.hypot(...c.position.map((v,i)=>(v-b.position[i])/h));
      assert.ok(Math.abs(after-before)<.05,`${art.id}: travel speed jumps at ${key.time}`);
      assert.ok(Math.hypot(c.yaw-2*b.yaw+a.yaw,c.pitch-2*b.pitch+a.pitch)/h<.02,`${art.id}: rotation speed jumps at ${key.time}`);
    }
  }
});

test('all framed artwork fits the desktop and mobile viewport with interface margins',()=>{
  for(const [mobile,aspect] of [[false,1440*.65/900],[true,390/(844*.47)],[true,320/(720*.47)]])for(const a of layout.artworks){
    const pose=cameraPose(layout,a.id,mobile,aspect),camera=new PerspectiveCamera(pose.fov,aspect,.08,300);camera.position.set(...pose.position);camera.lookAt(new Vector3(...pose.target));camera.updateMatrixWorld();
    for(const x of [-a.width/2,a.width/2])for(const y of [-a.height/2,a.height/2]){const p=new Vector3(a.position[0]+x*Math.cos(a.rotation),a.position[1]+y,a.position[2]-x*Math.sin(a.rotation)).project(camera);assert.ok(Math.abs(p.x)<.81);assert.ok(p.y<(mobile?.5:.7)&&p.y>-.8,`${a.id} ${mobile} ${p.y}`);}
  }
});
test('each project keeps independently replaceable media',()=>{for(const a of layout.artworks)for(const v of [0,1])assert.ok(fs.statSync(`public/art/${a.id}-${v}.webp`).size>1000);});

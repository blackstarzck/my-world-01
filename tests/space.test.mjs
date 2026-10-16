import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PerspectiveCamera,Vector3} from 'three';
import {cameraPose,planRoute,clearSegment,isWalkable,routeMetrics,sampleRoute} from '../src/navigation.mjs';
import {createCameraMotion,sampleCameraMotion} from '../src/camera-motion.mjs';
const layout=JSON.parse(fs.readFileSync('src/data/layout.json','utf8'));
const design=JSON.parse(fs.readFileSync('assets/design/revision-i-radial-galleries/building-model.json','utf8'));
const near=(a,b,label)=>assert.ok(Math.abs(a-b)<1e-6,`${label}: ${a} versus ${b}`);
const local=(r,u,v,y=1.65)=>{const t=r.angle_deg*Math.PI/180;return [r.origin[0]+u*Math.cos(t)-v*Math.sin(t),y,-r.origin[1]-u*Math.sin(t)-v*Math.cos(t)];};
const safeRoute=(from,to)=>{const route=planRoute(layout,from,to);assert.deepEqual(route[0],from);assert.deepEqual(route.at(-1),to);assert.ok(route.every((p,i)=>isWalkable(layout,p,.23)&&(!i||clearSegment(layout,route[i-1],p,.23))));return route;};

test('Revision I uses the approved four 12 x 36 m radial rooms and all 48 scheduled slots',()=>{
  assert.equal(layout.revision,'I.1');assert.equal(layout.modelPath,'/models/gallery-i-fidelity-v11-opt1.glb');
  assert.equal(layout.rooms.length,4);assert.equal(layout.artworks.length,48);
  assert.equal(new Set(layout.artworks.map(a=>a.id)).size,48);assert.equal(new Set(layout.artworks.map(a=>a.projectId)).size,8);
  for(const [r,source] of layout.rooms.map(r=>[r,design.rooms.find(s=>s.id===r.id)])){
    assert.deepEqual(r.clearSize,[12,36,source.crown]);assert.equal(r.angleDeg,source.angle_deg);
    assert.equal(layout.artworks.filter(a=>a.room===r.id).length,12);
    for(const slot of source.slots){const a=layout.artworks.find(a=>a.id===slot.id);a.position.forEach((v,i)=>near(v,slot.center_gltf[i],slot.id));
      a.cameraPosition.forEach((v,i)=>near(v,[slot.camera_blender[0],slot.camera_blender[2],-slot.camera_blender[1]][i],slot.id));
      near(a.width,slot.image_width,'image width');near(a.height,slot.image_height,'image height');
      assert.ok(a.normal[0]*(a.cameraPosition[0]-a.position[0])+a.normal[2]*(a.cameraPosition[2]-a.position[2])>7.49);
    }
  }
  near(layout.footprint[0],design.overall_xy,'overall width');assert.equal(layout.hallWidth,32);
});

test('rotated perimeter, four throat seams, support bases, planters and frame envelopes match the design',()=>{
  assert.equal(layout.piers.length,64);assert.equal(layout.portals.length,4);assert.equal(layout.furniture.length,16);
  for(const r of design.rooms){
    for(const u of [-1.3,-1.2,-.6,0,.1,3,18,33,35])assert.ok(isWalkable(layout,local(r,u,0),.7),`${r.id} u=${u} center aisle`);
    for(const p of [local(r,-.6,4),local(r,18,6.1),local(r,36.1,0)])assert.equal(isWalkable(layout,p),false);
    assert.equal(isWalkable(layout,local(r,-.6,0,10.4)),false);
    assert.equal(isWalkable(layout,local(r,-.6,3.3,9)),false,'off-center arch soffit');
    // The V11 base projects 0.62m: its new outer strip must also block a route.
    for(const v of [-5.40,5.40])assert.equal(isWalkable(layout,local(r,6,v),0),false,`${r.id} expanded base`);
    for(const v of [-1.8,1.8])assert.ok(isWalkable(layout,local(r,18,v),.7),`${r.id} central aisle edge`);
  }
  for(const p of [...layout.piers,...layout.furniture])assert.equal(isWalkable(layout,[p.center[0],1.65,p.center[1]]),false,p.id);
  for(const p of [[30,1.65,0],[0,1.65,-30],[44,1.65,44],[NaN,1.65,0],[0,-.1,0]])assert.equal(isWalkable(layout,p),false);
  assert.ok(isWalkable(layout,layout.overview.position,.7),'overview is inside the central hall');
});

test('the route graph is fully connected and every slot has a safe connection to it',()=>{
  const {nodes,edges}=layout.navigation,adj=nodes.map(()=>[]);
  for(const [a,b] of edges){assert.ok(clearSegment(layout,nodes[a],nodes[b],.7));adj[a].push(b);adj[b].push(a);}
  const seen=new Set([0]),queue=[0];for(const i of queue)for(const n of adj[i])if(!seen.has(n)){seen.add(n);queue.push(n);}
  assert.equal(seen.size,nodes.length,'all graph nodes connected');
  for(const a of layout.artworks){const position=cameraPose(layout,a.id,false,1.04).position;assert.ok(nodes.some(p=>clearSegment(layout,position,p,.7)),a.id);}
});

test('all 48 slots, including both end-wall bays in every room, can be reached and returned from safely',()=>{
  for(const a of layout.artworks){const pose=cameraPose(layout,a.id,false,1.04);assert.equal(pose.position[1],1.65);safeRoute(layout.overview.position,pose.position);safeRoute(pose.position,layout.overview.position);}
});

test('every pair of far end slots across the four wings has a safe animated route',()=>{
  const ends=layout.artworks.filter(a=>a.bay===6);
  for(const from of ends)for(const to of ends){if(from.id===to.id)continue;
    const a=cameraPose(layout,from.id,false,1.04),b=cameraPose(layout,to.id,false,1.04);
    const route=safeRoute(a.position,b.position),motion=createCameraMotion(route,a.target,b.target,a.fov,b.fov);
    assert.ok(motion.duration<14,`${from.id} to ${to.id}: excessive duration`);
    let previous=sampleCameraMotion(motion,0);
    for(let t=1/30;t<motion.duration+1/30;t+=1/30){const p=sampleCameraMotion(motion,Math.min(t,motion.duration));
      assert.ok(clearSegment(layout,previous.position,p.position),`${from.id} to ${to.id}: unsafe frame chord`);
      assert.ok(Math.hypot(p.yaw-previous.yaw,p.pitch-previous.pitch)*30<3.41,'camera turn rate');previous=p;
    }
    assert.ok(previous.done);assert.deepEqual(previous.position,b.position);
  }
});

test('interruptions in hall bends and doorways can reroute to another wing',()=>{
  for(const room of layout.rooms){const to=cameraPose(layout,`${room.id}-L06`,false,1.04),route=planRoute(layout,layout.overview.position,to.position),metrics=routeMetrics(route);
    const next=layout.rooms[(layout.rooms.indexOf(room)+1)%4];
    for(const t of [.08,.23,.47,.62,.84])safeRoute(sampleRoute(route,metrics,t),cameraPose(layout,`${next.id}-R06`,false,1.04).position);
  }
});

test('eight project aliases remain separate from 48 independently addressable positions',()=>{
  for(const [id,slot] of Object.entries(layout.projectSlots)){
    assert.deepEqual(cameraPose(layout,id,false,1.04),cameraPose(layout,slot,false,1.04));
    assert.equal(layout.artworks.filter(a=>a.projectId===id).length,6);
    for(const v of [0,1])assert.ok(fs.statSync(`public/art/${id}-${v}.webp`).size>1000);
  }
  assert.deepEqual(layout.rooms.find(r=>r.id==='R3').projects,['objects','atelier']);
  assert.deepEqual(layout.rooms.find(r=>r.id==='R4').projects,['mono','tide']);
  assert.notDeepEqual(cameraPose(layout,'R1-L01',false,1.04).position,cameraPose(layout,'R1-L03',false,1.04).position);
});

test('every frame fits desktop and mobile views at the same approved eye height',()=>{
  for(const [mobile,aspect] of [[false,1440*.65/900],[true,390/(844*.47)],[true,320/(720*.47)]])for(const a of layout.artworks){
    const pose=cameraPose(layout,a.id,mobile,aspect),camera=new PerspectiveCamera(pose.fov,aspect,.08,300);camera.position.set(...pose.position);camera.lookAt(new Vector3(...pose.target));camera.updateMatrixWorld();
    assert.equal(pose.position[1],1.65);assert.ok(pose.fov<100);assert.ok(isWalkable(layout,pose.position,.7));
    for(const x of [-a.frameWidth/2,a.frameWidth/2])for(const y of [-a.frameHeight/2,a.frameHeight/2]){const p=new Vector3(a.position[0]+x*Math.cos(a.rotation),a.position[1]+y,a.position[2]-x*Math.sin(a.rotation)).project(camera);assert.ok(Math.abs(p.x)<.79);assert.ok(p.y<(mobile?.49:.68)&&p.y>-.79,`${a.id} ${mobile} ${p.y}`);}
  }
});

test('short moves and stationary turns finish at the exact requested pose without last-frame jumps',()=>{
  for(const distance of [0,.005,.02,.2]){
    const points=[[0,1.65,0],[distance,1.65,0]],target=[distance,1.65,-1],motion=createCameraMotion(points,[0,1.65,1],target,60,45);
    let previous=sampleCameraMotion(motion,0);
    for(let t=1/60;t<motion.duration+1/60;t+=1/60){const pose=sampleCameraMotion(motion,t);assert.ok(pose.position.every(Number.isFinite));assert.ok(Math.abs(pose.yaw-previous.yaw)*60<2.61);previous=pose;}
    assert.ok(previous.done);assert.deepEqual(previous.position,points[1]);assert.equal(previous.fov,45);
  }
});

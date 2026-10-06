import fs from 'node:fs/promises';
import clipping from 'polygon-clipping';
import {ShapeUtils,Vector2} from 'three';
const design=JSON.parse(await fs.readFile('assets/design/revision-d/drawing-dimensions.json','utf8'));
const ids=['sol','form','aether','verdant','mono','tide','objects','atelier'];
const revision='D-open',sourceDirectory='assets/source/revision-d-open';
const box=(x0,z0,x1,z1)=>[[x0,z0],[x1,z0],[x1,z1],[x0,z1]];
const rotate=(p,a)=>[p[0]*Math.cos(a)-p[1]*Math.sin(a),p[0]*Math.sin(a)+p[1]*Math.cos(a)];
const world=(r,p)=>rotate(p,r.angle*Math.PI/180).map((v,i)=>v+r.door[i]);
const local=(r,p)=>rotate(p.map((v,i)=>v-r.door[i]),-r.angle*Math.PI/180);
const xyz=(r,p,y)=>{const q=world(r,p);return [q[0],y,q[1]];};
const rooms=design.rooms.map((ref,i)=>{
 const [x,z,w,d]=ref.b,c=[x+w/2,z+d/2];
 const angle=ref.door[2]==='h'?(z<0?0:180):(x<0?-90:90);
 const a=angle*Math.PI/180,door=[ref.door[0]+Math.sin(a)*.3,ref.door[1]-Math.cos(a)*.3];
 const r={id:ref.id,project:ids[i],angle,door,center:c,h:12,w:ref.door[2]==='h'?w-.6:d-.6,d:14.4,art:[4.5,6],view:7.5,screen:false,outerBounds:ref.b,clearSize:ref.clearSize};
 r.outer=box(x,z,x+w,z+d).map(p=>local(r,p));r.inner=box(x+.6,z+.6,x+w-.6,z+d-.6).map(p=>local(r,p));
 r.poly=box(x+.3,z+.3,x+w-.3,z+d-.3);r.local=r.poly.map(p=>local(r,p));
 r.artLocal=local(r,ref.art.slice(0,2));r.viewLocal=[r.artLocal[0],r.artLocal[1]+r.view];
 r.anchor=world(r,[0,2.3]);r.skylight=box(r.artLocal[0]-3,r.artLocal[1]+1.4,r.artLocal[0]+3,r.artLocal[1]+3.4);
 return r;
});
const corridor=clipping.union([box(-12,-17,-8,17)],[box(8,-17,12,27)],[box(-12,-12,12,-8)],[box(-12,8,12,12)]);
const court={bounds:[-8,-8,16,16],height:14,polygon:box(-8,-8,8,8)};
// Clockwise, rounded only inside the 4 m corridor: the building plan stays square.
const spine=[];
for(const [cx,cz,start] of [[-9,-9,180],[9,-9,270],[9,9,0],[-9,9,90]]){
 for(let i=0;i<=8;i++){const a=(start+i*90/8)*Math.PI/180;spine.push([cx+Math.cos(a),cz+Math.sin(a)]);}
}
spine.push(spine[0]);
const nav={nodes:spine.slice(0,-1).map(p=>[p[0],2.3,p[1]]),edges:[]};
for(let i=0;i<nav.nodes.length;i++)nav.edges.push([i,(i+1)%nav.nodes.length]);
function connect(p){
 let best=0,tBest=0,dBest=Infinity;
 for(let i=0;i<nav.edges.length;i++){
  const [ia,ib]=nav.edges[i],a=nav.nodes[ia],b=nav.nodes[ib],dx=b[0]-a[0],dz=b[2]-a[2],t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[2])*dz)/(dx*dx+dz*dz||1)));
  const d=Math.hypot(p[0]-a[0]-dx*t,p[1]-a[2]-dz*t);if(d<dBest){best=i;tBest=t;dBest=d;}
 }
 const [ia,ib]=nav.edges[best],a=nav.nodes[ia],b=nav.nodes[ib];
 const j=nav.nodes.length;nav.nodes.push(a.map((n,k)=>n+(b[k]-n)*tBest));nav.edges.splice(best,1,[ia,j],[j,ib]);return j;
}
for(const r of rooms){
 let last=connect(r.anchor);const points=[r.anchor,world(r,[0,.9]),world(r,[0,-.9]),world(r,r.viewLocal)];
 for(const p of points){const j=nav.nodes.length;nav.nodes.push([p[0],2.3,p[1]]);nav.edges.push([last,j]);last=j;}r.navView=last;
}
// The open courtyard joins all four sides; it contains no artwork or partitions.
const courtNode=nav.nodes.length;nav.nodes.push([0,2.3,0]);
for(const p of [[0,-10],[10,0],[0,10],[-10,0]]){const j=connect(p);nav.edges.push([j,courtNode]);}
const entranceNode=nav.nodes.length;nav.nodes.push([10,2.3,26]);nav.edges.push([connect([10,10]),entranceNode]);
const artworks=rooms.map(r=>({id:r.project,room:r.id,position:xyz(r,r.artLocal,.65+r.art[1]/2),rotation:-r.angle*Math.PI/180,width:r.art[0],height:r.art[1],viewDistance:r.view}));
const overview={room:0,position:[5.4,2.6,5.4],target:[-3.6,6.1,-3.6],fov:78};
const layout={revision,sourceDirectory,footprint:design.footprint,wallThickness:.6,corridorHeight:4.2,portalSize:[3.2,3.6],overview,rooms,spine,corridor,circulation:clipping.union(corridor,[court.polygon]),court,branches:rooms.map(r=>[r.anchor,r.door]),navigation:nav,artworks,textureGroups:[...rooms.map(r=>'Room_'+String(r.id).padStart(2,'0')),'Promenade','Court']};
await fs.writeFile('src/data/layout.json',JSON.stringify(layout,null,2));
function mesh(polygons){return polygons.map(poly=>{const rings=poly.map(r=>r.filter((p,i)=>i!==r.length-1||p[0]!==r[0][0]||p[1]!==r[0][1]));return {rings,triangles:ShapeUtils.triangulateShape(rings[0].map(p=>new Vector2(...p)),rings.slice(1).map(r=>r.map(p=>new Vector2(...p))))};});}
const geometry={rooms:rooms.map(r=>({...r,floorMesh:mesh([[r.outer]]),wallMesh:mesh(clipping.difference([r.outer,r.inner],[box(-1.6,-.7,1.6,.7)])),roofMesh:mesh(clipping.difference([r.outer],[r.skylight]))})),corridor,floorMesh:mesh(corridor),roofMesh:mesh(corridor),courtFloor:mesh([[court.polygon]])};
await fs.mkdir(sourceDirectory,{recursive:true});await fs.writeFile(sourceDirectory+'/geometry.json',JSON.stringify(geometry));
await fs.mkdir('assets/design/revision-d-open',{recursive:true});
await fs.writeFile('assets/design/revision-d-open/drawing-dimensions.json',JSON.stringify({...design,revision,status:'D floor plan approved for implementation; all eight entrance screens removed',screen:null,rooms:design.rooms.map(({screen,...r})=>({...r,screen:null}))},null,2));
console.log('Prepared D-open: 54 × 54 m, eight 12 m rooms, 16 × 16 m courtyard, no entry screens.');

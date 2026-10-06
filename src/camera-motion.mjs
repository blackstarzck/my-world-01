import {routeMetrics,sampleRoute} from './navigation.mjs';

const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const ease=t=>t*t*(3-2*t);
const angleNear=(angle,reference)=>reference+Math.atan2(Math.sin(angle-reference),Math.cos(angle-reference));
function direction(position,target){
 const [x,y,z]=target.map((v,i)=>v-position[i]);
 return {yaw:Math.atan2(x,z),pitch:Math.atan2(y,Math.hypot(x,z))};
}
const TURN_RATE=1.55,TRAVEL_SPEED=8;

// Rotate directions rather than interpolating world-space look-at points: a
// target passing through the camera caused the previous sudden 180° flips.
export function createCameraMotion(points,fromTarget,toTarget,fromFov,toFov,returning=false){
 const metrics=routeMetrics(points),start=direction(points[0],fromTarget),end=direction(points.at(-1),toTarget);
 const keys=[{position:points[0],...start,fov:fromFov,time:0,turn:false}];
 function addTurn(position,angles,fov){
  const prev=keys.at(-1),yaw=angleNear(angles.yaw,prev.yaw);
  const radians=Math.hypot(yaw-prev.yaw,angles.pitch-prev.pitch);
  keys.push({position,yaw,pitch:angles.pitch,fov,time:prev.time+Math.max(.25,1.5*radians/TURN_RATE),turn:true});
 }
 if(metrics.total<.01){addTurn(points.at(-1),end,toFov);return {keys,duration:keys.at(-1).time};}
 let reverse=0;
 function heading(distance){
  const a=sampleRoute(points,metrics,distance/metrics.total);
  let b=sampleRoute(points,metrics,Math.min(1,(distance+2)/metrics.total));
  if(metrics.total-distance<.001){const behind=sampleRoute(points,metrics,Math.max(0,(distance-1)/metrics.total));b=a.map((v,i)=>v+(v-behind[i]));}
  return {yaw:direction(a,b).yaw+reverse,pitch:0};
 }
 if(returning){
  const first=heading(0).yaw,last=heading(metrics.total).yaw;
  const turns=offset=>Math.abs(angleNear(first+offset,start.yaw)-start.yaw)+Math.abs(angleNear(end.yaw,last+offset)-last-offset);
  // Returning can retrace the approach as a backwards dolly, without two U-turns.
  if(turns(Math.PI)+.4<turns(0))reverse=Math.PI;
 }
 addTurn(points[0],heading(0),fromFov);
 // Include every original bend so interpolation cannot cut through a doorway.
 const count=Math.ceil(metrics.total/.3);
 const distances=[...metrics.distances,...Array.from({length:count+1},(_,i)=>i*metrics.total/count)].sort((a,b)=>a-b).filter((d,i,a)=>!i||d-a[i-1]>.00001);
 for(let i=1;i<distances.length;i++){
  const d=distances[i],last=distances[i-1],prev=keys.at(-1),yaw=angleNear(heading(d).yaw,prev.yaw);
  const accelerationDistance=Math.min((last+d)/2,metrics.total-(last+d)/2);
  const speed=Math.min(TRAVEL_SPEED,Math.sqrt(16*Math.max(.03,accelerationDistance)));
  const seconds=Math.max((d-last)/speed,Math.abs(yaw-prev.yaw)/TURN_RATE);
  keys.push({position:sampleRoute(points,metrics,d/metrics.total),yaw,pitch:0,fov:fromFov+(toFov-fromFov)*ease(d/metrics.total),time:prev.time+seconds,turn:false});
 }
 addTurn(points.at(-1),end,toFov);
 return {keys,duration:keys.at(-1).time};
}

export function sampleCameraMotion(motion,seconds){
 const keys=motion.keys,index=keys.findIndex(k=>k.time>=seconds);
 if(index===-1)return {...keys.at(-1),done:true};
 if(index===0)return {...keys[0],done:false};
 const a=keys[index-1],b=keys[index];let t=clamp((seconds-a.time)/(b.time-a.time),0,1);if(b.turn)t=ease(t);
 return {position:a.position.map((v,i)=>v+(b.position[i]-v)*t),yaw:a.yaw+(b.yaw-a.yaw)*t,pitch:a.pitch+(b.pitch-a.pitch)*t,fov:a.fov+(b.fov-a.fov)*t,done:seconds>=motion.duration};
}

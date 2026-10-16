import {routeMetrics,sampleRoute} from './navigation.mjs';

const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const ease=t=>t*t*(3-2*t);
const blend=t=>{t=clamp(t,0,1);return t*t*t*(t*(t*6-15)+10);};
const angleNear=(angle,reference)=>reference+Math.atan2(Math.sin(angle-reference),Math.cos(angle-reference));
function direction(position,target){
 const [x,y,z]=target.map((v,i)=>v-position[i]);
 return {yaw:Math.atan2(x,z),pitch:Math.atan2(y,Math.hypot(x,z))};
}
// Slow down before bends, with room to accelerate and brake on either side.
const TURN_RATE=2.6,TRAVEL_SPEED=22,ACCELERATION=24,LATERAL_ACCELERATION=20;

// Monotone Hermite curves share a velocity at each key, without overshooting
// the safe route distance or reversing a turn between samples.
function finishMotion(keys,points,metrics){
 const fields=['distance','yaw','pitch','fov'];
 const slopes=keys.map(()=>Object.fromEntries(fields.map(field=>[field,0])));
 for(let i=1;i<keys.length-1;i++)for(const field of fields){
  if(keys[i].turn||keys[i+1].turn)continue;
  const a=keys[i-1],b=keys[i],c=keys[i+1],h0=b.time-a.time,h1=c.time-b.time;
  const left=(b[field]-a[field])/h0,right=(c[field]-b[field])/h1;
  if(left*right>0){const w0=2*h1+h0,w1=h1+2*h0;slopes[i][field]=(w0+w1)/(w0/left+w1/right);}
 }
 return {keys,slopes,points,metrics,duration:keys.at(-1).time};
}
function interpolate(a,b,va,vb,t,seconds){
 return (2*t**3-3*t*t+1)*a+(t**3-2*t*t+t)*seconds*va+(-2*t**3+3*t*t)*b+(t**3-t*t)*seconds*vb;
}

// Rotate directions rather than interpolating world-space look-at points: a
// target passing through the camera caused the previous sudden 180° flips.
export function createCameraMotion(points,fromTarget,toTarget,fromFov,toFov,returning=false){
 const metrics=routeMetrics(points),start=direction(points[0],fromTarget),end=direction(points.at(-1),toTarget);
 const keys=[{position:points[0],distance:0,...start,fov:fromFov,time:0,turn:false}];
 function addTurn(position,angles,fov){
  const prev=keys.at(-1),yaw=angleNear(angles.yaw,prev.yaw);
  const radians=Math.hypot(yaw-prev.yaw,angles.pitch-prev.pitch);
  keys.push({position,distance:prev.distance,yaw,pitch:angles.pitch,fov,time:prev.time+Math.max(.12,1.5*radians/TURN_RATE),turn:true});
 }
 if(metrics.total<.01){addTurn(points.at(-1),end,toFov);return finishMotion(keys,points,metrics);}
 let reverse=0;
 function heading(distance){
  const a=sampleRoute(points,metrics,distance/metrics.total);
  let b=sampleRoute(points,metrics,Math.min(1,(distance+3.5)/metrics.total));
  if(metrics.total-distance<.001){const behind=sampleRoute(points,metrics,Math.max(0,(distance-1)/metrics.total));b=a.map((v,i)=>v+(v-behind[i]));}
  return {yaw:direction(a,b).yaw+reverse,pitch:0};
 }
 if(returning){
  const first=heading(0).yaw,last=heading(metrics.total).yaw;
  const turns=offset=>Math.abs(angleNear(first+offset,start.yaw)-start.yaw)+Math.abs(angleNear(end.yaw,last+offset)-last-offset);
  // Returning can retrace the approach as a backwards dolly, without two U-turns.
  if(turns(Math.PI)+.4<turns(0))reverse=Math.PI;
 }
 // Start travelling while turning, and acquire the artwork before arriving.
 // These windows overlap the journey instead of adding stationary turn phases.
 const departureDistance=Math.min(metrics.total*.45,10),arrivalDistance=Math.min(metrics.total*.4,7);
 // Smooth travelled distance; sampleRoute still follows every original bend.
 // Uniform samples avoid near-duplicate keys with abrupt millisecond changes.
 const count=Math.ceil(metrics.total/.3);
 const distances=Array.from({length:count+1},(_,i)=>i*metrics.total/count);
 let previousHeading=angleNear(heading(0).yaw,start.yaw);
 const rawHeadings=distances.map(d=>{previousHeading=angleNear(heading(d).yaw,previousHeading);return previousHeading;});
 // A look-ahead crossing a route join must not abruptly change the turn rate.
 // Filter directions over distance, so the result is independent of frame rate.
 const window=Math.ceil(1.8/(metrics.total/count));
 const headings=rawHeadings.map((_,i)=>{
  let sum=0,weight=0;
  for(let j=-window;j<=window;j++){const w=1+window-Math.abs(j);sum+=rawHeadings[clamp(i+j,0,count)]*w;weight+=w;}
  return sum/weight;
 });
 const endYaw=angleNear(end.yaw,headings.at(-1));
 for(let i=1;i<distances.length;i++){
  const d=distances[i],prev=keys.at(-1),depart=blend(d/departureDistance),arrive=blend(1-(metrics.total-d)/arrivalDistance);
  const travelYaw=headings[i];
  let yaw=start.yaw+(travelYaw-start.yaw)*depart;
  yaw=angleNear(yaw+(endYaw-yaw)*arrive,prev.yaw);
  const pitch=start.pitch*(1-depart)*(1-arrive)+end.pitch*arrive;
  keys.push({position:i===count?points.at(-1):sampleRoute(points,metrics,d/metrics.total),distance:d,yaw,pitch,fov:fromFov+(toFov-fromFov)*ease(d/metrics.total),time:0,turn:false});
 }
 const speeds=keys.map((key,i)=>{
  if(i===0||i===count)return 0;
  const a=keys[i-1],b=keys[i+1],ds=(b.distance-a.distance)/2;
  const incoming=key.position.map((v,k)=>v-a.position[k]),outgoing=b.position.map((v,k)=>v-key.position[k]);
  const cosine=incoming.reduce((sum,v,k)=>sum+v*outgoing[k],0)/(Math.hypot(...incoming)*Math.hypot(...outgoing));
  const curvature=Math.acos(clamp(cosine,-1,1))/ds;
  const rotation=Math.max(Math.hypot(key.yaw-a.yaw,key.pitch-a.pitch),Math.hypot(b.yaw-key.yaw,b.pitch-key.pitch))/ds;
  return Math.min(TRAVEL_SPEED,Math.sqrt(LATERAL_ACCELERATION/Math.max(curvature,1e-6)),TURN_RATE/(1.5*Math.max(rotation,1e-6)));
 });
 // Propagate braking backwards before a tight corner, then acceleration forwards.
 // Independent segment durations caused sharp speed dips at the start of turns.
 for(let i=count-1;i>=0;i--)speeds[i]=Math.min(speeds[i],Math.sqrt(speeds[i+1]**2+2*ACCELERATION*(distances[i+1]-distances[i])));
 for(let i=1;i<=count;i++)speeds[i]=Math.min(speeds[i],Math.sqrt(speeds[i-1]**2+2*ACCELERATION*(distances[i]-distances[i-1])));
 for(let i=1;i<=count;i++){
  const a=keys[i-1],b=keys[i],ds=b.distance-a.distance;
  const seconds=speeds[i-1]+speeds[i]>0?2*ds/(speeds[i-1]+speeds[i]):Math.max(2*Math.sqrt(ds/ACCELERATION),1.5*Math.hypot(b.yaw-a.yaw,b.pitch-a.pitch)/TURN_RATE);
  b.time=a.time+seconds;
 }
 const stretch=Math.max(1,1.8/keys.at(-1).time);keys.forEach(key=>{key.time*=stretch;});
 const motion=finishMotion(keys,points,metrics);
 // Preserve the planned velocity at joins; estimating it again can overshoot
 // the acceleration envelope, especially in the first and last intervals.
 motion.slopes.forEach((slope,i)=>{slope.distance=speeds[i]/stretch;});
 return motion;
}

function firstKeyAtOrAfter(keys,seconds){
 // Motion key times are nondecreasing. Keep the same first matching key and
 // interpolation arithmetic; only the search cost changes from O(n) to O(log n).
 let low=0,high=keys.length;
 while(low<high){const middle=Math.floor((low+high)/2);if(keys[middle].time>=seconds)high=middle;else low=middle+1;}
 return low<keys.length?low:-1;
}
export function sampleCameraMotion(motion,seconds){
 if(seconds>=motion.duration)return {...motion.keys.at(-1),done:true};
 const keys=motion.keys,index=firstKeyAtOrAfter(keys,seconds);
 if(index===-1)return {...keys.at(-1),done:true};
 if(index===0)return {...keys[0],done:false};
 const a=keys[index-1],b=keys[index],dt=b.time-a.time,t=clamp((seconds-a.time)/dt,0,1);
 const value=field=>interpolate(a[field],b[field],motion.slopes[index-1][field],motion.slopes[index][field],t,dt);
 const distance=value('distance');
 return {position:motion.metrics.total<.01?b.position:sampleRoute(motion.points,motion.metrics,distance/motion.metrics.total),yaw:value('yaw'),pitch:value('pitch'),fov:value('fov'),done:seconds>=motion.duration};
}

const dist=(a,b)=>Math.hypot(...a.map((n,i)=>n-b[i]));
const geometryCache=new WeakMap();
function polygonBounds(poly){const xs=poly.map(p=>p[0]),zs=poly.map(p=>p[1]);return [Math.min(...xs),Math.min(...zs),Math.max(...xs),Math.max(...zs)];}
function inBounds(x,z,b,margin=0){return x>=b[0]-margin&&x<=b[2]+margin&&z>=b[1]-margin&&z<=b[3]+margin;}
function inPolygon(x,z,poly){let inside=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){
  const a=poly[i],b=poly[j];if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])inside=!inside;
}return inside;}
function edgeDistance(x,z,poly){let best=Infinity;for(let i=0;i<poly.length;i++){
  const a=poly[i],b=poly[(i+1)%poly.length],dx=b[0]-a[0],dz=b[1]-a[1];
  const t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz||1)));
  best=Math.min(best,(x-a[0]-t*dx)**2+(z-a[1]-t*dz)**2);
}return best;}
function geometry(layout){if(!geometryCache.has(layout))geometryCache.set(layout,{
  regions:layout.walkPolygons.map(rings=>({rings,bounds:polygonBounds(rings[0])})),
  obstacles:layout.obstacles.map(o=>({...o,bounds:polygonBounds(o.poly)})),
  portals:layout.portals.map(p=>({...p,bounds:polygonBounds(p.poly)})),
});return geometryCache.get(layout);}
export function isWalkable(layout,p,margin=.23){
  if(!Array.isArray(p)||p.length!==3||!p.every(Number.isFinite))return false;
  const [x,y,z]=p,g=geometry(layout);
  if(y<.4||y>layout.maximumWalkHeight-margin)return false;
  // Clearance is measured against the UNION boundary. Eroding each room
  // separately closes the shared seams between the hall and its four throats.
  if(!g.regions.some(({rings,bounds})=>inBounds(x,z,bounds)&&inPolygon(x,z,rings[0])&&!rings.slice(1).some(h=>inPolygon(x,z,h))&&rings.every(r=>edgeDistance(x,z,r)>=(margin-1e-7)**2)))return false;
  for(const o of g.obstacles)if(inBounds(x,z,o.bounds,margin)&&(inPolygon(x,z,o.poly)||edgeDistance(x,z,o.poly)<margin**2))return false;
  for(const portal of g.portals)if(inBounds(x,z,portal.bounds)&&inPolygon(x,z,portal.poly)){
    const dx=x-portal.origin[0],by=-z+portal.origin[2];
    const v=-Math.sin(portal.angle)*dx+Math.cos(portal.angle)*by;
    const ceiling=portal.spring+Math.sqrt(Math.max(0,(portal.width/2)**2-v*v));
    if(y>ceiling-margin)return false;
  }
  return true;
}
export function clearSegment(layout,a,b,margin=.23){const n=Math.max(1,Math.ceil(dist(a,b)/.08));for(let i=0;i<=n;i++)if(!isWalkable(layout,a.map((v,k)=>v+(b[k]-v)*i/n),margin))return false;return true;}
export function cameraPose(layout,id,mobile,aspect){
  const a=layout.artworks.find(a=>a.id===id)||layout.artworks.find(a=>a.id===layout.projectSlots[id]);
  if(!a)return {...layout.overview};
  const target=[...a.position];target[1]+=mobile?1.0:0;
  const position=[...a.cameraPosition],forward=target.map((v,i)=>v-position[i]);
  const length=Math.hypot(...forward);forward.forEach((_,i)=>{forward[i]/=length;});
  const horizontal=Math.hypot(forward[0],forward[2]);
  const right=[-forward[2]/horizontal,0,forward[0]/horizontal];
  const up=[-forward[1]*forward[0]/horizontal,horizontal,-forward[1]*forward[2]/horizontal];
  let tanHalf=Math.tan(45*Math.PI/360);
  // Fit actual frame corners including camera tilt and mobile interface space.
  for(const x of [-a.frameWidth/2,a.frameWidth/2])for(const y of [-a.frameHeight/2,a.frameHeight/2]){
    const delta=[a.position[0]+x*Math.cos(a.rotation)-position[0],a.position[1]+y-position[1],a.position[2]-x*Math.sin(a.rotation)-position[2]];
    const dot=v=>v.reduce((s,n,i)=>s+n*delta[i],0),depth=dot(forward),vertical=dot(up)/depth;
    tanHalf=Math.max(tanHalf,Math.abs(dot(right)/depth)/(Math.max(.3,aspect)*.78),Math.abs(vertical)/(vertical>0?(mobile?.48:.67):.78));
  }
  return {position,target,fov:2*Math.atan(tanHalf)*180/Math.PI,room:a.room};
}
// Connect endpoints to every visible safe waypoint in the X-shaped gallery.
export function planRoute(layout,from,to){
  // Leave room for broad bends. A selection made halfway around a bend may
  // start closer to a wall, so use the already validated clearance there.
  const clear=(a,b)=>clearSegment(layout,a,b,isWalkable(layout,a,.7)&&isWalkable(layout,b,.7)?.7:.26);
  if(clear(from,to))return [from,to];
  const nodes=layout.navigation.nodes.map(p=>[...p]),edges=layout.navigation.edges.map(e=>[...e]);
  function attach(p){const ranked=nodes.map((v,i)=>({i,d:dist(v,p)})).sort((a,b)=>a.d-b.d);const links=[];
    for(const c of ranked)if(clear(p,nodes[c.i]))links.push(c.i);
    if(!links.length)throw new Error('No safe connection to the gallery route');
    const idx=nodes.length;nodes.push([...p]);links.forEach(i=>edges.push([idx,i]));return idx;
  }
  const start=attach(from),end=attach(to),adj=nodes.map(()=>[]);
  edges.forEach(([a,b])=>{const w=dist(nodes[a],nodes[b]);adj[a].push([b,w]);adj[b].push([a,w]);});
  const costs=nodes.map(()=>Infinity),prev=nodes.map(()=>-1),visited=new Set();costs[start]=0;
  while(visited.size<nodes.length){let u=-1;costs.forEach((d,i)=>{if(!visited.has(i)&&(u<0||d<costs[u]))u=i;});if(u<0||!Number.isFinite(costs[u])||u===end)break;visited.add(u);for(const [v,w] of adj[u])if(costs[u]+w<costs[v]){costs[v]=costs[u]+w;prev[v]=u;}}
  if(!Number.isFinite(costs[end]))throw new Error('Gallery route is disconnected');
  const route=[];for(let at=end;at!==-1;at=prev[at])route.unshift(nodes[at]);
  const short=[route[0]];
  for(let i=0;i<route.length-1;){let j=route.length-1;while(j>i+1&&!clear(route[i],route[j]))j--;if(dist(short.at(-1),route[j])>.001)short.push(route[j]);i=j;}
  return smoothRoute(layout,roundRoute(layout,short));
}
function roundRoute(layout,points){
  const result=[points[0]];
  for(let i=1;i<points.length-1;i++){
    const a=points[i-1],b=points[i],c=points[i+1],ab=dist(a,b),bc=dist(b,c);
    const maximum=Math.min(8,ab*.48,bc*.48);let low=0,high=maximum,curve;
    // Spread a bend across the available space, with straight tangents and zero
    // curvature at both ends. Fit the largest safe sweep around the actual walls.
    for(let attempt=0;attempt<9;attempt++){
      const radius=attempt?(low+high)/2:maximum;
      const start=b.map((v,k)=>v+(a[k]-v)*radius/ab),end=b.map((v,k)=>v+(c[k]-v)*radius/bc);
      const controls=[start,...[.32,.64].map(f=>start.map((v,k)=>v+(b[k]-a[k])*radius*f/ab)),...[.64,.32].map(f=>end.map((v,k)=>v-(c[k]-b[k])*radius*f/bc)),end];
      const count=Math.max(24,Math.ceil(radius*2/.12));
      const candidate=Array.from({length:count+1},(_,j)=>{const t=j/count,u=1-t,weights=[u**5,5*u**4*t,10*u**3*t*t,10*u*u*t**3,5*u*t**4,t**5];return b.map((_,k)=>controls.reduce((s,p,n)=>s+p[k]*weights[n],0));});
      if(candidate.every((p,j)=>clearSegment(layout,j?candidate[j-1]:result.at(-1),p,.26))&&clearSegment(layout,candidate.at(-1),c,.26)){curve=candidate;low=radius;if(radius===maximum)break;}
      else high=radius;
    }
    result.push(...(curve||[b]));
  }
  result.push(points.at(-1));return result;
}
function smoothRoute(layout,route){
  const metrics=routeMetrics(route),count=Math.ceil(metrics.total/.65);
  const points=Array.from({length:count+1},(_,i)=>sampleRoute(route,metrics,i/count));
  // Spread each bend along the whole path, instead of restricting its radius
  // to the shortest neighbouring edge (often the small doorway connector).
  // Relax the second differences, retaining the endpoints and wall clearance.
  for(let pass=0;pass<32;pass++){
    for(let j=1;j<count;j++){
      const i=pass%2?count-j:j,p=points[i],a=points[i-1],b=points[i+1];
      const aa=i>1?points[i-2]:a.map((v,k)=>2*v-p[k]);
      const bb=i<count-1?points[i+2]:b.map((v,k)=>2*v-p[k]);
      const candidate=p.map((v,k)=>k===1?v:v+.5*((4*(a[k]+b[k])-aa[k]-bb[k])/6-v));
      if(clearSegment(layout,a,candidate,.3)&&clearSegment(layout,candidate,b,.3))points[i]=candidate;
    }
  }
  // A cubic B-spline joins the relaxed controls with continuous tangent and
  // curvature. Dense samples preserve that curve in the distance-based player.
  const controls=[points[0],points[0],...points,points.at(-1),points.at(-1)],result=[];
  for(let i=0;i<controls.length-3;i++){
    const cp=controls.slice(i,i+4),n=Math.max(4,Math.ceil(dist(cp[1],cp[2])/.04));
    for(let j=0;j<n;j++){
      const t=j/n,u=1-t,w=[u**3/6,(3*t**3-6*t*t+4)/6,(-3*t**3+3*t*t+3*t+1)/6,t**3/6];
      const p=cp[0].map((_,k)=>cp.reduce((sum,c,l)=>sum+c[k]*w[l],0));
      if(!result.length||dist(result.at(-1),p)>1e-8)result.push(p);
    }
  }
  result[0]=route[0];result.push(route.at(-1));
  // Recheck the actual curve, including every chord, before using it. A route
  // interrupted next to a wall can still fall back to its validated bends.
  return result.every((p,i)=>!i||clearSegment(layout,result[i-1],p,.26))?result:route;
}
export function routeMetrics(points){let total=0;const distances=[0];for(let i=1;i<points.length;i++){total+=dist(points[i-1],points[i]);distances.push(total);}return {distances,total};}
function firstDistanceAtOrAfter(distances,d){
  // routeMetrics is nondecreasing; lower-bound preserves findIndex's FIRST
  // match at repeated/zero-length segments. NaN still produces no match.
  let low=0,high=distances.length;
  while(low<high){const middle=Math.floor((low+high)/2);if(distances[middle]>=d)high=middle;else low=middle+1;}
  return low<distances.length?low:-1;
}
export function sampleRoute(points,metrics,t){const d=Math.max(0,Math.min(1,t))*metrics.total;let i=firstDistanceAtOrAfter(metrics.distances,d);if(i<=0)return [...points[0]];const start=metrics.distances[i-1],u=(d-start)/(metrics.distances[i]-start||1);return points[i].map((n,k)=>points[i-1][k]+(n-points[i-1][k])*u);}

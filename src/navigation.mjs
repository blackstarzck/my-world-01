const dist=(a,b)=>Math.hypot(...a.map((n,i)=>n-b[i]));
const boundaryCache=new WeakMap();
function corridorIndex(layout){
  if(boundaryCache.has(layout))return boundaryCache.get(layout);
  const rows=new Map(),cells=new Map();
  for(const poly of layout.circulation)for(const ring of poly)for(let i=1;i<ring.length;i++){
    const edge=[ring[i-1],ring[i]],minX=Math.floor(Math.min(edge[0][0],edge[1][0])/4),maxX=Math.floor(Math.max(edge[0][0],edge[1][0])/4),minZ=Math.floor(Math.min(edge[0][1],edge[1][1])/4),maxZ=Math.floor(Math.max(edge[0][1],edge[1][1])/4);
    for(let z=minZ;z<=maxZ;z++){if(!rows.has(z))rows.set(z,[]);rows.get(z).push(edge);for(let x=minX;x<=maxX;x++){const key=x+','+z;if(!cells.has(key))cells.set(key,[]);cells.get(key).push(edge);}}
  }
  const result={rows,cells};boundaryCache.set(layout,result);return result;
}
export function localPoint(room,p){const a=room.angle*Math.PI/180,x=p[0]-room.door[0],z=p[2]-room.door[1];return [x*Math.cos(a)+z*Math.sin(a),p[1],-x*Math.sin(a)+z*Math.cos(a)];}
function inside(p,ring){let yes=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])yes=!yes;}return yes;}
function segmentDistance(p,a,b){const v=b.map((n,i)=>n-a[i]),l=v.reduce((s,n)=>s+n*n,0),t=l?Math.max(0,Math.min(1,p.reduce((s,n,i)=>s+(n-a[i])*v[i],0)/l)):0;return dist(p,a.map((n,i)=>n+t*v[i]));}
export function isWalkable(layout,p,margin=.23){
  if(p[1]<.4)return false;
  for(const r of layout.rooms){const [x,y,z]=localPoint(r,p);
    if(Math.abs(x)<1.6-margin&&Math.abs(z)<.65&&y<3.6-margin)return true;
    if(!inside([x,z],r.local))continue;
    if(y>r.h-.3)return false;
    if(Math.abs(x-r.artLocal[0])<r.art[0]/2+margin&&Math.abs(z-r.artLocal[1])<.25+margin&&y<r.art[1]+.65+margin)return false;
    if(Math.abs(x)<1.6-margin&&z>-.65&&y<3.6-margin)return true;
    return Math.min(...r.local.map((a,i)=>segmentDistance([x,z],a,r.local[(i+1)%r.local.length])))>.3+margin;
  }
  if(Math.abs(p[0])<8-margin&&Math.abs(p[2])<8-margin)return p[1]<layout.court.height-margin;
  if(p[1]>layout.corridorHeight-margin)return false;
  const q=[p[0],p[2]],index=corridorIndex(layout),cx=Math.floor(q[0]/4),cz=Math.floor(q[1]/4);let yes=false;
  for(const [a,b] of index.rows.get(cz)||[])if((a[1]>q[1])!==(b[1]>q[1])&&q[0]<(b[0]-a[0])*(q[1]-a[1])/(b[1]-a[1])+a[0])yes=!yes;
  if(!yes)return false;
  for(let x=cx-1;x<=cx+1;x++)for(let z=cz-1;z<=cz+1;z++)for(const [a,b] of index.cells.get(x+','+z)||[])if(segmentDistance(q,a,b)<=.09+margin)return false;
  return true;
}
export function clearSegment(layout,a,b){const n=Math.max(1,Math.ceil(dist(a,b)/.16));for(let i=0;i<=n;i++)if(!isWalkable(layout,a.map((v,k)=>v+(b[k]-v)*i/n)))return false;return true;}
export function cameraPose(layout,id,mobile,aspect){
  const a=layout.artworks.find(a=>a.id===id);
  if(!a)return {...layout.overview};
  const target=[...a.position];target[1]+=mobile?1.0:0;
  const position=[target[0]+Math.sin(a.rotation)*a.viewDistance,2.3,target[2]+Math.cos(a.rotation)*a.viewDistance];
  const fov=2*Math.atan(Math.max(a.height/(2*a.viewDistance*(mobile?.52:.67)),a.width/(2*a.viewDistance*aspect*.79)))*180/Math.PI;
  return {position,target,fov:Math.max(45,Math.min(91,fov)),room:a.room};
}
// Keep safe graph connections, but let the open court connect to every visible
// waypoint. Restricting endpoints to their two nearest nodes forced long detours.
export function planRoute(layout,from,to){
  if(clearSegment(layout,from,to))return [from,to];
  const nodes=layout.navigation.nodes.map(p=>[...p]),edges=layout.navigation.edges.map(e=>[...e]);
  function attach(p){const ranked=nodes.map((v,i)=>({i,d:dist(v,p)})).sort((a,b)=>a.d-b.d);const links=[];
    for(const c of ranked)if(clearSegment(layout,p,nodes[c.i]))links.push(c.i);
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
  for(let i=0;i<route.length-1;){let j=route.length-1;while(j>i+1&&!clearSegment(layout,route[i],route[j]))j--;if(dist(short.at(-1),route[j])>.001)short.push(route[j]);i=j;}
  return roundRoute(layout,short);
}
function roundRoute(layout,points){
  const result=[points[0]];
  for(let i=1;i<points.length-1;i++){
    const a=points[i-1],b=points[i],c=points[i+1],ab=dist(a,b),bc=dist(b,c);let radius=Math.min(1.8,ab*.35,bc*.35),curve;
    for(let attempt=0;attempt<6;attempt++,radius*=.5){
      const start=b.map((v,k)=>v+(a[k]-v)*radius/ab),end=b.map((v,k)=>v+(c[k]-v)*radius/bc);
      const candidate=Array.from({length:17},(_,j)=>{const t=j/16;return b.map((v,k)=>(1-t)**2*start[k]+2*(1-t)*t*v+t*t*end[k]);});
      if(candidate.every((p,j)=>clearSegment(layout,j?candidate[j-1]:result.at(-1),p))){curve=candidate;break;}
    }
    result.push(...(curve||[b]));
  }
  result.push(points.at(-1));return result;
}
export function routeMetrics(points){let total=0;const distances=[0];for(let i=1;i<points.length;i++){total+=dist(points[i-1],points[i]);distances.push(total);}return {distances,total};}
export function sampleRoute(points,metrics,t){const d=Math.max(0,Math.min(1,t))*metrics.total;let i=metrics.distances.findIndex(v=>v>=d);if(i<=0)return [...points[0]];const start=metrics.distances[i-1],u=(d-start)/(metrics.distances[i]-start||1);return points[i].map((n,k)=>points[i-1][k]+(n-points[i-1][k])*u);}

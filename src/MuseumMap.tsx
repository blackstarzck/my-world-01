import layout from './data/layout.json';
import {projects} from './data/projects';

export default function MuseumMap({onSelect}:{onSelect:(id:string,slotId?:string)=>void}){
  return <div className="museum-map"><p>네 전시실 · 48개 전시 자리 <span>8개 샘플 작품을 반복 배치했습니다</span></p>
    <svg viewBox="-46 -46 92 94" aria-label="중앙 팔각 홀에서 X자로 연결된 네 전시실. 방마다 12개, 총 48개 작품 자리 배치도">
      <rect x="-46" y="-46" width="92" height="94" rx="2" fill="#f3f0e7"/>
      {layout.walkPolygons.map((poly,i)=><path key={i} d={poly.map(r=>'M'+r.map(p=>p.join(',')).join('L')+'Z').join('')} fill="#dcc8a5" stroke="#8ba29c" strokeWidth=".24"/>)}
      <polygon points={layout.court.poly.map(p=>p.join(',')).join(' ')} style={{fill:'#e9eee3'}}/>
      <circle r="8.4" fill="none" stroke="#8ba29c" strokeWidth=".2"/>
      <text x="0" y=".3" textAnchor="middle" style={{fontSize:2.2}}>중앙 돔 홀</text>
      <text x="0" y="3.2" textAnchor="middle" style={{fontSize:1.5}}>각 실 12 × 36m</text>
      {layout.rooms.map(r=><g key={r.id}>
        <polygon points={r.poly.map(p=>p.join(',')).join(' ')} style={{fill:r.color,stroke:'none'}}/>
        <text x={r.center[0]} y={r.center[1]} textAnchor="middle" dominantBaseline="central" transform={`rotate(${r.center[0]*r.center[1]>0?45:-45} ${r.center[0]} ${r.center[1]})`} style={{fontSize:1.85}}>{r.name} · 12자리</text>
      </g>)}
      {[...layout.piers,...layout.furniture].map(o=><polygon key={o.id} points={o.poly.map(p=>p.join(',')).join(' ')} style={{fill:o.kind==='planter'?'#788d65':'#657367',stroke:'none'}}/>)}
      {layout.artworks.map(a=>{
        const index=projects.findIndex(p=>p.id===a.projectId),project=projects[index];
        const x=a.position[0]+a.normal[0]*1.1,z=a.position[2]+a.normal[2]*1.1;
        const label=`${a.slotId} · ${project.title} 작품으로 이동`;
        return <g key={a.id} className="map-artwork" role="button" tabIndex={0} aria-label={label} onClick={()=>onSelect(a.projectId,a.id)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onSelect(a.projectId,a.id);}}}>
          <title>{label}</title>
          <circle cx={x} cy={z} r="1.55" fill="#f9f7ef" stroke="#a56d44" strokeWidth=".2"/>
          <text x={x} y={z} textAnchor="middle" dominantBaseline="central" style={{fontSize:1.6}}>{String(index+1).padStart(2,'0')}</text>
        </g>;
      })}
      <path d="M-4,16 L4,16 M0,18 L0,21" stroke="#a56d44" strokeWidth=".4" fill="none"/>
      <text x="0" y="24.5" textAnchor="middle" style={{fontSize:1.8}}>주 출입구</text>
      <text x="0" y="45" textAnchor="middle" style={{fontSize:1.7}}>번호를 선택하면 해당 전시 자리로 이동합니다</text>
    </svg>
    <div aria-label="전시 자리 목록" style={{display:'grid',gap:8,marginTop:16}}>
      {layout.rooms.map(room=><details key={room.id}>
        <summary style={{cursor:'pointer',padding:'10px 0',fontSize:12}}>{room.name} · 12자리 선택</summary>
        <div style={{display:'grid',gridTemplateColumns:'repeat(2,minmax(0,1fr))',gap:6}}>
          {layout.artworks.filter(a=>a.room===room.id).map(a=><button key={a.id} style={{padding:'12px 6px',minHeight:44,fontSize:11,border:'1px solid #bec3b4'}} onClick={()=>onSelect(a.projectId,a.id)}>{a.side==='L'?'왼쪽':'오른쪽'} {a.bay} · {projects.find(p=>p.id===a.projectId)?.title}</button>)}
        </div>
      </details>)}
    </div>
  </div>;
}

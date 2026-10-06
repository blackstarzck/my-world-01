import layout from './data/layout.json';
import {projects} from './data/projects';

export default function MuseumMap({onSelect}:{onSelect:(id:string)=>void}){
  return <div className="museum-map"><p>여덟 작품, 여덟 개의 공간 <span>전시실을 선택하세요</span></p>
    <svg viewBox="-30 -30 60 63" aria-label="중정 둘레의 순환 회랑으로 연결된 여덟 전시실 배치도">
      {layout.corridor.map((poly,i)=><path key={i} d={poly.map(r=>'M'+r.map(p=>p.join(',')).join('L')+'Z').join('')} fill="#dcc8a5"/>)}
      <rect x="-8" y="-8" width="16" height="16" fill="#d9e7dd" stroke="#8ba29c" strokeWidth=".3"/>
      <text x="0" y=".6" textAnchor="middle" style={{fontSize:2.2}}>채광 중정</text>
      {layout.rooms.map((r,i)=><g key={r.id} role="button" tabIndex={0} aria-label={`${String(r.id).padStart(2,'0')} ${projects[i].title} 전시실로 이동`} onClick={()=>onSelect(r.project)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onSelect(r.project);}}}>
        <polygon points={r.poly.map(p=>p.join(',')).join(' ')} strokeWidth=".7"/>
        <text x={r.center[0]} y={r.center[1]+.9} textAnchor="middle">{String(r.id).padStart(2,'0')}</text>
      </g>)}
      <text x="10" y="31" textAnchor="middle" style={{fontSize:1.8}}>입구</text>
    </svg>
  </div>;
}

import fs from 'node:fs/promises';
import sharp from 'sharp';
const spec=JSON.parse(await fs.readFile('assets/design/model-spec.json','utf8'));
const dir='assets/design/model-sheets'; await fs.mkdir(dir,{recursive:true});
const colors={canvas:'#d9d4c5',steel:'#768078',wood:'#c4a984',stone:'#cbc6b8',olive:'#a4ad92'};
const esc=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;');
const text=(x,y,t,size=15)=>`<text x="${x}" y="${y}" font-size="${size}" font-family="Arial" fill="#26332e">${esc(t)}</text>`;
const line=(x,y,X,Y,dash='')=>`<path d="M${x} ${y}L${X} ${Y}" fill="none" stroke="#6b7d73" stroke-width="1" ${dash?'stroke-dasharray="5 4"':''}/>`;
const dimension=(x,y,X,Y,t)=>line(x,y,X,Y)+line(x-4,y-5,x+4,y+5)+line(X-4,Y-5,X+4,Y+5)+text((x+X)/2+6,(y+Y)/2-9,t,13);
const mm=n=>Math.round(n*1000);
function ortho(a,cx,by,scale,view){
  let out=''; const plan=view==='TOP',side=view==='SIDE';
  const parts=[...a.parts].sort((a,b)=>view==='BACK'?b.p[2]-a.p[2]:a.p[2]-b.p[2]);
  for(const p of parts){let u=side?2:0,v=plan?2:1;let px=p.p[u],py=p.p[v]; if(view==='BACK')px=-px;
    const x=cx+(px-p.s[u]/2)*scale,y=by-(py+p.s[v]/2)*scale;
    out+=`<rect x="${x}" y="${y}" width="${p.s[u]*scale}" height="${p.s[v]*scale}" rx="${Math.min(p.bevel*scale,3)}" fill="${colors[p.material]}" stroke="#394b40" stroke-width="1"/>`;
  }
  const w=(side?a.size[2]:a.size[0])*scale,h=(plan?a.size[2]:a.size[1])*scale;
  const bottom=plan?by+h/2:by;
  out+=dimension(cx-w/2,bottom+25,cx+w/2,bottom+25,`${mm(side?a.size[2]:a.size[0])} mm`);
  if(!plan)out+=dimension(cx-w/2-22,by-h,cx-w/2-22,by,`${mm(a.size[1])}`);
  out+=line(cx,by-h-20,cx,bottom+8,'dash');
  return out;
}
function iso(a,cx,by,s){let out='';const pr=(x,y,z)=>[cx+(x-z)*s*.72,by-y*s+(x+z)*s*.28];
  for(const p of [...a.parts].sort((a,b)=>a.p[1]-b.p[1])){
    const [x,y,z]=p.p,[w,h,d]=p.s;const pts=[];
    for(const dy of [-1,1])for(const dz of [-1,1])for(const dx of [-1,1])pts.push(pr(x+dx*w/2,y+dy*h/2,z+dz*d/2));
    for(const face of [[0,1,5,4],[1,3,7,5],[4,5,7,6]])out+=`<polygon points="${face.map(i=>pts[i].join(',')).join(' ')}" fill="${colors[p.material]}" stroke="#394b40" stroke-width=".9"/>`;
  } return out;
}
for(const [index,a] of spec.assets.entries()){
  const s=Math.min(325/a.size[1],250/a.size[0]), small=Math.min(290/a.size[1],280/a.size[0]);
  let content=text(65,68,`STILL / MODELING REFERENCE ${String(index+1).padStart(2,'0')} / REV ${spec.revision}`,18)+text(65,117,a.name,34)+text(65,155,'ORTHOGRAPHIC VIEWS / shared scale / dimensions in millimetres / design intent, not a site survey',16);
  content+=line(65,180,1735,180);
  content+=text(110,223,'FRONT')+ortho(a,260,580,s,'FRONT');
  content+=text(510,223,'RIGHT SIDE')+ortho(a,605,580,s,'SIDE');
  content+=text(875,223,'BACK / STRUCTURE')+ortho(a,1025,580,s,'BACK');
  content+=text(1310,223,'ASSEMBLY / ISOMETRIC')+iso(a,1500,580,small);
  content+=text(110,700,'TOP / same scale')+ortho(a,260,825,s,'TOP');
  content+=text(530,700,'PART SCHEDULE / W x H x D (mm)',18);
  a.parts.forEach((p,i)=>content+=text(530,735+i*24,`${String(i+1).padStart(2,'0')}  ${p.name}    ${p.s.map(mm).join(' x ')}    R${mm(p.bevel)}`,14));
  content+=text(1260,700,'CONSTRUCTION NOTES',18);
  a.notes.forEach((n,i)=>content+=text(1260,738+i*34,n,13));
  content+=text(1260,920,'SURFACE / '+a.material,12)+text(1260,952,'Inspect silhouette, thickness, joints and underside.',13);
  content+=line(65,1100,1735,1100)+text(65,1135,'SOURCE: model-spec.json / unit: m / origin: floor centre / front: +Z / no perspective in orthographic views',14);
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="1800" height="1180"><rect width="1800" height="1180" fill="#f7f6f0"/>${content}</svg>`;
  await fs.writeFile(`${dir}/${a.id}.svg`,svg);await sharp(Buffer.from(svg)).png().toFile(`${dir}/${a.id}.png`);
}
console.log('Five consistent asset sheets written from measured component specifications.');

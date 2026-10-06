import fs from 'node:fs/promises';
import sharp from 'sharp';
const l=JSON.parse(await fs.readFile('src/data/layout.json','utf8'));
const d=JSON.parse(await fs.readFile('assets/design/revision-d-open/drawing-dimensions.json','utf8'));
const s=17,ox=350,oy=238,X=x=>ox+(x+27)*s,Y=z=>oy+(z+27)*s;
let v=[];const text=(x,y,t,size=19,anchor='start',color='#35483f')=>v.push(`<text x="${x}" y="${y}" font-size="${size}" text-anchor="${anchor}" fill="${color}">${t}</text>`);
const rect=(x,z,w,h,fill,stroke='none',sw=1)=>v.push(`<rect x="${X(x)}" y="${Y(z)}" width="${w*s}" height="${h*s}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`);
const line=(a,b,color='#53675d',width=2,dash='')=>v.push(`<path d="M${X(a[0])} ${Y(a[1])}L${X(b[0])} ${Y(b[1])}" fill="none" stroke="${color}" stroke-width="${width}" ${dash?`stroke-dasharray="${dash}"`:''}/>`);
text(50,52,'STILL / BUILDING STUDY / D — OPEN ENTRIES',17);text(50,104,'중정을 둘러싼 여덟 전시실',38);text(50,146,'승인된 D 평면을 복원하고, 모든 전시실 입구 가벽을 제거했습니다.',20);
v.push('<path d="M50 174H1550" stroke="#a0ada4"/>');rect(-27,-27,54,54,'#dfebe4');
for(const poly of l.corridor)v.push(`<path d="${poly.map(r=>'M'+r.map(p=>X(p[0])+','+Y(p[1])).join('L')+'Z').join('')}" fill="#e9d8b6"/>`);
rect(-8,-8,16,16,'#d9e7dd','#73999b',2);
for(const r of d.rooms){const [x,z,w,h]=r.b;rect(x,z,w,h,'#52665b');rect(x+.6,z+.6,w-1.2,h-1.2,'#f3f0e6');const [dx,dz,orientation]=r.door;
 if(orientation==='h')rect(dx-1.6,dz+(z<0?-.65:0),3.2,.65,'#e9d8b6');else rect(dx+(x<0?-.65:0),dz-1.6,.65,3.2,'#e9d8b6');
 const [ax,az,artdir]=r.art;if(artdir==='h'){rect(ax-3,az-.8,6,1.6,'#d2c6af');line([ax-2.25,az],[ax+2.25,az],'#ba6949',3);}else{rect(ax-.8,az-3,1.6,6,'#d2c6af');line([ax,az-2.25],[ax,az+2.25],'#ba6949',3);}
 const cx=X(x+w/2),cy=Y(z+h/2);text(cx,cy-9,'전시실 '+String(r.id).padStart(2,'0'),22,'middle');text(cx,cy+23,'한 작품 · 높이 12m',16,'middle');text(cx,cy+49,r.clearSize[0]+' × '+r.clearSize[1]+'m / 유효 실내',13,'middle');
}
text(X(0),Y(-1),'채광 중정',29,'middle');text(X(0),Y(1.1),'16 × 16m · 높이 14m',18,'middle');text(X(0),Y(3.1),'작품 없는 열린 중심 공간',14,'middle');
line([-10,-10],[10,-10],'#b76948',2,'7 8');line([10,-10],[10,10],'#b76948',2,'7 8');line([10,10],[-10,10],'#b76948',2,'7 8');line([-10,10],[-10,-10],'#b76948',2,'7 8');
line([-27,-29.2],[27,-29.2],'#a0ada4',1);text(X(0),Y(-30),'54m / 외벽 바깥면 기준',19,'middle');
line([29,-27],[29,27],'#a0ada4',1);text(X(29.5),Y(0),'54m',17);text(X(10),Y(29.2),'입구',18,'middle');
for(const [x,w,label] of [[-27,15,'15m'],[-12,4,'4m'],[-8,16,'16m'],[8,4,'4m'],[12,15,'15m']]){line([x,30],[x+w,30],'#a0ada4',1);text(X(x+w/2),Y(31.5),label,16,'middle');}
text(50,254,'01  원본 D 배치',22);text(50,291,'54 × 54m 외곽',18);text(50,320,'중정 둘레의 폭 4m 회랑',18);
text(50,394,'02  가벽 제거',22);text(50,431,'입구 바로 앞 가벽 8개 제거',18);text(50,460,'우회하지 않고 작품으로 접근',18);
text(50,534,'03  높이와 작품',22);text(50,571,'전시실 12m / 중정 14m',18);text(50,600,'회랑 4.2m / 출입구 3.6m',18);text(50,629,'작품 예시 4.5 × 6m',18);
text(50,707,'04  변하지 않는 원칙',22);text(50,744,'각 방에는 작품 하나',18);text(50,773,'옆 전시실을 거치지 않는 동선',18);
text(1350,280,'도면 읽기',22);text(1350,328,'주황선 = 작품',17);text(1350,364,'베이지 = 회랑',17);text(1350,400,'연녹색 = 빛 우물',17);text(1350,436,'짙은색 = 0.6m 벽',17);text(1350,510,'가벽 없음',24);
v.push('<path d="M50 1293H1550" stroke="#a0ada4"/>');text(50,1324,'가상 전시관 제작 기준 · 단위 m · 실제 시공용 구조 도면이 아닙니다.',16);text(1310,1324,'D-OPEN / 01',16);
const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1350" viewBox="0 0 1600 1350"><rect width="1600" height="1350" fill="#f7f5ef"/><g font-family="Malgun Gothic,Arial,sans-serif">${v.join('')}</g></svg>`;
await fs.writeFile('assets/design/revision-d-open/01-building-plan.svg',svg);await sharp(Buffer.from(svg)).png().toFile('assets/design/revision-d-open/01-building-plan.png');
console.log('Measured D-open floor plan saved.');

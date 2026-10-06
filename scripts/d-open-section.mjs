import fs from 'node:fs/promises';
import sharp from 'sharp';
const W=1600,H=830,s=25,ox=125,base=600,X=z=>ox+(z+27)*s,Y=h=>base-h*s;
let v=[];const text=(x,y,t,size=20,anchor='start')=>v.push(`<text x="${x}" y="${y}" font-size="${size}" text-anchor="${anchor}" fill="#35483f">${t}</text>`);
const rect=(x,y,w,h,color)=>v.push(`<rect x="${X(x)}" y="${Y(y+h)}" width="${w*s}" height="${h*s}" fill="${color}"/>`);
text(50,50,'STILL / D — OPEN ENTRIES / SECTION B–B',17);text(50,104,'가벽 없이 연결되는 회랑과 전시실',38);text(50,146,'전시실 02 → 순환 회랑 → 채광 중정 → 순환 회랑 → 전시실 06',20);
v.push('<path d="M50 174H1550" stroke="#a0ada4"/>');rect(-27,-.22,54,.22,'#53675c');
for(const side of [-1,1]){
 const left=side<0?-27:12;rect(left,12,15,.35,'#53675c');rect(side<0?-27:26.4,0,.6,12,'#53675c');rect(side<0?-12.6:12,3.6,.6,8.4,'#53675c');
 rect(side<0?-12:8,4.2,4,.3,'#b9b39f');rect(side<0?-8.3:8,4.2,.3,9.8,'#53675c');
 rect(side<0?-25.5:23.9,0,1.6,.45,'#c8bda7');rect(side*24.7-.06,.65,.12,6,'#b96745');
 rect(side<0?-23.3:21.3,11.99,2,.4,'#d7e8e2');text(X(side*19.5),655,side<0?'전시실 02 · 12m':'전시실 06 · 12m',22,'middle');text(X(side*10),655,'회랑',18,'middle');
}
v.push(`<path d="M${X(-8.3)} ${Y(14.3)}H${X(8.3)}" stroke="#779a9c" stroke-width="5"/>`);
text(X(0),Y(8.5),'채광 중정',32,'middle');text(X(0),Y(6.8),'16m 폭 · 14m 높이',21,'middle');text(X(0),655,'중정과 회랑 사이가 열려 있습니다',19,'middle');
text(X(-13.8),Y(5),'4.2m',17,'middle');text(X(-9.1),Y(2),'3.6m',16,'middle');text(X(-19.5),Y(7.9),'작품 6m',17,'middle');
text(50,721,'입구 가벽 8개 제거 · 전시실 높이 12m · 벽 두께 0.6m · 받침대 높이 0.45m',20);text(50,757,'바닥은 모두 같은 높이입니다. 치수와 입구·작품 위치는 수정 평면도와 동일합니다.',18);
v.push('<path d="M50 787H1550" stroke="#a0ada4"/>');text(50,815,'가상 전시관 제작 기준 · 단위 m · 실제 시공용 구조 도면이 아닙니다.',15);text(1380,815,'D-OPEN / 02',15);
const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="100%" height="100%" fill="#f7f5ef"/><g font-family="Malgun Gothic,Arial,sans-serif">${v.join('')}</g></svg>`;
await fs.writeFile('assets/design/revision-d-open/02-building-section.svg',svg);await sharp(Buffer.from(svg)).png().toFile('assets/design/revision-d-open/02-building-section.png');

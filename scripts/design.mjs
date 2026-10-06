import fs from 'node:fs/promises';
import sharp from 'sharp';
const layout = JSON.parse(await fs.readFile('src/data/layout.json','utf8'));
await Promise.all(['assets/design','assets/source','public/art','public/models','public/textures','docs','tests','artifacts'].map(p=>fs.mkdir(p,{recursive:true})));
const ink='#303a37', muted='#7c8279', paper='#f5f3ec', accent='#bf6742';
const text=(x,y,t,size=17,extra='')=>`<text x="${x}" y="${y}" font-family="Arial, sans-serif" font-size="${size}" fill="${ink}" ${extra}>${t}</text>`;
const line=(x,y,X,Y,color=muted,width=1,dash='')=>`<line x1="${x}" y1="${y}" x2="${X}" y2="${Y}" stroke="${color}" stroke-width="${width}" ${dash?`stroke-dasharray="${dash}"`:''}/>`;
const rect=(x,y,w,h,fill='none',stroke=ink)=>`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" stroke="${stroke}"/>`;
const dim=(x,y,X,Y,label)=>line(x,y,X,Y)+line(x-5,y-5,x+5,y+5)+line(X-5,Y-5,X+5,Y+5)+text((x+X)/2+7,(y+Y)/2-10,label,15);
function sheet(title,subtitle,content){return `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1100" viewBox="0 0 1600 1100"><rect width="1600" height="1100" fill="${paper}"/>${text(70,85,'STILL / DESIGN DOCUMENTS',18)}${text(70,143,title,38)}${text(70,180,subtitle,17)}${line(70,206,1530,206)}${content}${line(70,1015,1530,1015)}${text(70,1052,`01. GALLERY / ${layout.room.width} x ${layout.room.depth} x ${layout.room.height} m / Revision C`,14)}${text(1190,1052,'COORDINATED DESIGN',14)}</svg>`;}
async function save(name,svg){await fs.writeFile(`assets/design/${name}.svg`,svg);await sharp(Buffer.from(svg)).png().toFile(`assets/design/${name}.png`);}
const sx=x=>800+x*52, sy=z=>610+z*52;
let floor=rect(sx(-9),sy(-6),936,624,'#e7e5dc');
for(let x=-9;x<=9;x++)floor+=line(sx(x),sy(-6),sx(x),sy(6),'#d9d8cf');
for(let z=-6;z<=6;z++)floor+=line(sx(-9),sy(z),sx(9),sy(z),'#d9d8cf');
layout.columns.forEach(([x,z])=>floor+=rect(sx(x)-16,sy(z)-16,32,32,'#a5aba0'));
layout.artworks.forEach((a,i)=>{let [x,,z]=a.position; floor+=`<g transform="translate(${sx(x)},${sy(z)}) rotate(${-a.rotation*180/Math.PI})">${rect(-a.width*26,-4,a.width*52,8,accent)}${line(0,0,0,28,accent,2)}</g>`+text(sx(x)-12,sy(z)-18,`${i+1}`);});
floor+=dim(sx(-9),sy(-6)-30,sx(9),sy(-6)-30,'18.00 m')+dim(sx(9)+35,sy(-6),sx(9)+35,sy(6),'12.00 m');
floor+=rect(sx(-5.8),sy(-.3),11.6*52,4.5*52,'none',accent)+text(sx(-2.6),sy(2.1),'CLEAR CAMERA ZONE',18);
layout.props.forEach(p=>floor+=rect(sx(p.position[0])-30,sy(p.position[2])-15,60,30,'#bac0ae'));
floor+=text(70,350,'PLAN / 52 pixels per metre',18)+text(70,395,'01-04 / Back row',16)+text(70,425,'05-06 / Left side',16)+text(70,455,'07-08 / Right side',16)+text(70,495,'All fronts face the',16)+text(70,519,'central viewing area.',16)+text(70,570,'Grid spacing / 1 m',16)+text(70,598,'Columns / 0.62 m',16)+text(70,626,'Window sill / 1.10 m',16)+text(70,654,'Window top / 4.70 m',16);
await save('01-measured-floor-plan',sheet('A room for eight perspectives.','Measured plan / coordinates shared with the model and the website.',floor));
let elev='';
function elevation(x,y,w,height,label){let out=rect(x,y-height,w,height,'#e6e5de')+text(x,y+35,label,20);out+=rect(x,y-height,w,28,'#bfc2b8');out+=dim(x-25,y-height,x-25,y,'5.50 m');return out;}
elev+=elevation(180,595,810,247.5,'FRONT ELEVATION / 18.00 m');
layout.artworks.slice(0,4).forEach(a=>{const x=585+a.position[0]*45; elev+=rect(x-a.width*22.5,595-(a.position[1]+a.height/2)*45,a.width*45,a.height*45,'#c6c4b6')+text(x-8,530,a.id,16);});
elev+=elevation(180,925,540,247.5,'LEFT ELEVATION / 12.00 m');
for(let i=0;i<4;i++){const x=195+i*132;elev+=rect(x,714,105,158,'#c6d2ce');for(let j=1;j<3;j++)elev+=line(x+j*35,714,x+j*35,872,ink,3);for(let j=1;j<4;j++)elev+=line(x,714+j*39.5,x+105,714+j*39.5,ink,3);}
elev+=text(1070,350,'SECTION &amp; MATERIALS',20)+text(1070,400,'Ceiling beam / 0.30 x 0.55 m',17)+text(1070,438,'Floor slab / 0.18 m',17)+text(1070,476,'Wall / 0.20 m',17)+text(1070,514,'Canvas bottom / 0.35 m',17)+text(1070,552,'Diffused daylight from left',17)+text(1070,590,'Warm ivory mineral surfaces',17);
await save('02-elevations-section',sheet('Light, structure, proportion.','All heights measured from finished floor level.',elev));
let detail=rect(160,300,282,372,'#dedcd0')+rect(178,318,246,336,'#c3704d')+dim(160,285,442,285,'2.35 m')+dim(470,300,470,672,'3.10 m')+text(160,735,'BACK ROW / 55 mm canvas depth',18);
detail+=rect(600,310,12,362,'#dedcd0')+line(606,672,606,710,ink,8)+rect(565,710,85,12,ink)+text(565,770,'SIDE / fixed metal base',18);
detail+=rect(880,430,230,60,'#acb6a5')+rect(896,490,14,85,'#9b9a8d')+rect(1080,490,14,85,'#9b9a8d')+text(880,620,'BENCH / 2.0 x 0.55 x 0.48 m',16);
detail+=rect(1200,430,115,140,'#ddd9c9')+text(1160,620,'PLINTH / 0.7 x 0.7 x 0.85 m',16);
detail+=text(160,840,'Detail standard: bevels on visible edges, no coplanar overlaps, contact at floor.',21)+text(160,882,'Separate artwork surface / original ratio preserved / no artwork baked into architecture.',19);
await save('03-object-details',sheet('Small details make the room real.','Canvas assembly, support profiles and prop dimensions.',detail));
let camera=floor;
layout.artworks.forEach((a,i)=>{for(const mobile of [false,true]){const distance=a.height/(2*Math.tan(58*Math.PI/360)*(mobile?.55:.69));const p=[a.position[0]+Math.sin(a.rotation)*distance,a.position[2]+Math.cos(a.rotation)*distance];camera+=line(sx(0),sy(2.2),sx(p[0]),sy(p[1]),mobile?'#91a092':accent,mobile?1:2,mobile?'2 5':'5 7')+`<circle cx="${sx(p[0])}" cy="${sy(p[1])}" r="${mobile?5:9}" fill="${mobile?'#91a092':accent}"/>`+text(sx(p[0])+12,sy(p[1]),(mobile?'M':'C')+(i+1),12);}});
camera+=`<circle cx="${sx(layout.overview.position[0])}" cy="${sy(layout.overview.position[2])}" r="10" fill="${ink}"/>`+text(sx(layout.overview.position[0])+16,sy(layout.overview.position[2]),'ENTRY',15)+text(70,735,'C / desktop focus',15)+text(70,765,'M / mobile focus',15);
await save('04-camera-routes',sheet('Move the viewpoint. Keep the world.','The camera passes through clear space; project fronts are never crossed.',camera));
let ui=rect(90,310,950,580,'#e3e3d9')+rect(708,310,332,580,'#f3f0e6')+rect(245,402,275,360,'#bf6742')+text(130,358,'STILL',24)+text(742,430,'PROJECT TITLE',24)+text(742,478,'Purpose / Role / Process',16)+text(742,512,'Results / Related links',16)+text(250,825,'Previous image / Next image',16)+text(744,844,'Previous project / Next',16)+dim(90,280,708,280,'65% / ARTWORK')+dim(708,280,1040,280,'35% / DESCRIPTION');
ui+=rect(1150,280,292,635,'#e3e3d9')+rect(1220,348,151,217,'#bf6742')+rect(1150,597,292,318,'#f3f0e6')+text(1176,645,'PROJECT TITLE',20)+text(1176,683,'Scrollable description',15)+text(1176,875,'Prev / Next / Close',15);
await save('05-desktop-mobile-layout',sheet('One continuous gallery.','Desktop split at 900 px / mobile artwork above a readable detail panel.',ui));
const colors=['#d76433','#ddd8c9','#6378ae','#164d3f','#e9e6db','#387780','#b09b7b','#ac4944'];
const names=['SŌL','FORM','AETHER','VERDANT','MONO','TIDE','OBJECTS','ATELIER'];
const titles=['The shape of a slower day.','Less, but with feeling.','Between here and elsewhere.','A living visual language.','A rhythm of type.','Made to move, naturally.','Everyday, reconsidered.','Stories in good company.'];
function poster(i,variant=0){
let art='';const c=colors[i],fg=i===3||i===5?'#efebdb':'#222a26';
if(i===0)art=`<circle cx="480" cy="535" r="290" fill="#eee6cc"/><path d="M-70 980Q300 540 960 820V1300H-70Z" fill="#873f2b"/><path d="M-70 1030Q540 770 1000 970V1300H-70Z" fill="#d0a76f"/>`;
if(i===1)art=`<g transform="translate(170 290) rotate(-12 300 350)"><rect x="0" y="0" width="540" height="690" rx="260" fill="#3c3b34"/><rect x="110" y="110" width="320" height="470" rx="160" fill="#ddd8c9"/><circle cx="430" cy="660" r="165" fill="#e77b3c"/></g>`;
if(i===2)art=`<defs><radialGradient id="g"><stop stop-color="#efd9b4"/><stop offset=".45" stop-color="#c999b8"/><stop offset="1" stop-color="#6378ae"/></radialGradient></defs><rect y="280" width="900" height="740" fill="url(#g)"/><ellipse cx="450" cy="660" rx="245" ry="245" fill="none" stroke="#e8dac6" stroke-width="1.5"/>`;
if(i===3)for(let j=0;j<7;j++)art+=`<ellipse cx="${300+j*35}" cy="${450+j*58}" rx="${230-j*15}" ry="70" transform="rotate(${j%2?35:-35} ${300+j*35} ${450+j*58})" fill="${j%2?'#96a77b':'#c7ce9a'}"/>`;
if(i===4)art=`<text x="35" y="615" font-family="Arial" font-size="430" font-weight="900" letter-spacing="-30" fill="#232822">Aa</text><text x="300" y="940" font-family="Georgia" font-style="italic" font-size="410" fill="#c46c43">&amp;</text>`;
if(i===5)for(let j=0;j<17;j++)art+=`<path d="M-80 ${400+j*30} Q200 ${110+j*37} 450 ${550+j*20} T980 ${350+j*35}" fill="none" stroke="#d6e1c7" stroke-width="${j%4===0?5:2}" opacity=".8"/>`;
if(i===6)art=`<ellipse cx="460" cy="970" rx="280" ry="60" fill="#938368"/><rect x="235" y="415" width="440" height="560" rx="210" fill="#ddd6bd"/><ellipse cx="455" cy="445" rx="205" ry="70" fill="#68664f"/><ellipse cx="455" cy="432" rx="150" ry="32" fill="#b09b7b"/><circle cx="646" cy="818" r="140" fill="#484e3d"/>`;
if(i===7)art=`<rect x="155" y="295" width="580" height="730" fill="#e5d5b2" transform="rotate(9 445 660)"/><rect x="220" y="385" width="450" height="540" fill="#242d44" transform="rotate(-9 445 660)"/><circle cx="442" cy="640" r="168" fill="#c3a260"/><path d="M230 835Q430 470 680 860" fill="#b25143"/>`;
return `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1200" viewBox="0 0 900 1200"><rect width="900" height="1200" fill="${c}"/>${variant?`<g transform="translate(900 0) scale(-1 1)">${art}</g>`:art}<text x="60" y="108" fill="${fg}" font-family="Arial" font-size="22" letter-spacing="4">STILL / EXPERIMENT ${String(i+1).padStart(2,'0')}</text><text x="55" y="232" fill="${fg}" font-family="${i===0||i===7?'Georgia':'Arial'}" font-size="${i===3?112:128}" letter-spacing="-6">${names[i]}</text><text x="60" y="1128" fill="${fg}" font-family="Arial" font-size="24">${variant?'Studies in composition &amp; detail.':titles[i]}</text><text x="60" y="1168" fill="${fg}" font-family="Arial" font-size="14" letter-spacing="3">${variant?'PROCESS STUDY':'CONCEPT PROJECT'} / SAMPLE — 2026</text></svg>`;
}
for(let i=0;i<8;i++)for(let v=0;v<2;v++){let svg=poster(i,v), id=layout.artworks[i].id;await fs.writeFile(`assets/design/poster-${id}-${v}.svg`,svg);await sharp(Buffer.from(svg)).webp({quality:90}).toFile(`public/art/${id}-${v}.webp`);if(v===0)await sharp(Buffer.from(svg)).resize(225,300).webp({quality:78}).toFile(`public/art/${id}-thumb.webp`);}
console.log('Five measured design sheets and 8 replaceable sample projects created.');

await import('./grand-hall-sheets.mjs');

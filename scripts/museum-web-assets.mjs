import fs from 'node:fs/promises';
import sharp from 'sharp';
const layout=JSON.parse(await fs.readFile('src/data/layout.json','utf8'));
for(const name of layout.textureGroups){
 const src=`${layout.sourceDirectory}/${name}_clean.png`;
 await sharp(src).webp({quality:90}).toFile(`public/textures/${name}.webp`);
 await sharp(src).resize(1024).webp({quality:84}).toFile(`public/textures/${name}-mobile.webp`);
}
await sharp('public/gallery-poster.png').resize(1600).webp({quality:88}).toFile('public/gallery-poster.webp');
console.log(`${layout.textureGroups.length} baked texture sets, desktop and mobile, are ready.`);

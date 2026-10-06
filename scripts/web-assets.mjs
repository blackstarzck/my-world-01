import fs from 'node:fs/promises';
import sharp from 'sharp';
for(const name of ['Floor','Architecture','Props']){
  const src=`assets/source/Baked_${name}_clean.png`;
  await sharp(src).webp({quality:88}).toFile(`public/textures/${name}.webp`);
  await sharp(src).resize(name==='Props'?768:name==='Architecture'?1536:1024).webp({quality:82}).toFile(`public/textures/${name}-mobile.webp`);
}
await sharp('public/gallery-poster.png').resize(1600).webp({quality:88}).toFile('public/gallery-poster.webp');
console.log('Desktop and mobile light-baked textures ready.');

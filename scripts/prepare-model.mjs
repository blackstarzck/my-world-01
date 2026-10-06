import sharp from 'sharp';
import fs from 'node:fs/promises';
const layout=JSON.parse(await fs.readFile('src/data/layout.json','utf8'));
for(const a of layout.artworks)await sharp(`public/art/${a.id}-0.webp`).png().toFile(`assets/source/${a.id}.png`);
console.log('Artwork PNGs prepared for Blender.');

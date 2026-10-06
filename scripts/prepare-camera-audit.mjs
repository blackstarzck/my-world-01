import fs from 'node:fs/promises';
import {cameraPose,planRoute} from '../src/navigation.mjs';
const layout=JSON.parse(await fs.readFile('src/data/layout.json','utf8'));
const segments=new Map();
function add(a,b){const ends=[a,b].map(p=>p.map(n=>n.toFixed(5)).join(',')).sort();segments.set(ends.join('/'),[a,b]);}
for(const [a,b] of layout.navigation.edges)add(layout.navigation.nodes[a],layout.navigation.nodes[b]);
for(const mobile of [false,true]){
 const poses=[layout.overview.position,...layout.artworks.map(a=>cameraPose(layout,a.id,mobile,mobile?.983:1.04).position)];
 for(const from of poses)for(const to of poses){const route=planRoute(layout,from,to);for(let i=1;i<route.length;i++)add(route[i-1],route[i]);}
}
await fs.writeFile('artifacts/museum-camera-segments.json',JSON.stringify([...segments.values()]));
console.log(`${segments.size} unique segments prepared for collision checks against the Blender meshes.`);

import {memo,useEffect,useMemo,useState} from 'react';
import {useThree} from '@react-three/fiber';
import {Object3D} from 'three';
import type {MeshStandardMaterial} from 'three';
import layout from './data/layout.json';
import { galleryReviewEnabled } from './gallery-diagnostics';
function GalleryLight({materials}:{materials:MeshStandardMaterial[]}){
  const {gl,scene,invalidate}=useThree();
  const [preset,setPreset]=useState('final');
  const sideReturn=!['ceiling-return','r1-directional','r3-directional','return-only','return-env','return-area'].includes(preset);
  useEffect(()=>{
    if(!galleryReviewEnabled)return;
    const change=(event:Event)=>setPreset((event as CustomEvent<string>).detail);
    window.addEventListener('gallery-review-lighting',change);return()=>window.removeEventListener('gallery-review-lighting',change);
  },[]);
  useEffect(()=>{
    materials.filter(m=>m.userData.environmentURL==='/environment/i-v3/gallery-r1.hdr').forEach(m=>m.envMapIntensity=(preset==='return-only'||preset==='return-area'||preset==='no-env')?0:(preset==='r1-directional'||sideReturn)?.18:.24);
    materials.filter(m=>m.userData.environmentURL==='/environment/i-v3/gallery-r4.hdr').forEach(m=>m.envMapIntensity=preset==='r4-env-legacy'?.65:.2);
    materials.filter(m=>m.userData.environmentURL==='/environment/i-v3/gallery-r3.hdr').forEach(m=>m.envMapIntensity=preset==='r3-directional'||sideReturn?.3:.65);
    scene.userData.reviewLightPreset=preset;gl.shadowMap.needsUpdate=true;invalidate();
  },[preset,sideReturn,materials,scene,gl,invalidate]);
  const roofLights=useMemo(()=>{
    const r=layout.rooms.find(room=>room.id==='R1')!;
    return [6,18,30].map(u=>{
      const x=r.origin[0]+u*r.outward[0],z=r.origin[2]+u*r.outward[2];
      const target=new Object3D();target.position.set(x,14,z);target.updateMatrixWorld();
      // Approximate the broad diffuse return from the upper wall. Geometry
      // occlusion attenuates this return in the material's lighting chunk.
      const position=[x-3.89,8.6,z-3.89] as [number,number,number];
      const panel=new Object3D();panel.position.set(...position);panel.lookAt(target.position);panel.rotateY(Math.PI);
      return {id:`R1-wall-return-${u}`,position,target,rotation:panel.rotation.clone()};
    });
  },[]);
  useEffect(()=>{gl.shadowMap.needsUpdate=true;invalidate();},[gl,invalidate,roofLights]);
  const roomLights=layout.rooms.flatMap(r=>[6,18,30].map(u=>{
    const side=(sideReturn&&(r.id==='R1'||r.id==='R2'||r.id==='R3'))||(preset==='r4-wall-return'&&r.id==='R4');
    const x=r.origin[0]+u*r.outward[0],z=r.origin[2]+u*r.outward[2];
    const lateral=[r.outward[2],-r.outward[0]];
    const position=[x-(side?4:0)*lateral[0],side?9:r.id==='R1'?15.8:r.id==='R2'?16.3:r.id==='R3'?15.1:14.6,z-(side?4:0)*lateral[1]] as [number,number,number];
    const panel=new Object3D();panel.position.set(...position);
    panel.lookAt(x+4*lateral[0],preset==='upper-return'?6:3,z+4*lateral[1]);panel.rotateY(Math.PI);
    return {id:`${r.id}-${u}`,position,rotation:side?panel.rotation:[-Math.PI/2,0,0] as [number,number,number],width:side?6:3,height:side?5:3,
      intensity:side?(r.id==='R1'||r.id==='R2'?400:r.id==='R4'?850:500)/(30*Math.PI):(r.id==='R1'?(preset==='r1-directional'?400:90):r.id==='R4'?850:r.id==='R3'&&preset==='r3-directional'?500:100)/(9*Math.PI)};
  }));
  const full=preset==='final'||preset.startsWith('reflection-')||preset==='no-floor-reflection'||preset==='no-env'||preset==='no-hemi'||preset.startsWith('r4-')||preset==='r2-wall-return'||preset==='upper-return'||preset==='r1-directional'||preset==='r3-directional'||preset==='wall-return'||preset==='ceiling-return';
  return <>
    <hemisphereLight args={['#e8f0f5','#d5c6ad',(full&&preset!=='no-hemi')||preset==='return-env'?.22:0]}/>
    <directionalLight position={[12,92,12]} color="#ffe7c9" intensity={full?5.6:0} castShadow shadow-mapSize={[4096,4096]} shadow-camera-left={-57} shadow-camera-right={57} shadow-camera-top={57} shadow-camera-bottom={-57} shadow-camera-near={1} shadow-camera-far={180} shadow-bias={-.00008} shadow-normalBias={.018} shadow-radius={2}/>
    {roomLights.map(light=><rectAreaLight key={light.id} position={light.position} rotation={light.rotation} width={light.width} height={light.height} intensity={preset==='return-only'||preset==='return-env'||(preset==='r4-down-off'&&light.id.startsWith('R4-'))?0:light.intensity} color="#fffaf2"/>)}
    {roofLights.map(light=><rectAreaLight key={light.id} name={light.id} position={light.position} rotation={light.rotation} width={4} height={3} intensity={25} color="#fff0d6"/>)}
    <rectAreaLight position={[0,22.9,0]} rotation={[-Math.PI/2,0,0]} width={3.3} height={3.3} intensity={47} color="#fffaf2"/>
    {layout.rooms.filter(r=>r.id==='R4').map(r=><group key="R4-cove" position={r.origin as [number,number,number]} rotation={[0,Math.atan2(-r.outward[2],r.outward[0]),0]}>
      {[-1,1].map(side=><group key={side} position={[18,10.83,side*5.7]}>
        <rectAreaLight rotation={[Math.PI/2,0,0]} width={35.4} height={.28} intensity={24} color="#ffbe86"/>
      </group>)}
    </group>)}
  </>;
}

export default memo(GalleryLight);


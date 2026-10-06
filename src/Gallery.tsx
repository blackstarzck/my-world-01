import { Suspense, useEffect, useMemo, useRef, useState, Component } from 'react';
import type { ReactNode } from 'react';
import { Canvas, useFrame, useLoader, useThree } from '@react-three/fiber';
import type {ThreeEvent} from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { OrbitControls as Controls } from 'three-stdlib';
import { Mesh, MeshBasicMaterial, PerspectiveCamera, SRGBColorSpace, TextureLoader, Vector3, VideoTexture, NoToneMapping } from 'three';
import type { Texture } from 'three';
import layout from './data/layout.json';
import { projects } from './data/projects';
import { cameraPose, planRoute } from './navigation.mjs';
import { createCameraMotion, sampleCameraMotion } from './camera-motion.mjs';

type Props = { selected: string | null; mediaIndex: number; playing: boolean; retry: number; reduced: boolean; mobile: boolean; reset: number; onSelect: (id:string)=>void; onReady:()=>void; onMediaError:(error:boolean)=>void; onVideoEnd:()=>void; onFailure:()=>void };
const toVector=(p:number[])=>new Vector3(...p as [number,number,number]);
const overviewOffset=toVector(layout.overview.position).sub(toVector(layout.overview.target));
const overviewRadius=overviewOffset.length(),overviewPolar=Math.acos(overviewOffset.y/overviewRadius),overviewAzimuth=Math.atan2(overviewOffset.x,overviewOffset.z);
export function clearGalleryCache(){
  useLoader.clear(GLTFLoader,'/models/gallery.glb');
  for(const mobile of [false,true])useLoader.clear(TextureLoader,layout.textureGroups.map(n=>`/textures/${n}${mobile?'-mobile':''}.webp`));
}

class SceneBoundary extends Component<{children:ReactNode; onError:()=>void},{error:boolean}> {
  state={error:false};
  static getDerivedStateFromError(){return {error:true};}
  componentDidCatch(){this.props.onError();}
  render(){return this.state.error?null:this.props.children;}
}

function Building({mobile,onReady}:{mobile:boolean;onReady:()=>void}) {
  const gltf=useLoader(GLTFLoader,'/models/gallery.glb');
  const maps=useLoader(TextureLoader,layout.textureGroups.map(n=>`/textures/${n}${mobile?'-mobile':''}.webp`));
  const scene=useMemo(()=>{
    const copy=gltf.scene.clone(true);
    copy.traverse(o=>{if(o instanceof Mesh){const i=layout.textureGroups.indexOf(o.name);if(i>=0){maps[i].flipY=false;maps[i].colorSpace=SRGBColorSpace;maps[i].anisotropy=4;o.material=new MeshBasicMaterial({map:maps[i],toneMapped:false});}else{o.material=new MeshBasicMaterial({color:'#f5f4ed',toneMapped:false});}}});return copy;
  },[gltf,maps]);
  useEffect(()=>{onReady();return()=>{scene.traverse(o=>{if(o instanceof Mesh)(o.material as MeshBasicMaterial).dispose();});};},[scene,onReady]);
  return <primitive object={scene} onClick={(e:ThreeEvent<MouseEvent>)=>e.stopPropagation()} onPointerOver={(e:ThreeEvent<PointerEvent>)=>e.stopPropagation()} />;
}

function Artwork({index,selected,mediaIndex,playing,retry,onSelect,onMediaError,onVideoEnd}:Props & {index:number}) {
  const a=layout.artworks[index],p=projects[index],active=selected===a.id;
  const media=active?p.media[mediaIndex]:null;
  const {invalidate}=useThree();
  const [map,setMap]=useState<Texture|null>(null);
  const [ratio,setRatio]=useState(.75);
  const [hover,setHover]=useState(false);
  const videoRef=useRef<HTMLVideoElement|null>(null);
  const source=media?.type==='image'?media.src:`/art/${a.id}-thumb.webp`;
  useEffect(()=>{
    let live=true;let texture:Texture|undefined;
    new TextureLoader().load(source,t=>{texture=t;if(!live){t.dispose();return;}t.colorSpace=SRGBColorSpace;t.anisotropy=4;setRatio(t.image.width/t.image.height);setMap(t);if(active)onMediaError(false);invalidate();},undefined,()=>{if(live&&active)onMediaError(true);});
    return()=>{live=false;texture?.dispose();};
  },[source,retry,active,invalidate,onMediaError]);
  useEffect(()=>{
    if(media?.type!=='video')return;
    const video=document.createElement('video');video.src=media.src;video.playsInline=true;video.preload='metadata';video.crossOrigin='anonymous';videoRef.current=video;
    if(import.meta.env.DEV)Object.assign(window,{__lastGalleryVideo:video});
    const tex=new VideoTexture(video);tex.colorSpace=SRGBColorSpace;
    video.onloadeddata=()=>{setRatio(video.videoWidth/video.videoHeight);setMap(tex);onMediaError(false);invalidate();};
    video.onerror=()=>onMediaError(true);video.onended=onVideoEnd;video.load();
    return()=>{video.pause();video.removeAttribute('src');video.load();videoRef.current=null;tex.dispose();};
  },[media?.src,media?.type,retry,invalidate,onMediaError,onVideoEnd]);
  useEffect(()=>{const v=videoRef.current;if(v){if(playing)v.play().catch(()=>onMediaError(true));else v.pause();invalidate();}},[playing,media?.src,invalidate,onMediaError]);
  useFrame(()=>{if(playing&&active&&videoRef.current)invalidate();});
  const height=Math.min(a.height-.038,(a.width-.038)/ratio),width=height*ratio;
  return <group position={a.position as [number,number,number]} rotation={[0,a.rotation,0]}>
    <mesh position={[0,0,.095]} onClick={e=>{if(e.delta<5){e.stopPropagation();onSelect(a.id);}}} onPointerOver={()=>{setHover(true);document.body.style.cursor='pointer';}} onPointerOut={()=>{setHover(false);document.body.style.cursor='';}}>
      <planeGeometry args={[width,height]} /><meshBasicMaterial key={map?.uuid ?? 'empty'} map={map} color={map?'white':p.color} toneMapped={false}/>
    </mesh>
    {hover&&!selected?<mesh position={[0,0,.092]}><planeGeometry args={[a.width+.045,a.height+.045]}/><meshBasicMaterial color="#f4e7d0" toneMapped={false}/></mesh>:null}
  </group>;
}

function CameraRig({selected,reduced,mobile,reset}:Pick<Props,'selected'|'reduced'|'mobile'|'reset'>) {
  const {camera,invalidate,gl}=useThree();
  const controls=useRef<Controls>(null);
  const saved=useRef({position:toVector(layout.overview.position),target:toVector(layout.overview.target)});
  const previous=useRef<string|null>(null);
  const initialized=useRef(false);
  const motion=useRef<{path:ReturnType<typeof createCameraMotion>;lookTo:Vector3;start:number;immediate:boolean}|null>(null);
  // The overview has a fixed lens. Its closing-panel resize must not restart a trip.
  const aspect=selected?(mobile?window.innerWidth/(window.innerHeight*.47):window.innerWidth*.65/window.innerHeight):1;
  const lastReset=useRef(reset);
  useEffect(()=>{
    const c=controls.current;if(!c)return;
    const cam=camera as PerspectiveCamera;
    const initial=!initialized.current;initialized.current=true;
    const wasReset=lastReset.current!==reset;lastReset.current=reset;
    if(wasReset)saved.current={position:toVector(layout.overview.position),target:toVector(layout.overview.target)};
    if(initial&&!selected){c.target.copy(saved.current.target);camera.lookAt(c.target);c.update();invalidate();return;}
    if(selected&&!previous.current){saved.current={position:camera.position.clone(),target:c.target.clone()};}
    const pose=cameraPose(layout,selected,mobile,aspect);
    const position=selected?toVector(pose.position):saved.current.position.clone(),target=selected?toVector(pose.target):saved.current.target.clone();
    const points=initial?[camera.position.toArray(),position.toArray()]:planRoute(layout,camera.position.toArray(),position.toArray());
    const reframe=selected===previous.current&&!wasReset;
    motion.current={path:createCameraMotion(points,c.target.toArray(),target.toArray(),cam.fov,pose.fov,!selected),lookTo:target,start:performance.now(),immediate:reduced||initial||reframe};
    c.minDistance=.1;c.maxDistance=250;c.minPolarAngle=0;c.maxPolarAngle=Math.PI;c.minAzimuthAngle=-Infinity;c.maxAzimuthAngle=Infinity;
    c.enabled=false;previous.current=selected;invalidate();
  },[selected,reduced,mobile,aspect,reset,camera,invalidate]);
  useEffect(()=>{
    // Expose measurements only in the local verification build.
    if(import.meta.env.DEV)Object.assign(window,{__gallery:{camera,renderer:gl,get moving(){return !!motion.current;}}});
  },[camera,gl]);
  useFrame(()=>{
    const m=motion.current,c=controls.current;if(!m||!c)return;
    const pose=sampleCameraMotion(m.path,m.immediate?m.path.duration:(performance.now()-m.start)/1000);
    camera.position.copy(toVector(pose.position));
    c.target.copy(camera.position).add(new Vector3(Math.sin(pose.yaw)*Math.cos(pose.pitch),Math.sin(pose.pitch),Math.cos(pose.yaw)*Math.cos(pose.pitch)).multiplyScalar(5));
    const cam=camera as PerspectiveCamera;cam.fov=pose.fov;cam.updateProjectionMatrix();
    if(pose.done){c.target.copy(m.lookTo);motion.current=null;c.enabled=!selected;if(!selected){c.minDistance=overviewRadius-.25;c.maxDistance=overviewRadius+.25;c.minPolarAngle=overviewPolar-.06;c.maxPolarAngle=overviewPolar+.06;c.minAzimuthAngle=overviewAzimuth-.1;c.maxAzimuthAngle=overviewAzimuth+.1;}}
    camera.lookAt(c.target);
    if(pose.done)c.update();else invalidate();
  });
  return <OrbitControls ref={controls} target={layout.overview.target as [number,number,number]} enabled={!selected} enablePan={false} enableDamping={false} minDistance={overviewRadius-.25} maxDistance={overviewRadius+.25} minPolarAngle={overviewPolar-.06} maxPolarAngle={overviewPolar+.06} minAzimuthAngle={overviewAzimuth-.1} maxAzimuthAngle={overviewAzimuth+.1} rotateSpeed={.24} zoomSpeed={.25} onChange={()=>invalidate()}/>;
}

export default function Gallery(props:Props) {
  return <SceneBoundary onError={props.onFailure}><Canvas frameloop="demand" dpr={[1,1.5]} camera={{position:layout.overview.position as [number,number,number],fov:layout.overview.fov,near:.08,far:300}} gl={{antialias:true,alpha:false,powerPreference:'high-performance',toneMapping:NoToneMapping}} onCreated={({gl})=>{gl.setClearColor('#e4e5dd');}}>
    <Suspense fallback={null}><Building mobile={props.mobile} onReady={props.onReady}/>{projects.map((p,index)=><Artwork key={p.id} index={index} {...props}/>)}</Suspense>
    <CameraRig {...props}/><ContextGuard onFailure={props.onFailure}/>
  </Canvas></SceneBoundary>;
}
function ContextGuard({onFailure}:{onFailure:()=>void}){
  const gl=useThree(s=>s.gl);
  useEffect(()=>{const lost=(event:Event)=>{event.preventDefault();onFailure();};gl.domElement.addEventListener('webglcontextlost',lost);return()=>gl.domElement.removeEventListener('webglcontextlost',lost);},[gl,onFailure]);return null;
}


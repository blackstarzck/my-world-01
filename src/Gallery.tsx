import { lazy, memo, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, Component } from 'react';
import type { ReactNode } from 'react';
import { Canvas, useFrame, useLoader, useThree } from '@react-three/fiber';
import type {ThreeEvent} from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';
import type { OrbitControls as Controls } from 'three-stdlib';
import { PerspectiveCamera, SRGBColorSpace, Vector3, VideoTexture, AgXToneMapping, PCFSoftShadowMap } from 'three';
import type { Texture, Mesh, Material, MeshStandardMaterial } from 'three';
import { GalleryEffects } from './GalleryEffects';
import GalleryLight from './GalleryLight';
import { GalleryFloorReflection } from './GalleryFloorReflection';
import { applySurfaceMaterials } from './GallerySurfaceMaterials';
import { prepareDetailLOD } from './GalleryDetailLOD';
import { galleryStage, measureGalleryStage } from './gallery-performance';
import { galleryDiagnosticBuild, galleryReviewEnabled } from './gallery-diagnostics';
import { GallerySceneReady } from './GallerySceneReady';
import { galleryArtworkTexturePool } from './GalleryArtworkTexturePool.mjs';
import type { ArtworkTextureLease } from './GalleryArtworkTexturePool.mjs';
import { GalleryRuntimeOptimizations, optimizeThinRoofGlass } from './GalleryRuntimeOptimizations';
import { preloadGallerySurfacePixels, readGallerySurfacePixels, clearGallerySurfacePixelCache } from './GallerySurfacePixelLoader';
import { GalleryEnvironment, reflectionEnvironmentURL, reflectionEnvironmentRotationY, reflectiveBakedFloors, authoredEnvironmentMaterials, materialEnvironmentURL, authoredLightingModel } from './GalleryEnvironment';
import type { AuthoredLightingModel } from './GalleryEnvironment';
import { GallerySky, authoredSky } from './GallerySky';
import type { SkySettings } from './GallerySky';
import layout from './data/layout.json';
import { projects } from './data/projects';
import { cameraPose, planRoute } from './navigation.mjs';
import { createCameraMotion, sampleCameraMotion } from './camera-motion.mjs';

type Props = { selected: string | null; selectedSlot: string | null; mediaIndex: number; playing: boolean; retry: number; reduced: boolean; mobile: boolean; reset: number; onSelect: (id:string,slotId?:string)=>void; onReady:()=>void; onMediaError:(error:boolean)=>void; onVideoEnd:()=>void; onFailure:()=>void };
RectAreaLightUniformsLib.init();
void preloadGallerySurfacePixels();
const projectById=new Map(projects.map(p=>[p.id,p]));
const reviewEnabled=galleryReviewEnabled;
const ReviewUI=galleryDiagnosticBuild?lazy(()=>import('./GalleryReview').then(m=>({default:m.GalleryReviewUI}))):null;
const ReviewDiagnostics=galleryDiagnosticBuild?lazy(()=>import('./GalleryReview').then(m=>({default:m.GalleryDiagnostics}))):null;
const toVector=(p:number[])=>new Vector3(...p as [number,number,number]);
const overviewOffset=toVector(layout.overview.position).sub(toVector(layout.overview.target));
const overviewRadius=overviewOffset.length(),overviewPolar=Math.acos(overviewOffset.y/overviewRadius),overviewAzimuth=Math.atan2(overviewOffset.x,overviewOffset.z);
// Reserve a core for UI work while decoding independent mesh buffers in parallel.
const dracoWorkers=Math.max(1,Math.min(4,(navigator.hardwareConcurrency||4)-1));
type WarmDracoLoader=DRACOLoader&{decoderPending?:Promise<unknown>};
function createDracoLoader(){
  const loader=new DRACOLoader().setDecoderPath('/draco/').setWorkerLimit(dracoWorkers) as WarmDracoLoader;
  // Overlap initialization with the model request. The original rejected
  // promise still reaches GLTFLoader/error UI; preloading must not leave an
  // unhandled rejection before that consumer attaches.
  loader.preload();
  void loader.decoderPending?.catch(()=>{});
  return loader;
}
let dracoLoader=createDracoLoader();
// Share the decoder across Suspense/StrictMode attempts. Workers start only if
// a model actually contains KTX2 textures; PNG loading keeps its existing path.
let ktx2Loader:KTX2Loader|undefined;
// A development-only whitelist allows exported candidates to be reviewed before
// switching the production manifest. Production always follows layout.json.
const modelCandidates:Record<string,string>={i3:'/models/gallery-i-v3-web-ao.glb'};
const requestedModel=import.meta.env.DEV?new URLSearchParams(window.location.search).get('model'):null;
const baseModelPath=requestedModel&&Object.hasOwn(modelCandidates,requestedModel)?modelCandidates[requestedModel]:layout.modelPath;
const performanceRun=import.meta.env.DEV?new URLSearchParams(window.location.search).get('perfRun'):null;
const modelPath=performanceRun&&/^[a-z0-9-]{1,50}$/.test(performanceRun)?`${baseModelPath}?perfRun=${performanceRun}`:baseModelPath;
export function clearGalleryCache(){
  clearGallerySurfacePixelCache();
  void preloadGallerySurfacePixels();
  useLoader.clear(GLTFLoader,modelPath);
  const previousDraco=dracoLoader;dracoLoader=createDracoLoader();
  // A failed initialization is sticky in Three. Retry owns a fresh decoder;
  // dispose the old workers and any late-created Blob after initialization.
  if(previousDraco.decoderPending)void previousDraco.decoderPending.then(()=>previousDraco.dispose(),()=>previousDraco.dispose());
  else previousDraco.dispose();
  const previous=ktx2Loader;ktx2Loader=undefined;
  // A failed decoder fetch must not remain a rejected promise on retry. Wait
  // for initialization so a late worker Blob is also released after teardown.
  if(previous?.transcoderPending)void previous.transcoderPending.then(()=>previous.dispose(),()=>previous.dispose());
}

class SceneBoundary extends Component<{children:ReactNode; onError:()=>void},{error:boolean}> {
  state={error:false};
  static getDerivedStateFromError(){return {error:true};}
  componentDidCatch(){this.props.onError();}
  render(){return this.state.error?null:this.props.children;}
}

const Building=memo(function Building({onReady,onFailure,onLighting,onLightingModel,onEnvironment,onEnvironmentRotation,onSky,onReflectionMaterials}:{onReady:()=>void;onFailure:()=>void;onLighting:(baked:boolean)=>void;onLightingModel:(model:AuthoredLightingModel)=>void;onEnvironment:(url:string|null)=>void;onEnvironmentRotation:(rotationY:number)=>void;onSky:(settings:SkySettings|null)=>void;onReflectionMaterials:(materials:MeshStandardMaterial[])=>void}) {
  const {gl,camera,invalidate,scene:renderScene}=useThree();
  const configureGLTF=useCallback((loader:GLTFLoader)=>{
    galleryStage('model-loader-configured');
    ktx2Loader??=new KTX2Loader().setTranscoderPath('/basis/').setWorkerLimit(2);
    loader.setDRACOLoader(dracoLoader).setKTX2Loader(ktx2Loader.detectSupport(gl));
  },[gl]);
  const gltf=useLoader(GLTFLoader,modelPath,configureGLTF);
  readGallerySurfacePixels();
  // The exported model owns its PBR materials. Keep the cached geometry and
  // materials intact when this view remounts after a context loss or retry.
  const model=useMemo(()=>{
    galleryStage('model-decoded');
    // GLTFLoader tolerates an image decode failure by assigning a null texture.
    // A declared KTX2 GI map is required here: show the existing retry UI instead
    // of silently rendering an unlit surface. Resolve by glTF indices, not names.
    gltf.scene.traverse(object=>{
      const mesh=object as Mesh;if(!mesh.isMesh)return;
      for(const material of Array.isArray(mesh.material)?mesh.material:[mesh.material]){
        const index=gltf.parser.associations.get(material)?.materials;
        if(index===undefined)continue;
        const textureIndex=gltf.parser.json.materials?.[index]?.emissiveTexture?.index;
        const basis=gltf.parser.json.textures?.[textureIndex]?.extensions?.KHR_texture_basisu;
        if(basis&&!(material as MeshStandardMaterial).emissiveMap)throw new Error(`Required KTX2 GI texture ${textureIndex} failed to load.`);
      }
    });
    const copy=measureGalleryStage('model-clone',()=>gltf.scene.clone(true));
    const detailLOD=measureGalleryStage('detail-lod',()=>prepareDetailLOD(copy));
    copy.userData.detailLOD=detailLOD.summary;
    const environmentURL=reflectionEnvironmentURL(copy,gltf.parser.json.asset?.extras);
    const environmentRotationY=reflectionEnvironmentRotationY(copy,gltf.parser.json.asset?.extras);
    const sky=authoredSky(copy,gltf.parser.json.asset?.extras);
    const lightingModel=authoredLightingModel(copy,gltf.parser.json.asset?.extras);
    const authoredMaterials=measureGalleryStage('material-clones',()=>authoredEnvironmentMaterials(copy));
    copy.userData.thinRoofGlass = optimizeThinRoofGlass(authoredMaterials);
    // Recesses receive shadowed skylight below; the room probe supplies only
    // the remaining soft fill, avoiding an evenly bright coffer interior.
    authoredMaterials.forEach(material=>{if(material.userData.environmentURL==='/environment/i-v3/gallery-r1.hdr')material.envMapIntensity=.18;if(material.userData.environmentURL==='/environment/i-v3/gallery-r3.hdr')material.envMapIntensity=.3;if(material.userData.environmentURL==='/environment/i-v3/gallery-r4.hdr')material.envMapIntensity=.2;});
    const surface=measureGalleryStage('surface-pixels-and-hooks',()=>applySurfaceMaterials(authoredMaterials));
    const floors=environmentURL?reflectiveBakedFloors(copy):[];
    copy.traverse(object=>{
      const mesh=object as Mesh;if(!mesh.isMesh)return;
      // The authored frame remains in the GLB. Replace only its sample image
      // on the instance, leaving the shared loader cache untouched.
      if(mesh.userData.element_role==='artwork'){mesh.visible=false;return;}
      const materials=(Array.isArray(mesh.material)?mesh.material:[mesh.material]) as Material[];
      // A translucent skylight admits daylight. Casting an opaque WebGL shadow
      // from it would close the roof that the source model intentionally opens.
      mesh.castShadow=!materials.some(m=>/glaz|glass/i.test(m.name)||m.transparent);
      mesh.receiveShadow=true;
    });
    galleryStage('model-prepared');
    return {scene:copy,environmentURL,environmentRotationY,sky,lightingModel,surface,detailLOD:detailLOD.nodes,ownedMaterials:[...authoredMaterials,...floors]};
  },[gltf]);
  const {scene,environmentURL,environmentRotationY,sky,lightingModel,surface,detailLOD,ownedMaterials}=model;
  useFrame(()=>{
    camera.updateMatrixWorld();
    let changed=false;
    for(const lod of detailLOD){const before=lod.getCurrentLevel();lod.update(camera);if(lod.getCurrentLevel()!==before)changed=true;}
    if(changed){if(!renderScene.userData.staticDetailShadow?.safeToIgnoreDetailLODChanges)gl.shadowMap.needsUpdate=true;renderScene.userData.reflectionRevision=(renderScene.userData.reflectionRevision??0)+1;renderScene.userData.geometryRevision=(renderScene.userData.geometryRevision??0)+1;}
  },.1);
  useEffect(()=>{
    if(!galleryReviewEnabled)return;
    const apply=(enabled:boolean)=>{ownedMaterials.forEach(m=>{if(m.userData.geometryAOStrength)m.userData.geometryAOStrength.value=enabled?1:0;});renderScene.userData.reviewVertexAOEnabled=enabled;invalidate();};
    apply(renderScene.userData.reviewVertexAOEnabled??true);
    const toggle=(event:Event)=>apply((event as CustomEvent<boolean>).detail);
    window.addEventListener('gallery-review-vertex-ao',toggle);return()=>window.removeEventListener('gallery-review-vertex-ao',toggle);
  },[ownedMaterials,renderScene,invalidate]);
  useEffect(()=>()=>{surface.dispose();ownedMaterials.forEach(material=>material.dispose());},[surface,ownedMaterials]);
  useEffect(()=>{
    let baked=scene.userData.lightingBaked===true;
    scene.traverse(object=>{const mesh=object as Mesh;if(!mesh.isMesh)return;const mats=Array.isArray(mesh.material)?mesh.material:[mesh.material];if(mats.some(m=>m.userData.lightingBaked===true||m.name.startsWith('BAKED / ')))baked=true;});
    // Original PBR materials also use the reflection probe authored with their
    // Blender source. Only baked models opt out of the realtime light rig.
    const environment=environmentURL;
    renderScene.userData.expectedEnvironmentURL=environment;
    renderScene.userData.expectedEnvironmentRotationY=environment?environmentRotationY:0;
    renderScene.userData.expectedMaterialEnvironmentURLs=[...new Set(ownedMaterials.map(materialEnvironmentURL).filter((url):url is string=>url!==null))];
    renderScene.userData.expectedSkyStatus=sky;
    renderScene.userData.runtimeLightingModel=baked?lightingModel:null;
    renderScene.userData.thinRoofGlass=scene.userData.thinRoofGlass;
    onReflectionMaterials(ownedMaterials);onSky(sky);onEnvironment(environment);onEnvironmentRotation(environment?environmentRotationY:0);onLighting(baked);onLightingModel(baked?lightingModel:null);gl.shadowMap.needsUpdate=true;invalidate();
  },[scene,environmentURL,environmentRotationY,sky,lightingModel,ownedMaterials,onReady,onLighting,onLightingModel,onEnvironment,onEnvironmentRotation,onSky,onReflectionMaterials,renderScene,gl,invalidate]);
  return <><primitive object={scene} dispose={null} onClick={(e:ThreeEvent<MouseEvent>)=>e.stopPropagation()} />
    <GalleryRuntimeOptimizations layout={layout} resetKey={scene.uuid}/>
    <GallerySceneReady textures={surface.textures} resetKey={scene.uuid} onReady={()=>{galleryStage('loading-ui-dismissed');onReady();}} onFailure={onFailure}/>
  </>;
});

type ArtworkProps=Pick<Props,'retry'|'onSelect'|'onMediaError'|'onVideoEnd'>&{index:number;active:boolean;hasSelection:boolean;mediaIndex:number;playing:boolean};
const Artwork=memo(function Artwork({index,active,hasSelection,mediaIndex,playing,retry,onSelect,onMediaError,onVideoEnd}:ArtworkProps) {
  const a=layout.artworks[index],p=projectById.get(a.projectId)!;
  const media=active?p.media[mediaIndex]:null;
  const {invalidate,scene}=useThree();
  const [map,setMap]=useState<Texture|null>(null);
  const [ratio,setRatio]=useState(.75);
  const [hover,setHover]=useState(false);
  useEffect(()=>{scene.userData.reflectionRevision=(scene.userData.reflectionRevision??0)+1;invalidate();},[scene,invalidate,map,hover,hasSelection]);
  useEffect(()=>{scene.userData.geometryRevision=(scene.userData.geometryRevision??0)+1;invalidate();},[scene,invalidate,ratio]);
  const videoRef=useRef<HTMLVideoElement|null>(null);
  // A texture remains owned while it is attached to the committed material.
  // Disposing it in the loader cleanup can make the next camera frame upload
  // that same, still-rendered texture again before its replacement is ready.
  const ownedTextures=useRef(new Set<Texture>());
  const staticLeases=useRef(new Map<Texture,ArtworkTextureLease>());
  const disposeOwnedTexture=useCallback((texture:Texture)=>{
    if(!ownedTextures.current.delete(texture))return;
    const lease=staticLeases.current.get(texture);
    if(lease){staticLeases.current.delete(texture);lease.release();}
    else texture.dispose();
  },[]);
  useEffect(()=>()=>{for(const texture of [...ownedTextures.current])disposeOwnedTexture(texture);},[disposeOwnedTexture]);
  // Passive cleanup runs after React detaches the previous material/map.
  useEffect(()=>()=>{if(map)disposeOwnedTexture(map);},[map,disposeOwnedTexture]);
  const source=media?.type==='image'?media.src:`/art/${p.id}-thumb.webp`;
  useEffect(()=>{
    // A delayed thumbnail must never overwrite the active VideoTexture.
    if(media?.type==='video')return;
    let live=true,accepted=false;
    const status={state:'loading',message:''};
    (scene.userData.artworkLoadStatus??={})[a.id]=status;
    const lease=galleryArtworkTexturePool.acquire(source);
    void lease.ready.then(t=>{
      if(!live){lease.release();return;}
      status.state='ready';
      // Changing active/retry can request the same image while it is still the
      // committed map. Keep just one lease per Artwork/Texture in that case.
      if(ownedTextures.current.has(t))lease.release();
      else{ownedTextures.current.add(t);staticLeases.current.set(t,lease);}
      accepted=true;
      setRatio(t.image.width/t.image.height);setMap(t);if(active)onMediaError(false);invalidate();
    },()=>{
      if(!live)return;
      status.state='failed';status.message=`Artwork texture failed to load: ${a.id}`;
      live=false;lease.release();if(active)onMediaError(true);
    });
    return()=>{live=false;if(!accepted)lease.release();if(scene.userData.artworkLoadStatus?.[a.id]===status)delete scene.userData.artworkLoadStatus[a.id];};
  },[source,media?.type,retry,active,invalidate,onMediaError,disposeOwnedTexture,scene,a.id]);
  useEffect(()=>{
    if(media?.type!=='video')return;
    let live=true,accepted=false;
    const video=document.createElement('video');video.src=media.src;video.playsInline=true;video.preload='metadata';video.crossOrigin='anonymous';videoRef.current=video;
    if(import.meta.env.DEV)Object.assign(window,{__lastGalleryVideo:video});
    const tex=new VideoTexture(video);tex.colorSpace=SRGBColorSpace;ownedTextures.current.add(tex);
    const refreshReflection=()=>{if(live){scene.userData.reflectionRevision=(scene.userData.reflectionRevision??0)+1;invalidate();}};
    video.addEventListener('seeked',refreshReflection);video.addEventListener('pause',refreshReflection);video.addEventListener('loadeddata',refreshReflection);video.addEventListener('ended',refreshReflection);
    const stopVideo=()=>{
      video.removeEventListener('seeked',refreshReflection);video.removeEventListener('pause',refreshReflection);video.removeEventListener('loadeddata',refreshReflection);video.removeEventListener('ended',refreshReflection);
      video.onloadeddata=null;video.onerror=null;video.onended=null;
      video.pause();video.removeAttribute('src');video.load();
      if(videoRef.current===video)videoRef.current=null;
    };
    video.onloadeddata=()=>{
      if(!live)return;
      accepted=true;setRatio(video.videoWidth/video.videoHeight);setMap(tex);onMediaError(false);invalidate();
    };
    video.onerror=()=>{
      if(!live)return;
      live=false;stopVideo();if(!accepted)disposeOwnedTexture(tex);onMediaError(true);
    };
    video.onended=()=>{if(live)onVideoEnd();};video.load();
    return()=>{live=false;stopVideo();if(!accepted)disposeOwnedTexture(tex);};
  },[media?.src,media?.type,retry,invalidate,onMediaError,onVideoEnd,disposeOwnedTexture,scene]);
  useEffect(()=>{const v=videoRef.current;if(v){if(playing)v.play().catch(()=>onMediaError(true));else v.pause();invalidate();}},[playing,media?.src,invalidate,onMediaError]);
  useFrame(()=>{if(playing&&active&&videoRef.current){scene.userData.reflectionRevision=(scene.userData.reflectionRevision??0)+1;invalidate();}});
  const height=Math.min(a.height-.038,(a.width-.038)/ratio),width=height*ratio;
  return <group position={a.position as [number,number,number]} rotation={[0,a.rotation,0]}>
    <mesh position={[0,0,.002]} onClick={e=>{if(e.delta<5){e.stopPropagation();onSelect(p.id,a.id);}}}><planeGeometry args={[a.width,a.height]}/><meshBasicMaterial color={hover&&!hasSelection?'#eadcc3':'#f6f1e6'} toneMapped={false}/></mesh>
    <mesh name={`WEB-ART-${a.id}`} userData={{slot_id:a.id,project_id:p.id,element_role:'web_artwork'}} position={[0,0,.004]} onClick={e=>{if(e.delta<5){e.stopPropagation();onSelect(p.id,a.id);}}} onPointerOver={()=>{setHover(true);document.body.style.cursor='pointer';}} onPointerOut={()=>{setHover(false);document.body.style.cursor='';}}>
      <planeGeometry args={[width,height]} /><meshBasicMaterial key={map?.uuid ?? 'empty'} map={map} color={map?'white':p.color} toneMapped={false}/>
    </mesh>
  </group>;
});

function CameraRig({selected,selectedSlot,reduced,mobile,reset}:Pick<Props,'selected'|'selectedSlot'|'reduced'|'mobile'|'reset'>) {
  const {camera,invalidate,gl,scene}=useThree();
  const controls=useRef<Controls>(null);
  const saved=useRef({position:toVector(layout.overview.position),target:toVector(layout.overview.target)});
  const previous=useRef<string|null>(null);
  const initialized=useRef(false);
  const motion=useRef<{path:ReturnType<typeof createCameraMotion>;lookTo:Vector3;start:number|null;immediate:boolean}|null>(null);
  // The overview has a fixed lens. Its closing-panel resize must not restart a trip.
  const aspect=selected?(mobile?window.innerWidth/(window.innerHeight*.47):window.innerWidth*.65/window.innerHeight):1;
  const lastReset=useRef(reset);
  const cameraKey=selectedSlot??selected;
  // Prepare the unchanged route in this commit, before the next requested
  // canvas frame. The aspect guard below still waits for a real panel resize.
  useLayoutEffect(()=>{
    const c=controls.current;if(!c)return;
    const cam=camera as PerspectiveCamera;
    camera.up.set(0,1,0);
    const initial=!initialized.current;initialized.current=true;
    const wasReset=lastReset.current!==reset;lastReset.current=reset;
    if(wasReset)saved.current={position:toVector(layout.overview.position),target:toVector(layout.overview.target)};
    if(initial&&!selected){c.target.copy(saved.current.target);camera.lookAt(c.target);c.update();invalidate();return;}
    if(selected&&!previous.current){saved.current={position:camera.position.clone(),target:c.target.clone()};}
    const pose=cameraPose(layout,cameraKey,mobile,aspect);
    const position=selected?toVector(pose.position):saved.current.position.clone(),target=selected?toVector(pose.target):saved.current.target.clone();
    const points=initial?[camera.position.toArray(),position.toArray()]:planRoute(layout,camera.position.toArray(),position.toArray());
    const reframe=cameraKey===previous.current&&!wasReset;
    motion.current={path:createCameraMotion(points,c.target.toArray(),target.toArray(),cam.fov,pose.fov,!selected),lookTo:target,start:null,immediate:reduced||initial||reframe};
    c.minDistance=.1;c.maxDistance=250;c.minPolarAngle=0;c.maxPolarAngle=Math.PI;c.minAzimuthAngle=-Infinity;c.maxAzimuthAngle=Infinity;
    c.enabled=false;previous.current=cameraKey;invalidate();
  },[selected,cameraKey,reduced,mobile,aspect,reset,camera,invalidate]);
  useEffect(()=>{
    // Expose measurements only in the local verification build.
    if(galleryReviewEnabled)Object.assign(window,{__gallery:{camera,renderer:gl,scene,invalidate,modelPath,get moving(){return !!motion.current;},captureView(position:number[],target:number[],fov=58,up?:number[]){
      const c=controls.current;const cam=camera as PerspectiveCamera;motion.current=null;
      if(c){c.enabled=false;c.target.copy(toVector(target));}
      camera.up.copy(toVector(up??[0,1,0]));camera.position.copy(toVector(position));camera.lookAt(toVector(target));cam.fov=fov;cam.updateProjectionMatrix();invalidate();
    }}});
  },[camera,gl,scene,invalidate]);
  useFrame(()=>{
    const m=motion.current,c=controls.current;if(!m||!c)return;
    const cam=camera as PerspectiveCamera;
    if(m.start===null){
      // Let the panel layout and drawing buffer agree before starting the trip.
      // A late aspect-ratio update otherwise looks like a camera jump in flight.
      const viewport=gl.domElement.parentElement?.getBoundingClientRect();
      if(!m.immediate&&viewport?.height&&Math.abs(cam.aspect-viewport.width/viewport.height)>.002){invalidate();return;}
      m.start=performance.now();
    }
    const pose=sampleCameraMotion(m.path,m.immediate?m.path.duration:(performance.now()-m.start)/1000);
    camera.position.copy(toVector(pose.position));
    c.target.copy(camera.position).add(new Vector3(Math.sin(pose.yaw)*Math.cos(pose.pitch),Math.sin(pose.pitch),Math.cos(pose.yaw)*Math.cos(pose.pitch)).multiplyScalar(5));
    cam.fov=pose.fov;cam.updateProjectionMatrix();
    if(pose.done){c.target.copy(m.lookTo);motion.current=null;c.enabled=!selected;if(!selected){c.minDistance=overviewRadius-.25;c.maxDistance=overviewRadius+.25;c.minPolarAngle=overviewPolar-.06;c.maxPolarAngle=overviewPolar+.06;c.minAzimuthAngle=overviewAzimuth-.1;c.maxAzimuthAngle=overviewAzimuth+.1;}}
    camera.lookAt(c.target);
    if(pose.done)c.update();else invalidate();
  });
  return <OrbitControls ref={controls} target={layout.overview.target as [number,number,number]} enabled={!selected} enablePan={false} enableDamping={false} minDistance={overviewRadius-.25} maxDistance={overviewRadius+.25} minPolarAngle={overviewPolar-.06} maxPolarAngle={overviewPolar+.06} minAzimuthAngle={overviewAzimuth-.1} maxAzimuthAngle={overviewAzimuth+.1} rotateSpeed={.24} zoomSpeed={.25} onChange={()=>invalidate()}/>;
}

function Gallery(props:Props) {
  const [baked,setBaked]=useState(false);
  const [lightingModel,setLightingModel]=useState<AuthoredLightingModel>(null);
  const [environmentURL,setEnvironmentURL]=useState<string|null>(null);
  const [environmentRotationY,setEnvironmentRotationY]=useState(0);
  const [sky,setSky]=useState<SkySettings|null>(null);
  const [reflectionMaterials,setReflectionMaterials]=useState<MeshStandardMaterial[]>([]);
  // Geometry AA belongs to GalleryEffects' multisampled render target. The
  // default framebuffer only receives its fullscreen output quad.
  return <SceneBoundary onError={props.onFailure}><Canvas frameloop="demand" shadows="soft" resize={{debounce:0}} dpr={[1,props.mobile?1.25:1.5]} camera={{position:layout.overview.position as [number,number,number],fov:layout.overview.fov,near:.08,far:250}} gl={{antialias:false,alpha:false,powerPreference:'high-performance',toneMapping:AgXToneMapping,toneMappingExposure:.82}} onCreated={({gl})=>{gl.setClearColor('#dce6ed');gl.shadowMap.type=PCFSoftShadowMap;gl.shadowMap.autoUpdate=false;gl.shadowMap.needsUpdate=true;}}>
    {!(baked&&environmentURL&&lightingModel==='baked-diffuse-probes')?<GalleryLight materials={reflectionMaterials}/>:null}
    <Suspense fallback={null}><Building onReady={props.onReady} onFailure={props.onFailure} onLighting={setBaked} onLightingModel={setLightingModel} onEnvironment={setEnvironmentURL} onEnvironmentRotation={setEnvironmentRotationY} onSky={setSky} onReflectionMaterials={setReflectionMaterials}/>{layout.artworks.map((a,index)=>{
      const active=props.selected===a.projectId&&a.id===(props.selectedSlot??layout.projectSlots[a.projectId as keyof typeof layout.projectSlots]);
      return <Artwork key={a.id} index={index} active={active} hasSelection={props.selected!==null} mediaIndex={active?props.mediaIndex:0} playing={active&&props.playing} retry={props.retry} onSelect={props.onSelect} onMediaError={props.onMediaError} onVideoEnd={props.onVideoEnd}/>;
    })}</Suspense>
    <CameraRig {...props}/><ContextGuard onFailure={props.onFailure}/>
    <GalleryFloorReflection materials={reflectionMaterials} mobile={props.mobile} baked={baked}/>
    <GalleryEffects mobile={props.mobile} baked={baked}/>
    <GalleryEnvironment url={environmentURL} rotationY={environmentRotationY} materials={reflectionMaterials} onFailure={props.onFailure}/>
    <GallerySky settings={sky} onFailure={props.onFailure}/>
    {reviewEnabled&&ReviewDiagnostics?<Suspense fallback={null}><ReviewDiagnostics/></Suspense>:null}
  </Canvas>{reviewEnabled&&ReviewUI?<Suspense fallback={null}><ReviewUI/></Suspense>:null}</SceneBoundary>;
}
export default memo(Gallery);
function ContextGuard({onFailure}:{onFailure:()=>void}){
  const gl=useThree(s=>s.gl);
  useEffect(()=>{const lost=(event:Event)=>{event.preventDefault();onFailure();};gl.domElement.addEventListener('webglcontextlost',lost);return()=>gl.domElement.removeEventListener('webglcontextlost',lost);},[gl,onFailure]);return null;
}


import {useEffect,useRef,useState,useSyncExternalStore} from 'react';
import {useFrame,useThree} from '@react-three/fiber';
import {AgXToneMapping,ACESFilmicToneMapping,NoToneMapping,Vector3} from 'three';
import type {Light,Mesh,MeshStandardMaterial,PerspectiveCamera,Texture,VideoTexture,WebGLRenderer} from 'three';
import cameraData from './data/review-i-cameras.json';
import layout from './data/layout.json';
import { galleryLoadSnapshot } from './gallery-performance';
import { galleryReviewEnabled } from './gallery-diagnostics';
import { getGallerySurfacePixelStatus } from './GallerySurfacePixelLoader';

type Snapshot=Record<string,unknown>;
type Command='refresh'|'performance'|'performance-long'|'arm-motion';
type GalleryHandle={camera:PerspectiveCamera;renderer:WebGLRenderer;moving:boolean;modelPath:string;invalidate:()=>void;captureView:(position:number[],target:number[],fov:number,up?:number[])=>void};
const gallery=()=>((window as unknown as {__gallery?:GalleryHandle}).__gallery);
const enabled=()=>galleryReviewEnabled;
const listeners=new Set<()=>void>(),commands=new Set<(command:Command)=>void>();
let serialized=JSON.stringify({status:'waiting-for-scene',reviewCameraCount:cameraData.cameras.length});
const subscribe=(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener);};};
const publish=(snapshot:Snapshot)=>{serialized=JSON.stringify(snapshot);for(const listener of listeners)listener();};
const command=(value:Command)=>{for(const listener of commands)listener(value);};
const rounded=(value:number)=>Math.round(value*1000)/1000;
const quantile=(sorted:number[],fraction:number)=>sorted.length?sorted[Math.min(sorted.length-1,Math.ceil(sorted.length*fraction)-1)]:null;
const summary=(values:number[])=>{
  const sorted=[...values].sort((a,b)=>a-b);
  return {samples:values.length,medianMs:quantile(sorted,.5),p95Ms:quantile(sorted,.95),minMs:sorted[0]??null,maxMs:sorted.at(-1)??null};
};

/** Opt-in controls: actions are ordinary buttons; diagnostics stay in read-only DOM. */
export function GalleryReviewUI(){
  const snapshot=useSyncExternalStore(subscribe,()=>serialized);
  const [cameraId,setCameraId]=useState('R1-A-entry'),[folded,setFolded]=useState(false),[clean,setClean]=useState(true),[message,setMessage]=useState(''),[aoEnabled,setAOEnabled]=useState(true),[vertexAOEnabled,setVertexAOEnabled]=useState(true);
  useEffect(()=>{
    if(!enabled())return;
    document.body.classList.toggle('gallery-review-clean',clean);
    return()=>document.body.classList.remove('gallery-review-clean');
  },[clean]);
  if(!enabled())return null;
  const move=()=>{
    const handle=gallery(),pose=cameraData.cameras.find(c=>c.id===cameraId);
    if(!handle||!pose){setMessage('장면이 준비된 뒤 다시 시도하세요.');return;}
    const rect=handle.renderer.domElement.getBoundingClientRect(),aspect=rect.width/rect.height;
    const fov=2*Math.atan(pose.sensorWidthMm/(2*pose.lensMm*aspect))*180/Math.PI;
    handle.captureView(pose.position,pose.target,fov,pose.up);
    setMessage(`${pose.id} · ${pose.lensMm}mm · 수직 FOV ${fov.toFixed(2)}°`);
    command('refresh');
  };
  const toggleClean=()=>{
    // Ceiling / detail review cameras may sit above the walkable volume.
    // End review framing at the approved safe overview before normal UI travel.
    if(clean){
      gallery()?.captureView(layout.overview.position,layout.overview.target,layout.overview.fov,[0,1,0]);
      command('refresh');
    }
    setClean(v=>!v);
  };
  return <aside aria-label="Revision I 검수 컨트롤" style={{position:'fixed',zIndex:10000,left:12,bottom:12,width:folded?'auto':360,maxWidth:'calc(100vw - 24px)',background:'rgba(250,249,244,.96)',border:'1px solid #6b7769',borderRadius:6,padding:folded?6:12,fontSize:12,color:'#253123',boxShadow:'0 2px 14px #0002'}}>
    <button onClick={()=>setFolded(v=>!v)} style={{padding:'7px 10px'}}>{folded?'검수 컨트롤 펼치기':'검수 컨트롤 접기'}</button>
    <div style={{display:folded?'none':'block',maxHeight:'70vh',overflow:'auto'}}>
      <p style={{margin:'10px 0 6px'}}>Revision I · 비교 카메라 {cameraData.cameras.length}개</p>
      <label htmlFor="review-i-camera">검수 카메라</label>
      <select id="review-i-camera" value={cameraId} onChange={e=>setCameraId(e.target.value)} style={{display:'block',width:'100%',padding:8,margin:'4px 0 8px'}}>
        {cameraData.cameras.map(c=><option key={c.id} value={c.id}>{c.id} · {c.purpose}</option>)}
      </select>
      <div style={{display:'flex',flexWrap:'wrap',gap:6}}>
        <button onClick={move}>선택한 카메라로 이동</button>
        <button onClick={()=>{command('refresh');gallery()?.invalidate();}}>진단 새로고침</button>
        <button onClick={()=>{command('performance');setMessage('10프레임 준비 후 120프레임 간격을 측정합니다.');}}>성능 측정</button>
        <button onClick={()=>{command('performance-long');setMessage('10프레임 준비 후 600프레임과 원시 간격을 측정합니다.');}}>장기 성능 측정</button>
        <button onClick={()=>{command('arm-motion');setMessage('일반 UI에서 작품을 선택하면 다음 이동을 측정합니다.');}}>이동 측정 준비</button>
        <button onClick={toggleClean}>{clean?'일반 UI 표시':'일반 UI 숨기기'}</button>
        <button onClick={()=>{const next=!aoEnabled;setAOEnabled(next);window.dispatchEvent(new CustomEvent('gallery-review-ao',{detail:next}));command('refresh');}}>접촉 음영 {aoEnabled?'끄기':'켜기'}</button>
        <button onClick={()=>{const next=!vertexAOEnabled;setVertexAOEnabled(next);window.dispatchEvent(new CustomEvent('gallery-review-vertex-ao',{detail:next}));command('refresh');}}>모델 음영 {vertexAOEnabled?'끄기':'켜기'}</button>
        <label>광원 진단<select aria-label="광원 진단" defaultValue="final" onChange={e=>{if(e.target.value==='final'){setAOEnabled(true);setVertexAOEnabled(true);window.dispatchEvent(new CustomEvent('gallery-review-ao',{detail:true}));window.dispatchEvent(new CustomEvent('gallery-review-vertex-ao',{detail:true}));}window.dispatchEvent(new CustomEvent('gallery-review-lighting',{detail:e.target.value}));command('refresh');}}><option value="final">전체 조명 · 음영 복원</option><option value="ceiling-return">이전 수직 보조광</option><option value="wall-return">R1/R3 상부 벽 반사광</option><option value="r1-directional">R1 방향성 채광</option><option value="r3-directional">R3 방향성 채광</option><option value="reflection-legacy">이전 바닥 반사</option><option value="reflection-raw">반사 원본 투영</option><option value="reflection-soft">넓고 흐린 바닥 반사</option><option value="reflection-r3-blur">온실 반사 흐림 0.65</option><option value="reflection-r3-polished">온실 반사 흐림 0.65 · 대비 1.2</option><option value="reflection-r3-polished-high">온실 반사 흐림 0.65 · 대비 1.6</option><option value="no-floor-reflection">바닥 반사 제외</option><option value="upper-return">R1/R3 상부 몰딩 반사 방향</option><option value="r2-wall-return">R2 측벽 반사광 400</option><option value="r4-wall-return">R4 측벽 반사광</option><option value="r4-down-off">R4 천장 보조광 제외</option><option value="r4-env-low">R4 환경광 0.2</option><option value="r4-env-legacy">R4 이전 환경광 0.65</option><option value="no-env">환경광 제외</option><option value="no-hemi">반구광 제외</option><option value="return-only">반사광만</option><option value="return-env">반사광 + 환경광</option><option value="return-area">반사광 + 천장광</option></select></label>
      </div>
      <p role="status" style={{margin:'8px 0'}}>{message}</p>
      <output data-testid="gallery-diagnostics" aria-label="갤러리 진단 JSON" style={{display:'block',maxHeight:190,overflow:'auto',whiteSpace:'pre-wrap',overflowWrap:'anywhere',fontFamily:'monospace',fontSize:10,lineHeight:1.35}}>{snapshot}</output>
    </div>
  </aside>;
}

/** Mount inside Canvas after CameraRig; does not alter scene materials or camera. */
export function GalleryDiagnostics({onSnapshot}:{onSnapshot?:(snapshot:Snapshot)=>void}={}){
  const {gl,scene,camera,invalidate,size}=useThree();
  const callback=useRef(onSnapshot);callback.current=onSnapshot;
  const state=useRef({refresh:true,lastPublish:0,contextLosses:0,contextRestores:0,
    performance:{state:'idle',warmup:0,previous:0,target:120,values:[] as number[],result:null as ReturnType<typeof summary>|null},
    motion:{state:'idle',previous:0,values:[] as number[],result:null as ReturnType<typeof summary>|null,positions:[] as number[][],durationMs:0,started:0,maximumStepM:0,requestedAt:0,request:null as Snapshot|null,firstSubmittedAt:0,frameProfile:[] as Snapshot[]},
  });
  useEffect(()=>{
    if(!enabled())return;
    const request=(type:Command)=>{
      const s=state.current;s.refresh=true;
      if(type==='performance'||type==='performance-long')s.performance={state:'warming',warmup:10,previous:0,target:type==='performance-long'?600:120,values:[],result:null};
      if(type==='arm-motion')s.motion={state:'armed',previous:0,values:[],result:null,positions:[],durationMs:0,started:0,maximumStepM:0,requestedAt:0,request:null,firstSubmittedAt:0,frameProfile:[]};
      invalidate();
    };
    const lost=()=>{state.current.contextLosses++;state.current.refresh=true;publish({status:'context-lost',contextLosses:state.current.contextLosses});};
    const restored=()=>{state.current.contextRestores++;state.current.refresh=true;invalidate();};
    const navigation=(event:Event)=>{const m=state.current.motion;if(m.state!=='armed')return;const detail=(event as CustomEvent<{at:number;project:string|null;slot:string|null}>).detail;m.requestedAt=detail.at;m.request=detail;};
    commands.add(request);gl.domElement.addEventListener('webglcontextlost',lost);gl.domElement.addEventListener('webglcontextrestored',restored);window.addEventListener('gallery-navigation-request',navigation);
    return()=>{commands.delete(request);gl.domElement.removeEventListener('webglcontextlost',lost);gl.domElement.removeEventListener('webglcontextrestored',restored);window.removeEventListener('gallery-navigation-request',navigation);};
  },[gl,invalidate]);
  useFrame(()=>{
    if(!enabled())return;
    const now=performance.now(),s=state.current,p=s.performance,m=s.motion,moving=gallery()?.moving??false;
    if(p.state==='warming'){
      p.warmup--;p.previous=now;
      if(p.warmup<=0){p.state='running';s.refresh=true;}
      invalidate();
    }else if(p.state==='running'){
      p.values.push(rounded(now-p.previous));p.previous=now;
      if(p.values.length>=p.target){p.result=summary(p.values);p.state='complete';s.refresh=true;}else invalidate();
    }
    if(m.state==='armed'&&m.requestedAt>0&&moving){m.state='running';m.started=now;m.previous=now;s.refresh=true;}
    if(m.state==='running'){
      const position=camera.position.toArray();
      if(m.positions.length){m.values.push(rounded(now-m.previous));m.maximumStepM=Math.max(m.maximumStepM,Math.hypot(...position.map((v,i)=>v-m.positions.at(-1)![i])));}
      m.positions.push(position);m.previous=now;m.durationMs=now-m.started;
      if(!moving){m.state='complete';m.result=summary(m.values);s.refresh=true;}
    }
    if(!s.refresh&&now-s.lastPublish<500&&scene.userData.perfReadyRecorded)return;
    s.refresh=false;s.lastPublish=now;
    const meshes:Mesh[]=[],sourceHashes=new Set<string>(),lights:Record<string,number>={},slots=new Set<string>();
    const lightRig:Snapshot[]=[];
    let webArtworkVisible=0,originalArtworkHidden=0,originalArtworkVisible=0,webArtworkWithTexture=0,visibleMeshes=0;
    const detailLevels:Record<string,number>={};
    const materialSet=new Set<MeshStandardMaterial>(),textures=new Set<Texture>();
    const aoGeometries=new Set<string>(),aoMaterials=new Set<string>(),activeVideoTextures:Snapshot[]=[];
    const capitalAOByRoom:Record<string,{meshes:number;withAttribute:number;withHook:number}>={};
    const revisedDetailAO:Record<string,{meshes:number;withAttribute:number;withHook:number}>={};
    let meshesWithAO=0,aoVertexCount=0;
    const visible=(object:Mesh)=>{for(let p=object as Mesh|null;p;p=p.parent as Mesh|null)if(!p.visible)return false;return true;};
    scene.traverse(object=>{
      if(object.userData.fidelityLOD){
        const active=object.children.filter(child=>child.visible);
        const level=active.length===1?active[0].name.split('-level-').at(-1)!:'invalid';
        detailLevels[level]=(detailLevels[level]??0)+1;
      }
      const hash=object.userData.sourceModelSHA256;if(typeof hash==='string')sourceHashes.add(hash);
      if((object as Light).isLight){const light=object as Light;lights[object.type]=(lights[object.type]??0)+1;lightRig.push({name:light.name,type:light.type,worldPosition:light.getWorldPosition(new Vector3()).toArray(),intensity:light.intensity,color:light.color.getHexString(),castShadow:light.castShadow});}
      const mesh=object as Mesh;if(!mesh.isMesh)return;meshes.push(mesh);
      const isVisible=visible(mesh);if(isVisible)visibleMeshes++;
      const ao=mesh.geometry.getAttribute('_ao');
      if(ao){meshesWithAO++;if(!aoGeometries.has(mesh.geometry.uuid)){aoGeometries.add(mesh.geometry.uuid);aoVertexCount+=ao.count;}}
      const materials=(Array.isArray(mesh.material)?mesh.material:[mesh.material]) as MeshStandardMaterial[];
      if(mesh.userData.fidelity_v8_changed===true&&['capital','ornament','molding','carving','pilaster'].includes(mesh.userData.element_role)){
        const key=String(mesh.userData.room_id)+'/'+String(mesh.userData.element_role);
        const coverage=revisedDetailAO[key]??={meshes:0,withAttribute:0,withHook:0};
        coverage.meshes++;if(ao)coverage.withAttribute++;
        if(materials.every(m=>m.userData.geometryAOAttribute==='_AO'))coverage.withHook++;
      }
      if(mesh.userData.element_role==='capital'){
        const room=String(mesh.userData.room_id??'unknown');
        const coverage=capitalAOByRoom[room]??={meshes:0,withAttribute:0,withHook:0};
        coverage.meshes++;if(ao)coverage.withAttribute++;
        if(materials.every(m=>m.userData.geometryAOAttribute==='_AO'))coverage.withHook++;
      }
      materials.forEach(material=>{materialSet.add(material);for(const texture of [material.map,material.normalMap,material.roughnessMap,material.metalnessMap,material.emissiveMap,material.envMap])if(texture)textures.add(texture);});
      for(const material of materials){
        if(material.userData.geometryAOAttribute==='_AO'&&material.customProgramCacheKey().includes('revision-i-geometry-ao-v1'))aoMaterials.add(material.uuid);
        const map=material.map as VideoTexture|null;
        if(map?.isVideoTexture&&map.image instanceof HTMLVideoElement){
          const video=map.image;
          activeVideoTextures.push({slotId:mesh.userData.slot_id??null,mesh:mesh.name,visible:isVisible,source:video.currentSrc||video.src,currentTime:rounded(video.currentTime),paused:video.paused,ended:video.ended,readyState:video.readyState,videoWidth:video.videoWidth,videoHeight:video.videoHeight,textureVersion:map.version});
        }
      }
      if(mesh.userData.element_role==='web_artwork'&&isVisible){webArtworkVisible++;slots.add(mesh.userData.slot_id);if(materials.some(mat=>mat.map?.image))webArtworkWithTexture++;}
      if(mesh.userData.element_role==='artwork'){if(isVisible)originalArtworkVisible++;else originalArtworkHidden++;}
    });
    const context=gl.getContext(),debug=context.getExtension('WEBGL_debug_renderer_info');
    const tone=gl.toneMapping===AgXToneMapping?'AgX':gl.toneMapping===ACESFilmicToneMapping?'ACESFilmic':gl.toneMapping===NoToneMapping?'None':String(gl.toneMapping);
    const expectedMaterialURLs=scene.userData.expectedMaterialEnvironmentURLs??[];
    const environmentStates=scene.userData.materialEnvironmentStatus??{};
    const aoStrengths=[...materialSet].filter(m=>m.userData.geometryAOStrength).map(m=>Number(m.userData.geometryAOStrength.value));
    const snapshot:Snapshot={status:'scene-sampled',capturedAt:new Date().toISOString(),pageURL:location.href,sampledAtMs:rounded(now),modelPath:gallery()?.modelPath??null,
      sourceModelSHA256:[...sourceHashes],expectedSourceModelSHA256:layout.sourceBlendSha256,cameraSourceModelSHA256:cameraData.sourceModelSha256,sourceHashMatches:sourceHashes.size===1&&sourceHashes.has(layout.sourceBlendSha256),
      artworks:{expected:48,webVisible:webArtworkVisible,uniqueVisibleSlots:slots.size,webTextured:webArtworkWithTexture,originalHidden:originalArtworkHidden,originalVisible:originalArtworkVisible},
      meshes:{total:meshes.length,visible:visibleMeshes},detailLOD:{groups:Object.values(detailLevels).reduce((a,b)=>a+b,0),activeLevels:detailLevels},materials:materialSet.size,textures:textures.size,lights,lightRig,lightPartitions:[...new Set([...materialSet].filter(m=>m.userData.localLights).map(m=>JSON.stringify(m.userData.localLights)))].map(value=>JSON.parse(value)),reviewAOEnabled:scene.userData.reviewAOEnabled??true,reviewVertexAOEnabled:scene.userData.reviewVertexAOEnabled??true,reviewLightPreset:scene.userData.reviewLightPreset??'final',
      geometryAO:{attribute:'_ao',meshesWithAttribute:meshesWithAO,uniqueGeometries:aoGeometries.size,decodedVertexCount:aoVertexCount,hookedMaterials:aoMaterials.size,capitalAOByRoom,revisedDetailAO,shaderCacheKey:'revision-i-geometry-ao-v1',actualStrengthMin:aoStrengths.length?Math.min(...aoStrengths):null,actualStrengthMax:aoStrengths.length?Math.max(...aoStrengths):null,screenSpacePassEnabled:scene.userData.reviewAOPassEnabled??null},activeVideoTextures,
      surfaceFidelity:{materials:[...materialSet].filter(m=>m.userData.surfaceFidelity).map(m=>({name:m.name,...m.userData.surfaceFidelity})),floorReflection:scene.userData.floorReflection??null},
      renderer:{priorFrameCalls:gl.info.render.calls,priorFrameTriangles:gl.info.render.triangles,geometries:gl.info.memory.geometries,textures:gl.info.memory.textures,programs:gl.info.programs?.length??0,dpr:gl.getPixelRatio(),canvasCSS:[size.width,size.height],drawingBuffer:[gl.domElement.width,gl.domElement.height],toneMapping:tone,exposure:gl.toneMappingExposure,outputColorSpace:gl.outputColorSpace,shadowMapEnabled:gl.shadowMap.enabled,shadowMapType:gl.shadowMap.type},
      gpu:{renderer:debug?context.getParameter(debug.UNMASKED_RENDERER_WEBGL):context.getParameter(context.RENDERER),vendor:debug?context.getParameter(debug.UNMASKED_VENDOR_WEBGL):context.getParameter(context.VENDOR),version:context.getParameter(context.VERSION),contextLost:context.isContextLost(),contextLosses:s.contextLosses,contextRestores:s.contextRestores},
      environment:{expectedSceneURL:scene.userData.expectedEnvironmentURL??null,sceneStatus:scene.userData.environmentStatus??null,actualSceneURL:scene.environment?.userData.environmentURL??null,expectedMaterialURLs,materialStates:environmentStates,actualMaterialIntensities:Object.fromEntries(expectedMaterialURLs.map((url:string)=>[url,[...new Set([...materialSet].filter(m=>m.userData.environmentURL===url).map(m=>m.envMapIntensity))]])),allExpectedReady:!!scene.userData.expectedEnvironmentURL&&scene.userData.environmentStatus?.state==='ready'&&scene.environment?.userData.environmentURL===scene.userData.expectedEnvironmentURL&&expectedMaterialURLs.every((url:string)=>environmentStates[url]?.state==='ready'),expectedRotationY:scene.userData.expectedEnvironmentRotationY??null,actualRotationY:scene.environmentRotation.y},
      sky:{expected:scene.userData.expectedSkyStatus??null,status:scene.userData.skyStatus??null,backgroundType:scene.background?.constructor.name??null,backgroundRotationY:scene.backgroundRotation.y,backgroundIntensity:scene.backgroundIntensity},
      camera:{position:camera.position.toArray(),quaternion:camera.quaternion.toArray(),up:camera.up.toArray(),fov:(camera as PerspectiveCamera).fov,aspect:(camera as PerspectiveCamera).aspect,moving},
      load:galleryLoadSnapshot(webArtworkWithTexture===48&&!!scene.userData.expectedEnvironmentURL&&scene.userData.environmentStatus?.state==='ready'&&expectedMaterialURLs.every((url:string)=>environmentStates[url]?.state==='ready')),
      renderPasses:scene.userData.renderPasses??null,
      contactAOCache:scene.userData.contactAOCache??null,staticDetailShadow:scene.userData.staticDetailShadow??null,
      sceneReadiness:scene.userData.sceneReadiness??null,surfacePixels:getGallerySurfacePixelStatus(),galleryVisibility:scene.userData.galleryVisibility??null,thinRoofGlass:scene.userData.thinRoofGlass??null,
      performance:{state:p.state,warmupFramesRemaining:p.warmup,framesCollected:p.values.length,targetSamples:p.target,...(p.result??{}),...(p.state==='complete'?{frameIntervalsMs:p.values}:{}),measurement:'rAF frame intervals after 10 warm-up frames. Includes browser scheduling and GPU waits; not GPU-only render time.'},
      motion:{state:m.state,framesCollected:m.values.length,durationMs:rounded(m.durationMs),maximumFrameStepM:rounded(m.maximumStepM),start:m.positions[0]??null,end:m.positions.at(-1)??null,...(m.result??{}),...(m.state==='complete'?{positions:m.positions,frameIntervalsMs:m.values,frameProfile:m.frameProfile,request:m.request,requestToFirstSubmittedMs:m.requestedAt?rounded(m.firstSubmittedAt-m.requestedAt):null}:{}),measurement:'Observed next normal UI camera journey, sampled each rendered frame. positions are actual camera coordinates; frameIntervalsMs[i] is elapsed time from positions[i] to positions[i+1].'},
    };
    if(webArtworkWithTexture===48&&scene.userData.environmentStatus?.state==='ready'&&expectedMaterialURLs.every((url:string)=>environmentStates[url]?.state==='ready'))scene.userData.perfReadyRecorded=true;
    publish(snapshot);callback.current?.(snapshot);
  });
  // Effects renders at priority 1. Keep frame-start timings above unchanged,
  // but record submission timing and counters only after that frame succeeds.
  useFrame(()=>{
    const m=state.current.motion;
    if(!enabled()||scene.userData.renderReady!==true||m.positions.length<=m.frameProfile.length)return;
    const now=performance.now();
    if(!m.firstSubmittedAt)m.firstSubmittedAt=now;
    m.frameProfile.push({positionIndex:m.positions.length-1,atMs:rounded(now),calls:gl.info.render.calls,triangles:gl.info.render.triangles,programs:gl.info.programs?.length??0,shadowRefreshSkips:scene.userData.galleryVisibility?.shadowRefreshSkips??0,geometryRevision:scene.userData.geometryRevision??0,reflectionCPU:rounded(scene.userData.renderPasses?.reflection?.cpuSubmissionMs??0),colorCPU:rounded(scene.userData.renderPasses?.color?.cpuSubmissionMs??0),aoCPU:rounded(scene.userData.renderPasses?.contactAO?.cpuSubmissionMs??0),reflectionCached:scene.userData.renderPasses?.reflection?.cached??false,aoCached:scene.userData.contactAOCache?.cacheHit??false});
  },2);
  return null;
}

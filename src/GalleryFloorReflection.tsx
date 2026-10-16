import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { DataTexture, DepthTexture, Matrix4, PlaneGeometry, RGBAFormat, UnsignedIntType, Vector2, Vector3 } from 'three';
import type { MeshStandardMaterial, ShaderMaterial, Texture } from 'three';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';

type ReflectionCache = {
  valid: boolean;
  cameraWorld: Matrix4;
  cameraProjection: Matrix4;
  inputs: unknown[];
  hits: number;
  renders: number;
};

// All authored finish slabs share Y=0. One clipped render serves the entire
// building; the stone/wood maps and joints remain on the original geometry.
export function GalleryFloorReflection({ materials, mobile, baked }: { materials: MeshStandardMaterial[]; mobile: boolean; baked: boolean }) {
  const { gl, scene, camera, size, invalidate } = useThree();
  const pass = useRef<{ mirror: Reflector; matrix: Matrix4; inverse: Matrix4; sampler: { value: Texture }; depthSampler:{value:Texture}; reflectionDepth:DepthTexture; enabled: { value: number }; mode: { value: number }; botanicalFinish:{value:Vector2}; fallback: DataTexture; texel: { value: Vector2 }; cache: ReflectionCache } | null>(null);
  const direction = useRef(new Vector3());

  useEffect(() => {
    if (baked || !materials.length) return;
    const floors = materials.filter(m => /^(I \/ honed limestone flooring|I \/ oak herringbone)(?: \/|$)/.test(m.userData.sourceMaterial ?? ''));
    if (!floors.length) return;
    const geometry = new PlaneGeometry(1, 1);
    const mirror = new Reflector(geometry, { textureWidth: 512, textureHeight: 288, multisample: 0, clipBias: .0002 });
    const reflectionDepth=new DepthTexture(512,288,UnsignedIntType);
    mirror.getRenderTarget().depthTexture=reflectionDepth;
    mirror.rotation.x = -Math.PI / 2;
    mirror.position.y = .002;
    mirror.updateMatrixWorld(true);
    const fallback = new DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, RGBAFormat);
    fallback.needsUpdate = true;
    const sampler = { value: fallback as Texture }, depthSampler={value:fallback as Texture}, enabled = { value: 0 }, mode = { value: 0 };
    const matrix = new Matrix4(), inverse = mirror.matrixWorld.clone().invert();
    const texel = { value: new Vector2(1 / 512, 1 / 288) };
    const botanicalFinish={value:new Vector2(1,1)},standardFinish={value:new Vector2(1,1)};
    const restores = floors.map(material => {
      const priorCompile = material.onBeforeCompile, priorKey = material.customProgramCacheKey;
      const cacheKey = priorKey.call(material);
      material.onBeforeCompile = function(shader, renderer) {
        priorCompile.call(this, shader, renderer);
        Object.assign(shader.uniforms, { galleryFloorReflection: sampler, galleryFloorReflectionDepth: depthSampler, galleryFloorReflectionMatrix: { value: matrix }, galleryFloorReflectionEnabled: enabled, galleryFloorReflectionMode: mode, galleryFloorReflectionTexel: texel, galleryFloorFinish: material.userData.room_id==='R3'?botanicalFinish:standardFinish });
        shader.vertexShader = 'uniform mat4 galleryFloorReflectionMatrix;\nvarying vec4 vGalleryFloorProjection;\nvarying vec3 vGalleryFloorWorld;\nvarying vec3 vGalleryFloorNormal;\n' + shader.vertexShader;
        shader.vertexShader = shader.vertexShader.replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
          vec4 galleryFloorWorld = modelMatrix * vec4(transformed, 1.0);
          vGalleryFloorWorld = galleryFloorWorld.xyz;
          vGalleryFloorNormal = normalize(mat3(modelMatrix) * objectNormal);
          vGalleryFloorProjection = galleryFloorReflectionMatrix * galleryFloorWorld;
        `);
        shader.fragmentShader = `uniform sampler2D galleryFloorReflection;
          uniform sampler2D galleryFloorReflectionDepth;
          uniform float galleryFloorReflectionEnabled;
          uniform float galleryFloorReflectionMode;
          uniform vec2 galleryFloorReflectionTexel;
          uniform vec2 galleryFloorFinish;
          varying vec4 vGalleryFloorProjection;
          varying vec3 vGalleryFloorWorld;
          varying vec3 vGalleryFloorNormal;
          vec4 galleryFloorTap(vec2 uv,float centerDepth,float weight){
            uv=clamp(uv,galleryFloorReflectionTexel*0.5,vec2(1.0)-galleryFloorReflectionTexel*0.5);
            // Keep sky outside the clipped building from bleeding over a solid
            // wall at the floor boundary. The center may still reflect real sky.
            float sampleDepth=texture2D(galleryFloorReflectionDepth,uv).r;
            if(centerDepth<0.999999&&sampleDepth>=0.999999)weight=0.0;
            return vec4(texture2D(galleryFloorReflection,uv).rgb*weight,weight);
          }
        ` + shader.fragmentShader;
        shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `
          if (galleryFloorReflectionEnabled > 0.5 && abs(vGalleryFloorWorld.y) < 0.03 && vGalleryFloorNormal.y > 0.9) {
            vec2 floorUv = vGalleryFloorProjection.xy / vGalleryFloorProjection.w;
            float floorFacing = clamp(dot(normalize(cameraPosition - vGalleryFloorWorld), normalize(vGalleryFloorNormal)), 0.0, 1.0);
            vec2 spread = galleryFloorReflectionTexel * (galleryFloorReflectionMode > 0.5 ? (2.0 + roughnessFactor * 16.0 + (1.0-floorFacing)*3.0) : (1.0 + roughnessFactor * 7.0));
            if(galleryFloorReflectionMode>0.5)spread*=galleryFloorFinish.x;
            vec3 floorReflection;
            if(galleryFloorReflectionMode<=0.5){
            floorReflection = texture2D(galleryFloorReflection, floorUv).rgb * 0.25;
            floorReflection += (texture2D(galleryFloorReflection, floorUv + vec2(spread.x, 0.0)).rgb + texture2D(galleryFloorReflection, floorUv - vec2(spread.x, 0.0)).rgb + texture2D(galleryFloorReflection, floorUv + vec2(0.0, spread.y)).rgb + texture2D(galleryFloorReflection, floorUv - vec2(0.0, spread.y)).rgb) * 0.125;
            floorReflection += (texture2D(galleryFloorReflection, floorUv + spread).rgb + texture2D(galleryFloorReflection, floorUv - spread).rgb + texture2D(galleryFloorReflection, floorUv + vec2(spread.x, -spread.y)).rgb + texture2D(galleryFloorReflection, floorUv + vec2(-spread.x, spread.y)).rgb) * 0.0625;
            }else{
              float centerDepth=texture2D(galleryFloorReflectionDepth,floorUv).r;
              vec4 filtered=galleryFloorTap(floorUv,centerDepth,0.25);
              filtered+=galleryFloorTap(floorUv+vec2(spread.x,0.0),centerDepth,0.125)+galleryFloorTap(floorUv-vec2(spread.x,0.0),centerDepth,0.125);
              filtered+=galleryFloorTap(floorUv+vec2(0.0,spread.y),centerDepth,0.125)+galleryFloorTap(floorUv-vec2(0.0,spread.y),centerDepth,0.125);
              filtered+=galleryFloorTap(floorUv+spread,centerDepth,0.0625)+galleryFloorTap(floorUv-spread,centerDepth,0.0625);
              filtered+=galleryFloorTap(floorUv+vec2(spread.x,-spread.y),centerDepth,0.0625)+galleryFloorTap(floorUv+vec2(-spread.x,spread.y),centerDepth,0.0625);
              floorReflection=filtered.rgb/max(filtered.a,0.0001);
            }
            float floorFresnel = galleryFloorReflectionMode > 0.5 ? (0.045 + 0.955 * pow(1.0 - floorFacing, 5.0)) * (1.0 - 0.45 * roughnessFactor) : (0.055 + 0.38 * pow(1.0 - floorFacing, 5.0)) * (1.0 - roughnessFactor);
            if(galleryFloorReflectionMode>0.5)floorFresnel=clamp(floorFresnel*galleryFloorFinish.y,0.0,1.0);
            float floorBounds = step(0.0, floorUv.x) * step(floorUv.x, 1.0) * step(0.0, floorUv.y) * step(floorUv.y, 1.0);
            outgoingLight = galleryFloorReflectionMode > 1.5 ? texture2D(galleryFloorReflection, floorUv).rgb : mix(outgoingLight, floorReflection, floorFresnel * floorBounds);
          }
          #include <opaque_fragment>
        `);
      };
      material.customProgramCacheKey = () => `${cacheKey}/shared-floor-reflection-v3-finish`;
      material.needsUpdate = true;
      return () => {
        material.onBeforeCompile = priorCompile;
        material.customProgramCacheKey = priorKey;
        // A new effect owns new uniform objects. Release this owned material's
        // cached program so the next compile cannot retain a disposed target.
        material.dispose();
        material.needsUpdate = true;
      };
    });
    const cache: ReflectionCache = { valid: false, cameraWorld: new Matrix4(), cameraProjection: new Matrix4(), inputs: [], hits: 0, renders: 0 };
    pass.current = { mirror, matrix, inverse, sampler, depthSampler, reflectionDepth, enabled, mode, botanicalFinish, fallback, texel, cache };
    scene.userData.floorReflection = { status: 'ready', version:'v3-finish', depthAware:true, filterTaps:9, materials: floors.length, planeY: .002, renderPasses: 1, cacheVersion: 'unchanged-frame-v1', cacheHits: 0, renderCount: 0, cacheHit: false };
    invalidate();
    return () => {
      pass.current = null;
      restores.forEach(restore => restore());
      mirror.dispose(); geometry.dispose(); fallback.dispose();
      delete scene.userData.floorReflection;
    };
  }, [materials, baked, gl, scene, invalidate]);

  useEffect(() => {
    const p = pass.current; if (!p) return;
    const width = mobile ? 320 : 640, height = Math.max(128, Math.round(width * size.height / size.width));
    p.mirror.getRenderTarget().setSize(width, height);
    p.cache.valid = false;
    p.texel.value.set(1 / width, 1 / height);
    Object.assign(scene.userData.floorReflection, { width, height });
    invalidate();
  }, [materials, baked, mobile, size.width, size.height, scene, invalidate]);

  useFrame(() => {
    const p = pass.current; if (!p) return;
    if (scene.userData.renderReady !== true) {
      p.enabled.value = 0; p.cache.valid = false;
      Object.assign(scene.userData.floorReflection, { enabled: false, cacheHit: false, skipReason: 'scene-not-ready' });
      return;
    }
    camera.getWorldDirection(direction.current);
    p.enabled.value = 0;
    const reviewEnabled=scene.userData.reviewLightPreset!=='no-floor-reflection';
    scene.userData.floorReflection.requested=reviewEnabled;
    scene.userData.floorReflection.enabled=false;
    scene.userData.floorReflection.cacheHit=false;
    p.mode.value=scene.userData.reviewLightPreset==='reflection-raw'?2:scene.userData.reviewLightPreset==='reflection-legacy'?0:1;
    scene.userData.floorReflection.mode=p.mode.value===2?'raw':p.mode.value===1?'soft-v2':'legacy-v1';
    // R3's polished stone needs a narrower lobe to retain the small planter
    // and pier reflections. Other rooms keep the shared standard finish.
    const botanicalHigh=['final','reflection-r3-polished-high'].includes(scene.userData.reviewLightPreset??'final');
    const botanicalPolish=botanicalHigh||scene.userData.reviewLightPreset==='reflection-r3-polished';
    const botanicalBlur=botanicalPolish||scene.userData.reviewLightPreset==='reflection-r3-blur';
    p.botanicalFinish.value.set(botanicalBlur ? .65 : 1,botanicalHigh ? 1.6 : botanicalPolish ? 1.2 : 1);
    scene.userData.floorReflection.botanicalFinish={blurScale:p.botanicalFinish.value.x,reflectionGain:p.botanicalFinish.value.y};
    if(!reviewEnabled){p.cache.valid=false;scene.userData.floorReflection.skipReason='review-disabled';return;}
    // The upward detail cameras cannot see the floor. Keep the demand loop idle
    // and avoid sampling the render target while it is the active attachment.
    if (direction.current.y > .6 || camera.position.y <= .01) {p.cache.valid=false;scene.userData.floorReflection.skipReason='outside-floor-view';return;}
    camera.updateMatrixWorld();
    const target = p.mirror.getRenderTarget(), cache = p.cache;
    // Scene geometry is static. Dynamic content must increment reflectionRevision
    // on committed map/hover changes, LOD changes, and visible video frames or
    // seeking/pause completion. Cache inspection itself never invalidates Fiber.
    const inputs = [
      target.width, target.height, camera.uuid, camera.layers.mask,
      scene.userData.reflectionRevision ?? 0, scene.userData.reviewLightPreset ?? 'final',
      scene.userData.reviewVertexAOEnabled ?? true, scene.userData.reviewAOEnabled ?? true,
      scene.background, (scene.background as Texture | null)?.version,
      scene.backgroundIntensity, scene.backgroundBlurriness,
      scene.backgroundRotation.x, scene.backgroundRotation.y, scene.backgroundRotation.z,
      scene.environment, scene.environment?.version, scene.environmentIntensity,
      scene.environmentRotation.x, scene.environmentRotation.y, scene.environmentRotation.z,
      gl.toneMapping, gl.toneMappingExposure, gl.shadowMap.enabled, gl.shadowMap.type,
    ];
    const shadowRefresh = gl.shadowMap.enabled && (gl.shadowMap.needsUpdate || gl.shadowMap.autoUpdate);
    const refreshReason = !cache.valid ? 'uncached'
      : shadowRefresh ? 'shadow-refresh'
      : !cache.cameraWorld.equals(camera.matrixWorld) ? 'camera-world'
      : !cache.cameraProjection.equals(camera.projectionMatrix) ? 'camera-projection'
      : inputs.some((value, index) => value !== cache.inputs[index]) ? 'scene-inputs' : null;
    if (!refreshReason) {
      cache.hits++;
      p.sampler.value = target.texture;
      p.depthSampler.value = p.reflectionDepth;
      p.enabled.value = 1;
      Object.assign(scene.userData.floorReflection, {
        enabled: true, skipReason: null, cacheHit: true, cacheHits: cache.hits, renderCount: cache.renders, refreshReason: null,
      });
      (scene.userData.renderPasses ??= {}).reflection = { calls: 0, triangles: 0, cpuSubmissionMs: 0, shadowUpdate: false, cached: true };
      return;
    }
    cache.valid = false;
    p.sampler.value = p.fallback;
    p.depthSampler.value=p.fallback;
    scene.updateMatrixWorld();
    const calls=gl.info.render.calls,triangles=gl.info.render.triangles,start=performance.now(),shadowUpdate=gl.shadowMap.needsUpdate;
    p.mirror.onBeforeRender(gl, scene, camera, p.mirror.geometry, p.mirror.material as ShaderMaterial, null as never);
    (scene.userData.renderPasses??={}).reflection={calls:gl.info.render.calls-calls,triangles:gl.info.render.triangles-triangles,cpuSubmissionMs:performance.now()-start,shadowUpdate,cached:false};
    p.matrix.copy((p.mirror.material as ShaderMaterial).uniforms.textureMatrix.value).multiply(p.inverse);
    p.sampler.value = p.mirror.getRenderTarget().texture;
    p.depthSampler.value=p.reflectionDepth;
    p.enabled.value = 1;
    // Commit only after the real mirror render and texture matrix update succeed.
    cache.cameraWorld.copy(camera.matrixWorld);
    cache.cameraProjection.copy(camera.projectionMatrix);
    cache.inputs = inputs;
    cache.valid = true;
    cache.renders++;
    Object.assign(scene.userData.floorReflection, {
      enabled: true, skipReason: null, cacheHit: false, cacheHits: cache.hits, renderCount: cache.renders, refreshReason,
    });
  }, .5);
  return null;
}

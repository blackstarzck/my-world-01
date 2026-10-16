import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { AgXToneMapping, HalfFloatType, NoToneMapping, WebGLRenderTarget } from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { galleryStage } from './gallery-performance';
import { galleryReviewEnabled } from './gallery-diagnostics';
import { installGalleryContactAOCache } from './GalleryContactAOCache';
import { createGalleryEffectPreparation } from './GalleryEffectPreparation.mjs';

// A small world-space AO radius describes the contact between the modeled
// moldings and plaster, rather than outlining the whole building in black.
export function GalleryEffects({ mobile, baked }: { mobile: boolean; baked: boolean }) {
  const { gl, scene, camera, size, invalidate } = useThree();
  const pipeline = useRef<{ composer: EffectComposer; ao: GTAOPass; aoCache: ReturnType<typeof installGalleryContactAOCache> } | null>(null);
  const priorAutoReset = useRef(true);

  useEffect(() => {
    const target = new WebGLRenderTarget(1, 1, { type: HalfFloatType, samples: mobile ? 0 : 2 });
    const composer = new EffectComposer(gl, target);
    const render = new RenderPass(scene, camera);
    const ao = new GTAOPass(scene, camera);
    const aoCache = installGalleryContactAOCache(ao, gl, invalidate);
    const output = new OutputPass();
    for (const [name, pass] of [['color', render], ['contactAO', ao]] as const) {
      const draw = pass.render.bind(pass);
      pass.render = (...args) => {
        const calls = gl.info.render.calls, triangles = gl.info.render.triangles, start = performance.now();
        try { draw(...args); } finally {
          (scene.userData.renderPasses ??= {})[name] = {calls: gl.info.render.calls - calls, triangles: gl.info.render.triangles - triangles, cpuSubmissionMs: performance.now() - start};
        }
      };
    }
    ao.updateGtaoMaterial({ radius: .7, thickness: .8, distanceExponent: 2, distanceFallOff: .7, samples: mobile ? 8 : 16, screenSpaceRadius: false });
    ao.updatePdMaterial({ radius: 5, rings: 2, samples: 8, depthPhi: 2, normalPhi: 4 });
    ao.blendIntensity = .8;
    composer.addPass(render);
    composer.addPass(ao);
    composer.addPass(output);
    const preparation = createGalleryEffectPreparation(gl, scene, camera, composer, ao, output);
    scene.userData.galleryEffectPreparation = preparation;
    pipeline.current = { composer, ao, aoCache };
    invalidate();
    return () => {
      pipeline.current = null;
      if(scene.userData.galleryEffectPreparation===preparation)delete scene.userData.galleryEffectPreparation;
      preparation.dispose();
      aoCache.dispose();
      ao.dispose();
      // Three r180 omits these two owned materials from GTAOPass.dispose().
      ao.gtaoMaterial.dispose();
      ao.blendMaterial.dispose();
      output.dispose();
      render.dispose();
      composer.dispose();
    };
  }, [gl, scene, camera, mobile, invalidate]);

  useEffect(() => {
    const p = pipeline.current;
    if (!p) return;
    // Full Cycles color bakes already contain their display transform.
    // Applying another filmic curve would flatten them and dull the artwork.
    gl.toneMapping = baked ? NoToneMapping : AgXToneMapping;
    gl.toneMappingExposure = baked ? 1 : .82;
    const ratio = Math.min(gl.getPixelRatio(), mobile ? 1 : 1.35);
    p.composer.setPixelRatio(ratio);
    p.composer.setSize(size.width, size.height);
    p.ao.setSize(Math.round(size.width * ratio * .75), Math.round(size.height * ratio * .75));
    p.ao.enabled = !baked && (scene.userData.reviewAOEnabled??true);
    scene.userData.reviewAOPassEnabled=p.ao.enabled;
    invalidate();
  }, [gl, scene, size.width, size.height, mobile, baked, invalidate]);

  useEffect(()=>{
    if(!galleryReviewEnabled)return;
    const toggle=(event:Event)=>{const enabled=(event as CustomEvent<boolean>).detail; if(pipeline.current)pipeline.current.ao.enabled=enabled&&!baked;scene.userData.reviewAOEnabled=enabled;scene.userData.reviewAOPassEnabled=enabled&&!baked;invalidate();};
    window.addEventListener('gallery-review-ao',toggle);
    return()=>window.removeEventListener('gallery-review-ao',toggle);
  },[baked,scene,invalidate]);

  // Start counters before the shared floor reflection (priority .5), so the
  // diagnostic total includes its geometry and draw calls as well as the AO.
  useFrame(({ gl: renderer }) => {
    priorAutoReset.current = renderer.info.autoReset;
    renderer.info.autoReset = false;
    renderer.info.reset();
    scene.userData.renderPasses = {};
  }, .25);

  // Positive priority takes over only an already-requested Fiber frame. No
  // invalidation here: the gallery still sleeps after camera/media activity.
  useFrame((state, delta) => {
    const p = pipeline.current;
    try {
      if (scene.userData.renderReady !== true) {p?.aoCache.invalidate('scene-not-ready');return;}
      if (p) p.composer.render(delta);
      else state.gl.render(state.scene, state.camera);
      const firstFrameReady = scene.userData.galleryFirstRenderReady;
      delete scene.userData.galleryFirstRenderReady;
      if (typeof firstFrameReady === 'function') firstFrameReady();
      if (scene.userData.perfReadyRecorded && !scene.userData.perfFirstReadySubmitted) {
        scene.userData.perfFirstReadySubmitted = true;
        galleryStage('first-ready-render-submitted');
      }
    } finally { state.gl.info.autoReset = priorAutoReset.current; }
  }, 1);
  return null;
}

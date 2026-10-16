import { Matrix4, NoBlending } from 'three';
import type { ShaderMaterial, WebGLRenderer, WebGLRenderTarget } from 'three';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';

// Narrow adapter for installed Three 0.180.0. Its declaration file still names
// renderPass without the underscore, but the actual GTAOPass uses _renderPass.
// Recheck GTAOPass.render's OUTPUT.Default branch when upgrading Three.
type InternalGTAOPass = GTAOPass & {
  _renderGBuffer: boolean;
  normalRenderTarget: WebGLRenderTarget;
  _renderPass: (renderer: WebGLRenderer, material: ShaderMaterial, target: WebGLRenderTarget | null) => void;
};

export type GalleryContactAOCacheDiagnostics = {
  version: 'three-r180-geometry-cache-v1';
  active: boolean;
  valid: boolean;
  cacheHit: boolean;
  hits: number;
  updates: number;
  bypasses: number;
  invalidations: number;
  reason: string;
};

/** Install before the pass.render performance wrapper so its counters include
 * the two compositing draws on a cache hit. Dispose this adapter before ao.dispose().
 * The owner increments scene.userData.geometryRevision for LOD, artwork size,
 * object transform/visibility or geometry changes. Color/video/light changes do
 * not alter the GBuffer. Call invalidate('scene-not-ready') when gating the whole
 * composer, because a pass which is never called cannot observe that transition.
 */
export function installGalleryContactAOCache(ao: GTAOPass, gl: WebGLRenderer, invalidateFrame: () => void) {
  const pass = ao as InternalGTAOPass, scene = ao.scene;
  const previousRender = ao.render, previousSetSize = ao.setSize;
  const cameraWorld = new Matrix4(), cameraProjection = new Matrix4();
  let live = true, valid = false, contextLost = false;
  let inputs: unknown[] = [];
  const diagnostics: GalleryContactAOCacheDiagnostics = {
    version: 'three-r180-geometry-cache-v1', active: true, valid: false, cacheHit: false,
    hits: 0, updates: 0, bypasses: 0, invalidations: 0, reason: 'uninitialized',
  };
  scene.userData.contactAOCache = diagnostics;

  const invalidate = (reason = 'explicit') => {
    if (!live) return;
    valid = false; diagnostics.valid = false; diagnostics.cacheHit = false;
    diagnostics.invalidations++; diagnostics.reason = reason;
  };
  const readInputs = () => {
    const camera = ao.camera as typeof ao.camera & { near?: number; far?: number };
    const g = ao.gtaoMaterial.uniforms, p = ao.pdMaterial.uniforms;
    return [
      ao.camera, camera.layers.mask, camera.near, camera.far, ao.width, ao.height,
      scene.userData.geometryRevision ?? 0,
      ao.gtaoMaterial, ao.gtaoMaterial.version, ao.pdMaterial, ao.pdMaterial.version,
      ao.normalMaterial, ao.normalMaterial.version,
      pass.normalRenderTarget, pass.normalRenderTarget?.width, pass.normalRenderTarget?.height,
      ao.gtaoRenderTarget, ao.pdRenderTarget, ao.pdRenderTarget.width, ao.pdRenderTarget.height,
      ao.normalTexture, ao.normalTexture?.version, ao.depthTexture, ao.depthTexture?.version,
      ao.gtaoNoiseTexture, ao.gtaoNoiseTexture.version, ao.pdNoiseTexture, ao.pdNoiseTexture.version,
      // Several public parameter setters change only uniforms, not material.version.
      g.radius?.value, g.distanceExponent?.value, g.thickness?.value,
      g.distanceFallOff?.value, g.scale?.value,
      g.sceneBoxMin?.value?.x, g.sceneBoxMin?.value?.y, g.sceneBoxMin?.value?.z,
      g.sceneBoxMax?.value?.x, g.sceneBoxMax?.value?.y, g.sceneBoxMax?.value?.z,
      p.lumaPhi?.value, p.depthPhi?.value, p.normalPhi?.value, p.radius?.value,
      ao.pdRings, ao.pdRadiusExponent, ao.pdSamples,
    ];
  };

  const render: GTAOPass['render'] = function (renderer, writeBuffer, readBuffer, deltaTime, maskActive) {
    if (!live) return previousRender.call(ao, renderer, writeBuffer, readBuffer, deltaTime, maskActive);
    diagnostics.cacheHit = false;
    if (contextLost || scene.userData.renderReady !== true) {
      invalidate(contextLost ? 'context-lost' : 'scene-not-ready');
      return;
    }
    const supported = renderer === gl && ao.scene === scene && ao.output === GTAOPass.OUTPUT.Default
      && pass._renderGBuffer === true && !maskActive && typeof pass._renderPass === 'function';
    if (!supported) {
      invalidate('unsupported-output-or-gbuffer'); diagnostics.bypasses++;
      return previousRender.call(ao, renderer, writeBuffer, readBuffer, deltaTime, maskActive);
    }
    ao.camera.updateMatrixWorld();
    const next = readInputs();
    const reason = !valid ? diagnostics.reason
      : !cameraWorld.equals(ao.camera.matrixWorld) ? 'camera-world'
      : !cameraProjection.equals(ao.camera.projectionMatrix) ? 'camera-projection'
      : next.length !== inputs.length || next.some((value, i) => value !== inputs[i]) ? 'geometry-or-parameters' : null;
    if (reason !== null) {
      valid = false; diagnostics.valid = false;
      previousRender.call(ao, renderer, writeBuffer, readBuffer, deltaTime, maskActive);
      // Commit after success, including versions changed by initial target allocation.
      cameraWorld.copy(ao.camera.matrixWorld); cameraProjection.copy(ao.camera.projectionMatrix);
      inputs = readInputs(); valid = true; diagnostics.valid = true;
      diagnostics.updates++; diagnostics.reason = reason;
      return;
    }
    try {
      // Exact OUTPUT.Default compositing path from Three r180. Always copy this
      // frame's readBuffer, then multiply the cached denoised AO with current
      // blendIntensity; do not reuse scene color or the complete output frame.
      const target = ao.renderToScreen ? null : writeBuffer;
      ao.copyMaterial.uniforms.tDiffuse.value = readBuffer.texture;
      ao.copyMaterial.blending = NoBlending;
      pass._renderPass(renderer, ao.copyMaterial, target);
      ao.blendMaterial.uniforms.intensity.value = ao.blendIntensity;
      ao.blendMaterial.uniforms.tDiffuse.value = ao.pdRenderTarget.texture;
      pass._renderPass(renderer, ao.blendMaterial, target);
      diagnostics.hits++; diagnostics.cacheHit = true; diagnostics.reason = 'geometry-unchanged';
    } catch (error) {
      invalidate('composite-failed');
      throw error;
    }
  };
  const setSize: GTAOPass['setSize'] = function (width, height) {
    invalidate('resize');
    return previousSetSize.call(ao, width, height);
  };
  const lost = () => { contextLost = true; invalidate('context-lost'); };
  const restored = () => { if (live) { contextLost = false; invalidate('context-restored'); invalidateFrame(); } };
  gl.domElement.addEventListener('webglcontextlost', lost);
  gl.domElement.addEventListener('webglcontextrestored', restored);
  ao.render = render; ao.setSize = setSize;

  return {
    diagnostics,
    invalidate,
    dispose() {
      if (!live) return;
      live = false; valid = false;
      gl.domElement.removeEventListener('webglcontextlost', lost);
      gl.domElement.removeEventListener('webglcontextrestored', restored);
      if (ao.render === render) ao.render = previousRender;
      if (ao.setSize === setSize) ao.setSize = previousSetSize;
      diagnostics.active = false; diagnostics.valid = false; diagnostics.cacheHit = false; diagnostics.reason = 'disposed';
      if (scene.userData.contactAOCache === diagnostics) delete scene.userData.contactAOCache;
      // No texture/material/target ownership: GTAOPass disposes its own resources.
      // A later wrapper retaining render/setSize forwards through this inactive adapter.
    },
  };
}

import type { LOD, Object3D, Scene, WebGLRenderer } from 'three';

type ShadowRender = WebGLRenderer['shadowMap']['render'];
type HolderState = { object: Object3D; visible: boolean };
type DetailGroup = { lod: LOD; holders: Object3D[]; near: Object3D };

export type GalleryStaticDetailShadowOptions = {
  /** The demand renderer's invalidate function; never creates a continuous loop. */
  requestFrame?: () => void;
};

/** Keep static architectural shadows independent of camera-distance detail.
 *
 * Narrow Three r180 / 0.180.0 adapter: WebGLRenderer builds its COLOR render list
 * before calling shadowMap.render(). WebGLShadowMap then traverses the scene
 * independently, respecting holder.visible without updating LODs. Therefore only
 * this depth-call scope may select near holders. Selecting them around gl.render
 * would incorrectly replace color/reflection LODs as well.
 *
 * Install after the complete model and prepareDetailLOD() holders are attached.
 * Their visibility belongs exclusively to LOD selection. Ancestor visibility,
 * mesh visibility, castShadow, transforms, materials, geometry, getCurrentLevel()
 * and autoUpdate are never modified. Existing visibility culling MUST continue
 * to leave all room casters present on a real shadow-refresh render.
 *
 * Integration contract: do not mark shadows dirty for camera-only LOD changes.
 * Actual model membership, caster transform/visibility/alpha and light/shadow
 * changes must keep their existing needsUpdate producers or call invalidate().
 * Color/reflection/AO LOD and revision producers remain unchanged. Reinstall on
 * model replacement. This helper does not infer arbitrary scene mutations.
 */
export function installGalleryStaticDetailShadows(
  renderer: WebGLRenderer,
  scene: Scene,
  options: GalleryStaticDetailShadowOptions = {},
) {
  const shadowMap = renderer.shadowMap;
  const previousRender = shadowMap.render;
  const groups: DetailGroup[] = [];
  const seenHolders = new Set<Object3D>();
  const skippedGroups: { name: string; reason: string }[] = [];
  scene.traverse(object => {
    const lod = object as LOD;
    if (!lod.isLOD || !lod.userData.fidelityLOD) return;
    const levels = lod.levels;
    const holders = levels.map(level => level.object);
    if (lod.autoUpdate || levels.length < 2 || levels[0].distance !== 0
      || new Set(holders).size !== holders.length
      || holders.some(holder => holder.parent !== lod || seenHolders.has(holder))) {
      skippedGroups.push({ name: lod.name, reason: 'unsupported-or-shared-detail-holders' });
      return;
    }
    holders.forEach(holder => seenHolders.add(holder));
    groups.push({ lod, holders, near: levels[0].object });
  });

  let live = true;
  let pendingReason = 'installation';
  const scopes: (() => void)[] = [];
  const diagnostic = {
    version: 'near-detail-depth-v1', threeVersion: '0.180.0',
    active: true, state: 'installed', groups: groups.length,
    holders: seenHolders.size, skippedGroups,
    safeToIgnoreDetailLODChanges: groups.length > 0 && skippedGroups.length === 0,
    depthScopes: 0, nestedScopes: 0, restores: 0, failures: 0,
    invalidations: 0, lastInvalidationReason: 'installation',
    lastRefreshReason: '', lastCamera: '', lastLightCount: 0,
    lastCalls: 0, lastTriangles: 0, lastCpuSubmissionMs: 0,
    firstRefreshCpuSubmissionMs: null as number | null,
    policy: 'highest-exported-detail-for-shadow-depth-only',
  };
  scene.userData.staticDetailShadow = diagnostic;

  const render: ShadowRender = function (lights, renderScene, camera) {
    if (!live || renderScene !== scene || !shadowMap.enabled
      || (!shadowMap.autoUpdate && !shadowMap.needsUpdate) || !lights.length) {
      return previousRender.call(shadowMap, lights, renderScene, camera);
    }
    // Avoid changing any visibility when Three would skip every light anyway.
    const updatingLights = lights.filter(light => {
      const shadow = (light as typeof light & { shadow?: { autoUpdate: boolean; needsUpdate: boolean } }).shadow;
      return shadow && (shadow.autoUpdate || shadow.needsUpdate);
    });
    if (!updatingLights.length) return previousRender.call(shadowMap, lights, renderScene, camera);

    const saved: HolderState[] = [];
    let restored = false;
    const restore = () => {
      if (restored) return;
      restored = true;
      for (let i = saved.length - 1; i >= 0; i--) saved[i].object.visible = saved[i].visible;
      diagnostic.restores++;
    };
    const calls = renderer.info.render.calls, triangles = renderer.info.render.triangles;
    const started = performance.now();
    const firstRefresh = diagnostic.depthScopes === 0;
    diagnostic.depthScopes++;
    if (scopes.length) diagnostic.nestedScopes++;
    scopes.push(restore);
    diagnostic.state = 'rendering-shadow-depth';
    diagnostic.lastRefreshReason = pendingReason || (shadowMap.autoUpdate ? 'automatic-shadow-update' : 'external-needs-update');
    diagnostic.lastCamera = camera.uuid;
    diagnostic.lastLightCount = updatingLights.length;
    // Consume only this request. An explicit invalidation during the original
    // call is preserved below even though Three clears needsUpdate on success.
    pendingReason = '';
    try {
      for (const group of groups) {
        for (const holder of group.holders) {
          saved.push({ object: holder, visible: holder.visible });
          holder.visible = holder === group.near;
        }
      }
      return previousRender.call(shadowMap, lights, renderScene, camera);
    } catch (error) {
      diagnostic.failures++;
      pendingReason ||= 'failed-shadow-depth';
      throw error;
    } finally {
      restore();
      scopes.pop();
      diagnostic.lastCalls = renderer.info.render.calls - calls;
      diagnostic.lastTriangles = renderer.info.render.triangles - triangles;
      diagnostic.lastCpuSubmissionMs = performance.now() - started;
      if (firstRefresh) diagnostic.firstRefreshCpuSubmissionMs = diagnostic.lastCpuSubmissionMs;
      if (live && pendingReason) {
        shadowMap.needsUpdate = true;
        for (const light of updatingLights) {
          const shadow = (light as typeof light & { shadow?: { needsUpdate: boolean } }).shadow;
          if (shadow) shadow.needsUpdate = true;
        }
      }
      diagnostic.state = live ? 'restored' : 'disposed';
    }
  };
  shadowMap.render = render;

  const invalidate = (reason: string) => {
    if (!live) return;
    pendingReason = reason;
    diagnostic.invalidations++;
    diagnostic.lastInvalidationReason = reason;
    shadowMap.needsUpdate = true;
    // The current rig leaves per-light autoUpdate enabled. Also support a
    // deliberate static per-light policy without silently ignoring invalidation.
    scene.traverse(object => {
      const light = object as Object3D & { isLight?: boolean; shadow?: { needsUpdate: boolean } };
      if (light.isLight && light.shadow) light.shadow.needsUpdate = true;
    });
    options.requestFrame?.();
  };
  const contextRestored = () => invalidate('webgl-context-restored');
  renderer.domElement.addEventListener('webglcontextrestored', contextRestored);
  // A pre-existing map may have been rendered using distance-selected holders.
  // Request one complete near-detail map; do not clear an existing dirty request.
  invalidate('installation');

  return {
    diagnostics: diagnostic,
    invalidate,
    dispose() {
      if (!live) return;
      live = false;
      // If teardown is triggered synchronously by a shadow callback, unwind
      // inner scopes before outer ones. Their later finally calls are no-ops.
      for (const restore of [...scopes].reverse()) restore();
      renderer.domElement.removeEventListener('webglcontextrestored', contextRestored);
      // A newer wrapper may have captured this one. Leave that wrapper in place;
      // our inactive closure simply forwards, preserving StrictMode ownership.
      if (shadowMap.render === render) shadowMap.render = previousRender;
      diagnostic.active = false;
      diagnostic.state = 'disposed';
      if (scene.userData.staticDetailShadow === diagnostic) delete scene.userData.staticDetailShadow;
    },
  };
}

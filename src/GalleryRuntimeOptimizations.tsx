import { useLayoutEffect } from 'react';
import { useThree } from '@react-three/fiber';
import type { Camera, Material, MeshPhysicalMaterial, WebGLRenderer } from 'three';
import { createGalleryVisibility } from './GalleryVisibility.mjs';
import type { GalleryVisibilityLayout } from './GalleryVisibility.mjs';
import { installGalleryStaticDetailShadows } from './GalleryStaticDetailShadows';

type VisibilityProps = {
  layout: GalleryVisibilityLayout;
  /** Change when the attached model/artwork objects change; camera motion needs no reset. */
  resetKey?: string | number;
  enabled?: boolean;
};

/** Mount after the model and artwork meshes are attached to the Fiber scene. */
export function GalleryRuntimeOptimizations({ layout, resetKey, enabled = true }: VisibilityProps) {
  const { gl, scene, invalidate } = useThree();
  useLayoutEffect(() => {
    if (!enabled) return;
    const controller = createGalleryVisibility(scene, layout);
    const detailShadows = installGalleryStaticDetailShadows(gl, scene, { requestFrame: invalidate });
    const previousRender = gl.render;
    let live = true;
    const scopes: { camera: Camera; culled: boolean; restore: () => void }[] = [];
    const diagnostic = {
      ...controller.diagnostics,
      active: true, state: 'installed', renders: 0, culledRenders: 0,
      shadowRefreshSkips: 0, nestedRenders: 0, failures: 0,
      camera: '', renderTarget: false, overrideMaterial: false,
    };
    scene.userData.galleryVisibility = diagnostic;

    const render: WebGLRenderer['render'] = function (renderScene, camera) {
      // Fullscreen postprocessing scenes and stale wrappers in somebody else's
      // wrapper chain keep their original behavior.
      if (!live || renderScene !== scene) return previousRender.call(gl, renderScene, camera);
      const parent = scopes[scopes.length - 1];
      // A nested reflection must see its own room set, not the outer camera's
      // temporary hides. Restore the parent first, and resume it in finally.
      parent?.restore();
      const shadowRefresh = gl.shadowMap.enabled && (gl.shadowMap.needsUpdate || gl.shadowMap.autoUpdate);
      const scope = { camera, culled: !shadowRefresh, restore: () => {} };
      scopes.push(scope);
      diagnostic.renders++;
      if (parent) diagnostic.nestedRenders++;
      try {
        if (shadowRefresh) {
          diagnostic.shadowRefreshSkips++;
          Object.assign(diagnostic, {
            visibleRooms: ['C0', ...layout.rooms.map(room => room.id)], currentRoom: null,
            reason: 'shadow-refresh', fallback: true, hidden: 0,
          });
        } else {
          scope.restore = controller.apply(camera);
          Object.assign(diagnostic, controller.diagnostics);
          diagnostic.culledRenders++;
        }
        diagnostic.camera = camera.uuid;
        diagnostic.renderTarget = gl.getRenderTarget() !== null;
        diagnostic.overrideMaterial = scene.overrideMaterial !== null;
        diagnostic.state = 'rendering';
        return previousRender.call(gl, renderScene, camera);
      } catch (error) {
        diagnostic.failures++;
        throw error;
      } finally {
        scope.restore();
        scopes.pop();
        if (parent?.culled && live) parent.restore = controller.apply(parent.camera);
        diagnostic.state = live ? 'restored' : 'disposed';
      }
    };
    gl.render = render;
    return () => {
      live = false;
      detailShadows.dispose();
      controller.dispose();
      // Never overwrite a newer integration's wrapper. If it captured ours,
      // the inactive wrapper above simply forwards to its original function.
      if (gl.render === render) gl.render = previousRender;
      diagnostic.active = false;
      diagnostic.state = 'disposed';
      if (scene.userData.galleryVisibility === diagnostic) delete scene.userData.galleryVisibility;
    };
  }, [gl, scene, layout, resetKey, enabled, invalidate]);
  return null;
}

type GlassValues = { transmission: number; transparent: boolean; opacity: number; depthWrite: boolean };
export type ThinRoofGlassChange = {
  name: string;
  uuid: string;
  room: string;
  previous: GlassValues;
  applied: GlassValues;
  thickness: number;
  ior: number;
  roughness: number;
};
export type ThinRoofGlassDiagnostics = {
  approximation: 'thin-roof-alpha-v1';
  changed: ThinRoofGlassChange[];
  skipped: { name: string; reason: string }[];
};
const glassChanges = new WeakMap<Material, ThinRoofGlassChange>();
const glassRooms = new Set(['C0', 'R1', 'R2', 'R3', 'R4']);
const glassValues = (material: MeshPhysicalMaterial): GlassValues => ({
  transmission: material.transmission, transparent: material.transparent,
  opacity: material.opacity, depthWrite: material.depthWrite,
});

/** Candidate approximation, not a physically equivalent material conversion.
 * Pass ONLY the Building's owned clones, never cached GLTFLoader materials.
 * Keep the physical class, environment, tint, roughness, specular and all maps.
 * Zero transmission removes Three's extra opaque-scene transmission pass;
 * alpha .12 supplies the thin tinted surface pending actual visual review.
 */
export function optimizeThinRoofGlass(materials: readonly Material[]): ThinRoofGlassDiagnostics {
  const result: ThinRoofGlassDiagnostics = { approximation: 'thin-roof-alpha-v1', changed: [], skipped: [] };
  for (const source of new Set(materials)) {
    if (source.userData.sourceMaterial !== 'I / thin clear roof glass') continue;
    const material = source as MeshPhysicalMaterial;
    const prior = glassChanges.get(source);
    if (prior) { result.changed.push(prior); continue; }
    if (!material.isMeshPhysicalMaterial || !glassRooms.has(String(material.userData.room_id))) {
      result.skipped.push({ name: source.name, reason: 'not-an-authored-room-physical-glass' }); continue;
    }
    if (material.thickness !== 0 || material.thicknessMap !== null) {
      result.skipped.push({ name: source.name, reason: 'volume-glass-kept' }); continue;
    }
    if (!(material.transmission > 0)) {
      result.skipped.push({ name: source.name, reason: 'already-nontransmissive' }); continue;
    }
    const previous = glassValues(material);
    material.transmission = 0;
    material.transparent = true;
    material.opacity = .12;
    material.depthWrite = false;
    material.needsUpdate = true;
    const change: ThinRoofGlassChange = {
      name: source.name, uuid: source.uuid, room: String(source.userData.room_id), previous,
      applied: glassValues(material), thickness: material.thickness, ior: material.ior, roughness: material.roughness,
    };
    glassChanges.set(source, change);
    result.changed.push(change);
  }
  return result;
}

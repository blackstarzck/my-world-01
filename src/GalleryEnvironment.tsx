import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { EquirectangularReflectionMapping, MeshStandardMaterial, PMREMGenerator, ShaderChunk } from 'three';
import type { Material, Mesh, MeshBasicMaterial, Object3D, WebGLRenderTarget } from 'three';
// Three r180 renamed RGBELoader to HDRLoader; the old name emits a warning.
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { areaLightRooms, materialLightRoom } from './gallery-light-groups';

function localRoomLights(material: MeshStandardMaterial) {
  const room = materialLightRoom(material.userData.environmentURL);
  if (!room) return;
  const indices = areaLightRooms.flatMap((id, i) => id === room ? [i] : []);
  const mask = indices.map(i => `UNROLLED_LOOP_INDEX == ${i}`).join(' || ');
  const directArea = 'RE_Direct_RectArea( rectAreaLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );';
  const bounceAO = material.userData.geometryAOAttribute === '_AO'
    ? 'mix(1.0, clamp(vGalleryAO, 0.0, 1.0), galleryGeometryAOStrength)' : '1.0';
  // These interior panels approximate diffuse wall/ceiling return. Short-range
  // geometry occlusion applies to that return, while direct sun stays intact.
  const bouncedArea = `{
    ReflectedLight galleryBounce = ReflectedLight(vec3(0.0), vec3(0.0), vec3(0.0), vec3(0.0));
    ${directArea.replace('material, reflectedLight', 'material, galleryBounce')}
    reflectedLight.directDiffuse += galleryBounce.directDiffuse * ${bounceAO};
    reflectedLight.directSpecular += galleryBounce.directSpecular * mix(0.5, 1.0, ${bounceAO});
  }`;
  let chunk = ShaderChunk.lights_fragment_begin.replace(directArea, `#if ${mask}\n${bouncedArea}\n#endif`);
  const priorCompile = material.onBeforeCompile, priorKey = material.customProgramCacheKey;
  const key = priorKey.call(material);
  material.onBeforeCompile = function(shader, renderer) {
    priorCompile.call(this, shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_begin>', chunk);
  };
  material.customProgramCacheKey = () => `${key}/room-lights-v2/${room}/${indices.join(',')}`;
  material.userData.localLights = { room, areaIndices: indices, spotLights: 0 };
}

function localHDRURL(value: unknown): string | null {
  return typeof value === 'string' && /^\/environment\/[a-z\d._/-]+\.hdr$/i.test(value) && !value.includes('..') ? value : null;
}

export type AuthoredLightingModel = 'baked-diffuse-probes' | null;

export function authoredLightingModel(scene: Object3D, assetExtras?: Record<string, unknown>): AuthoredLightingModel {
  let mode: unknown = scene.userData.runtimeLightingModel ?? assetExtras?.runtimeLightingModel;
  scene.traverse(object => { mode ??= object.userData.runtimeLightingModel; });
  // Only newly authored candidates opt out of the original fallback rig.
  // Their diffuse illumination and reflection probes share one Blender scene.
  return mode === 'baked-diffuse-probes' ? mode : null;
}

export function reflectionEnvironmentURL(scene: Object3D, assetExtras?: Record<string, unknown>): string | null {
  let url: unknown = scene.userData.environmentURL ?? assetExtras?.environmentURL;
  scene.traverse(object => { url ??= object.userData.environmentURL; });
  // Publication of this explicit metadata is the availability flag. Do not
  // probe guessed files or download an unrelated default environment.
  return localHDRURL(url);
}

function finiteRotationY(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function reflectionEnvironmentRotationY(scene: Object3D, assetExtras?: Record<string, unknown>): number {
  let value: unknown = scene.userData.environmentRotationY ?? assetExtras?.environmentRotationY;
  scene.traverse(object => { value ??= object.userData.environmentRotationY; });
  // Public Three rotation, in radians. Three negates this for shader lookup.
  // Probe camera Rx(pi/2) requires +pi/2; only exporter metadata opts into it.
  return finiteRotationY(value);
}

export function materialEnvironmentURL(material: Material): string | null {
  return localHDRURL(material.userData.environmentURL);
}

export function materialEnvironmentRotationY(material: Material): number {
  return finiteRotationY(material.userData.environmentRotationY);
}

function detailOcclusionReceiver(mesh: Mesh): boolean {
  // Vertex interpolation cannot represent a 0.7 m contact shadow on a tall
  // wall or shaft. Restrict the exported samples to densely modeled details.
  const role=mesh.userData.element_role;
  const name=mesh.name;
  if (role==='capital'||role==='ornament'||role==='molding') return true;
  // V8 supplies fresh short-range samples on its profiled bases, capital
  // bodies and carved spandrels; the old sparse shafts remain excluded.
  if (mesh.userData.fidelity_v8_changed === true && (role==='carving'||role==='pilaster')) return true;
  return /capital-(body|face)|C0-ARCADE-MOLDING|C0-OCULUS-RIM|C0-REUSED-(CARVING|SHELL)|R1_(COFFERED_DOMES|DOME_FOUNDATION_MOLDINGS|ARCH_CARVED_FILLET)/.test(name);
}

export function authoredEnvironmentMaterials(scene: Object3D): MeshStandardMaterial[] {
  const replacements = new Map<string, MeshStandardMaterial>();
  const convert = (material: Material, geometryAO: boolean) => {
    const source = material as MeshStandardMaterial;
    const intensity: unknown = source.userData.environmentIntensity;
    const hasIntensity = typeof intensity === 'number' && Number.isFinite(intensity) && intensity >= 0;
    if (!source.isMeshStandardMaterial || (!hasIntensity && !materialEnvironmentURL(source) && !geometryAO)) return material;
    const key=source.uuid+(geometryAO?'/geometry-ao':'/standard');
    let copy = replacements.get(key);
    if (!copy) {
      // clone() retains the authored emissive/normal/ORM texture references and
      // their UV channels without changing the shared useLoader cache.
      copy = source.clone();
      if (hasIntensity) copy.envMapIntensity = intensity;
      if(geometryAO){
        copy.userData.geometryAOAttribute='_AO';
        const strength={value:1};copy.userData.geometryAOStrength=strength;
        // Short-range occlusion is sampled from this model's real geometry.
        // Keep albedo and direct sunlight intact; attenuate only indirect light.
        copy.onBeforeCompile=shader=>{
          shader.uniforms.galleryGeometryAOStrength=strength;
          shader.vertexShader='attribute float _ao;\nvarying float vGalleryAO;\n'+shader.vertexShader;
          shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvGalleryAO = _ao;');
          shader.fragmentShader='uniform float galleryGeometryAOStrength;\nvarying float vGalleryAO;\n'+shader.fragmentShader;
          shader.fragmentShader=shader.fragmentShader.replace('#include <aomap_fragment>','#include <aomap_fragment>\nfloat galleryAO = mix(1.0, clamp(vGalleryAO, 0.0, 1.0), galleryGeometryAOStrength);\nreflectedLight.indirectDiffuse *= galleryAO;\nreflectedLight.indirectSpecular *= mix(0.5, 1.0, galleryAO);');
        };
        copy.customProgramCacheKey=()=> 'revision-i-geometry-ao-v1/tunable';
      }
      localRoomLights(copy);
      replacements.set(key, copy);
    }
    return copy;
  };
  scene.traverse(object => {
    const mesh = object as Mesh;
    if (!mesh.isMesh) return;
    const geometryAO=mesh.geometry.hasAttribute('_ao')&&detailOcclusionReceiver(mesh);
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(material=>convert(material,geometryAO)) : convert(mesh.material,geometryAO);
  });
  return [...replacements.values()];
}

export function reflectiveBakedFloors(scene: Object3D): MeshStandardMaterial[] {
  const replacements = new Map<Material, MeshStandardMaterial>();
  const convert = (material: Material) => {
    const source = material as MeshBasicMaterial;
    if (!source.isMeshBasicMaterial || !source.map || !/^BAKED\s*\/\s*[^/]+_FLOOR(?:$|[ .])/i.test(source.name)) return material;
    const existing = replacements.get(source);
    if (existing) return existing;
    const floor = new MeshStandardMaterial({
      name: source.name, color: 0x000000, metalness: 0, roughness: .38,
      emissive: source.color, emissiveMap: source.map, emissiveIntensity: 1,
      envMapIntensity: .42, side: source.side, transparent: source.transparent,
      opacity: source.opacity, alphaTest: source.alphaTest, alphaMap: source.alphaMap,
      vertexColors: source.vertexColors, depthWrite: source.depthWrite,
    });
    floor.userData = { ...source.userData, lightingBaked: true, bakedFloorReflection: true };
    // GLTF unlit multiplies the atlas by any vertex color. Preserve that term
    // in the emissive contribution as well, rather than losing baked tint.
    if (source.vertexColors) {
      floor.onBeforeCompile = shader => {
        shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n#if defined(USE_COLOR) || defined(USE_COLOR_ALPHA)\n totalEmissiveRadiance *= vColor.rgb;\n#endif');
      };
      floor.customProgramCacheKey = () => 'baked-floor-emissive-vertex-color-v1';
    }
    replacements.set(source, floor);
    return floor;
  };
  scene.traverse(object => {
    const mesh = object as Mesh;
    if (!mesh.isMesh) return;
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(convert) : convert(mesh.material);
  });
  return [...replacements.values()];
}

export function GalleryEnvironment({ url, rotationY, materials, onFailure }: { url: string | null; rotationY: number; materials: MeshStandardMaterial[]; onFailure:()=>void }) {
  const { gl, scene, invalidate } = useThree();
  useEffect(() => {
    const groups = new Map<string, MeshStandardMaterial[]>();
    for (const material of materials) {
      const probe = materialEnvironmentURL(material);
      if (!probe) continue;
      const group = groups.get(probe) ?? [];
      group.push(material);
      groups.set(probe, group);
    }
    // The scene fallback and all matching material overrides share one HDR
    // request and one PMREM texture per URL for this model instance.
    const urls = new Set([...groups.keys(), ...(url ? [url] : [])]);
    if (!urls.size) return;
    let live = true;
    let pending = urls.size;
    const targets = new Map<string, WebGLRenderTarget>();
    const previousMaps = new Map(materials.map(material => [material, { map: material.envMap, rotation: material.envMapRotation.clone() }]));
    const previous = scene.environment;
    const previousRotation = scene.environmentRotation.clone();
    const pmrem = new PMREMGenerator(gl);
    type PreparationTiming = { requestStartedMs: number; hdrDecodedAtMs?: number; pmremCPUMs?: number; readyAtMs?: number };
    const states: Record<string, { url: string; state: 'loading' | 'ready' | 'failed'; materials: string[]; rotationY?: number; materialRotations: { name: string; rotationY: number }[]; width?: number; height?: number; message?: string; preparationTiming?: PreparationTiming }> = {};
    scene.userData.materialEnvironmentStatus = states;
    const status = (probe: string, state: 'loading' | 'ready' | 'failed', detail: { width?: number; height?: number; message?: string; preparationTiming?: PreparationTiming } = {}) => {
      const group = groups.get(probe) ?? [];
      states[probe] = { url: probe, state, materials: group.map(material => material.name), rotationY: probe === url ? rotationY : undefined, materialRotations: group.map(material => ({ name: material.name, rotationY: materialEnvironmentRotationY(material) })), ...detail };
      if (probe === url) scene.userData.environmentStatus = states[probe];
    };
    const settled = () => { if (--pending === 0) pmrem.dispose(); invalidate(); };
    for (const probe of urls) {
      const preparationTiming: PreparationTiming = { requestStartedMs: performance.now() };
      status(probe, 'loading', { preparationTiming });
      new HDRLoader().load(probe, hdr => {
        if (!live) { hdr.dispose(); return; }
        preparationTiming.hdrDecodedAtMs = performance.now();
        try {
          hdr.mapping = EquirectangularReflectionMapping;
          const pmremStart = performance.now();
          const target = pmrem.fromEquirectangular(hdr);
          preparationTiming.pmremCPUMs = performance.now() - pmremStart;
          targets.set(probe, target);
          target.texture.userData.environmentURL = probe;
          if (probe === url) {
            scene.environment = target.texture;
            scene.environmentRotation.set(0, rotationY, 0);
          }
          for (const material of groups.get(probe) ?? []) {
            material.envMap = target.texture;
            // Shared HDR/PMREM data can serve materials with independent
            // rotations. The cached glTF material and HDR pixels stay intact.
            material.envMapRotation.set(0, materialEnvironmentRotationY(material), 0);
            material.needsUpdate = true;
          }
          preparationTiming.readyAtMs = performance.now();
          status(probe, 'ready', { width: hdr.image.width, height: hdr.image.height, preparationTiming });
        } catch (error) {
          status(probe, 'failed', { message: String(error) });
          onFailure();
        } finally {
          hdr.dispose();
          settled();
        }
      }, undefined, error => {
        if (!live) return;
        status(probe, 'failed', { message: String(error) });
        onFailure();
        settled();
      });
    }
    return () => {
      live = false;
      if (url && scene.environment === targets.get(url)?.texture) {
        scene.environment = previous;
        scene.environmentRotation.copy(previousRotation);
      }
      for (const [probe, group] of groups) for (const material of group) {
        if (material.envMap === targets.get(probe)?.texture) {
          const original = previousMaps.get(material);
          material.envMap = original?.map ?? null;
          if (original) material.envMapRotation.copy(original.rotation);
          material.needsUpdate = true;
        }
      }
      for (const target of targets.values()) target.dispose();
      pmrem.dispose();
      if (url && scene.userData.environmentStatus === states[url]) delete scene.userData.environmentStatus;
      if (scene.userData.materialEnvironmentStatus === states) delete scene.userData.materialEnvironmentStatus;
    };
  }, [url, rotationY, materials, gl, scene, invalidate, onFailure]);
  return null;
}

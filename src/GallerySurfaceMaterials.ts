import { DataTexture, LinearFilter, LinearMipmapLinearFilter, NoColorSpace, RepeatWrapping, RGBAFormat, SRGBColorSpace, UnsignedByteType } from 'three';
import type { MeshStandardMaterial, Texture } from 'three';
import { getGallerySurfacePixels } from './GallerySurfacePixelLoader';

type SurfaceKind = 'limestone' | 'plaster' | 'terracotta' | 'jade' | 'floor' | 'oak' | 'brass' | 'foliage';
type TextureKind = 'stone' | 'limestone-cut' | 'botanical-floor' | 'clay' | 'clay-trowel' | 'jade' | 'oak' | 'foliage';
type SurfaceProfile = { kind: SurfaceKind; macro: number; grain: number; roughness: number; roughnessVariation: number; vein: number };

/** Values are intentionally independent of the light rig and environment gain. */
export const SURFACE_FIDELITY_TUNING = Object.freeze({
  version: 'reference-surface-v4.6',
  textureSize: 512,
  limestoneVariation: .06,
  cutLimestoneVariation: .12,
  cutLimestoneRoughnessVariation: .055,
  cutLimestoneBumpMetres: .00065,
  botanicalStoneBumpMetres: .00030,
  ivoryRoomStoneRoughness: .36,
  plasterVariation: .035,
  terracottaVariation: .025,
  terracottaTextureScale: 2,
  terracottaDiffuseRed: .92,
  terracottaDiffuseGreen: .97,
  terracottaDiffuseBlue: .78,
  terracottaTrowelVariation: .20,
  terracottaTrowelBumpMetres: .0012,
  jadeVariation: .18,
  jadeVeinStrength: .82,
  jadeFractureScale: 3.2,
  oakGrainStrength: .28,
  limestoneBumpMetres: .0012,
  plasterBumpMetres: .0008,
  terracottaBumpMetres: .0022,
  oakBumpMetres: .00018,
  foliageBumpMetres: .00045,
  brassRoughness: .4,
  jadeRoomBrassRoughness: .36,
  jadeRoomBrassReflectanceGain: 1.6,
  jadeRoomBrassReflectanceGreenGain: 1.8,
  jadeRoomBrassReflectanceBlueGain: 1.65,
  jadeRoomBrassEnvironment: .9,
  stoneFloorRoughness: .205,
  botanicalFloorRoughness: .19,
  botanicalFloorVariation: .18,
  botanicalFloorDiffuseRed: .91,
  botanicalFloorDiffuseGreen: .89,
  botanicalFloorDiffuseBlue: .86,
  woodFloorRoughness: .205,
});

export type SurfaceMaterialTuning = Partial<Omit<typeof SURFACE_FIDELITY_TUNING, 'version' | 'textureSize'>>;

function sourceProfile(material: MeshStandardMaterial, tuning: typeof SURFACE_FIDELITY_TUNING): SurfaceProfile | null {
  // Select the exported source identity rather than broad name matching. This
  // also works for geometry re-exported from the revised Blender scene.
  const source = material.userData.sourceMaterial;
  if (typeof source !== 'string') return null;
  const common = { grain: .018, roughnessVariation: .035, vein: 0 };
  if (source === 'I / ivory carved limestone') {
    const cutStone = ['R1', 'R3', 'R4'].includes(material.userData.room_id);
    return { ...common, kind: 'limestone', macro: cutStone ? tuning.cutLimestoneVariation : tuning.limestoneVariation,
      roughness: material.userData.room_id === 'R1' ? tuning.ivoryRoomStoneRoughness : .40,
      roughnessVariation: cutStone ? tuning.cutLimestoneRoughnessVariation : common.roughnessVariation };
  }
  if (source === 'I / warm mineral plaster') return { ...common, kind: 'plaster', macro: tuning.plasterVariation, roughness: .67, roughnessVariation: .06 };
  if (source === 'I / terracotta lime plaster') return { ...common, kind: 'terracotta', macro: tuning.terracottaVariation, grain: .012, roughness: .74, roughnessVariation: .04 };
  if (source === 'I / deep jade marble') return { ...common, kind: 'jade', macro: tuning.jadeVariation, roughness: .225, vein: tuning.jadeVeinStrength };
  if (/^I \/ honed limestone flooring(?: \/ R[134] board tone \d{2})?$/.test(source)) {
    // Keep the original per-slab finish difference as well as its color map.
    const finishVariation = material.roughness - .26;
    const botanical = material.userData.room_id === 'R3';
    return { ...common, kind: 'floor', macro: botanical ? tuning.botanicalFloorVariation : .07, grain: botanical ? .006 : .009, roughness: Math.max(.18, Math.min(.24, (botanical ? tuning.botanicalFloorRoughness : tuning.stoneFloorRoughness) + finishVariation)), roughnessVariation: botanical ? .045 : .028 };
  }
  if (/^I \/ oak herringbone(?: \/ R2 board tone \d{2})?$/.test(source)) {
    const finishVariation = (material.roughness - .30) * .38;
    return { ...common, kind: 'oak', macro: .055, grain: .008, roughness: Math.max(.18, Math.min(.24, tuning.woodFloorRoughness + finishVariation)), roughnessVariation: .018 };
  }
  if (source === 'I / antique brass') return { ...common, kind: 'brass', macro: .035, grain: .006, roughness: material.userData.room_id === 'R2' ? tuning.jadeRoomBrassRoughness : tuning.brassRoughness, roughnessVariation: .035 };
  if (source === 'I / foliage atlas') return { ...common, kind: 'foliage', macro: 0, grain: 0, roughness: .52, roughnessVariation: .08 };
  return null;
}

function createSurfaceTexture(kind: TextureKind, size: number): DataTexture {
  const data = getGallerySurfacePixels(kind, size);
  const texture = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType);
  texture.name = `I fidelity / ${kind} / periodic physical surface`;
  texture.colorSpace = kind === 'foliage' ? SRGBColorSpace : NoColorSpace;
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

function numberGLSL(value: number) { return value.toFixed(6); }

type OakCurveCalibration = { meanR: number; meanB: number; roughnessChannelOffset: number; albedoCorrection: readonly [number, number, number] };
// Integrated over a full 150 x 900 mm plank with the actual source albedo.
// Preserve each selected tone's mean linear RGB and roughness after bending
// the existing texture; the other six exported tone groups stay unchanged.
const oakCurveCalibration: Record<number, OakCurveCalibration> = {
  2: { meanR: .4533209034033602, meanB: .4712818407511198, roughnessChannelOffset: .0015970510640754831, albedoCorrection: [1.0045682722245148, 1.0045907500953628, 1.0045993661968693] },
  6: { meanR: .4533209034033602, meanB: .4712818407511198, roughnessChannelOffset: .0005196868576618682, albedoCorrection: [.9975444842506432, .9975161376101944, .9974880458189033] },
};

function applyOakCurvature(material: MeshStandardMaterial) {
  const match = /^I \/ oak herringbone \/ R2 board tone (\d{2})$/.exec(material.userData.sourceMaterial ?? '');
  const tone = match ? Number(match[1]) : 0;
  if (material.userData.room_id !== 'R2' || (tone !== 2 && tone !== 6)) return;
  const values = oakCurveCalibration[tone];
  const center = tone === 2 ? .38 : .62, sign = tone === 2 ? 1 : -1;
  const mean2 = ((1 - center) ** 3 + center ** 3) / 3;
  const mean3 = ((1 - center) ** 4 - center ** 4) / 4;
  const priorCompile = material.onBeforeCompile, priorKey = material.customProgramCacheKey();
  material.onBeforeCompile = function(shader, renderer) {
    priorCompile.call(this, shader, renderer);
    const anchor = 'vec4 galleryMineral = texture2D(gallerySurface, gallerySampleUv);';
    if (!shader.fragmentShader.includes(anchor)) throw new Error('Oak surface sampler anchor changed.');
    shader.fragmentShader = `
      float galleryOakCurveHash(ivec2 cell) {
        uint n = uint(cell.x) * 374761393u ^ uint(cell.y) * 668265263u ^ ${tone * 97}u;
        n = (n ^ (n >> 13u)) * 1274126177u;
        return float(n ^ (n >> 16u)) / 4294967295.0;
      }
      float galleryOakCurveGate(vec2 uv) {
        vec2 p = uv * vec2(12.0, 45.0), f = fract(p);
        ivec2 i = ivec2(floor(p)); f = f * f * (3.0 - 2.0 * f);
        float n = mix(mix(galleryOakCurveHash(i), galleryOakCurveHash(i + ivec2(1, 0)), f.x),
          mix(galleryOakCurveHash(i + ivec2(0, 1)), galleryOakCurveHash(i + ivec2(1, 1)), f.x), f.y);
        float footprint = max(length(dFdx(p)), length(dFdy(p)));
        // Fade the non-periodic 1.25 x 2 cm interruption field at distance.
        n = mix(0.5, n, 1.0 - smoothstep(0.5, 1.5, footprint));
        return 0.55 + 0.45 * n;
      }
    ` + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace(anchor, `
      float galleryOakAlong = vGallerySurfaceUv.y - ${center.toFixed(8)};
      gallerySampleUv.x += ${sign.toFixed(1)} * (0.48 * (galleryOakAlong * galleryOakAlong - ${mean2.toFixed(10)})
        + 0.18 * (galleryOakAlong * galleryOakAlong * galleryOakAlong - ${mean3.toFixed(10)}));
      ${anchor}
      float galleryOakGate = galleryOakCurveGate(vGallerySurfaceUv);
      galleryMineral.r = ${values.meanR.toFixed(10)} + (galleryMineral.r - ${values.meanR.toFixed(10)}) * galleryOakGate;
      galleryMineral.b = ${values.meanB.toFixed(10)} + (galleryMineral.b - ${values.meanB.toFixed(10)}) * galleryOakGate;
      galleryMineral.a *= galleryOakGate;
      galleryMineral.g += ${values.roughnessChannelOffset.toFixed(10)};
    `);
    const correction = values.albedoCorrection.map(value => value.toFixed(10)).join(',');
    shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', `diffuseColor.rgb *= vec3(${correction});\n#include <roughnessmap_fragment>`);
  };
  material.customProgramCacheKey = () => `${priorKey}/oak-curvature-v1/${tone}`;
  material.userData.surfaceFidelity.oakCurvature = { tone, physicalBoardMetres: [.15, .9], transitionMetres: [.01, .03], calibration: values };
}

/**
 * Augment already owned/cloned materials. The GLTF cache, original color and
 * normal maps, UVs, per-board tones, metalness and prior lighting/AO hooks survive.
 * Jade alone replaces its overly broad albedo veins in the instance shader.
 * Four 512px and two 1024px data textures are allocated per model. Foliage reuses
 * its source atlas, with one 1024px fallback only when no source map exists.
 * No per-frame work, image requests, geometry or material instances are added.
 */
export function applySurfaceMaterials(materials: MeshStandardMaterial[], overrides: SurfaceMaterialTuning = {}) {
  const tuning = { ...SURFACE_FIDELITY_TUNING, ...overrides };
  const textures = new Map<TextureKind, DataTexture>();
  const changed: string[] = [];
  for (const material of materials) {
    if (!material.isMeshStandardMaterial || material.userData.surfaceFidelity) continue;
    const profile = sourceProfile(material, tuning);
    if (!profile) continue;
    const isR4Terracotta = profile.kind === 'terracotta' && material.userData.room_id === 'R4';
    const isCutLimestone = profile.kind === 'limestone' && ['R1', 'R3', 'R4'].includes(material.userData.room_id);
    const isR2Brass = profile.kind === 'brass' && material.userData.room_id === 'R2';
    const isR3Floor = profile.kind === 'floor' && material.userData.room_id === 'R3';
    const textureKind = isR3Floor ? 'botanical-floor' : profile.kind === 'jade' || profile.kind === 'oak' || profile.kind === 'foliage' ? profile.kind : profile.kind === 'terracotta' ? (isR4Terracotta ? 'clay-trowel' : 'clay') : isCutLimestone ? 'limestone-cut' : 'stone';
    const usesSourceFoliageAtlas = profile.kind === 'foliage' && !!material.map;
    let texture: Texture | undefined = usesSourceFoliageAtlas ? material.map! : textures.get(textureKind);
    if (!texture) {
      const ownedTexture = createSurfaceTexture(textureKind, ['jade', 'oak', 'foliage'].includes(textureKind) ? 1024 : tuning.textureSize);
      textures.set(textureKind, ownedTexture);
      texture = ownedTexture;
    }
    const priorCompile = material.onBeforeCompile;
    const priorCacheKey = material.customProgramCacheKey();
    // Base roughness is a Three uniform, so different board finishes can share
    // one compiled program. Include only values inserted into shader source.
    const textureScale = profile.kind === 'jade' ? tuning.jadeFractureScale : profile.kind === 'terracotta' ? tuning.terracottaTextureScale : 1;
    const detailScale = profile.kind === 'limestone' ? 8 : profile.kind === 'plaster' ? 6 : profile.kind === 'terracotta' ? 3.2 : textureScale;
    const bumpMetres = profile.kind === 'limestone' ? (isCutLimestone ? (material.userData.room_id === 'R3' ? tuning.botanicalStoneBumpMetres : tuning.cutLimestoneBumpMetres) : tuning.limestoneBumpMetres) : profile.kind === 'plaster' ? tuning.plasterBumpMetres : profile.kind === 'terracotta' ? tuning.terracottaBumpMetres : profile.kind === 'oak' ? tuning.oakBumpMetres : profile.kind === 'foliage' ? tuning.foliageBumpMetres : 0;
    const needsFoliageColor = profile.kind === 'foliage' && !material.map;
    const terracottaTrowel = isR4Terracotta ? { variation: tuning.terracottaTrowelVariation, bumpMetres: tuning.terracottaTrowelBumpMetres } : null;
    // R4 still samples its trowel color/roughness field when micro bump is off.
    // Either independent height component can require the normal helper.
    const needsDetailSample = bumpMetres > 0 || isR4Terracotta;
    const needsSurfaceNormal = bumpMetres > 0 || (terracottaTrowel?.bumpMetres ?? 0) > 0;
    const shaderProfile = { kind: profile.kind, macro: profile.macro, grain: profile.grain, roughnessVariation: profile.roughnessVariation, vein: profile.vein, textureScale, detailScale, bumpMetres, needsFoliageColor, terracottaTrowel, isCutLimestone, oakGrainStrength: profile.kind === 'oak' ? tuning.oakGrainStrength : 0 };
    const cacheKey = `${priorCacheKey}/${tuning.version}/${JSON.stringify(shaderProfile)}`;
    material.roughness = profile.roughness;
    // Adjust only the owned R4 instance in linear light. The source map and
    // other rooms stay intact; this removes salmon/blue bias without changing
    // exposure, light color or the relative pigmentation within the texture.
    if (isR4Terracotta) {
      material.color.r *= tuning.terracottaDiffuseRed;
      material.color.g *= tuning.terracottaDiffuseGreen;
      material.color.b *= tuning.terracottaDiffuseBlue;
    }
    if (isR3Floor) {
      // Instance-only diffuse reflectance: preserve the source slab palette
      // and give the existing physical reflection room to read against it.
      material.color.r *= tuning.botanicalFloorDiffuseRed;
      material.color.g *= tuning.botanicalFloorDiffuseGreen;
      material.color.b *= tuning.botanicalFloorDiffuseBlue;
    }
    if (isR2Brass) {
      material.envMapIntensity = tuning.jadeRoomBrassEnvironment;
      // The source metal map averages ~(.40,.30,.15) in linear reflectance.
      // Bounded RGB gains restore ~(.64,.54,.25) and reduce the bronze bias.
      // Cached pixels, metalness, roughness and light gains stay intact.
      material.color.r *= tuning.jadeRoomBrassReflectanceGain;
      material.color.g *= tuning.jadeRoomBrassReflectanceGreenGain;
      material.color.b *= tuning.jadeRoomBrassReflectanceBlueGain;
    }
    // The old jade normal tile follows the removed broad wire pattern. Its
    // cached texture stays intact; only this material instance reduces it.
    if (profile.kind === 'jade') material.normalScale.set(.035, .035);
    const boardTone = Number(String(material.userData.sourceMaterial).match(/board tone (\d+)/)?.[1] ?? 0);
    material.onBeforeCompile = function(shader, renderer) {
      priorCompile.call(this, shader, renderer);
      shader.uniforms.gallerySurface = { value: texture };
      shader.uniforms.gallerySurfacePhase = { value: boardTone * .731 };
      shader.vertexShader = 'varying vec2 vGallerySurfaceUv;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\nvGallerySurfaceUv = uv;');
      shader.fragmentShader = 'uniform sampler2D gallerySurface;\nuniform float gallerySurfacePhase;\nvarying vec2 vGallerySurfaceUv;\n' + shader.fragmentShader;
      if (needsSurfaceNormal) shader.fragmentShader = `
        // Surface-gradient bump in metres. Unnormalised view-position
        // derivatives retain real scale; mip-filtered heights fade at distance.
        vec3 gallerySurfaceNormal(vec3 position, vec3 surfaceNormal, float height) {
          vec3 dpdx = dFdx(position), dpdy = dFdy(position);
          vec3 r1 = cross(dpdy, surfaceNormal), r2 = cross(surfaceNormal, dpdx);
          float determinant = dot(dpdx, r1);
          float determinantSign = determinant < 0.0 ? -1.0 : 1.0;
          vec3 gradient = (dFdx(height) * r1 + dFdy(height) * r2) / (determinantSign * max(abs(determinant), 0.000000001));
          gradient *= min(1.0, 0.4 / max(length(gradient), 0.00001));
          return normalize(surfaceNormal - gradient);
        }
      ` + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
        vec2 gallerySampleUv = vGallerySurfaceUv * ${numberGLSL(textureScale)};
        ${needsFoliageColor ? 'gallerySampleUv.y = 1.0 - gallerySampleUv.y; // glTF UV.y = 1 - Blender UV.y; fallback pixels use the Blender cell contract.' : ''}
        ${profile.kind === 'oak' ? `gallerySampleUv = vGallerySurfaceUv * vec2(0.85 + 0.3 * fract(gallerySurfacePhase * 0.73), 0.82 + 0.4 * fract(gallerySurfacePhase * 0.91)) + vec2(gallerySurfacePhase * 0.137, gallerySurfacePhase * 0.197);` : isR3Floor ? 'gallerySampleUv += vec2(gallerySurfacePhase * 0.23, gallerySurfacePhase * 0.37);' : ''}
        vec4 galleryMineral = ${usesSourceFoliageAtlas ? 'sampledDiffuseColor' : 'texture2D(gallerySurface, gallerySampleUv)'};
        ${needsDetailSample ? `vec4 galleryDetail = ${detailScale === textureScale ? 'galleryMineral' : `texture2D(gallerySurface, vGallerySurfaceUv * ${numberGLSL(detailScale)})`};` : ''}
        ${isR4Terracotta ? 'float galleryTrowel = galleryMineral.g * 0.80 + galleryDetail.g * 0.20; // Two existing sample scales break the short repeat; about 0.09–0.40 m strokes.' : ''}
        float galleryTone = 1.0 + (galleryMineral.r - 0.5) * ${numberGLSL(profile.macro * 2)} + (galleryMineral.a - 0.5) * ${numberGLSL(profile.grain * 2)};
        diffuseColor.rgb *= ${isCutLimestone ? 'clamp(galleryTone, 0.92, 1.08)' : 'max(0.55, galleryTone)'};
        ${isR4Terracotta ? `diffuseColor.rgb *= clamp(1.0 + (galleryTrowel - 0.5) * ${numberGLSL(tuning.terracottaTrowelVariation * 2)}, 0.90, 1.10);` : ''}
        ${profile.kind === 'jade' ? `
          // Cloud sampling stays at the authored 2.4 m scale, independently
          // of the much smaller fractures. Values are linear-light reflectance.
          float galleryJadeCloud = texture2D(gallerySurface, vGallerySurfaceUv).r;
          vec3 galleryJadeMatrix = mix(vec3(0.045, 0.062, 0.031), vec3(0.105, 0.132, 0.071), galleryJadeCloud);
          galleryJadeMatrix *= 1.0 + (galleryMineral.g - 0.5) * ${numberGLSL(profile.macro)};
          float galleryCalcite = clamp(galleryMineral.b + galleryMineral.a * 0.39, 0.0, 1.0);
          diffuseColor.rgb = mix(galleryJadeMatrix, vec3(0.60, 0.54, 0.37), galleryCalcite * ${numberGLSL(profile.vein)});
        ` : ''}
        ${profile.kind === 'oak' ? `
          // GPU mip/anisotropic filtering integrates fine interrupted fibres
          // instead of aliasing analytic stripes at oblique viewing angles.
          diffuseColor.rgb *= 1.0 + (galleryMineral.r - 0.5) * ${numberGLSL(tuning.oakGrainStrength * 2)};
        ` : ''}
        ${needsFoliageColor ? 'diffuseColor.rgb *= galleryMineral.rgb;' : ''}
      `);
      if (isR3Floor) shader.fragmentShader = shader.fragmentShader.replace('diffuseColor.rgb *= max(0.55, galleryTone);', `
        diffuseColor.rgb *= clamp(galleryTone, 0.86, 1.14);
        diffuseColor.rgb *= mix(vec3(1.0), vec3(0.99, 0.965, 0.91), galleryMineral.b * 0.35);
      `);
      shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor + (${profile.kind === 'foliage' ? 'galleryMineral.a' : isR4Terracotta ? 'galleryTrowel' : 'galleryMineral.g'} - 0.5) * ${numberGLSL(profile.roughnessVariation * 2)}, ${isR3Floor ? '0.165, 0.245' : '0.14, 0.9'});
      `);
      if (needsSurfaceNormal) shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        normal = gallerySurfaceNormal(-vViewPosition, normal, (galleryDetail.${profile.kind === 'foliage' ? 'a' : 'b'} - 0.5) * ${numberGLSL(bumpMetres)} ${isR4Terracotta ? `+ (galleryTrowel - 0.5) * ${numberGLSL(tuning.terracottaTrowelBumpMetres)}` : ''});
      `);
    };
    material.customProgramCacheKey = () => cacheKey;
    material.userData.surfaceFidelity = { version: tuning.version, sourceMaterial: material.userData.sourceMaterial, ...profile, texture: texture.name, textureScale, detailScale, bumpMetres, terracottaTrowel, mineralStrataMetres: isCutLimestone ? [2 / 24, .25] : null, mineralPoreClusterMetres: isCutLimestone ? .125 : null, diffuseMultiplier: isR4Terracotta ? [tuning.terracottaDiffuseRed, tuning.terracottaDiffuseGreen, tuning.terracottaDiffuseBlue] : isR2Brass ? [tuning.jadeRoomBrassReflectanceGain, tuning.jadeRoomBrassReflectanceGreenGain, tuning.jadeRoomBrassReflectanceBlueGain] : [1, 1, 1], environmentIntensity: material.envMapIntensity, preservesSourceAlbedo: profile.kind !== 'jade', sourceTextureCacheUnchanged: true };
    if (isR3Floor) Object.assign(material.userData.surfaceFidelity, {
      diffuseMultiplier: [tuning.botanicalFloorDiffuseRed, tuning.botanicalFloorDiffuseGreen, tuning.botanicalFloorDiffuseBlue],
      floorMineralMetres: [1.2 / 11, .40], floorRoughnessRange: [.165, .245],
      floorPigmentRange: [.86, 1.14], preservesSourceSlabTones: true,
    });
    // Run only for this newly augmented instance; repeated apply calls skip
    // the whole loop above, so a hook cannot be stacked twice on reused data.
    if (profile.kind === 'oak') applyOakCurvature(material);
    material.needsUpdate = true;
    changed.push(material.name);
  }
  return {
    textures: [...textures.values()],
    materials: changed,
    dispose() {
      // StrictMode replays effect cleanup while retaining this memoized model.
      // Three can upload these same textures again on its next render. Every
      // subsequent cleanup must therefore dispatch dispose again; a permanent
      // "already disposed" flag would leak the second GPU allocation. Three's
      // texture manager safely ignores release when no allocation is present.
      for (const texture of textures.values()) texture.dispose();
    },
  };
}

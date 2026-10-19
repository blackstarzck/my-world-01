import { useLayoutEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import { Camera, HalfFloatType, Mesh, MeshBasicMaterial, Scene, WebGLRenderTarget } from 'three';
import type { BufferGeometry, Material, Texture, VideoTexture, WebGLRenderer } from 'three';
import { compileGalleryInBatches } from './GalleryCompileBatches.mjs';
import type { GalleryEffectPreparation } from './GalleryEffectPreparation.mjs';

type Props = {
  onReady: () => void;
  onLoadingStage?: (stage: 'lighting' | 'finishing') => void;
  onFailure: (error?: Error) => void;
  /** Custom shader textures (for example surface.textures), not visible as material map properties. */
  textures?: readonly Texture[];
  resetKey?: string | number;
  expectedArtworkCount?: number;
  timeoutMs?: number;
};
type Snapshot = { ready: boolean; reason: string; artworkCount: number; signature: string; textures: Texture[]; error?: string };
type State = 'waiting' | 'settling' | 'compile-submit' | 'uploading' | 'geometry-warm' | 'effects-upload' | 'effects-compile' | 'shader-wait' | 'program-reflection' | 'first-frame' | 'ready' | 'failed';
type PreparedProgram = {
  program?: unknown; id?: number; isReady?: () => boolean;
  getUniforms?: () => unknown; getAttributes?: () => unknown;
};
const emptyTextures: readonly Texture[] = [];

function isTexture(value: unknown): value is Texture {
  return !!value && typeof value === 'object' && (value as Texture).isTexture === true;
}

function imageReady(texture: Texture): boolean {
  const image = texture.image as { width?: number; height?: number; naturalWidth?: number; complete?: boolean; readyState?: number } | undefined;
  if (!image) return false;
  if ((texture as VideoTexture).isVideoTexture) return (image.readyState ?? 0) >= 2;
  return (image.width ?? 0) > 0 && (image.height ?? 0) > 0 && image.complete !== false && image.naturalWidth !== 0;
}

function snapshot(scene: Scene, camera: Camera, gl: WebGLRenderer, customTextures: readonly Texture[], expectedArtworkCount: number): Snapshot {
  const data = scene.userData;
  const result: Snapshot = { ready: false, reason: 'model-metadata', artworkCount: 0, signature: '', textures: [] };
  const artworkStates = data.artworkLoadStatus as Record<string, { state?: string; message?: string }> | undefined;
  for (const [slot, state] of Object.entries(artworkStates ?? {})) {
    if (state.state === 'failed') return { ...result, reason: 'artwork-textures', error: state.message ?? `Artwork texture failed: ${slot}` };
  }
  // Undefined means Building has not published its final metadata. Null explicitly means no environment/sky.
  if (data.expectedEnvironmentURL === undefined || !Array.isArray(data.expectedMaterialEnvironmentURLs) || data.expectedSkyStatus === undefined) return result;
  const environmentURL = data.expectedEnvironmentURL as string | null;
  const urls = new Set<string>(data.expectedMaterialEnvironmentURLs as string[]);
  if (environmentURL) urls.add(environmentURL);
  for (const url of urls) {
    const state = data.materialEnvironmentStatus?.[url];
    if (state?.state === 'failed') return { ...result, reason: 'environment', error: state.message ?? `Environment failed: ${url}` };
    if (state?.state !== 'ready') return { ...result, reason: 'environment' };
  }
  if (environmentURL && (data.environmentStatus?.state !== 'ready' || scene.environment?.userData.environmentURL !== environmentURL)) return { ...result, reason: 'scene-environment' };
  if (data.expectedSkyStatus) {
    const sky = data.skyStatus;
    if (sky?.state === 'failed') return { ...result, reason: 'sky', error: sky.message ?? 'Sky failed' };
    if (sky?.state !== 'ready' || sky.url !== data.expectedSkyStatus.url || !isTexture(scene.background)) return { ...result, reason: 'sky' };
  }

  const textures = new Map<string, Texture>();
  const materials = new Set<Material>();
  const artworkSlots = new Set<string>();
  const lightState: string[] = [];
  const addTexture = (texture: Texture) => {
    // PMREM and reflection/depth render targets already own GPU storage. Never upload them as source images.
    if (!texture.isRenderTargetTexture) textures.set(texture.uuid, texture);
  };
  scene.traverse(object => {
    const mesh = object as Mesh;
    if (!mesh.isMesh || mesh.userData.element_role === 'artwork') return;
    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of list) {
      materials.add(material);
      for (const value of Object.values(material)) if (isTexture(value)) addTexture(value);
    }
    if (mesh.userData.element_role === 'web_artwork' && list.some(material => {
      const map = (material as Material & { map?: Texture | null }).map;
      return isTexture(map) && imageReady(map);
    })) artworkSlots.add(String(mesh.userData.slot_id ?? mesh.uuid));
  });
  scene.traverseVisible(object => {
    const light = object as typeof object & { isLight?: boolean; intensity?: number; color?: { getHexString: () => string } };
    if (light.isLight && object.layers.test(camera.layers)) lightState.push(`${object.uuid}:${object.type}:${light.intensity}:${light.color?.getHexString()}:${object.castShadow}`);
  });
  result.artworkCount = artworkSlots.size;
  if (artworkSlots.size < expectedArtworkCount) return { ...result, reason: 'artwork-textures' };
  for (const texture of customTextures) addTexture(texture);
  if (isTexture(scene.background)) addTexture(scene.background);
  if (scene.environment) addTexture(scene.environment);
  for (const texture of textures.values()) if (!imageReady(texture)) return { ...result, reason: 'material-textures' };
  // Do not include material.version: compile itself increments it for transparent DoubleSide materials.
  // Texture versions can also change on a playing VideoTexture without changing its shader program.
  const materialState = [...materials].map(material => {
    const m = material as Material & { envMap?: Texture | null; map?: Texture | null; vertexColors?: boolean; defines?: unknown };
    return [m.uuid, m.customProgramCacheKey(), m.side, m.transparent, m.alphaTest, m.vertexColors, m.envMap?.uuid, m.map?.uuid, m.defines];
  });
  result.signature = JSON.stringify([environmentURL, [...urls], data.runtimeLightingModel, data.expectedSkyStatus,
    scene.environment?.uuid, isTexture(scene.background) ? scene.background.uuid : null,
    gl.toneMapping, gl.outputColorSpace, gl.shadowMap.enabled, gl.shadowMap.type, lightState, materialState, [...textures.keys()]]);
  result.textures = [...textures.values()];
  result.ready = true;
  result.reason = 'assets-ready';
  return result;
}

/** Final-scene preparation only. The caller must gate main/effect/reflection rendering until renderReady === true. */
export function GallerySceneReady({ onReady, onLoadingStage, onFailure, textures = emptyTextures, resetKey, expectedArtworkCount = 48, timeoutMs = 120_000 }: Props) {
  const { gl, scene, camera, invalidate } = useThree();
  const current = useRef({ onReady, onLoadingStage, onFailure, textures });
  useLayoutEffect(() => { current.current = { onReady, onLoadingStage, onFailure, textures }; }, [onReady, onLoadingStage, onFailure, textures]);

  useLayoutEffect(() => {
    let live = true;
    const owner = {};
    const timers = new Map<ReturnType<typeof setTimeout>, (active: boolean) => void>();
    const started = performance.now();
    let compilePasses = 0;
    let firstRenderComplete: (() => void) | undefined;
    const uploaded = new Set<string>();
    const warmed = new Set<BufferGeometry>();
    // Actual scene color and reflection are rendered into linear offscreen
    // targets; the OutputPass applies tone mapping only after those draws.
    const compileTarget = new WebGLRenderTarget(1, 1, { type: HalfFloatType, depthBuffer: false, stencilBuffer: false });
    const diagnostic: { state: State; reason: string; artworkCount: number; texturesUploaded: number; compilePasses: number; compileTarget: string; elapsedMs: number; error?: string } = {
      state: 'waiting', reason: 'model-metadata', artworkCount: 0, texturesUploaded: 0, compilePasses: 0, compileTarget: 'linear-offscreen', elapsedMs: 0,
    };
    // Driver uploads precede scene compilation: on this GPU initTexture after
    // linkProgram serialized pending shader work into a long blocking upload.
    const preparationTiming = {
      clock: 'window.performance.now', startedMs: started,
      phases: [{ state: 'waiting' as State, startMs: started, durationMs: 0 }],
      snapshotCalls: 0, snapshotCPUMs: 0, snapshotMaxCPUMs: 0,
      uploadCPUMs: 0, uploads: [] as { name: string; uuid: string; durationMs: number }[],
      compileCPUMs: 0, compiledMaterialCount: 0, shaderPollChecks: 0, shaderPollCPUMs: 0,
      compileObjectCount: 0, compileCalls: 0, compileMaxBatchMs: 0, compileFallbackReason: null as string | null,
      compileBatches: [] as { count: number; durationMs: number; compileCPUMs: number }[],
      compileSubmittedMs: null as number | null, shadersReadyMs: null as number | null,
      geometryCandidates: 0, geometriesWarmed: 0, geometryWarmCPUMs: 0,
      geometryWarmMaxBatchMs: 0, boundingSpheresComputed: 0, boundingSphereCPUMs: 0,
      geometryBatches: [] as { count: number; durationMs: number }[],
      programReflectionCount: 0, programReflectionCPUMs: 0, programReflectionMaxBatchMs: 0,
      programReflectionExtraPolls: 0,
      programReflectionBatches: [] as { count: number; durationMs: number }[],
      effectUploads: [] as { name: string; durationMs: number }[],
      effectCompileOperations: [] as { name: string; durationMs: number }[],
      effectCompiledMaterialCount: 0, effectShaderPollChecks: 0, effectShaderPollCPUMs: 0,
      effectProgramReflectionCount: 0, effectProgramReflectionCPUMs: 0,
      note: 'CPU submission and elapsed waits; not a GPU-completion fence.',
    };
    Object.assign(diagnostic, { preparationTiming });
    const transition = (state: State) => {
      if (diagnostic.state === state) return;
      const now = performance.now(), previous = preparationTiming.phases.at(-1)!;
      previous.durationMs = now - previous.startMs;
      preparationTiming.phases.push({ state, startMs: now, durationMs: 0 });
      diagnostic.state = state;
      if (state === 'uploading') current.current.onLoadingStage?.('finishing');
    };
    current.current.onLoadingStage?.('lighting');
    scene.userData.renderReadyOwner = owner;
    scene.userData.renderReady = false;
    scene.userData.sceneReadiness = diagnostic;
    const active = () => live && scene.userData.renderReadyOwner === owner;
    const pause = (ms: number) => new Promise<boolean>(resolve => {
      if (!active()) { resolve(false); return; }
      const timer = setTimeout(() => { timers.delete(timer); resolve(active()); }, ms);
      timers.set(timer, resolve);
    });
    const check = () => {
      if (gl.getContext().isContextLost()) throw new Error('WebGL context lost while preparing the gallery');
      if (performance.now() - started > timeoutMs) throw new Error(`Gallery preparation timed out (${diagnostic.reason})`);
      const snapshotStart = performance.now();
      const value = snapshot(scene, camera, gl, current.current.textures, expectedArtworkCount);
      const snapshotMs = performance.now() - snapshotStart;
      preparationTiming.snapshotCalls++;
      preparationTiming.snapshotCPUMs += snapshotMs;
      preparationTiming.snapshotMaxCPUMs = Math.max(preparationTiming.snapshotMaxCPUMs, snapshotMs);
      diagnostic.artworkCount = value.artworkCount;
      diagnostic.reason = value.reason;
      diagnostic.elapsedMs = performance.now() - started;
      if (value.error) throw new Error(value.error);
      return value;
    };
    const warmGeometry = async () => {
      const unique = new Set<BufferGeometry>();
      scene.traverse(object => {
        const mesh = object as Mesh;
        if (mesh.isMesh && mesh.userData.element_role !== 'artwork') unique.add(mesh.geometry);
      });
      preparationTiming.geometryCandidates = unique.size;
      const geometries = [...unique].filter(geometry => !warmed.has(geometry));
      if (!geometries.length) return true;
      const warmScene = new Scene(), warmCamera = new Camera();
      const material = new MeshBasicMaterial({ colorWrite: false, depthTest: false, depthWrite: false, toneMapped: false });
      const mesh = new Mesh(geometries[0], material);
      mesh.frustumCulled = false; mesh.matrixAutoUpdate = false;
      warmScene.add(mesh);
      // A source can be replaced/disposed while an upload batch yields. Never
      // resurrect its GPU buffers. This listener owns no source resources.
      const disposed = new Set<BufferGeometry>();
      const onDispose = (event: { target?: unknown }) => {
        const geometry = event.target as BufferGeometry;
        disposed.add(geometry); warmed.delete(geometry);
      };
      for (const geometry of geometries) geometry.addEventListener('dispose', onDispose);
      try {
        let index = 0;
        while (index < geometries.length) {
          if (!active()) return false;
          if (gl.getContext().isContextLost()) throw new Error('WebGL context lost while preparing gallery geometry');
          if (performance.now() - started > timeoutMs) throw new Error('Gallery geometry preparation timed out');
          const previousTarget = gl.getRenderTarget(), previousFace = gl.getActiveCubeFace(), previousMip = gl.getActiveMipmapLevel();
          const shadowsEnabled = gl.shadowMap.enabled, shadowDirty = gl.shadowMap.needsUpdate, sortObjects = gl.sortObjects;
          const batchStart = performance.now();
          let count = 0;
          try {
            gl.setRenderTarget(compileTarget);
            gl.shadowMap.enabled = false; gl.sortObjects = false;
            do {
              const geometry = geometries[index++];
              if (disposed.has(geometry)) continue;
              if (geometry.boundingSphere === null) {
                const boundsStart = performance.now();
                geometry.computeBoundingSphere();
                preparationTiming.boundingSphereCPUMs += performance.now() - boundsStart;
                preparationTiming.boundingSpheresComputed++;
              }
              mesh.geometry = geometry;
              // A normal render uploads every original attribute and index via
              // Three's own buffer cache. Only our detached proxy is drawn.
              gl.render(warmScene, warmCamera);
              warmed.add(geometry); count++;
            } while (index < geometries.length && count < 16 && performance.now() - batchStart < 6);
          } finally {
            gl.shadowMap.enabled = shadowsEnabled; gl.shadowMap.needsUpdate = shadowDirty; gl.sortObjects = sortObjects;
            gl.setRenderTarget(previousTarget, previousFace, previousMip);
          }
          const durationMs = performance.now() - batchStart;
          preparationTiming.geometryWarmCPUMs += durationMs;
          preparationTiming.geometryWarmMaxBatchMs = Math.max(preparationTiming.geometryWarmMaxBatchMs, durationMs);
          preparationTiming.geometryBatches.push({ count, durationMs });
          preparationTiming.geometriesWarmed = warmed.size;
          if (index < geometries.length && !await pause(0)) return false;
        }
        return true;
      } finally {
        warmScene.clear();
        material.dispose();
        for (const geometry of geometries) geometry.removeEventListener('dispose', onDispose);
        // Source BufferGeometry/attributes belong to Building and artwork meshes.
      }
    };
    const run = async () => {
      // Timer yields let StrictMode's immediate cleanup finish before any upload or shader work begins.
      if (!await pause(0)) return;
      while (active()) {
        transition('waiting');
        const initial = check();
        if (!initial.ready) { if (!await pause(50)) return; continue; }
        transition('settling');
        if (!await pause(0)) return;
        let stable = check();
        if (!stable.ready || stable.signature !== initial.signature) continue;
        if (!await pause(0)) return;
        stable = check();
        if (!stable.ready || stable.signature !== initial.signature) continue;

        transition('uploading');
        let batchStart = performance.now(), batchCount = 0;
        for (const texture of stable.textures) {
          if (!active()) return;
          if (uploaded.has(texture.uuid)) continue;
          const uploadStart = performance.now();
          gl.initTexture(texture); uploaded.add(texture.uuid); diagnostic.texturesUploaded = uploaded.size;
          const uploadMs = performance.now() - uploadStart;
          preparationTiming.uploadCPUMs += uploadMs;
          preparationTiming.uploads.push({ name: texture.name, uuid: texture.uuid, durationMs: uploadMs });
          // One driver upload cannot be preempted; bound the number of uploads between UI event-loop yields.
          if (++batchCount >= 4 || performance.now() - batchStart >= 6) {
            if (!await pause(0)) return;
            batchStart = performance.now(); batchCount = 0;
          }
        }
        const afterUploads = check();
        if (!afterUploads.ready || afterUploads.signature !== stable.signature) continue;
        transition('geometry-warm');
        if (!await warmGeometry()) return;
        const effects = scene.userData.galleryEffectPreparation as GalleryEffectPreparation | undefined;
        const effectSignature = effects?.signature();
        const effectsActive = () => active() && scene.userData.galleryEffectPreparation === effects;
        const checkEffects = () => {
          if (gl.getContext().isContextLost()) throw new Error('WebGL context lost while preparing gallery effects');
          if (performance.now() - started > timeoutMs) throw new Error('Gallery effect preparation timed out');
        };
        if (effects) {
          // Allocate the actual effect targets/noise before submitting shaders;
          // texture allocation after compile can serialize driver shader work.
          transition('effects-upload');
          if (!await effects.initialize({ active: effectsActive, check: checkEffects, pause: () => pause(0),
            onOperation: operation => preparationTiming.effectUploads.push(operation) })) {
            if (!active()) return;
            continue;
          }
        }
        const beforeCompile = check();
        if (!beforeCompile.ready || beforeCompile.signature !== stable.signature) continue;
        transition('compile-submit');
        diagnostic.compilePasses = ++compilePasses;
        const compilation = await compileGalleryInBatches(gl, scene, camera, compileTarget, {
          active, pause: () => pause(0),
          check: () => {
            if (gl.getContext().isContextLost()) throw new Error('WebGL context lost while compiling gallery shaders');
            if (performance.now() - started > timeoutMs) throw new Error('Gallery shader compilation timed out');
          },
          onBatch: batch => {
            preparationTiming.compileCPUMs += batch.compileCPUMs;
            preparationTiming.compileMaxBatchMs = Math.max(preparationTiming.compileMaxBatchMs, batch.durationMs);
            preparationTiming.compileBatches.push(batch);
          },
        });
        if (!compilation) return;
        if (compilation.invalidated) { if (!await pause(0)) return; continue; }
        const compiledMaterials = new Set(compilation.materials);
        preparationTiming.compileObjectCount = compilation.objectCount;
        preparationTiming.compileCalls = compilation.calls;
        preparationTiming.compileFallbackReason = compilation.fallbackReason;
        preparationTiming.compiledMaterialCount = compiledMaterials.size;
        let effectMaterials = new Set<Material>();
        if (effects) {
          transition('effects-compile');
          const prepared = await effects.compile({ active: effectsActive, check: checkEffects, pause: () => pause(0),
            onOperation: operation => preparationTiming.effectCompileOperations.push(operation) });
          if (!prepared) { if (!active()) return; continue; }
          effectMaterials = prepared;
          for (const material of prepared) compiledMaterials.add(material);
          preparationTiming.effectCompiledMaterialCount = prepared.size;
        }
        preparationTiming.compileSubmittedMs = performance.now();
        transition('shader-wait');
        let invalidated = false;
        // Three 0.180.0 compileAsync polls properties.get(material).currentProgram
        // in an unowned timer. That can throw after unmount disposes a material.
        // Mirror its internal readiness test here with owned/cancellable waits;
        // recheck this narrow internal API when upgrading Three.
        if (gl.extensions.has('KHR_parallel_shader_compile')) {
          const pending = new Set(compiledMaterials);
          while (pending.size) {
            if (!active()) return;
            if (gl.getContext().isContextLost()) throw new Error('WebGL context lost while compiling gallery shaders');
            if (performance.now() - started > timeoutMs) throw new Error('Gallery shader compilation timed out');
            const pollStart = performance.now();
            preparationTiming.shaderPollChecks++;
            for (const material of pending) {
              const properties = gl.properties.has(material) ? gl.properties.get(material) as {
                currentProgram?: { program?: unknown; isReady?: () => boolean };
              } : undefined;
              const program = properties?.currentProgram;
              // A committed artwork/material replacement may dispose an old
              // material while preparation is yielding. Resnapshot/recompile
              // the current scene rather than touching its deleted GL program.
              if (!program?.program) { invalidated = true; break; }
              if (typeof program.isReady !== 'function') throw new Error('Unsupported Three shader readiness API');
              const effectPollStart = effectMaterials.has(material) ? performance.now() : null;
              if (program.isReady()) pending.delete(material);
              if (effectPollStart !== null) {
                preparationTiming.effectShaderPollChecks++;
                preparationTiming.effectShaderPollCPUMs += performance.now() - effectPollStart;
              }
            }
            preparationTiming.shaderPollCPUMs += performance.now() - pollStart;
            if (invalidated || !pending.size) break;
            if (!await pause(50)) return;
          }
        }
        // Without KHR, Three also treats programs as immediately ready. The
        // first draw may still stall in the driver; it stays behind the loader.
        if (invalidated) { if (!await pause(0)) return; continue; }
        if (!active()) return;
        preparationTiming.shadersReadyMs = performance.now();
        transition('program-reflection');
        const programs = new Set<PreparedProgram>();
        const effectPrograms = new Set<PreparedProgram>();
        for (const material of compiledMaterials) {
          const properties = gl.properties.has(material) ? gl.properties.get(material) as {
            currentProgram?: PreparedProgram; programs?: Map<string, PreparedProgram>;
          } : undefined;
          if (!properties?.currentProgram?.program) { invalidated = true; break; }
          programs.add(properties.currentProgram);
          if (effectMaterials.has(material)) effectPrograms.add(properties.currentProgram);
          // Include already compiled back/front-side variants. Do not create
          // new shader keys or replace any material's currentProgram.
          for (const program of properties.programs?.values() ?? []) {
            programs.add(program);
            if (effectMaterials.has(material)) effectPrograms.add(program);
          }
        }
        let reflectionBatchStart = performance.now(), reflectionBatchCount = 0;
        const recordReflectionBatch = () => {
          if (!reflectionBatchCount) return;
          const durationMs = performance.now() - reflectionBatchStart;
          preparationTiming.programReflectionBatches.push({ count: reflectionBatchCount, durationMs });
          preparationTiming.programReflectionMaxBatchMs = Math.max(preparationTiming.programReflectionMaxBatchMs, durationMs);
          reflectionBatchCount = 0;
        };
        if (!invalidated) for (const program of programs) {
          if (!active()) return;
          if (gl.getContext().isContextLost()) throw new Error('WebGL context lost while preparing gallery program reflection');
          if (performance.now() - started > timeoutMs) throw new Error('Gallery program reflection timed out');
          if (!program.program) { invalidated = true; break; }
          if (typeof program.isReady !== 'function' || typeof program.getUniforms !== 'function' || typeof program.getAttributes !== 'function') throw new Error('Unsupported Three program reflection API');
          // The previous poll covered current programs. A compiled alternate
          // side may still be pending; never turn that wait into a sync query.
          while (!program.isReady()) {
            recordReflectionBatch();
            preparationTiming.programReflectionExtraPolls++;
            if (!await pause(50)) return;
            if (!program.program) { invalidated = true; break; }
            if (gl.getContext().isContextLost()) throw new Error('WebGL context lost while preparing gallery program reflection');
            if (performance.now() - started > timeoutMs) throw new Error('Gallery program reflection timed out');
            reflectionBatchStart = performance.now();
          }
          if (invalidated) break;
          // Three r180 onFirstUse performs link diagnostics and caches both
          // uniform and attribute locations. No values/buffers are uploaded.
          const reflectionStart = performance.now();
          program.getUniforms(); program.getAttributes();
          const reflectionMs = performance.now() - reflectionStart;
          preparationTiming.programReflectionCPUMs += reflectionMs;
          if (effectPrograms.has(program)) {
            preparationTiming.effectProgramReflectionCount++;
            preparationTiming.effectProgramReflectionCPUMs += reflectionMs;
          }
          preparationTiming.programReflectionCount++;
          reflectionBatchCount++;
          if (reflectionBatchCount >= 4 || performance.now() - reflectionBatchStart >= 6) {
            recordReflectionBatch();
            if (!await pause(0)) return;
            reflectionBatchStart = performance.now();
          }
        }
        recordReflectionBatch();
        if (invalidated) { if (!await pause(0)) return; continue; }
        const afterCompile = check();
        if (!afterCompile.ready || afterCompile.signature !== beforeCompile.signature) continue;
        if (effects && (!effectsActive() || effects.signature() !== effectSignature)) continue;
        transition('first-frame'); diagnostic.reason = 'first-frame-pending'; diagnostic.elapsedMs = performance.now() - started;
        let completed = false;
        firstRenderComplete = () => {
          if (!active() || completed) return;
          completed = true;
          if (scene.userData.galleryFirstRenderReady === firstRenderComplete) delete scene.userData.galleryFirstRenderReady;
          transition('ready'); diagnostic.reason = 'first-frame-submitted'; diagnostic.elapsedMs = performance.now() - started;
          current.current.onReady();
        };
        // Effects invokes this once after the actual composer submission succeeds.
        // Keep the loading UI through initial buffer/shadow/effect GPU preparation.
        scene.userData.galleryFirstRenderReady = firstRenderComplete;
        scene.userData.renderReady = true;
        gl.shadowMap.needsUpdate = true;
        invalidate();
        return;
      }
    };
    void run().catch(error => {
      if (!active()) return;
      transition('failed'); diagnostic.error = String(error); diagnostic.elapsedMs = performance.now() - started;
      scene.userData.renderReady = false;
      current.current.onFailure(error instanceof Error ? error : new Error(String(error)));
    });
    return () => {
      live = false;
      for (const [timer, resolve] of timers) { clearTimeout(timer); resolve(false); }
      timers.clear();
      compileTarget.dispose();
      if (scene.userData.galleryFirstRenderReady === firstRenderComplete) delete scene.userData.galleryFirstRenderReady;
      if (scene.userData.renderReadyOwner === owner) {
        scene.userData.renderReady = false;
        delete scene.userData.renderReadyOwner;
      }
      // No renderer-owned polling timer survives cleanup. Shared textures and
      // materials remain owned by Building/artwork/environment components.
    };
  }, [gl, scene, camera, invalidate, resetKey, expectedArtworkCount, timeoutMs]);
  return null;
}

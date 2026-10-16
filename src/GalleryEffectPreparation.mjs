import { Mesh, Scene } from 'three';

// Three r180's gl.compile(scene) only sees scene materials; GTAO's normal
// override and fullscreen materials are not part of that scene traversal.
// These detached proxies share geometry/materials and are never rendered.
function normalVariant(object) {
  if (object.isSkinnedMesh || object.isInstancedMesh || object.isBatchedMesh) return object.uuid;
  const geometry = object.geometry;
  return JSON.stringify([object.type,
    Object.entries(geometry.attributes).map(([name, a]) => [name, a.itemSize]),
    Object.entries(geometry.morphAttributes).map(([name, a]) => [name, a.length]),
    geometry.morphTargetsRelative]);
}

export function createGalleryEffectPreparation(renderer, scene, camera, composer, ao, output) {
  let live = true;
  const initializedTargets = new Map(), initializedTextures = new Map();
  const clearInitialized = () => { initializedTargets.clear(); initializedTextures.clear(); };
  renderer.domElement.addEventListener('webglcontextrestored', clearInitialized);
  const emptyScene = new Scene();

  const signature = () => JSON.stringify([
    ao.enabled, ao.width, ao.height, composer.readBuffer.width, composer.readBuffer.height,
    renderer.toneMapping, renderer.outputColorSpace,
    ao.normalMaterial.uuid, ao.gtaoMaterial.uuid, ao.pdMaterial.uuid,
    ao.copyMaterial.uuid, ao.blendMaterial.uuid, output.material.uuid,
    ao.gtaoMaterial.defines, ao.pdMaterial.defines,
  ]);

  function jobs() {
    const result = [], normalGroups = new Set();
    if (ao.enabled) scene.traverse(object => {
      if (!object.isMesh) return;
      const key = normalVariant(object);
      if (normalGroups.has(key)) return;
      normalGroups.add(key);
      const proxy = object.clone(false);
      proxy.material = ao.normalMaterial;
      result.push({ name: 'normal', object: proxy, camera, scene, target: ao.normalRenderTarget });
    });
    // Capture the actual FullScreenQuad geometry and orthographic camera. No
    // draw happens, and the shared fullscreen geometry is never disposed here.
    let quad;
    ao._fsQuad.render({ render: (object, view) => { quad = { geometry: object.geometry, camera: view }; } });
    if (ao.enabled) for (const [name, material, target] of [
      ['gtao', ao.gtaoMaterial, ao.gtaoRenderTarget],
      ['denoise', ao.pdMaterial, ao.pdRenderTarget],
      ['copy', ao.copyMaterial, composer.writeBuffer],
      ['blend', ao.blendMaterial, composer.writeBuffer],
    ]) result.push({ name, object: new Mesh(quad.geometry, material), camera: quad.camera, scene: emptyScene, target });

    // Let installed OutputPass.render configure its exact color/tone defines.
    // A recording renderer captures the draw without touching the actual GPU.
    const screen = output.renderToScreen;
    try {
      output.renderToScreen = true; // It is the final enabled composer pass.
      output.render({
        outputColorSpace: renderer.outputColorSpace, toneMapping: renderer.toneMapping,
        toneMappingExposure: renderer.toneMappingExposure,
        setRenderTarget() {}, clear() {},
        render(object, view) { result.push({ name: 'output', object: new Mesh(object.geometry, object.material), camera: view, scene: emptyScene, target: null }); },
      }, composer.writeBuffer, composer.readBuffer);
    } finally { output.renderToScreen = screen; }
    return result;
  }

  async function initialize(options) {
    const targets = [composer.renderTarget1, composer.renderTarget2,
      ...(ao.enabled ? [ao.normalRenderTarget, ao.gtaoRenderTarget, ao.pdRenderTarget] : [])];
    const textures = ao.enabled ? [ao.gtaoNoiseTexture, ao.pdNoiseTexture] : [];
    for (const value of [...targets, ...textures]) {
      if (!live || !options.active()) return false;
      options.check();
      const target = targets.includes(value);
      const cache = target ? initializedTargets : initializedTextures;
      const key = target ? `${value.width}:${value.height}:${value.samples}` : value.version;
      if (cache.get(value) === key) continue;
      const previous = renderer.getRenderTarget(), face = renderer.getActiveCubeFace(), mip = renderer.getActiveMipmapLevel();
      const start = performance.now();
      try {
        if (target) renderer.initRenderTarget(value);
        else renderer.initTexture(value);
        cache.set(value, key);
      } finally { renderer.setRenderTarget(previous, face, mip); }
      options.onOperation({ name: target ? 'effect-target' : 'effect-noise', durationMs: performance.now() - start });
      if (!await options.pause()) return false;
    }
    return live && options.active();
  }

  async function compile(options) {
    if (!live || !options.active()) return null;
    const materials = new Set(), startSignature = signature();
    const tasks = jobs();
    for (const task of tasks) {
      if (!live || !options.active()) return null;
      options.check();
      const previous = renderer.getRenderTarget(), face = renderer.getActiveCubeFace(), mip = renderer.getActiveMipmapLevel();
      const start = performance.now();
      try {
        renderer.setRenderTarget(task.target);
        for (const material of renderer.compile(task.object, task.camera, task.scene)) materials.add(material);
      } finally { renderer.setRenderTarget(previous, face, mip); }
      options.onOperation({ name: task.name, durationMs: performance.now() - start });
      if (!await options.pause()) return null;
    }
    return live && signature() === startSignature ? materials : null;
  }

  return { initialize, compile, signature, dispose() {
    if (!live) return;
    live = false; clearInitialized();
    renderer.domElement.removeEventListener('webglcontextrestored', clearInitialized);
  } };
}

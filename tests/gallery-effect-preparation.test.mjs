import test from 'node:test';
import assert from 'node:assert/strict';
import {
  Scene, PerspectiveCamera, Mesh, MeshStandardMaterial, BoxGeometry, Float32BufferAttribute,
  InstancedMesh, WebGLRenderTarget, HalfFloatType, Color, SRGBColorSpace, AgXToneMapping,
  DirectionalLight, PCFSoftShadowMap,
} from 'three';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { WebGLPrograms } from 'three/src/renderers/webgl/WebGLPrograms.js';
import { WebGLRenderStates } from 'three/src/renderers/webgl/WebGLRenderStates.js';
import { createGalleryEffectPreparation } from '../src/GalleryEffectPreparation.mjs';

function fixture() {
  const scene = new Scene(), camera = new PerspectiveCamera(40, 16 / 9, .1, 100);
  const sun = new DirectionalLight(); sun.castShadow = true; scene.add(sun);
  for (let i = 0; i < 9; i++) {
    const geometry = new BoxGeometry();
    geometry.setAttribute('color', new Float32BufferAttribute(new Float32Array(geometry.attributes.position.count * (i % 2 ? 3 : 4)), i % 2 ? 3 : 4));
    if (i === 8) geometry.morphAttributes.position = [geometry.attributes.position.clone()];
    scene.add(i === 7 ? new InstancedMesh(geometry, new MeshStandardMaterial(), 2) : new Mesh(geometry, new MeshStandardMaterial()));
  }
  const ao = new GTAOPass(scene, camera, 960, 540), output = new OutputPass();
  ao.updateGtaoMaterial({ radius: .7, thickness: .8, distanceExponent: 2, distanceFallOff: .7, samples: 16, screenSpaceRadius: false });
  ao.updatePdMaterial({ radius: 5, rings: 2, samples: 8, depthPhi: 2, normalPhi: 4 });
  ao.blendIntensity = .8;
  const target1 = new WebGLRenderTarget(1280, 720, { type: HalfFloatType, samples: 2 }), target2 = target1.clone();
  const composer = { renderTarget1: target1, renderTarget2: target2, readBuffer: target2, writeBuffer: target1 };
  let target = { name: 'prior' }, face = 2, mip = 1;
  const prior = target, records = [], initialized = [], clearColor = new Color();
  const renderer = {
    domElement: new EventTarget(), outputColorSpace: SRGBColorSpace, toneMapping: AgXToneMapping, toneMappingExposure: .82,
    state: { buffers: { depth: { getReversed: () => false } } }, shadowMap: { enabled: true, type: PCFSoftShadowMap },
    getRenderTarget: () => target, getActiveCubeFace: () => face, getActiveMipmapLevel: () => mip,
    setRenderTarget(value, nextFace = 0, nextMip = 0) { target = value; face = nextFace; mip = nextMip; },
    initRenderTarget(value) { initialized.push(value); }, initTexture(value) { initialized.push(value); },
    getClearColor(value) { return value.copy(clearColor); }, setClearColor(value) { clearColor.set(value); },
    getClearAlpha: () => 1, setClearAlpha() {}, autoClear: true, clear() {},
  };
  const extensions = { has: name => name === 'KHR_parallel_shader_compile' };
  const programs = WebGLPrograms(renderer, { get: x => x }, { get: x => x }, extensions,
    { precision: 'highp', vertexTextures: true, logarithmicDepthBuffer: false, getMaxPrecision: x => x }, {}, { numPlanes: 0, numIntersection: 0 });
  const states = WebGLRenderStates(extensions), empty = new Scene();
  function record(object, view, targetScene, material) {
    const state = states.get(targetScene); state.init(view);
    targetScene.traverseVisible(o => { if (o.isLight) { state.pushLight(o); if (o.castShadow) state.pushShadow(o); } });
    state.setupLights();
    const parameters = programs.getParameters(material, state.state.lights.state, state.state.shadowsArray, targetScene, object);
    records.push({ material, key: programs.getProgramCacheKey(parameters), target, geometry: object.geometry });
  }
  renderer.compile = (object, view, targetScene = empty) => {
    const materials = new Set();
    object.traverse(o => { if (!o.isMesh) return; record(o, view, targetScene, o.material); materials.add(o.material); });
    return materials;
  };
  renderer.render = (object, view) => {
    const targetScene = object.isScene ? object : empty;
    object.traverseVisible(o => { if (o.isMesh) record(o, view, targetScene, targetScene.overrideMaterial ?? o.material); });
  };
  const options = extra => ({ active: () => true, check() {}, pause: async () => true, onOperation() {}, ...extra });
  return { scene, camera, ao, output, composer, renderer, records, initialized, options,
    prepare: createGalleryEffectPreparation(renderer, scene, camera, composer, ao, output),
    restore() { renderer.setRenderTarget(prior, 2, 1); },
    assertRestored() { assert.equal(target, prior); assert.equal(face, 2); assert.equal(mip, 1); },
  };
}

test('effect preparation has the same installed Three program keys as the actual GTAO and Output passes', async () => {
  const f = fixture();
  const before = f.scene.children.filter(o => o.isMesh).map(object => ({ object, geometry: object.geometry, material: object.material, parent: object.parent, visible: object.visible }));
  f.ao.render(f.renderer, f.composer.writeBuffer, f.composer.readBuffer);
  f.output.renderToScreen = true; f.output.render(f.renderer, f.composer.writeBuffer, f.composer.readBuffer);
  const expected = new Set(f.records.map(r => r.key)); f.records.length = 0; f.restore();
  const materialSet = await f.prepare.compile(f.options());
  assert.equal(materialSet.size, 6);
  assert.deepEqual(new Set(f.records.map(r => r.key)), expected);
  assert.ok(f.records.length < before.length + 5, 'normal geometry variants deduplicate repeated meshes');
  for (const saved of before) for (const key of ['geometry', 'material', 'parent', 'visible']) assert.equal(saved.object[key], saved[key]);
  assert.equal(f.scene.overrideMaterial, null); f.assertRestored(); f.prepare.dispose();
});

test('owned target/noise initialization yields, reinitializes on resize/context restore, and never renders', async () => {
  const f = fixture(); let yields = 0;
  const options = f.options({ pause: async () => { yields++; return true; } });
  assert.equal(await f.prepare.initialize(options), true);
  assert.equal(f.initialized.length, 7); assert.equal(yields, 7); assert.equal(f.records.length, 0); f.assertRestored();
  await f.prepare.initialize(options); assert.equal(f.initialized.length, 7);
  f.composer.renderTarget1.setSize(800, 600); await f.prepare.initialize(options); assert.equal(f.initialized.length, 8);
  f.renderer.domElement.dispatchEvent(new Event('webglcontextrestored'));
  await f.prepare.initialize(options); assert.equal(f.initialized.length, 15);
  f.prepare.dispose(); f.prepare.dispose();
  assert.equal(await f.prepare.initialize(options), false);
});

test('cancel, compile exception and pipeline disposal restore target without disposing shared resources', async () => {
  const f = fixture(); let disposed = 0;
  f.ao.gtaoMaterial.addEventListener('dispose', () => disposed++);
  f.composer.readBuffer.addEventListener('dispose', () => disposed++);
  assert.equal(await f.prepare.compile(f.options({ pause: async () => false })), null); f.assertRestored();
  f.renderer.compile = () => { throw new Error('deliberate compile exception'); };
  await assert.rejects(f.prepare.compile(f.options()), /deliberate/); f.assertRestored();
  f.prepare.dispose(); assert.equal(await f.prepare.compile(f.options()), null); assert.equal(disposed, 0);
});

test('disabled AO prepares only unchanged final Output and pipeline changes invalidate an in-flight compile', async () => {
  const f = fixture(); f.ao.enabled = false;
  assert.equal((await f.prepare.compile(f.options())).size, 1);
  assert.equal(f.records.length, 1); assert.equal(f.records[0].material, f.output.material); f.assertRestored();
  f.ao.enabled = true;
  assert.equal(await f.prepare.compile(f.options({ pause: async () => { f.ao.enabled = false; return true; } })), null);
  f.prepare.dispose();
});

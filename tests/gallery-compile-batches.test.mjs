import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  BackSide, FrontSide, DoubleSide, Scene, Camera, Mesh, Group, InstancedMesh,
  BoxGeometry, Float32BufferAttribute, MeshStandardMaterial, Texture,
  DirectionalLight, HemisphereLight, RectAreaLight, CubeUVReflectionMapping,
  SRGBColorSpace, PCFSoftShadowMap,
} from 'three';
import { WebGLPrograms } from 'three/src/renderers/webgl/WebGLPrograms.js';
import { WebGLRenderStates } from 'three/src/renderers/webgl/WebGLRenderStates.js';
import { compileGalleryInBatches } from '../src/GalleryCompileBatches.mjs';

// Execute the installed renderer's actual compile traversal/side handling and
// actual program parameter/key functions, with no fake GPU timing claim.
const rendererSource = fs.readFileSync(new URL('../node_modules/three/src/renderers/WebGLRenderer.js', import.meta.url), 'utf8');
const prepareStart = rendererSource.indexOf('function prepareMaterial(');
const prepareSource = rendererSource.slice(prepareStart, rendererSource.indexOf('\n\t\t/**', prepareStart));
const compileStart = rendererSource.indexOf('this.compile = function');
const compileSource = rendererSource.slice(compileStart, rendererSource.indexOf('// compileAsync', compileStart));

function harness() {
  const originalTarget = { name: 'original' }, target = { name: 'linear-offscreen' };
  let currentTarget = originalTarget, face = 2, mip = 1;
  const renderer = {
    outputColorSpace: SRGBColorSpace,
    state: { buffers: { depth: { getReversed: () => false } } },
    shadowMap: { enabled: true, type: PCFSoftShadowMap },
    getRenderTarget: () => currentTarget,
    getActiveCubeFace: () => face, getActiveMipmapLevel: () => mip,
    setRenderTarget: (value, nextFace = 0, nextMip = 0) => { currentTarget = value; face = nextFace; mip = nextMip; },
  };
  const extensions = { has: name => name === 'KHR_parallel_shader_compile' };
  const programs = WebGLPrograms(renderer, { get: x => x }, { get: x => x }, extensions,
    { precision: 'highp', vertexTextures: true, logarithmicDepthBuffer: false, getMaxPrecision: x => x }, {},
    { numPlanes: 0, numIntersection: 0 });
  const records = [];
  new Function('renderStates', 'programs', 'records', 'BackSide', 'FrontSide', 'DoubleSide', `
    let currentRenderState; const renderStateStack = [];
    function getProgram(material, scene, object) {
      const state = currentRenderState.state;
      const parameters = programs.getParameters(material, state.lights.state, state.shadowsArray, scene, object);
      records.push({object, material, key: programs.getProgramCacheKey(parameters), scene,
        lights: state.lightsArray.map(light => light.uuid).sort()});
    }
    ${prepareSource}
    ${compileSource}
  `).call(renderer, WebGLRenderStates(extensions), programs, records, BackSide, FrontSide, DoubleSide);
  return { renderer, records, target, originalTarget,
    restored() { assert.equal(currentTarget, originalTarget); assert.equal(face, 2); assert.equal(mip, 1); },
  };
}

function fixture() {
  const scene = new Scene(), camera = new Camera(), holder = new Group();
  scene.add(holder);
  const env = new Texture({ height: 256 }); env.mapping = CubeUVReflectionMapping; scene.environment = env;
  const sun = new DirectionalLight(); sun.castShadow = true;
  scene.add(sun, new HemisphereLight(), new RectAreaLight());
  const hiddenLight = new DirectionalLight(); hiddenLight.visible = false; scene.add(hiddenLight);
  const materials = Array.from({ length: 170 }, (_, i) => {
    const m = new MeshStandardMaterial({ vertexColors: i % 3 === 0, transparent: i % 5 === 0, side: i % 5 === 0 ? DoubleSide : FrontSide });
    m.customProgramCacheKey = () => `fixture-surface-${i % 8}`;
    if (i % 4 === 0) { m.map = new Texture(); m.map.channel = i % 2; }
    if (i % 7 === 0) m.envMap = env;
    return m;
  });
  const geometries = Array.from({ length: 3 }, (_, i) => {
    const geometry = new BoxGeometry();
    geometry.setAttribute('color', new Float32BufferAttribute(new Float32Array(geometry.attributes.position.count * (i === 1 ? 4 : 3)), i === 1 ? 4 : 3));
    if (i === 2) geometry.morphAttributes.position = [geometry.attributes.position.clone()];
    return geometry;
  });
  const meshes = Array.from({ length: 210 }, (_, i) => {
    const mesh = i % 13 === 0 ? new InstancedMesh(geometries[i % 3], materials[i % 170], 2) : new Mesh(geometries[i % 3], materials[i % 170]);
    mesh.visible = i % 11 !== 0; holder.add(mesh); return mesh;
  });
  // A nested renderable must appear once, despite compile traversing children.
  meshes[0].add(meshes[209]);
  return { scene, camera, materials, meshes };
}

const options = extra => ({ active: () => true, check() {}, pause: async () => true, onBatch() {}, ...extra });

test('batched actual Three compile preserves 170 materials, all program keys, lights and object flags', async () => {
  const h = harness(), f = fixture();
  const before = f.meshes.map(o => ({ object: o, parent: o.parent, geometry: o.geometry, material: o.material, visible: o.visible, children: [...o.children] }));
  h.renderer.setRenderTarget(h.target);
  const full = h.renderer.compile(f.scene, f.camera);
  const expected = [...h.records]; h.records.length = 0;
  h.renderer.setRenderTarget(h.originalTarget, 2, 1);
  const batches = [];
  const result = await compileGalleryInBatches(h.renderer, f.scene, f.camera, h.target, options({ onBatch: batch => batches.push(batch) }));
  assert.equal(result.invalidated, false); assert.equal(result.fallbackReason, null);
  assert.equal(full.size, 170); assert.deepEqual(result.materials, full);
  assert.deepEqual(h.records, expected); assert.ok(batches.length > 1);
  assert.ok(batches.every(batch => batch.count <= 32));
  for (const saved of before) {
    for (const key of ['parent', 'geometry', 'material', 'visible']) assert.equal(saved.object[key], saved[key]);
    assert.deepEqual(saved.object.children, saved.children);
  }
  h.restored();
});

test('detached future mesh is not compiled after a yield', async () => {
  const h = harness(), f = fixture(); let changed = false;
  const victim = f.meshes[180];
  const result = await compileGalleryInBatches(h.renderer, f.scene, f.camera, h.target, options({ pause: async () => {
    if (!changed) { victim.removeFromParent(); changed = true; } return true;
  } }));
  assert.equal(result.invalidated, true); assert.ok(!h.records.some(record => record.object === victim)); h.restored();
});

test('replacement material invalidates an already compiled material union', async () => {
  const h = harness(), f = fixture(); let changed = false;
  const result = await compileGalleryInBatches(h.renderer, f.scene, f.camera, h.target, options({ pause: async () => {
    if (!changed) { f.meshes[0].material = new MeshStandardMaterial(); changed = true; } return true;
  } }));
  assert.equal(result.invalidated, true); h.restored();
});

test('cancellation and compile exceptions restore the original target/face/mip', async () => {
  const h = harness(), f = fixture();
  assert.equal(await compileGalleryInBatches(h.renderer, f.scene, f.camera, h.target, options({ pause: async () => false })), null);
  h.restored();
  h.renderer.compile = () => { throw Error('deliberate compile failure'); };
  await assert.rejects(compileGalleryInBatches(h.renderer, f.scene, f.camera, h.target, options()), /deliberate/);
  h.restored();
});

test('future lights under renderables preserve full-scene light collection', async () => {
  const h = harness(), f = fixture(); f.meshes[1].add(new DirectionalLight());
  h.renderer.setRenderTarget(h.target); h.renderer.compile(f.scene, f.camera);
  const expected = [...h.records]; h.records.length = 0; h.renderer.setRenderTarget(h.originalTarget, 2, 1);
  const result = await compileGalleryInBatches(h.renderer, f.scene, f.camera, h.target, options());
  assert.equal(result.fallbackReason, 'renderable-descendant-light'); assert.equal(result.calls, 1);
  assert.deepEqual(h.records, expected); assert.equal(result.invalidated, false); h.restored();
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  BoxGeometry, DirectionalLight, Group, LOD, Mesh, MeshBasicMaterial,
  PCFSoftShadowMap, PerspectiveCamera, Scene,
} from 'three';
import { WebGLShadowMap } from 'three/src/renderers/webgl/WebGLShadowMap.js';
import { prepareDetailLOD } from '../src/GalleryDetailLOD.ts';
import { installGalleryStaticDetailShadows } from '../src/GalleryStaticDetailShadows.ts';

const geometry = new BoxGeometry(.2, .2, .2);
const material = new MeshBasicMaterial();
const flags = lod => lod.levels.map(level => level.object.visible);
const nearOnly = lod => lod.levels.every((level, i) => level.object.visible === (i === 0));
function detail(scene, name = 'detail') {
  const lod = new LOD(); lod.name = name; lod.autoUpdate = false; lod.userData.fidelityLOD = name;
  for (let i = 0; i < 3; i++) {
    const holder = new Group(), mesh = new Mesh(geometry, material);
    mesh.name = `${name}-${i}`; mesh.castShadow = true; holder.add(mesh);
    lod.addLevel(holder, i * 10, .15);
  }
  scene.add(lod);
  const camera = new PerspectiveCamera(); camera.position.z = 25; camera.updateMatrixWorld();
  scene.updateMatrixWorld(true); lod.update(camera);
  return lod;
}
function harness(scene = new Scene()) {
  const light = new DirectionalLight(); light.castShadow = true;
  light.position.set(2, 8, 4); scene.add(light, light.target); scene.updateMatrixWorld(true);
  const renderer = {
    domElement: new EventTarget(), info: { render: { calls: 0, triangles: 0 } },
    shadowMap: { enabled: true, autoUpdate: false, needsUpdate: false, render() {} },
  };
  const camera = new PerspectiveCamera(); camera.updateMatrixWorld();
  return { scene, light, renderer, camera };
}
function sourceModelMetadata() {
  const fd = fs.openSync('public/models/gallery-i-fidelity-v11-opt1.glb', 'r');
  try {
    const header = Buffer.alloc(20); fs.readSync(fd, header, 0, 20, 0);
    assert.equal(header.toString('utf8', 0, 4), 'glTF');
    const json = Buffer.alloc(header.readUInt32LE(12)); fs.readSync(fd, json, 0, json.length, 20);
    return JSON.parse(json.toString('utf8'));
  } finally { fs.closeSync(fd); }
}

test('all 88 actual exported groups are supported after real prepareDetailLOD, with exact holder restoration', () => {
  const h = harness();
  const source = new Group(); h.scene.add(source);
  // Use the real GLB metadata and real assembly routine, with lightweight mesh
  // stand-ins. This audits grouping/parts/LOD state, not decoded vertex pixels.
  for (const node of sourceModelMetadata().nodes) {
    if (!node.extras?.fidelity_lod_group) continue;
    const mesh = new Mesh(geometry, material); mesh.userData = { ...node.extras };
    mesh.name = node.name; mesh.castShadow = true; source.add(mesh);
  }
  const { nodes, summary } = prepareDetailLOD(source);
  assert.equal(summary.groups, 88);
  h.camera.position.z = 35; h.camera.updateMatrixWorld();
  nodes.forEach(lod => lod.update(h.camera));
  const before = nodes.map(lod => ({ flags: flags(lod), level: lod.getCurrentLevel(), autoUpdate: lod.autoUpdate }));
  const matrices = nodes.map(lod => lod.matrixWorld.toArray());
  h.renderer.shadowMap.render = () => {
    assert.ok(nodes.every(nearOnly));
    assert.deepEqual(nodes.map(lod => lod.getCurrentLevel()), before.map(s => s.level));
    assert.deepEqual(nodes.map(lod => lod.matrixWorld.toArray()), matrices);
    h.renderer.info.render.calls += 88;
    h.renderer.shadowMap.needsUpdate = false;
  };
  const helper = installGalleryStaticDetailShadows(h.renderer, h.scene);
  assert.equal(helper.diagnostics.groups, 88);
  assert.equal(helper.diagnostics.holders, 264);
  assert.deepEqual(helper.diagnostics.skippedGroups, []);
  assert.equal(helper.diagnostics.safeToIgnoreDetailLODChanges, true);
  h.renderer.shadowMap.render([h.light], h.scene, h.camera);
  assert.deepEqual(nodes.map(lod => ({ flags: flags(lod), level: lod.getCurrentLevel(), autoUpdate: lod.autoUpdate })), before);
  assert.equal(helper.diagnostics.depthScopes, 1);
  assert.equal(helper.diagnostics.lastCalls, 88);
  helper.dispose();
});

test('installed Three r180 shadow traversal draws near casters while prebuilt color list stays far', () => {
  const h = harness(), lod = detail(h.scene);
  const originalFlags = flags(lod), colorList = [];
  h.scene.traverseVisible(object => { if (object.isMesh) colorList.push(object); });
  assert.equal(colorList[0].name, 'detail-2');
  let target = null;
  const depths = [];
  Object.assign(h.renderer, {
    getRenderTarget: () => target, getActiveCubeFace: () => 0, getActiveMipmapLevel: () => 0,
    setRenderTarget: next => { target = next; }, clear() {}, localClippingEnabled: false,
    state: { setBlending() {}, setScissorTest() {}, viewport() {}, buffers: {
      depth: { getReversed: () => false, setTest() {} }, color: { setClear() {} },
    } },
    renderBufferDirect(_camera, _scene, _geometry, _depthMaterial, object) {
      depths.push(object.name); h.renderer.info.render.calls++;
      h.renderer.info.render.triangles += object.geometry.index.count / 3;
    },
  });
  h.renderer.shadowMap = new WebGLShadowMap(h.renderer, { update: object => object.geometry }, { maxTextureSize: 8192 });
  Object.assign(h.renderer.shadowMap, { enabled: true, autoUpdate: false, type: PCFSoftShadowMap });
  const helper = installGalleryStaticDetailShadows(h.renderer, h.scene);
  h.renderer.shadowMap.render([h.light], h.scene, h.camera);
  assert.deepEqual(depths, ['detail-0']);
  assert.deepEqual(colorList.map(object => object.name), ['detail-2']);
  assert.deepEqual(flags(lod), originalFlags);
  assert.equal(h.renderer.shadowMap.needsUpdate, false);
  assert.equal(target, null);
  assert.equal(helper.diagnostics.depthScopes, 1);
  h.renderer.shadowMap.render([h.light], h.scene, h.camera);
  assert.equal(helper.diagnostics.depthScopes, 1, 'clean map must not redraw near geometry');
  helper.dispose(); h.light.shadow.map?.dispose();
});

test('shadow exceptions restore every holder, leave original mesh state untouched, and retain a retry', () => {
  const h = harness(), lod = detail(h.scene), before = flags(lod);
  const hidden = lod.levels[0].object.children[0]; hidden.visible = false; hidden.castShadow = false;
  h.renderer.shadowMap.render = () => { assert.ok(nearOnly(lod)); throw new Error('depth failure'); };
  const helper = installGalleryStaticDetailShadows(h.renderer, h.scene);
  assert.throws(() => h.renderer.shadowMap.render([h.light], h.scene, h.camera), /depth failure/);
  assert.deepEqual(flags(lod), before); assert.equal(hidden.visible, false); assert.equal(hidden.castShadow, false);
  assert.equal(h.renderer.shadowMap.needsUpdate, true); assert.equal(helper.diagnostics.failures, 1);
  helper.dispose();
});

test('nested scopes restore to outer near state then exact original state', () => {
  const h = harness(), lod = detail(h.scene), before = flags(lod);
  let depth = 0;
  h.renderer.shadowMap.render = () => {
    assert.ok(nearOnly(lod));
    if (depth++ === 0) h.renderer.shadowMap.render([h.light], h.scene, h.camera);
    assert.ok(nearOnly(lod)); depth--;
  };
  const helper = installGalleryStaticDetailShadows(h.renderer, h.scene);
  h.renderer.shadowMap.render([h.light], h.scene, h.camera);
  assert.deepEqual(flags(lod), before);
  assert.equal(helper.diagnostics.nestedScopes, 1); assert.equal(helper.diagnostics.restores, 2);
  helper.dispose();
});

test('teardown inside nested original render unwinds once without deferred restoration corrupting state', () => {
  const h = harness(), lod = detail(h.scene), before = flags(lod);
  let helper, depth = 0;
  const original = () => {
    if (depth++ === 0) h.renderer.shadowMap.render([h.light], h.scene, h.camera);
    else helper.dispose();
    assert.deepEqual(flags(lod), before); depth--;
  };
  h.renderer.shadowMap.render = original;
  helper = installGalleryStaticDetailShadows(h.renderer, h.scene);
  h.renderer.shadowMap.render([h.light], h.scene, h.camera);
  assert.equal(h.renderer.shadowMap.render, original); assert.deepEqual(flags(lod), before);
  assert.equal(helper.diagnostics.restores, 2); assert.equal(helper.diagnostics.state, 'disposed');
});

test('StrictMode replacement and downstream wrappers retain ownership and disposed callbacks stay inactive', () => {
  const h = harness(), lod = detail(h.scene), before = flags(lod);
  let originalCalls = 0;
  const original = () => { originalCalls++; };
  h.renderer.shadowMap.render = original;
  const old = installGalleryStaticDetailShadows(h.renderer, h.scene);
  const oldWrapper = h.renderer.shadowMap.render;
  const thirdParty = (...args) => oldWrapper(...args);
  h.renderer.shadowMap.render = thirdParty; old.dispose();
  assert.equal(h.renderer.shadowMap.render, thirdParty);
  h.renderer.shadowMap.render([h.light], h.scene, h.camera);
  assert.equal(originalCalls, 1); assert.deepEqual(flags(lod), before);
  const current = installGalleryStaticDetailShadows(h.renderer, h.scene);
  old.dispose(); assert.equal(h.scene.userData.staticDetailShadow, current.diagnostics);
  h.renderer.shadowMap.render([h.light], h.scene, h.camera);
  assert.equal(current.diagnostics.depthScopes, 1); assert.equal(old.diagnostics.depthScopes, 0);
  current.dispose(); assert.equal(h.renderer.shadowMap.render, thirdParty);
  assert.equal(h.scene.userData.staticDetailShadow, undefined);
});

test('clean/disabled/foreign-scene/disabled-light calls bypass holder mutation', () => {
  const h = harness(), lod = detail(h.scene), before = flags(lod);
  h.renderer.shadowMap.render = () => assert.deepEqual(flags(lod), before);
  const helper = installGalleryStaticDetailShadows(h.renderer, h.scene);
  h.renderer.shadowMap.needsUpdate = false;
  h.renderer.shadowMap.render([h.light], h.scene, h.camera);
  h.renderer.shadowMap.needsUpdate = true; h.renderer.shadowMap.enabled = false;
  h.renderer.shadowMap.render([h.light], h.scene, h.camera);
  h.renderer.shadowMap.enabled = true;
  h.renderer.shadowMap.render([h.light], new Scene(), h.camera);
  h.light.shadow.autoUpdate = false; h.light.shadow.needsUpdate = false;
  h.renderer.shadowMap.render([h.light], h.scene, h.camera);
  h.renderer.shadowMap.render([], h.scene, h.camera);
  assert.equal(helper.diagnostics.depthScopes, 0); helper.dispose();
});

test('real invalidation during a depth scope survives Three clearing flags; context listener is removed', () => {
  const h = harness(); detail(h.scene); h.light.shadow.autoUpdate = false;
  let frames = 0, helper;
  h.renderer.shadowMap.render = () => {
    helper.invalidate('caster-transform');
    h.light.shadow.needsUpdate = false; h.renderer.shadowMap.needsUpdate = false;
  };
  helper = installGalleryStaticDetailShadows(h.renderer, h.scene, { requestFrame: () => frames++ });
  h.renderer.shadowMap.render([h.light], h.scene, h.camera);
  assert.equal(h.renderer.shadowMap.needsUpdate, true); assert.equal(h.light.shadow.needsUpdate, true);
  h.renderer.domElement.dispatchEvent(new Event('webglcontextrestored'));
  assert.equal(helper.diagnostics.lastInvalidationReason, 'webgl-context-restored');
  assert.equal(frames, 3); helper.dispose();
  h.renderer.domElement.dispatchEvent(new Event('webglcontextrestored'));
  helper.invalidate('after-dispose'); assert.equal(frames, 3);
});

test('unsupported dynamic LOD makes suppression unsafe instead of promising stable shadows', () => {
  const h = harness(); detail(h.scene); const dynamic = detail(h.scene, 'dynamic'); dynamic.autoUpdate = true;
  const helper = installGalleryStaticDetailShadows(h.renderer, h.scene);
  assert.equal(helper.diagnostics.safeToIgnoreDetailLODChanges, false);
  assert.equal(helper.diagnostics.skippedGroups.length, 1); helper.dispose();
});

test('actual renderer source retains the narrow adapter ordering and shadow traversal contract', () => {
  const renderer = fs.readFileSync('node_modules/three/src/renderers/WebGLRenderer.js', 'utf8');
  const shadow = fs.readFileSync('node_modules/three/src/renderers/webgl/WebGLShadowMap.js', 'utf8');
  assert.equal(JSON.parse(fs.readFileSync('node_modules/three/package.json', 'utf8')).version, '0.180.0');
  const projected = renderer.indexOf('projectObject( scene, camera, 0, _this.sortObjects );');
  const depth = renderer.indexOf('shadowMap.render( shadowsArray, scene, camera );', projected);
  const color = renderer.indexOf('renderScene( currentRenderList, scene, camera );', depth);
  assert.ok(projected >= 0 && depth > projected && color > depth);
  assert.match(shadow, /if \( object\.visible === false \) return/);
  assert.doesNotMatch(shadow, /\.update\( camera \)/);
});

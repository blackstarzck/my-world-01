import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Group, Mesh, PerspectiveCamera, OrthographicCamera, Vector3 } from 'three';
import { createGalleryVisibility, visibleGalleryRooms } from '../src/GalleryVisibility.mjs';

const layout = JSON.parse(fs.readFileSync('src/data/layout.json', 'utf8'));
const room = id => layout.rooms.find(r => r.id === id);
const point = (r, u, v = 0, y = 1.65) => [r.origin[0] + u * r.outward[0] + v * r.outward[2], y, r.origin[2] + u * r.outward[2] - v * r.outward[0]];
const camera = (position, target, fov = 60) => {
  const c = new PerspectiveCamera(fov, 16 / 9, .08, 250);
  c.position.fromArray(position); c.lookAt(new Vector3(...target)); c.updateMatrixWorld(); return c;
};
const seen = c => new Set(visibleGalleryRooms(layout, c).visibleRooms);

test('looking deeper into each closed room retains that room and C0 only', () => {
  for (const r of layout.rooms) assert.deepEqual(seen(camera(point(r, 15), point(r, 30))), new Set(['C0', r.id]));
});

test('reverse views preserve the opposite room through the central hall', () => {
  for (const r of layout.rooms) {
    const opposite = layout.rooms.find(q => q.outward[0] * r.outward[0] + q.outward[2] * r.outward[2] < -.99);
    const result = seen(camera(point(r, 15), point(opposite, 15), 45));
    assert.ok(result.has(r.id)); assert.ok(result.has('C0')); assert.ok(result.has(opposite.id));
  }
});

test('hall views retain every doorway actually inside the view', () => {
  for (const r of layout.rooms) {
    const result = seen(camera([0, 1.65, 0], point(r, 15), 40));
    assert.ok(result.has('C0')); assert.ok(result.has(r.id));
    assert.ok(result.size < 5, 'offscreen closed wings need not be drawn');
  }
});

test('doorway thresholds, exterior and unsupported cameras fail open', () => {
  for (const r of layout.rooms) for (const u of [-1.3, 0, 1.4]) {
    const result = visibleGalleryRooms(layout, camera(point(r, u), point(r, 25)));
    assert.equal(result.fallback, true); assert.equal(result.visibleRooms.length, 5);
  }
  assert.equal(visibleGalleryRooms(layout, camera([100, 30, 100], [0, 0, 0])).fallback, true);
  assert.equal(visibleGalleryRooms(layout, new OrthographicCamera()).visibleRooms.length, 5);
});

test('a mirrored floor camera uses the portal view without losing its occupied room', () => {
  const r = room('R3'), opposite = room('R2');
  const reflected = camera(point(r, 15, 0, -1.646), point(opposite, 15, 0, 1.65));
  const result = visibleGalleryRooms(layout, reflected);
  assert.equal(result.currentRoom, 'R3'); assert.ok(result.visibleRooms.includes('R2'));
});

test('near-edge doorway rays remain visible across aspect and camera tilt', () => {
  for (const r of layout.rooms) for (const v of [-3.7, 0, 3.7]) for (const y of [1.65, 7.5]) {
    const c = camera([0, y, 0], point(r, 0, v, y), 12); c.aspect = .55; c.updateProjectionMatrix();
    assert.ok(seen(c).has(r.id), `${r.id} edge ${v}/${y}`);
  }
});

test('temporary visibility preserves shell, C0, source-hidden meshes and LOD holders', () => {
  const scene = new Group(), holder = new Group(); holder.visible = false; scene.add(holder);
  const mesh = (r, role, parent = scene) => { const m = new Mesh(); m.userData = { room_id: r, element_role: role }; parent.add(m); return m; };
  const local = mesh('R3', 'plant'), distant = mesh('R2', 'capital'), wall = mesh('R2', 'wall');
  const hall = mesh('C0', 'ornament'), hidden = mesh('R2', 'artwork'); hidden.visible = false;
  const inactive = mesh('R2', 'capital', holder);
  const inherited = new Group(); inherited.userData = { room_id: 'R1', element_role: 'molding' }; scene.add(inherited);
  const primitive = new Mesh(); inherited.add(primitive);
  const controller = createGalleryVisibility(scene, layout);
  const restore = controller.apply(camera(point(room('R3'), 15), point(room('R3'), 30)));
  assert.equal(local.visible, true); assert.equal(distant.visible, false); assert.equal(primitive.visible, false);
  assert.equal(wall.visible, true); assert.equal(hall.visible, true); assert.equal(hidden.visible, false); assert.equal(holder.visible, false);
  restore(); restore();
  assert.equal(distant.visible, true); assert.equal(primitive.visible, true); assert.equal(inactive.visible, true);
  assert.equal(hidden.visible, false); assert.equal(holder.visible, false);
  const restoreAgain = controller.apply(camera(point(room('R3'), 15), point(room('R3'), 30)));
  controller.dispose(); restoreAgain();
  assert.equal(distant.visible, true); assert.equal(hidden.visible, false);
});

test('unchanged main/AO camera shares cached room visibility; rotation, projection and layers invalidate it', () => {
  const controller = createGalleryVisibility(new Group(), layout);
  const r = room('R3'), c = camera(point(r, 15), point(r, 30));
  controller.apply(c)();
  assert.equal(controller.diagnostics.cacheMisses, 1);
  controller.apply(c)();
  assert.equal(controller.diagnostics.cacheHit, true);
  assert.equal(controller.diagnostics.cacheHits, 1);
  assert.equal(controller.diagnostics.cacheMisses, 1);
  c.lookAt(new Vector3(...point(room('R2'), 15)));
  controller.apply(c)();
  assert.equal(controller.diagnostics.cacheHit, false);
  assert.equal(controller.diagnostics.cacheMisses, 2);
  assert.ok(controller.diagnostics.visibleRooms.includes('R2'));
  c.aspect = .55; c.updateProjectionMatrix(); // A panel opening changes the frustum.
  controller.apply(c)();
  assert.equal(controller.diagnostics.cacheMisses, 3);
  assert.deepEqual(controller.diagnostics.visibleRooms, visibleGalleryRooms(layout, c).visibleRooms);
  c.layers.enable(2);
  controller.apply(c)();
  assert.equal(controller.diagnostics.cacheMisses, 4);
  controller.apply(c)();
  assert.equal(controller.diagnostics.cacheHit, true);
  controller.dispose();
});

test('reflection cameras have independent caches and recompute mirrored/oblique projections', () => {
  const controller = createGalleryVisibility(new Group(), layout);
  const r = room('R3'), target = point(room('R2'), 15);
  const main = camera(point(r, 15), target), reflection = camera(point(r, 15, 0, -1.646), target);
  controller.apply(main)(); controller.apply(reflection)();
  assert.equal(controller.diagnostics.cacheMisses, 2);
  assert.equal(controller.diagnostics.currentRoom, 'R3');
  assert.ok(controller.diagnostics.visibleRooms.includes('R2'));
  controller.apply(main)();
  assert.equal(controller.diagnostics.cacheHit, true);
  controller.apply(reflection)();
  assert.equal(controller.diagnostics.cacheHit, true);
  reflection.projectionMatrix.elements[2] += .01; // Oblique clipping can change without aspect/FOV changes.
  controller.apply(reflection)();
  assert.equal(controller.diagnostics.cacheMisses, 3);
  assert.deepEqual(controller.diagnostics.visibleRooms, visibleGalleryRooms(layout, reflection).visibleRooms);
  reflection.position.y = 1.65;
  controller.apply(reflection)();
  assert.equal(controller.diagnostics.cacheMisses, 4);
  controller.apply(main)();
  assert.equal(controller.diagnostics.cacheHit, true);
  controller.dispose();
});

test('cache hits observe fresh LOD visibility and restore only this pass, including nested passes', () => {
  const scene = new Group(), holder = new Group(); scene.add(holder);
  const near = new Mesh(), far = new Mesh(); holder.add(near, far);
  near.userData = far.userData = { room_id: 'R2', element_role: 'plant' };
  far.visible = false;
  const controller = createGalleryVisibility(scene, layout);
  const c = camera(point(room('R3'), 15), point(room('R3'), 30));
  controller.apply(c)();
  assert.equal(near.visible, true); assert.equal(far.visible, false);
  // LOD changes between passes must not be reverted to the previously cached state.
  near.visible = false; far.visible = true; holder.visible = false;
  const restoreOuter = controller.apply(c);
  assert.equal(controller.diagnostics.cacheHit, true);
  assert.equal(controller.diagnostics.hidden, 1);
  assert.equal(near.visible, false); assert.equal(far.visible, false);
  const restoreInner = controller.apply(c);
  assert.equal(controller.diagnostics.hidden, 0);
  restoreInner();
  assert.equal(far.visible, false, 'inner pass must not undo outer culling');
  restoreOuter(); restoreOuter();
  assert.equal(near.visible, false); assert.equal(far.visible, true); assert.equal(holder.visible, false);
  const restore = controller.apply(c);
  controller.dispose(); restore();
  assert.equal(near.visible, false); assert.equal(far.visible, true); assert.equal(holder.visible, false);
});

test('a parent transform invalidates a cached camera even before the scene updates', () => {
  const parent = new Group(), c = camera([0, 1.65, 0], point(room('R3'), 15)); parent.add(c);
  const controller = createGalleryVisibility(new Group(), layout);
  controller.apply(c)(); controller.apply(c)();
  assert.equal(controller.diagnostics.cacheHit, true);
  parent.position.x = 100;
  controller.apply(c)();
  assert.equal(controller.diagnostics.cacheHit, false);
  assert.equal(controller.diagnostics.reason, 'outside-known-interior');
  assert.equal(controller.diagnostics.visibleRooms.length, 5);
  controller.dispose();
});

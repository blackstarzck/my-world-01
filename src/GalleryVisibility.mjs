import { Frustum, Matrix4, Plane, Vector3 } from 'three';

// Appearance-only objects. The building shell, roof, supports, glazing and
// central hall remain available even when an adjoining interior is occluded.
const INTERIOR_ROLES = new Set(['capital', 'ornament', 'carving', 'molding', 'plant', 'planter', 'soil', 'bench', 'frame', 'canvas_back', 'artwork', 'web_artwork']);
const PORTAL_MARGIN = .35;
const PLANE_EPSILON = 1e-5;

function clippedPolygon(polygon, planes) {
  let points = polygon;
  for (const plane of planes) {
    if (!points.length) break;
    const next = [];
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[(i + 1) % points.length];
      const da = plane.distanceToPoint(a), db = plane.distanceToPoint(b);
      const insideA = da >= -PLANE_EPSILON, insideB = db >= -PLANE_EPSILON;
      if (insideA) next.push(a);
      if (insideA !== insideB && Math.abs(da - db) > 1e-12) next.push(a.clone().lerp(b, da / (da - db)));
    }
    points = next;
  }
  return points;
}

function portalPolygon(room, portal) {
  // A rectangle containing the actual arched opening deliberately overestimates
  // visibility. Use the inner mouth; ignore its thickness and carved intrusions.
  const width = portal.width / 2 + PORTAL_MARGIN;
  const top = (portal.crown ?? portal.spring + portal.width / 2) + PORTAL_MARGIN;
  const lateral = new Vector3(room.outward[2], 0, -room.outward[0]).normalize();
  const center = new Vector3(...portal.origin);
  return [[-width, -PORTAL_MARGIN], [width, -PORTAL_MARGIN], [width, top], [-width, top]]
    .map(([v, y]) => center.clone().addScaledVector(lateral, v).setY(y));
}

function conePlanes(eye, polygon) {
  const center = polygon.reduce((sum, p) => sum.add(p), new Vector3()).multiplyScalar(1 / polygon.length);
  const planes = [];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    const normal = new Vector3().crossVectors(a.clone().sub(eye), b.clone().sub(eye));
    if (normal.lengthSq() < 1e-14) continue;
    const plane = new Plane().setFromNormalAndCoplanarPoint(normal.normalize(), eye);
    if (plane.distanceToPoint(center) < 0) plane.negate();
    planes.push(plane);
  }
  return planes;
}

function updateCameraMatrices(camera) {
  camera?.updateMatrixWorld();
  // A parent may have changed since the last render. Preserve the old
  // getWorldPosition() behavior without allocating a temporary position on hits.
  if (camera?.parent) camera.updateWorldMatrix(true, false);
}

function visibleRoomsWithUpdatedCamera(layout, camera) {
  const all = ['C0', ...layout.rooms.map(room => room.id)];
  const fallback = reason => ({ visibleRooms: all, currentRoom: null, reason, fallback: true });
  if (!camera?.isPerspectiveCamera) return fallback('unsupported-camera');
  const eye = new Vector3().setFromMatrixPosition(camera.matrixWorld);
  if (![eye.x, eye.y, eye.z, ...camera.projectionMatrix.elements].every(Number.isFinite)) return fallback('invalid-camera');
  const y = Math.abs(eye.y);
  const locations = layout.rooms.map(room => {
    const dx = eye.x - room.origin[0], dz = eye.z - room.origin[2];
    return { room, u: dx * room.outward[0] + dz * room.outward[2], v: dx * room.outward[2] - dz * room.outward[0] };
  });
  if (locations.some(({ room, u, v }) => u > -1.8 && u < 1.5 && Math.abs(v) < room.width / 2 + .5)) return fallback('portal-transition');
  const occupied = locations.find(({ room, u, v }) => u >= 0 && u <= room.length && Math.abs(v) <= room.width / 2 && y <= (room.h ?? room.clearSize?.[2] ?? 20) + .5);
  const inHall = Math.abs(eye.x) <= layout.hallWidth / 2 && Math.abs(eye.z) <= layout.hallWidth / 2 && y <= (layout.hallSpring ?? 20) + layout.hallWidth / 2;
  if (!occupied && !inHall) return fallback('outside-known-interior');
  const portals = new Map(layout.portals.map(portal => [portal.room, portal]));
  if (layout.rooms.some(room => !portals.has(room.id))) return fallback('incomplete-portals');
  const projection = new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  const planes = new Frustum().setFromProjectionMatrix(projection).planes;
  let throughPlanes = planes;
  const currentRoom = occupied?.room.id ?? 'C0';
  const visible = new Set(['C0', currentRoom]);
  if (occupied) {
    const aperture = clippedPolygon(portalPolygon(occupied.room, portals.get(currentRoom)), planes);
    if (!aperture.length) return { visibleRooms: [...visible], currentRoom, reason: 'entry-outside-view', fallback: false };
    // Degenerate grazing intersections stay visible rather than flickering.
    if (aperture.length < 3) return fallback('grazing-portal');
    const cone = conePlanes(eye, aperture);
    if (cone.length < 3) return fallback('degenerate-portal');
    throughPlanes = [...planes, ...cone];
  }
  for (const room of layout.rooms) {
    if (room.id === currentRoom) continue;
    if (clippedPolygon(portalPolygon(room, portals.get(room.id)), throughPlanes).length) visible.add(room.id);
  }
  return { visibleRooms: [...visible], currentRoom, reason: occupied ? 'through-entry-portals' : 'hall-portals', fallback: false };
}

/** Conservative room visibility for the fixed four-room / central-hall plan.
 * Floor-reflection cameras use their real frustum and eye; only occupancy uses
 * abs(Y). No room is culled for unsupported/exterior/threshold camera positions.
 */
export function visibleGalleryRooms(layout, camera) {
  updateCameraMatrices(camera);
  return visibleRoomsWithUpdatedCamera(layout, camera);
}

function sameMatrix(saved, current) {
  for (let i = 0; i < 16; i++) if (saved[i] !== current[i]) return false;
  return true;
}

/** Apply only around a color/normal/reflection render, then invoke the returned
 * restore in finally. The caller MUST skip apply while refreshing shadow maps:
 * WebGLShadowMap also obeys object.visible and needs the complete caster set.
 * No LOD holder, matrix, material, geometry, castShadow or receiveShadow changes.
 * Recreate the controller when layout/model membership changes. Only geometric
 * camera visibility is cached; live object.visible / LOD state is never cached.
 */
export function createGalleryVisibility(scene, layout) {
  const roomIds = new Set(layout.rooms.map(room => room.id));
  const slotRooms = new Map((layout.artworks ?? []).map(art => [art.id, art.room]));
  const entries = [];
  scene.traverse(object => {
    if (!object.isMesh) return;
    let room, role;
    for (let node = object; node; node = node.parent) {
      room ??= node.userData.room_id ?? slotRooms.get(node.userData.slot_id);
      role ??= node.userData.element_role;
      if (room && role) break;
      if (node === scene) break;
    }
    if (roomIds.has(room) && INTERIOR_ROLES.has(role)) entries.push({ object, room });
  });
  const pending = new Set();
  let cameraCache = new WeakMap();
  let cacheHits = 0, cacheMisses = 0;
  let disposed = false;
  let diagnostics = { visibleRooms: ['C0', ...roomIds], currentRoom: null, reason: 'not-applied', fallback: true, candidates: entries.length, hidden: 0, cacheHit: false, cacheHits, cacheMisses };
  return {
    get diagnostics() { return diagnostics; },
    apply(camera) {
      if (disposed) return () => {};
      updateCameraMatrices(camera);
      const world = camera.matrixWorld.elements, projection = camera.projectionMatrix.elements;
      let cached = cameraCache.get(camera);
      const cacheHit = !!cached && cached.layersMask === camera.layers.mask
        && sameMatrix(cached.world, world) && sameMatrix(cached.projection, projection);
      if (cacheHit) cacheHits++;
      else {
        cacheMisses++;
        const visibility = visibleRoomsWithUpdatedCamera(layout, camera);
        const rooms = new Set(visibility.visibleRooms);
        if (!cached) cached = { world: new Float64Array(16), projection: new Float64Array(16) };
        cached.world.set(world);
        cached.projection.set(projection);
        cached.layersMask = camera.layers.mask;
        cached.visibility = visibility;
        // Membership depends only on the frozen scene/layout and camera state.
        // Re-read visible on every apply, including repeated main / GTAO passes.
        cached.hiddenCandidates = entries.filter(({ room }) => !rooms.has(room)).map(({ object }) => object);
        cameraCache.set(camera, cached);
      }
      const changed = [];
      for (const object of cached.hiddenCandidates) {
        if (object.visible) { changed.push(object); object.visible = false; }
      }
      diagnostics = { ...cached.visibility, candidates: entries.length, hidden: changed.length, cacheHit, cacheHits, cacheMisses };
      let restored = false;
      const restore = () => {
        if (restored) return;
        restored = true;
        for (const object of changed) object.visible = true;
        pending.delete(restore);
      };
      pending.add(restore);
      return restore;
    },
    dispose() {
      // Reverse nesting, if teardown interrupts a nested render.
      for (const restore of [...pending].reverse()) restore();
      cameraCache = new WeakMap();
      disposed = true;
    },
  };
}

import { Group, LOD, Vector3 } from 'three';
import type { Object3D } from 'three';

/** Assemble exported detail levels without changing shared geometry or transforms. */
export function prepareDetailLOD(scene: Object3D) {
  const groups = new Map<string, Object3D[]>();
  scene.updateMatrixWorld(true);
  scene.traverse(object => {
    const id = object.userData.fidelity_lod_group;
    if (typeof id !== 'string' || !id) return;
    const entries = groups.get(id) ?? [];
    entries.push(object); groups.set(id, entries);
  });
  let partCount = 0;
  const nodes: LOD[] = [];
  for (const [id, objects] of groups) {
    const levels = new Map<number, { distance: number; objects: Object3D[] }>();
    for (const object of objects) {
      const level = Number(object.userData.fidelity_lod_level);
      const distance = Number(object.userData.fidelity_lod_distance);
      if (!Number.isInteger(level) || level < 0 || !Number.isFinite(distance) || distance < 0) throw new Error(`Invalid exported detail level: ${id}`);
      const entry = levels.get(level) ?? { distance, objects: [] };
      if (entry.distance !== distance) throw new Error(`Inconsistent detail distance: ${id}`);
      entry.objects.push(object); levels.set(level, entry);
    }
    if (!levels.has(0) || levels.get(0)!.distance !== 0 || levels.size < 2) throw new Error(`Incomplete exported detail group: ${id}`);
    const origin = objects[0].getWorldPosition(new Vector3());
    const hysteresis = Number(objects[0].userData.fidelity_lod_hysteresis ?? .15);
    if (!Number.isFinite(hysteresis) || hysteresis < 0 || hysteresis >= 1) throw new Error(`Invalid detail hysteresis: ${id}`);
    if (objects.some(object => object.getWorldPosition(new Vector3()).distanceTo(origin) > 1e-5)) throw new Error(`Inconsistent detail origin: ${id}`);
    const ordered = [...levels].sort((a, b) => a[0] - b[0]);
    if (ordered.some((entry, i) => i > 0 && entry[1].distance <= ordered[i - 1][1].distance)) throw new Error(`Unordered detail distances: ${id}`);
    const lod = new LOD(); lod.name = `DETAIL-LOD-${id}`;
    // The main camera chooses one level for all passes. Letting the reflection
    // camera choose again can oscillate levels and invalidate static shadows.
    lod.autoUpdate = false;
    lod.userData.fidelityLOD = id;
    scene.add(lod); lod.position.copy(scene.worldToLocal(origin)); lod.updateMatrixWorld(true);
    for (const [level, entry] of ordered) {
      const holder = new Group(); holder.name = `${id}-level-${level}`;
      lod.add(holder); holder.updateMatrixWorld(true);
      for (const object of entry.objects) holder.attach(object);
      lod.addLevel(holder, entry.distance, hysteresis);
      holder.visible = level === 0;
      partCount += entry.objects.length;
    }
    nodes.push(lod);
  }
  return { nodes, summary: { groups: groups.size, parts: partCount, hysteresis: 'exported, default 0.15' } };
}

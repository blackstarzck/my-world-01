const renderable = object => object.isMesh || object.isPoints || object.isLine || object.isSprite;
const sameSet = (a, b) => a.size === b.size && [...a].every(value => b.has(value));

function collect(scene) {
  const roots = [], materials = new Set();
  let nestedLight = false;
  const visit = (object, belowRenderable) => {
    const draws = renderable(object);
    if (draws) {
      if (!belowRenderable) roots.push(object);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        if (material) materials.add(material);
      }
    }
    if (belowRenderable && object.isLight) nestedLight = true;
    for (const child of object.children) visit(child, belowRenderable || draws);
  };
  visit(scene, false);
  return { roots, materials, nestedLight };
}

function attached(object, scene) {
  for (let current = object; current; current = current.parent) if (current === scene) return true;
  return false;
}

/** Uses Three's public compile(object, camera, targetScene) without moving or
 * cloning any object. Every call retains the actual scene's lights/environment.
 * Only the temporary render-target binding changes, restored before each yield. */
export async function compileGalleryInBatches(renderer, scene, camera, target, options) {
  const initial = collect(scene), materials = new Set();
  // Three also gathers lights under the object argument. A future light below
  // a renderable would otherwise be counted twice; preserve full-scene behavior.
  const roots = initial.nestedLight ? [scene] : initial.roots;
  const result = { materials, objectCount: initial.roots.length, calls: 0,
    invalidated: false, fallbackReason: initial.nestedLight ? 'renderable-descendant-light' : null };
  let index = 0;
  while (index < roots.length) {
    if (!options.active()) return null;
    options.check();
    const previousTarget = renderer.getRenderTarget(), face = renderer.getActiveCubeFace(), mip = renderer.getActiveMipmapLevel();
    const start = performance.now();
    let count = 0, compileCPUMs = 0;
    try {
      renderer.setRenderTarget(target);
      do {
        const object = roots[index++];
        // React may replace a mesh while a previous batch yields. Do not
        // resurrect GPU programs belonging to a detached/disposed old mesh.
        if (!attached(object, scene)) { result.invalidated = true; break; }
        const compileStart = performance.now();
        for (const material of renderer.compile(object, camera, scene)) materials.add(material);
        compileCPUMs += performance.now() - compileStart;
        count++; result.calls++;
      } while (index < roots.length && count < 32 && performance.now() - start < 6);
    } finally {
      renderer.setRenderTarget(previousTarget, face, mip);
    }
    options.onBatch({ count, durationMs: performance.now() - start, compileCPUMs });
    if (result.invalidated) return result;
    if (index < roots.length && !await options.pause()) return null;
  }
  // A still-attached mesh can also receive a replacement material. Re-enter
  // the stable scene checks instead of accepting an obsolete material union.
  const final = collect(scene);
  result.invalidated = !sameSet(materials, final.materials)
    || !sameSet(new Set(initial.roots), new Set(final.roots));
  return result;
}

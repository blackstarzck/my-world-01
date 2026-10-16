/** Exact V4.6 deterministic RGBA generator. Build-time only; no browser/Three dependency.
 * Extracted verbatim math from GallerySurfaceMaterials.ts; build script verifies
 * byte equality against the independently transpiled frozen source generator. */
function smooth(value) { return value * value * (3 - 2 * value); }
function wrap(value, period) { return ((value % period) + period) % period; }
function hash(x, y, seed) {
  let n = Math.imul(x + seed * 97, 374761393) ^ Math.imul(y + seed * 41, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

/** Periodic value noise: the 2.4 m jade/1.2 m slab UV boundary stays continuous. */
function noiseRect(u, v, cellsX, cellsY, seed) {
  const x = u * cellsX, y = v * cellsY, ix = Math.floor(x), iy = Math.floor(y);
  const fx = smooth(x - ix), fy = smooth(y - iy);
  const a = hash(wrap(ix, cellsX), wrap(iy, cellsY), seed);
  const b = hash(wrap(ix + 1, cellsX), wrap(iy, cellsY), seed);
  const c = hash(wrap(ix, cellsX), wrap(iy + 1, cellsY), seed);
  const d = hash(wrap(ix + 1, cellsX), wrap(iy + 1, cellsY), seed);
  return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
}

function noise(u, v, cells, seed) {
  return noiseRect(u, v, cells, cells, seed);
}

function fbm(u, v, seed) {
  return noise(u, v, 4, seed) * .53 + noise(u, v, 8, seed + 3) * .27 + noise(u, v, 16, seed + 7) * .14 + noise(u, v, 32, seed + 13) * .06;
}

function crack(distance, width) {
  const t = Math.max(0, Math.min(1, (distance - width * .2) / (width * .8)));
  return 1 - smooth(t);
}

function ramp(value, low, high) {
  return smooth(Math.max(0, Math.min(1, (value - low) / (high - low))));
}

/** Interrupted overlapping blade marks in the R4 plaster, not broad clouds.
 * The 1.536 m source UV sampled twice makes a 0.768 m tile. Stroke lengths
 * are 0.14–0.40 m, with 0.05–0.105 m widths and softly curved pull edges. */
function trowelField(u, v) {
  const cells = 4, ix = Math.floor(u * cells), iy = Math.floor(v * cells);
  let field = .5;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const gx = ix + dx, gy = iy + dy, hx = wrap(gx, cells), hy = wrap(gy, cells);
    const cx = (gx + .15 + hash(hx, hy, 503) * .7) / cells;
    const cy = (gy + .15 + hash(hx, hy, 509) * .7) / cells;
    const angle = -.25 + (hash(hx, hy, 521) - .5) * 1.5;
    const cos = Math.cos(angle), sin = Math.sin(angle);
    const along = (u - cx) * cos + (v - cy) * sin;
    const halfLength = (.14 + hash(hx, hy, 523) * .26) / (.768 * 2);
    const halfWidth = (.05 + hash(hx, hy, 541) * .055) / (.768 * 2);
    const alongFraction = along / halfLength;
    const pull = 1 - ramp(Math.abs(alongFraction), .35, 1);
    const cross = (-(u - cx) * sin + (v - cy) * cos) / halfWidth
      + alongFraction * alongFraction * (hash(hx, hy, 547) - .5) * .8;
    const body = crack(Math.abs(cross), 1) * pull;
    const softEdge = Math.exp(-(((cross - .42) / .28) ** 2)) * pull;
    // Pressure/pigment density change together. The edge remains low and
    // feathered rather than outlining every stroke with a dark contour.
    field += body * (hash(hx, hy, 557) - .5) * .62 + (softEdge - body * .3) * .065;
  }
  return Math.max(.12, Math.min(.88, field));
}

function fractureDistance(u, v, cells, seed) {
  const x = u * cells, y = v * cells, ix = Math.floor(x), iy = Math.floor(y);
  let first = Infinity, second = Infinity;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const cx = ix + dx, cy = iy + dy;
    const px = cx + .15 + hash(wrap(cx, cells), wrap(cy, cells), seed) * .7;
    const py = cy + .15 + hash(wrap(cx, cells), wrap(cy, cells), seed + 43) * .7;
    const distance = (px - x) ** 2 + (py - y) ** 2;
    if (distance < first) { second = first; first = distance; }
    else if (distance < second) second = distance;
  }
  return Math.sqrt(second) - Math.sqrt(first);
}

export function createSurfacePixels(kind, size) {
  const data = new Uint8Array(size * size * 4);
  const isClay = kind === 'clay' || kind === 'clay-trowel';
  const seed = kind === 'jade' ? 73 : isClay ? 149 : 19;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size;
    const offset = (y * size + x) * 4;
    if (kind === 'botanical-floor') {
      // The authored floor UV spans 1.2 m: irregular 24–40 cm mineral beds,
      // 11–13 cm inclusions and smaller deposits, not engraved seam patterns.
      const mineralU = u + (noise(u, v, 4, 701) - .5) * .13 + (noise(u, v, 16, 703) - .5) * .025;
      const mineralV = v + (noise(u, v, 4, 709) - .5) * .13 + (noise(u, v, 16, 719) - .5) * .025;
      const beds = noiseRect(mineralU, mineralV, 3, 5, 727);
      const inclusions = noiseRect(mineralU, mineralV, 9, 11, 733);
      const deposits = ramp(noiseRect(mineralU, mineralV, 12, 18, 739), .45, .79);
      const pigment = .5 + (beds - .5) * .80 + (inclusions - .5) * .35 - (deposits - .2) * .12;
      const finish = .5 + (.55 - pigment) * .65 + (noise(mineralU, mineralV, 16, 743) - .5) * .20;
      data[offset] = Math.round(Math.max(0, Math.min(1, pigment)) * 255);
      data[offset + 1] = Math.round(Math.max(0, Math.min(1, finish)) * 255);
      data[offset + 2] = Math.round(deposits * 255);
      data[offset + 3] = Math.round(noise(u, v, 96, 751) * 255);
      continue;
    }
    if (kind === 'oak') {
      // Physical plank UV: 150 mm across, 900 mm along. Random anisotropic
      // fields create interrupted fibres, varying widths and irregular vessels;
      // there is no periodic sine contour or repeated drawn growth-ring line.
      const flow = (noiseRect(u, v, 6, 3, 301) - .5) * .07 + (noiseRect(u, v, 15, 7, 307) - .5) * .015;
      const longGrain = noiseRect(u + flow, v, 12, 3, 311);
      const latewood = ramp(noiseRect(u + flow, v, 35, 5, 313), .52, .88);
      const fibres = noiseRect(u + flow, v, 120, 15, 317);
      const vessels = ramp(noiseRect(u + flow, v, 220, 42, 331), .64, .9);
      const rays = ramp(noiseRect(u, v, 15, 65, 337), .71, .91);
      const color = .57 + (longGrain - .5) * .25 + (fibres - .5) * .22 - latewood * .48 - vessels * .16 + rays * .12;
      data[offset] = Math.round(Math.max(0, Math.min(1, color)) * 255);
      data[offset + 1] = Math.round(fibres * 255);
      data[offset + 2] = Math.round(Math.max(0, .56 - latewood * .23 - vessels * .32 + (fibres - .5) * .13) * 255);
      data[offset + 3] = Math.round(vessels * 255);
      continue;
    }
    if (kind === 'foliage') {
      // Geometry contract: 2x2 cells, u left->right / v root->tip, .02..98
      // inset within each cell. RGB is sRGB albedo; A is a relief height field.
      const column = Math.floor(u * 2), row = Math.floor(v * 2), cell = row * 2 + column;
      const leafU = Math.max(0, Math.min(1, (u * 2 - column - .02) / .96));
      const leafV = Math.max(0, Math.min(1, (v * 2 - row - .02) / .96));
      const fine = noise(leafU, leafV, 64, 401 + cell * 13);
      const broad = noiseRect(leafU, leafV, 4, 7, 409 + cell * 17);
      const midrib = crack(Math.abs(leafU - .5), .006 + (1 - leafV) * .013);
      const branchCoordinate = leafV * (cell === 2 ? 12 : 8) - Math.abs(leafU - .5) * 5.2 + (noise(leafU, leafV, 4, 431) - .5) * .13;
      const phase = wrap(branchCoordinate, 1);
      const branch = crack(Math.min(phase, 1 - phase), .045) * (.3 + .7 * (1 - Math.abs(leafU - .5) * 2));
      const vein = Math.max(midrib, branch * .6);
      const colors = [[61, 96, 45], [64, 105, 47], [73, 113, 49], [224, 220, 191]];
      const base = colors[cell];
      const shade = .86 + broad * .27 + (fine - .5) * .055;
      for (let c = 0; c < 3; c++) data[offset + c] = Math.round(Math.min(255, base[c] * shade + vein * (cell === 3 ? 7 : [13, 16, 7][c])));
      data[offset + 3] = Math.round((.35 + vein * .42 + (fine - .5) * .10) * 255);
      continue;
    }
    const warpX = noise(u, v, 4, seed + 31) - .5;
    const warpY = noise(u, v, 4, seed + 53) - .5;
    const warpedU = u + warpX * .19, warpedV = v + warpY * .19;
    // Stone retains gentle mineral clouds. Clay uses centimetre-scale trowel
    // grain below, since its authored color map already carries broad variation.
    const broad = fbm(warpedU, warpedV, seed);
    const medium = noise(warpedU, warpedV, 16, seed + 71);
    const micro = noise(u, v, 128, seed + 113);
    let vein = 0, fineVein = micro;
    if (kind === 'jade') {
      // This 0.75 m sampled tile has ~6.25 cm parent fractures and ~1.9 cm
      // branches (2.4 m source UV / 3.2 repeats). Independent coverage gates
      // interrupt both networks instead of drawing complete uniform cells.
      const fractureU = u + (noise(u, v, 16, seed + 101) - .5) * .027 + (noise(u, v, 64, seed + 107) - .5) * .012 + (noise(u, v, 128, seed + 109) - .5) * .004;
      const fractureV = v + (noise(u, v, 16, seed + 137) - .5) * .027 + (noise(u, v, 64, seed + 139) - .5) * .012 + (noise(u, v, 128, seed + 149) - .5) * .004;
      const fracture = fractureDistance(fractureU, fractureV, 12, seed + 167);
      const smallFracture = fractureDistance(fractureU, fractureV, 40, seed + 191);
      const fractureGrain = noise(u, v, 64, seed + 211);
      const parentCoverage = ramp(noise(u, v, 32, seed + 223), .29, .61);
      const width = .010 + fractureGrain * fractureGrain * .045;
      vein = crack(fracture, width) * parentCoverage * (.48 + .52 * medium);
      // Broken crystalline deposits vary the line width and diffuse its edge;
      // keep most of the parent seam thin instead of surrounding it with a halo.
      vein += crack(fracture, .09) * ramp(fractureGrain, .56, .8) * parentCoverage * .34;
      const fineCoverage = ramp(noise(u, v, 32, seed + 233), .36, .65);
      fineVein = crack(smallFracture, .025 + fractureGrain * .04) * fineCoverage;
    }
    let colorGrain = isClay
      ? noise(warpedU, warpedV, 32, seed + 251) * .65 + noise(u, v, 64, seed + 269) * .35
      : .5 + (broad - .5) * 2.1;
    let roughnessGrain = medium * .82 + micro * .18;
    if (kind === 'limestone-cut') {
      // Authored UV is 2 m: 25 x 11 cm interrupted layers and 12.5 x 8.3 cm
      // mineral patches survive a wider view. The displacement bends these
      // fields without adding metre-scale color clouds or periodic stripes.
      const layerU = u + (noise(u, v, 8, 631) - .5) * .04 + (noise(u, v, 24, 637) - .5) * .008;
      const layerV = v + (noise(u, v, 6, 641) - .5) * .045 + (noise(u, v, 24, 643) - .5) * .010;
      const layers = noiseRect(layerU, layerV, 8, 18, 647);
      const patches = noiseRect(layerU, layerV, 16, 24, 653);
      // Small deposits are irregularly clustered, not a uniform dotted grid.
      // Their pigment/roughness changes do not increase the micro height field.
      const pores = ramp(noise(layerU, layerV, 64, 659), .62, .88) * ramp(noise(u, v, 16, 661), .3, .7);
      const mineral = .5 + (layers - .5) * .85 + (patches - .5) * .30 - pores * .14;
      const rough = .5 + (mineral - .5) + pores * .30 + (noise(layerU, layerV, 32, 673) - .5) * .10;
      // Full-tile CPU calibration keeps prior mean color/roughness: final
      // clamped tone mean changes by only .000584; roughness mean by .000011.
      colorGrain = mineral - .020620683803842577;
      roughnessGrain = rough - .054394011937204056;
    }
    if (kind !== 'jade') {
      const pores = ramp(noise(u, v, 128, seed + 277), .66, .92);
      // Height is independent from the restrained color field. Stone has tiny
      // pores; clay adds low overlapping trowel ridges, not broad albedo clouds.
      vein = isClay
        ? .5 + (noiseRect(warpedU, warpedV, 8, 24, seed + 281) - .5) * .55 + (micro - .5) * .38 - pores * .12
        : .5 + (noiseRect(u, v, 32, 22, seed + 283) - .5) * .35 + (noise(u, v, 96, seed + 293) - .5) * .2 - pores * .22;
    }
    data[offset] = Math.round(Math.max(0, Math.min(1, colorGrain)) * 255);
    data[offset + 1] = Math.round(Math.max(0, Math.min(1, kind === 'clay-trowel' ? trowelField(u, v) : roughnessGrain)) * 255);
    data[offset + 2] = Math.round(Math.max(0, Math.min(1, vein)) * 255);
    data[offset + 3] = Math.round(fineVein * 255);
  }
  return data;
}


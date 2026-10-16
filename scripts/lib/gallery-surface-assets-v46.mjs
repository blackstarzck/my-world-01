// Immutable expected bytes from the independently checked, frozen v4.6 source.
// Asset packaging must never change these hashes or the DataTexture flags.
export const SURFACE_ASSET_DIRECTORY = 'textures/gallery-surfaces-v46-webp/';
export const WEBP_CODEC = Object.freeze({
  package: 'playwright-core', version: '1.63.0', file: 'webp_codec.wasm', bytes: 565369,
  sha256: '164cd9583a3e4d081f767d3b41ff0a730443dc7535fcc5caff83561463384b79',
});
export const SURFACE_RGBA = Object.freeze({
  stone: { size: 512, sha256: 'f369533f3d217f34c4858b1448d5cb8ceb112233a9d597bf6582c5af28875ba8' },
  'limestone-cut': { size: 512, sha256: 'a2dbd20b2a12344dde79563e256c6f00fbd077ec57cb2c7a5fd1beb99ad0371f' },
  'botanical-floor': { size: 512, sha256: '220b89d0193b92aabd5da8e295617b75395468b8c44a356293cf3bfc5cd6cbe3' },
  clay: { size: 512, sha256: '3b8ab6a34062cd8dda2593d714a4bc88a5b2c50b5ac1ffa9ac8df2380b69a8f8' },
  'clay-trowel': { size: 512, sha256: 'e952855d0830f2392ce6541a606e73456db876ae0b60bf895f2c6114b832d6b6' },
  jade: { size: 1024, sha256: 'b3e990f60d0957c14b43d154c9a7baa24b1743801b6159c4d759eec5d82671d5' },
  oak: { size: 1024, sha256: 'e8a1c3069dfd7171cfa1d0d1cb7cf51a101a5f7fda6ab62e150b4a5962e2d3d0' },
  foliage: { size: 1024, sha256: '7597cf4a78a7c42c51dc4c0d3600f6491d1070046325d5400710f8e5581afd1c' },
});
for (const value of Object.values(SURFACE_RGBA)) Object.freeze(value);

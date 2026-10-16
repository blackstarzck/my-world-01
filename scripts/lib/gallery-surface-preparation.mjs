import { createSurfacePixels } from './gallery-surface-pixels-v46.mjs';
import { SURFACE_RGBA, WEBP_CODEC } from './gallery-surface-assets-v46.mjs';
import { createWebPDecoder } from './gallery-webp-decoder.mjs';

export async function rgbaSHA256(bytes) {
  if (!globalThis.crypto?.subtle) throw new Error('SHA-256 verification is unavailable in this worker context.');
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}

/** One worker lifetime. No Canvas, ImageBitmap, color conversion or alpha
 * premultiplication. Network/codec/hash errors fall back to the frozen math. */
export function createSurfacePreparation(assetBaseURL, { fetchAsset = globalThis.fetch, timeoutMs = 4000, forceFallback = false } = {}) {
  const base = new URL(assetBaseURL);
  // Worker requests do not appear in window.performance. Preserve the actual
  // resource entries before this worker is terminated, including shared files.
  const resourceTimings = () => performance.getEntriesByType('resource')
    .filter(entry => entry.name.startsWith(base.href))
    .map(entry => ({ url: entry.name, timeOriginMs: performance.timeOrigin,
      startMs: entry.startTime, startEpochMs: performance.timeOrigin + entry.startTime,
      responseEndMs: entry.responseEnd, responseEndEpochMs: performance.timeOrigin + entry.responseEnd,
      durationMs: entry.duration, transferBytes: entry.transferSize, encodedBytes: entry.encodedBodySize,
      decodedBytes: entry.decodedBodySize, initiatorType: entry.initiatorType,
      deliveryType: entry.deliveryType ?? '', responseStatus: entry.responseStatus ?? null }));
  let decoderPromise, manifestPromise;
  const fetchBytes = async filename => {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchAsset(new URL(filename, base), { signal: controller.signal });
      if (!response.ok) throw new Error(`Surface asset ${filename}: HTTP ${response.status}`);
      return new Uint8Array(await response.arrayBuffer());
    } finally { clearTimeout(timer); }
  };
  function manifest() {
    return manifestPromise ??= fetchBytes('manifest.json').then(bytes => {
      const value = JSON.parse(new TextDecoder().decode(bytes));
      if (value.version !== 'reference-surface-v4.6' || value.format !== 'RGBA8' || value.compression !== 'lossless-webp') throw new Error('Invalid surface asset manifest.');
      return value;
    });
  }
  function decoder() {
    return decoderPromise ??= fetchBytes(WEBP_CODEC.file).then(async bytes => {
      if (bytes.byteLength !== WEBP_CODEC.bytes || await rgbaSHA256(bytes) !== WEBP_CODEC.sha256) throw new Error('Pinned WebP codec hash mismatch.');
      return createWebPDecoder(bytes);
    });
  }
  return async kind => {
    const expected = SURFACE_RGBA[kind];
    if (!expected) throw new Error(`Unknown surface kind ${kind}`);
    const start = performance.now();
    let pixels, method = 'webp-wasm', fallbackReason = null, assetBytes = 0, decodeMs = 0, fetchReadyMs = 0;
    let sha256 = null, verifyMs = 0;
    try {
      if (forceFallback) throw new Error('Explicit deterministic fallback diagnostic.');
      // Every kind begins fetching before the shared decoder/manifest settles.
      const [bytes, m, codec] = await Promise.all([fetchBytes(`${kind}-${expected.size}.webp`), manifest(), decoder()]);
      fetchReadyMs = performance.now() - start;
      const entry = m.assets?.find(asset => asset.kind === kind);
      if (!entry || entry.size !== expected.size || entry.sha256 !== expected.sha256 || entry.webpBytes !== bytes.byteLength || await rgbaSHA256(bytes) !== entry.webpSha256) throw new Error(`Surface WebP manifest/hash mismatch: ${kind}`);
      assetBytes = bytes.byteLength;
      const decodeStart = performance.now(); pixels = codec.decode(bytes, expected.size); decodeMs = performance.now() - decodeStart;
      const verifyStart = performance.now(); sha256 = await rgbaSHA256(pixels); verifyMs += performance.now() - verifyStart;
      if (sha256 !== expected.sha256) throw new Error(`Decoded RGBA hash mismatch: ${kind}`);
    } catch (error) {
      method = 'generated-fallback'; fallbackReason = error instanceof Error ? error.message : String(error);
      sha256 = null;
      const decodeStart = performance.now(); pixels = createSurfacePixels(kind, expected.size); decodeMs = performance.now() - decodeStart;
    }
    if (sha256 === null) {
      const verifyStart = performance.now(); sha256 = await rgbaSHA256(pixels); verifyMs += performance.now() - verifyStart;
    }
    if (sha256 !== expected.sha256) throw new Error(`Surface fallback RGBA hash mismatch: ${kind}`);
    return { kind, size: expected.size, pixels, elapsedMs: performance.now() - start,
      verification: { method, verified: true, sha256, expectedSHA256: expected.sha256, rgbaBytes: pixels.byteLength,
        assetBytes, fetchReadyMs, decodeMs, verifyMs, fallbackReason, codecVersion: method === 'webp-wasm' ? WEBP_CODEC.version : null,
        resourceTimings: resourceTimings() } };
  };
}

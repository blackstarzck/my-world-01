import { SURFACE_ASSET_DIRECTORY, SURFACE_RGBA } from '../scripts/lib/gallery-surface-assets-v46.mjs';
import type { SurfacePixelVerification, SurfaceResourceTiming } from '../scripts/lib/gallery-surface-preparation.mjs';

export type SurfaceTextureKind = 'stone' | 'limestone-cut' | 'botanical-floor' | 'clay' | 'clay-trowel' | 'jade' | 'oak' | 'foliage';

export const DEFAULT_SURFACE_PIXEL_KINDS: readonly SurfaceTextureKind[] = Object.freeze(['stone', 'limestone-cut', 'botanical-floor', 'clay-trowel', 'jade', 'oak']);
const KINDS: readonly SurfaceTextureKind[] = [...DEFAULT_SURFACE_PIXEL_KINDS, 'clay', 'foliage'];
const sizeFor = (kind: SurfaceTextureKind) => ['jade', 'oak', 'foliage'].includes(kind) ? 1024 : 512;
type Entry = { requestId: number; promise: Promise<void>; resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };

// Shared immutable CPU bytes only. React unmount/StrictMode cleanup MUST NOT
// clear these: each model owns and disposes its original DataTexture wrappers.
const pixels = new Map<string, Uint8Array<ArrayBuffer>>();
const pending = new Map<SurfaceTextureKind, Entry>();
const failures = new Map<SurfaceTextureKind, Error>();
const requests = new Map<string, Promise<void>>();
const generationMs = new Map<SurfaceTextureKind, number>();
const verificationByKind = new Map<SurfaceTextureKind, SurfacePixelVerification>();
const workerResources = new Map<string, SurfaceResourceTiming>();
const auditMode = import.meta.env.DEV ? new URLSearchParams(globalThis.location.search).get('surfacePixelAudit') : null;
const assetBaseURL = new URL(SURFACE_ASSET_DIRECTORY, new URL(import.meta.env.BASE_URL, globalThis.location.href)).href;
let worker: Worker | undefined;
let epoch = 0, requestId = 0, startedAt = 0, elapsedMs = 0;

function failedWorker(message: string) {
  const error = new Error(`Gallery surface textures could not be prepared: ${message}`);
  worker?.terminate(); worker = undefined;
  for (const [kind, entry] of pending) {
    clearTimeout(entry.timer); failures.set(kind, error); entry.reject(error);
  }
  pending.clear(); elapsedMs = startedAt ? performance.now() - startedAt : 0;
}

function getWorker() {
  if (worker) return worker;
  const run = epoch;
  const instance = new Worker(new URL('./GallerySurfacePixelWorker.ts', import.meta.url), { type: 'module', name: 'gallery-surface-pixels' });
  worker = instance;
  instance.addEventListener('message', (event: MessageEvent) => {
    if (run !== epoch || worker !== instance) return;
    const message = event.data;
    if (message?.type === 'error') { failedWorker(String(message.message ?? 'Worker generation failed.')); return; }
    if (message?.type !== 'pixels' || !KINDS.includes(message.kind)) { failedWorker('Invalid worker response.'); return; }
    const kind = message.kind as SurfaceTextureKind, entry = pending.get(kind);
    if (!entry || entry.requestId !== message.requestId) { failedWorker('Unexpected worker request identity.'); return; }
    const size = sizeFor(kind);
    if (message.size !== size || !(message.buffer instanceof ArrayBuffer) || message.buffer.byteLength !== size * size * 4) { failedWorker(`Incorrect worker pixel buffer: ${kind}.`); return; }
    const verification = message.verification as SurfacePixelVerification | undefined;
    if (verification?.verified !== true || verification.sha256 !== SURFACE_RGBA[kind].sha256 || verification.expectedSHA256 !== SURFACE_RGBA[kind].sha256 || verification.rgbaBytes !== size * size * 4 || !['webp-wasm', 'generated-fallback'].includes(verification.method)) { failedWorker(`Unverified worker surface bytes: ${kind}.`); return; }
    verificationByKind.set(kind, verification);
    for (const resource of verification.resourceTimings ?? []) {
      workerResources.set(`${resource.timeOriginMs}/${resource.startMs}/${resource.url}`, resource);
    }
    pixels.set(`${kind}/${size}`, new Uint8Array(message.buffer));
    generationMs.set(kind, Number(message.elapsedMs) || 0);
    clearTimeout(entry.timer); pending.delete(kind); entry.resolve();
    if (!pending.size) {
      elapsedMs = performance.now() - startedAt;
      // No background CPU worker survives a completed batch. The bytes and
      // fulfilled promises survive; a rare fallback request can start a new one.
      worker?.terminate(); worker = undefined;
    }
  });
  instance.addEventListener('error', event => {
    if (run !== epoch || worker !== instance) return;
    event.preventDefault(); failedWorker(event.message || 'Worker could not start.');
  });
  instance.addEventListener('messageerror', () => { if (run === epoch && worker === instance) failedWorker('Worker transfer could not be decoded.'); });
  return instance;
}

/** Start immediately alongside GLB loading. Same requests share one promise;
 * overlapping requests share per-kind work. No main-thread pixel generation.
 * Rejections persist until explicit clear/retry, avoiding automatic retry loops.
 */
export function preloadGallerySurfacePixels(kinds: readonly SurfaceTextureKind[] = DEFAULT_SURFACE_PIXEL_KINDS): Promise<void> {
  const selectedKinds = kinds === DEFAULT_SURFACE_PIXEL_KINDS && ['all', 'fallback'].includes(auditMode ?? '') ? KINDS : kinds;
  const unique = [...new Set(selectedKinds)].sort();
  if (unique.some(kind => !KINDS.includes(kind))) return Promise.reject(new Error('Unknown gallery surface texture kind.'));
  const key = unique.join(',');
  const existing = requests.get(key); if (existing) return existing;
  const missing = unique.filter(kind => !pixels.has(`${kind}/${sizeFor(kind)}`) && !pending.has(kind) && !failures.has(kind));
  const id = ++requestId;
  if (missing.length && !pending.size) { startedAt = performance.now(); elapsedMs = 0; }
  for (const kind of missing) {
    let resolve!: () => void, reject!: (error: Error) => void;
    const promise = new Promise<void>((accept, decline) => { resolve = accept; reject = decline; });
    const timer = setTimeout(() => failedWorker('Pixel generation timed out.'), 60_000);
    pending.set(kind, { requestId: id, promise, resolve, reject, timer });
  }
  const combined = Promise.all(unique.map(kind => {
    if (pixels.has(`${kind}/${sizeFor(kind)}`)) return Promise.resolve();
    const failure = failures.get(kind); if (failure) return Promise.reject(failure);
    return pending.get(kind)!.promise;
  })).then(() => {});
  requests.set(key, combined);
  // Ahead-of-Suspense preload must not cause unhandled rejection. The returned
  // original promise still rejects so the existing load-error UI can handle it.
  void combined.catch(() => {});
  if (missing.length) {
    try { getWorker().postMessage({ type: 'generate', requestId: id, kinds: missing, assetBaseURL, forceFallback: auditMode === 'fallback' }); }
    catch (error) { failedWorker(error instanceof Error ? error.message : String(error)); }
  }
  return combined;
}

/** Synchronous only after preload settles; no procedural fallback on this thread. */
export function getGallerySurfacePixels(kind: SurfaceTextureKind, size: number): Uint8Array<ArrayBuffer> {
  const data = pixels.get(`${kind}/${size}`); if (data) return data;
  const failure = failures.get(kind); if (failure) throw failure;
  throw new Error(`Surface pixels ${kind}/${size} are not ready. Await preloadGallerySurfacePixels() before applying materials.`);
}

/** Suspense reader: call after useLoader so a component-level read never delays
 * the GLB request. Start preload at Gallery module load for full parallelism. */
export function readGallerySurfacePixels(kinds: readonly SurfaceTextureKind[] = DEFAULT_SURFACE_PIXEL_KINDS): void {
  const promise = preloadGallerySurfacePixels(kinds);
  const selectedKinds = kinds === DEFAULT_SURFACE_PIXEL_KINDS && ['all', 'fallback'].includes(auditMode ?? '') ? KINDS : kinds;
  for (const kind of selectedKinds) { const error = failures.get(kind); if (error) throw error; }
  if (selectedKinds.some(kind => !pixels.has(`${kind}/${sizeFor(kind)}`))) throw promise;
}

export function getGallerySurfacePixelStatus() {
  const resources = [...workerResources.values()].sort((a, b) => a.startEpochMs - b.startEpochMs);
  return {
    state: failures.size ? 'failed' : pending.size ? 'loading' : pixels.size ? 'ready' : 'idle',
    version: 'reference-surface-v4.6', backend: 'verified-surface-worker-v2', strategy: 'lossless-webp-with-generator-fallback', workerActive: !!worker,
    auditMode, assetBaseURL, verification: Object.fromEntries(verificationByKind),
    network: {
      scope: 'worker ResourceTiming; separate from window resource entries', resources,
      observedRequests: resources.length,
      transferBytes: resources.reduce((sum, item) => sum + item.transferBytes, 0),
      encodedBytes: resources.reduce((sum, item) => sum + item.encodedBytes, 0),
      decodedBytes: resources.reduce((sum, item) => sum + item.decodedBytes, 0),
      staticDefaultBodyBytes: 3890576,
      staticDefaultBodyNote: 'Six lossless WebP files + pinned WASM + manifest, before HTTP headers or transport compression; observed transfer depends on cache.',
      cacheNote: 'deliveryType and byte sizes are browser observations. Zero transfer alone does not prove a cache hit.',
    },
    verifiedAssets: [...verificationByKind.values()].filter(item => item.verified).length,
    fallbackKinds: [...verificationByKind].filter(([, item]) => item.method === 'generated-fallback').map(([kind]) => kind),
    assets: pixels.size, ready: [...pixels.keys()], pending: [...pending.keys()],
    rgbaBytes: [...pixels.values()].reduce((sum, data) => sum + data.byteLength, 0),
    elapsedMs, generationMs: Object.fromEntries(generationMs), error: [...failures.values()][0]?.message ?? null,
  };
}

/** Explicit retry/cancel only, never ordinary component effect cleanup. Stale
 * worker messages cannot replace a new cache; pending consumers reject clearly. */
export function clearGallerySurfacePixelCache() {
  epoch++; worker?.terminate(); worker = undefined;
  const error = new Error('Gallery surface pixel preparation was cancelled for retry.'); error.name = 'AbortError';
  for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(error); }
  pending.clear(); pixels.clear(); failures.clear(); requests.clear(); generationMs.clear(); verificationByKind.clear(); workerResources.clear(); startedAt = 0; elapsedMs = 0;
}

import { createSurfacePreparation } from '../scripts/lib/gallery-surface-preparation.mjs';
import { SURFACE_RGBA } from '../scripts/lib/gallery-surface-assets-v46.mjs';
import type { SurfaceTextureKind } from './GallerySurfacePixelLoader';

const kinds = Object.keys(SURFACE_RGBA) as SurfaceTextureKind[];
const scope = self as unknown as {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
};
let prepare: ReturnType<typeof createSurfacePreparation> | undefined;
let setupKey: string | undefined;

scope.onmessage = event => {
  const request = event.data;
  const fail = (error: unknown) => scope.postMessage({ type: 'error', requestId: request?.requestId, message: error instanceof Error ? error.message : String(error) });
  try {
    if (request?.type !== 'generate' || !Number.isSafeInteger(request.requestId) || !Array.isArray(request.kinds)
      || request.kinds.some((kind: SurfaceTextureKind) => !kinds.includes(kind)) || typeof request.assetBaseURL !== 'string'
      || typeof request.forceFallback !== 'boolean') throw new Error('Invalid surface pixel preparation request.');
    const key = `${request.assetBaseURL}/${request.forceFallback}`;
    if (setupKey && setupKey !== key) throw new Error('Surface preparation strategy changed inside a worker batch.');
    setupKey = key;
    prepare ??= createSurfacePreparation(request.assetBaseURL, { forceFallback: request.forceFallback });
    // Fetch all requested compressed surfaces in parallel. WASM decode remains
    // synchronous per completed image; its memory never crosses an await.
    void Promise.all([...new Set<SurfaceTextureKind>(request.kinds)].map(async kind => {
      const result = await prepare!(kind);
      scope.postMessage({ type: 'pixels', requestId: request.requestId, kind, size: result.size,
        elapsedMs: result.elapsedMs, verification: result.verification, buffer: result.pixels.buffer }, [result.pixels.buffer]);
    })).catch(fail);
  } catch (error) { fail(error); }
};

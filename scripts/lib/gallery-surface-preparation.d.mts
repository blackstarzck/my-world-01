import type { SurfaceTextureKind } from '../../src/GallerySurfacePixelLoader';
export type SurfaceResourceTiming = {
  url: string; timeOriginMs: number; startMs: number; startEpochMs: number;
  responseEndMs: number; responseEndEpochMs: number; durationMs: number;
  transferBytes: number; encodedBytes: number; decodedBytes: number;
  initiatorType: string; deliveryType: string; responseStatus: number | null;
};
export type SurfacePixelVerification = {
  method: 'webp-wasm' | 'generated-fallback'; verified: true; sha256: string; expectedSHA256: string;
  rgbaBytes: number; assetBytes: number; fetchReadyMs: number; decodeMs: number; verifyMs: number;
  fallbackReason: string | null; codecVersion: string | null;
  resourceTimings?: SurfaceResourceTiming[];
};
export function rgbaSHA256(bytes: Uint8Array<ArrayBuffer>): Promise<string>;
export function createSurfacePreparation(assetBaseURL: string, options?: { fetchAsset?: typeof fetch; timeoutMs?: number; forceFallback?: boolean }):
  (kind: SurfaceTextureKind) => Promise<{ kind: SurfaceTextureKind; size: number; pixels: Uint8Array<ArrayBuffer>; elapsedMs: number; verification: SurfacePixelVerification }>;

import type { Texture } from 'three';
export type ArtworkTextureLease = { ready: Promise<Texture>; release(): void };
export type ArtworkTexturePool = {
  acquire(url: string): ArtworkTextureLease;
  snapshot(): { created: number; disposed: number; entries: Array<{
    url: string; state: string; owners: number; textureUUID: string | null;
  }> };
};
export function createGalleryArtworkTexturePool(
  load?: (url: string, loaded: (texture: Texture) => void, failed: (error?: unknown) => void) => Texture,
  defer?: (callback: () => void) => void,
): ArtworkTexturePool;
export const galleryArtworkTexturePool: ArtworkTexturePool;

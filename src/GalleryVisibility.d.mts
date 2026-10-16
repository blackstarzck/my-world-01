import type { Camera, Object3D } from 'three';

export type GalleryVisibilityLayout = {
  hallWidth: number;
  hallSpring?: number;
  rooms: { id: string; origin: number[]; outward: number[]; width: number; length: number; h?: number; clearSize?: number[] }[];
  portals: { room: string; origin: number[]; width: number; spring: number; crown?: number }[];
  artworks?: { id: string; room: string }[];
};
export type GalleryRoomVisibility = { visibleRooms: string[]; currentRoom: string | null; reason: string; fallback: boolean };
export type GalleryVisibilityDiagnostics = GalleryRoomVisibility & {
  candidates: number;
  hidden: number;
  cacheHit: boolean;
  cacheHits: number;
  cacheMisses: number;
};
export function visibleGalleryRooms(layout: GalleryVisibilityLayout, camera: Camera): GalleryRoomVisibility;
export function createGalleryVisibility(scene: Object3D, layout: GalleryVisibilityLayout): {
  apply(camera: Camera): () => void;
  readonly diagnostics: GalleryVisibilityDiagnostics;
  dispose(): void;
};

import type { Camera, Material, Scene, WebGLRenderer, WebGLRenderTarget } from 'three';
export type GalleryCompileBatch = { count: number; durationMs: number; compileCPUMs: number };
export function compileGalleryInBatches(renderer: WebGLRenderer, scene: Scene, camera: Camera, target: WebGLRenderTarget,
  options: { active(): boolean; check(): void; pause(): Promise<boolean>; onBatch(batch: GalleryCompileBatch): void }):
  Promise<{ materials: Set<Material>; objectCount: number; calls: number; invalidated: boolean; fallbackReason: string | null } | null>;

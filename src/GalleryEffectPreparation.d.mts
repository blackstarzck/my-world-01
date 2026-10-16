import type { Camera, Material, Scene, WebGLRenderer } from 'three';
import type { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import type { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import type { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
export type GalleryEffectPreparationOptions = {
  active(): boolean; check(): void; pause(): Promise<boolean>;
  onOperation(operation: { name: string; durationMs: number }): void;
};
export type GalleryEffectPreparation = {
  initialize(options: GalleryEffectPreparationOptions): Promise<boolean>;
  compile(options: GalleryEffectPreparationOptions): Promise<Set<Material> | null>;
  signature(): string; dispose(): void;
};
export function createGalleryEffectPreparation(renderer: WebGLRenderer, scene: Scene, camera: Camera,
  composer: EffectComposer, ao: GTAOPass, output: OutputPass): GalleryEffectPreparation;

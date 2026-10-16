import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { EquirectangularReflectionMapping, SRGBColorSpace, TextureLoader } from 'three';
import type { Object3D, Texture } from 'three';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';

export type SkySettings = { url: string; intensity: number; rotation: number };

export function authoredSky(scene: Object3D, assetExtras?: Record<string, unknown>): SkySettings | null {
  let source: Record<string, unknown> | undefined = scene.userData.skyURL !== undefined ? scene.userData : assetExtras?.skyURL !== undefined ? assetExtras : undefined;
  scene.traverse(object => { if (!source && object.userData.skyURL !== undefined) source = object.userData; });
  const url = source?.skyURL;
  if (typeof url !== 'string' || !/^\/environment\/[a-z\d._/-]+\.(hdr|png)$/i.test(url) || url.includes('..')) return null;
  const intensity = source?.skyIntensity, rotation = source?.skyRotation;
  return {
    url,
    intensity: typeof intensity === 'number' && Number.isFinite(intensity) && intensity >= 0 ? intensity : 1,
    // This is Three's visual background rotation around +Y, in radians.
    // Blender POINT/VECTOR texture-mapping Z rotation has the opposite sign;
    // model exporters perform that sampling-to-background conversion once.
    rotation: typeof rotation === 'number' && Number.isFinite(rotation) ? rotation : 0,
  };
}

export function GallerySky({ settings, onFailure }: { settings: SkySettings | null; onFailure:()=>void }) {
  const { scene, invalidate } = useThree();
  useEffect(() => {
    if (!settings) return;
    let live = true;
    let texture: Texture | undefined;
    const previous = { background: scene.background, intensity: scene.backgroundIntensity, rotation: scene.backgroundRotation.clone(), blur: scene.backgroundBlurriness };
    const format = /\.hdr$/i.test(settings.url) ? 'hdr' : 'png';
    const preparationTiming = { requestStartedMs: performance.now(), decodedAtMs: null as number | null };
    scene.userData.skyStatus = { ...settings, format, state: 'loading', preparationTiming };
    const loaded = (image: Texture) => {
      if (!live) { image.dispose(); return; }
      preparationTiming.decodedAtMs = performance.now();
      texture = image;
      image.mapping = EquirectangularReflectionMapping;
      // The display PNG already includes the authored AgX/exposure transform.
      // Decode its sRGB transfer once; the baked gallery uses NoToneMapping.
      if (format === 'png') image.colorSpace = SRGBColorSpace;
      scene.background = image;
      scene.backgroundIntensity = settings.intensity;
      scene.backgroundRotation.set(0, settings.rotation, 0);
      scene.backgroundBlurriness = 0;
      scene.userData.skyStatus = { ...settings, format, state: 'ready', width: image.image.width, height: image.image.height, preparationTiming };
      invalidate();
    };
    const failed = (error: unknown) => {
      if (!live) return;
      scene.userData.skyStatus = { ...settings, format, state: 'failed', message: String(error) };
      onFailure();
      invalidate();
    };
    if (format === 'hdr') new HDRLoader().load(settings.url, loaded, undefined, failed);
    else new TextureLoader().load(settings.url, loaded, undefined, failed);
    return () => {
      live = false;
      if (texture && scene.background === texture) {
        scene.background = previous.background;
        scene.backgroundIntensity = previous.intensity;
        scene.backgroundRotation.copy(previous.rotation);
        scene.backgroundBlurriness = previous.blur;
      }
      texture?.dispose();
      if (scene.userData.skyStatus?.url === settings.url) delete scene.userData.skyStatus;
    };
  }, [settings, scene, invalidate, onFailure]);
  return null;
}

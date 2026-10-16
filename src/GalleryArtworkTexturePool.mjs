import { SRGBColorSpace, TextureLoader } from 'three';

// All artwork images already use these same sampler/color-space settings.
// VideoTexture is deliberately outside this pool: its source and playback are
// owned by one Artwork, while a static image can serve several committed maps.
const loadImageTexture = (url, loaded, failed) => new TextureLoader().load(url, loaded, undefined, failed);

export function createGalleryArtworkTexturePool(load = loadImageTexture, defer = queueMicrotask) {
  const entries = new Map();
  let created = 0, disposed = 0;

  function scheduleRelease(entry) {
    // React StrictMode's cleanup -> setup can reclaim this same pending or ready
    // entry before the microtask. No long-lived zero-owner image/GPU cache.
    defer(() => {
      if (entry.refs !== 0 || entry.disposed) return;
      entry.disposed = true;
      if (entries.get(entry.url) === entry) entries.delete(entry.url);
      if (entry.texture) { entry.texture.dispose(); disposed++; }
    });
  }

  function acquire(url) {
    let entry = entries.get(url);
    if (!entry) {
      let resolve, reject;
      const ready = new Promise((ok, failed) => { resolve = ok; reject = failed; });
      // An abandoned request may fail after its last lease was released. Each
      // consumer still receives rejection, without an unhandled pool promise.
      void ready.catch(() => {});
      entry = { url, texture: null, ready, refs: 0, state: 'loading', disposed: false };
      entries.set(url, entry);
      const requested = entry;
      created++;
      try {
        requested.texture = load(url, texture => {
          texture.colorSpace = SRGBColorSpace;
          texture.anisotropy = 4;
          requested.state = 'ready';
          resolve(texture);
        }, error => {
          requested.state = 'failed';
          // A retry gets a new request even if old failed leases have not yet
          // cleaned up; their eventual release must not remove the replacement.
          if (entries.get(url) === requested) entries.delete(url);
          reject(error ?? new Error(`Artwork texture failed to load: ${url}`));
        });
      } catch (error) {
        requested.state = 'failed';
        if (entries.get(url) === requested) entries.delete(url);
        reject(error);
      }
    }
    entry.refs++;
    let released = false;
    return {
      ready: entry.ready,
      release() {
        if (released) return;
        released = true;
        entry.refs--;
        if (entry.refs === 0) scheduleRelease(entry);
      },
    };
  }

  return {
    acquire,
    snapshot: () => ({ created, disposed, entries: [...entries.values()].map(entry => ({
      url: entry.url, state: entry.state, owners: entry.refs, textureUUID: entry.texture?.uuid ?? null,
    })) }),
  };
}

export const galleryArtworkTexturePool = createGalleryArtworkTexturePool();

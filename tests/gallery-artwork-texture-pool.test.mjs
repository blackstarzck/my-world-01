import test from 'node:test';
import assert from 'node:assert/strict';
import { Texture, SRGBColorSpace } from 'three';
import { createGalleryArtworkTexturePool } from '../src/GalleryArtworkTexturePool.mjs';

function harness() {
  const requests = [], deferred = [];
  const pool = createGalleryArtworkTexturePool((url, loaded, failed) => {
    const texture = new Texture();
    let disposals = 0;
    texture.addEventListener('dispose', () => { disposals++; });
    requests.push({ url, texture, loaded, failed, disposals: () => disposals });
    return texture;
  }, callback => deferred.push(callback));
  return { pool, requests, flush() { while (deferred.length) deferred.shift()(); } };
}

test('48 static artwork leases share 8 textures without changing texture settings', async () => {
  const h = harness();
  const leases = Array.from({ length: 48 }, (_, i) => h.pool.acquire(`/art/${i % 8}.webp`));
  assert.equal(h.requests.length, 8);
  for (const r of h.requests) { r.texture.image = { width: 225, height: 300 }; r.loaded(r.texture); }
  const textures = await Promise.all(leases.map(x => x.ready));
  assert.equal(new Set(textures).size, 8);
  for (const t of textures) {
    const original = new Texture(); original.colorSpace = SRGBColorSpace; original.anisotropy = 4;
    for (const key of ['colorSpace', 'anisotropy', 'flipY', 'premultiplyAlpha', 'generateMipmaps', 'minFilter', 'magFilter', 'wrapS', 'wrapT', 'format', 'type', 'unpackAlignment']) assert.equal(t[key], original[key], key);
  }
  leases.slice(0, 40).forEach(x => x.release()); h.flush();
  assert.ok(h.requests.every(x => x.disposals() === 0), 'remaining committed maps still own each texture');
  leases.slice(40).forEach(x => { x.release(); x.release(); }); h.flush();
  assert.ok(h.requests.every(x => x.disposals() === 1));
  assert.deepEqual(h.pool.snapshot().entries, []);
});

test('StrictMode cleanup/setup reuses a pending request and final release disposes once', async () => {
  const h = harness(), first = h.pool.acquire('/image');
  first.release();
  const replacement = h.pool.acquire('/image');
  h.flush();
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].disposals(), 0);
  h.requests[0].loaded(h.requests[0].texture);
  assert.equal(await replacement.ready, h.requests[0].texture);
  replacement.release(); h.flush();
  assert.equal(h.requests[0].disposals(), 1);
});

test('committed image remains alive while its replacement loads or fails', async () => {
  const h = harness(), committed = h.pool.acquire('/old'), pending = h.pool.acquire('/new');
  h.requests[0].loaded(h.requests[0].texture); await committed.ready;
  h.requests[1].failed(new Error('network'));
  await assert.rejects(pending.ready, /network/);
  pending.release(); h.flush();
  assert.equal(h.requests[0].disposals(), 0);
  const retry = h.pool.acquire('/new');
  assert.equal(h.requests.length, 3);
  h.requests[2].loaded(h.requests[2].texture); await retry.ready;
  committed.release(); h.flush();
  assert.equal(h.requests[0].disposals(), 1);
  assert.equal(h.requests[2].disposals(), 0);
  retry.release(); h.flush();
});

test('failed retry and abandoned late completion cannot remove a newer entry', async () => {
  const h = harness(), failed = h.pool.acquire('/same');
  h.requests[0].failed(new Error('failed')); await assert.rejects(failed.ready);
  const retry = h.pool.acquire('/same');
  failed.release(); h.flush();
  assert.equal(h.pool.snapshot().entries[0].owners, 1);
  retry.release(); h.flush();
  const latest = h.pool.acquire('/same');
  h.requests[1].loaded(h.requests[1].texture); await retry.ready;
  assert.equal(h.pool.snapshot().entries[0].textureUUID, h.requests[2].texture.uuid);
  assert.equal(h.requests[1].disposals(), 1);
  h.requests[2].loaded(h.requests[2].texture); await latest.ready;
  latest.release(); h.flush();
  assert.ok(h.requests.every(x => x.disposals() === 1));
});

test('synchronous loader failure is retryable and release is idempotent', async () => {
  let calls = 0;
  const pool = createGalleryArtworkTexturePool(() => { calls++; throw new Error('loader'); });
  const first = pool.acquire('/bad'); await assert.rejects(first.ready, /loader/);
  first.release(); first.release();
  const retry = pool.acquire('/bad'); await assert.rejects(retry.ready, /loader/); retry.release();
  await Promise.resolve();
  assert.equal(calls, 2); assert.deepEqual(pool.snapshot().entries, []);
});

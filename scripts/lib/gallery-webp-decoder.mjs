/**
 * Small host adapter for the pinned Playwright 1.63.0 libwebp codec binary.
 * No Playwright code/API is imported at runtime. The binary and its licenses
 * are copied by the asset builder. Its SHA is verified before instantiation.
 * Export/import names are deliberately version-specific, not a general ABI.
 */
export async function createWebPDecoder(binary) {
  let exports;
  const timers = new Map();
  const fail = message => { throw new Error(`Pinned WebP codec: ${message}`); };
  const resize = requested => {
    requested >>>= 0;
    const memory = exports?.f;
    // Eight <=1024² surface images are decoded sequentially, not retained here.
    // This safety cap bounds corruption without changing a valid source image.
    if (!memory || requested > 256 * 1024 * 1024) return 0;
    try {
      const current = memory.buffer.byteLength;
      const target = Math.min(256 * 1024 * 1024, Math.ceil(Math.max(requested, current * 1.2) / 65536) * 65536);
      if (target > current) memory.grow((target - current) / 65536);
      return 1;
    } catch { return 0; }
  };
  const imports = { a: {
    e: () => fail('abort'),
    d: () => {},
    a: (which, timeout) => {
      clearTimeout(timers.get(which)); timers.delete(which);
      if (timeout) timers.set(which, setTimeout(() => { timers.delete(which); exports.m(which, performance.now()); }, timeout));
      return 0;
    },
    b: resize,
    c: code => fail(`exit ${code}`),
  } };
  const result = await WebAssembly.instantiate(binary, imports);
  exports = result.instance.exports;
  if (!(exports.f instanceof WebAssembly.Memory) || ['g', 'i', 'j', 'k', 'l', 'm'].some(key => typeof exports[key] !== 'function')) fail('unexpected ABI');
  exports.g(); // Emscripten constructors; identical to the packaged host glue.
  return {
    decode(bytes, expectedSize) {
      if (!(bytes instanceof Uint8Array) || !bytes.byteLength || ![512, 1024].includes(expectedSize)) fail('invalid input');
      let input = 0, widthPtr = 0, heightPtr = 0, output = 0;
      try {
        input = exports.k(bytes.byteLength); widthPtr = exports.k(4); heightPtr = exports.k(4);
        if (!input || !widthPtr || !heightPtr) fail('input allocation failed');
        // Reacquire views after malloc/decode: memory.grow detaches old views.
        new Uint8Array(exports.f.buffer).set(bytes, input);
        output = exports.i(input, bytes.byteLength, widthPtr, heightPtr);
        if (!output) fail('decode failed');
        const words = new Uint32Array(exports.f.buffer);
        const width = words[widthPtr >>> 2], height = words[heightPtr >>> 2];
        if (width !== expectedSize || height !== expectedSize) fail(`unexpected dimensions ${width}x${height}`);
        const byteLength = width * height * 4;
        if (output + byteLength > exports.f.buffer.byteLength) fail('output outside codec memory');
        // Own transferable ArrayBuffer before WebPFree; includes alpha verbatim.
        const pixels = new Uint8Array(byteLength);
        pixels.set(new Uint8Array(exports.f.buffer, output, byteLength));
        return pixels;
      } finally {
        if (output) exports.j(output); // WebPFree, not the host malloc free.
        if (input) exports.l(input);
        if (widthPtr) exports.l(widthPtr);
        if (heightPtr) exports.l(heightPtr);
      }
    },
    dispose() { for (const timer of timers.values()) clearTimeout(timer); timers.clear(); },
  };
}

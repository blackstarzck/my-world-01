export function createWebPDecoder(binary: ArrayBuffer | Uint8Array<ArrayBuffer>): Promise<{
  decode(bytes: Uint8Array<ArrayBuffer>, expectedSize: number): Uint8Array<ArrayBuffer>;
  dispose(): void;
}>;

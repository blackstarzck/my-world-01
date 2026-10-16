import { cp, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { brotliCompress, brotliDecompress, constants } from 'node:zlib';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';

// Only runtime assets enter a release. Historical exports and QA evidence stay
// in the workspace; the development server still serves the full public folder.
export async function copyGalleryPublicAssets(root, outDir) {
  const layout = JSON.parse(await readFile(path.join(root, 'src/data/layout.json'), 'utf8'));
  if (!/^\/models\/[a-zA-Z0-9._-]+\.glb$/.test(layout.modelPath)) throw new Error('Invalid active gallery model path');
  const relativePaths = ['art', 'fonts', 'draco', 'basis', 'environment/i-v3', 'textures/gallery-surfaces-v46-webp', layout.modelPath.slice(1), 'gallery-i-poster.webp', 'favicon.svg'];
  const publicDir = path.resolve(root, 'public');
  const output = path.resolve(root, outDir);
  if (output === publicDir || output.startsWith(`${publicDir}${path.sep}`)) throw new Error('Release output must be outside public');
  await mkdir(output, { recursive: true });
  for (const relative of relativePaths) {
    const source = path.join(publicDir, relative);
    await stat(source); // A missing runtime asset must fail the release build.
    const target = path.join(output, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await cp(source, target, { recursive: true });
  }
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  const prepareTransport = async assetPath => {
    const target = path.join(output, assetPath.slice(1));
    const original = await readFile(target);
    const compressed = await promisify(brotliCompress)(original, {
      params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
    });
    const restored = await promisify(brotliDecompress)(compressed);
    if (!original.equals(restored)) throw new Error(`Brotli transport changed asset bytes: ${assetPath}`);
    await writeFile(target + '.br', compressed);
    return {
      path: assetPath, bytes: original.length, sha256: hash(original),
      brotliPath: assetPath + '.br', brotliBytes: compressed.length,
      brotliSHA256: hash(compressed), brotliQuality: 11, restoredByteExact: true,
    };
  };
  const model = await prepareTransport(layout.modelPath);
  const environment = [];
  for (const name of (await readdir(path.join(publicDir, 'environment/i-v3'))).sort()) {
    if (name.endsWith('.hdr')) environment.push(await prepareTransport(`/environment/i-v3/${name}`));
  }
  await writeFile(path.join(output, 'gallery-release.json'), JSON.stringify({
    revision: 'M', model, environment, commit: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
  }, null, 2));
}

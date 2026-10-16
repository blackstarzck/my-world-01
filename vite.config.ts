import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { copyGalleryPublicAssets } from './scripts/lib/gallery-public-assets.mjs';
import type { ResolvedConfig } from 'vite';
let releaseConfig:ResolvedConfig;
export default defineConfig({ plugins: [react(), {
  name:'gallery-runtime-public-assets',apply:'build',
  configResolved(config){releaseConfig=config;},
  async closeBundle(){await copyGalleryPublicAssets(releaseConfig.root,releaseConfig.build.outDir);},
}], build: { copyPublicDir:false,chunkSizeWarningLimit: 1300 }, server: { port: 5173, strictPort: true, watch: { ignored: ['**/output/**', '**/assets/source/**'] } } });

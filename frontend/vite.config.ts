import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Build modes:
//   npm run build           → normal multi-file build (frontend/dist/index.html + dist/assets/*)
//   npm run build:single    → single vanilla index.html with everything inlined (frontend/dist/index.html)
//
// The single-file build is best for shipping one deliverable; the normal build
// loads faster because it can code-split Mermaid/etc. Flask serves either.

const SINGLEFILE = process.env.SINGLEFILE === '1';

export default defineConfig({
  plugins: [react(), ...(SINGLEFILE ? [viteSingleFile()] : [])],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:5000',
        changeOrigin: true,
      },
    },
  },
  build: {
    // Single-file build needs everything inlined, no code splitting.
    ...(SINGLEFILE
      ? {
          assetsInlineLimit: 100000000,
          cssCodeSplit: false,
          chunkSizeWarningLimit: 100000000,
          rollupOptions: {
            output: {
              manualChunks: undefined,
              inlineDynamicImports: true,
            },
          },
        }
      : {}),
  },
});

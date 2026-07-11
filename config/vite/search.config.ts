import { defineConfig, type Plugin } from 'vite';
import { resolve } from 'path';
import { copyFileSync } from 'fs';

// pdfjs-dist's worker must be served as a standalone file alongside
// search.iife.js (see lightbox.ts for how its URL is derived at runtime).
function copyPdfWorker(): Plugin {
  return {
    name: 'copy-pdf-worker',
    closeBundle() {
      copyFileSync(
        resolve(__dirname, '../../node_modules/pdfjs-dist/build/pdf.worker.mjs'),
        // Renamed to .js: this server maps .mjs to application/octet-stream,
        // which Chrome refuses to execute as a module script.
        resolve(__dirname, '../../dist/js/pdf.worker.js'),
      );
    },
  };
}

export default defineConfig({
  plugins: [copyPdfWorker()],
  build: {
    lib: {
      entry: resolve(__dirname, '../../src/ts/search.ts'),
      name: 'FavSearch',
      fileName: 'search',
      formats: ['iife'],
    },
    outDir: resolve(__dirname, '../../dist'),
    emptyOutDir: false,
    minify: true,
    rollupOptions: {
      output: {
        entryFileNames: 'js/[name].iife.js',
        assetFileNames: 'css/[name][extname]',
      },
    },
  },
});

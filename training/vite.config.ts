// Bundles the headless training entry points into plain Node ESM under
// training/dist/, so the Python bridge can run them with `node` alone (no TS
// loader, `@/` alias already resolved).

import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  root: here('..'),
  publicDir: false,
  logLevel: 'warn',
  resolve: {
    alias: { '@': here('../src') },
  },
  build: {
    ssr: true,
    target: 'node20',
    outDir: here('./dist'),
    emptyOutDir: true,
    minify: false,
    sourcemap: true,
    rollupOptions: {
      input: {
        'wyrmspan-env': here('./wyrmspan/env-server.ts'),
      },
      output: {
        format: 'es',
        entryFileNames: '[name].mjs',
        chunkFileNames: 'chunks/[name]-[hash].mjs',
      },
    },
  },
});

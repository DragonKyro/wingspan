// Bundles the heuristic tuner (tune.ts) into plain Node ESM under
// scripts/wyrmspan/dist/, so its worker processes run with `node` alone (no TS
// loader, `@/` alias already resolved). `npm run wyrm:tune` builds it first.

import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  root: here('../..'),
  publicDir: false,
  logLevel: 'warn',
  resolve: {
    alias: { '@': here('../../src') },
  },
  build: {
    ssr: true,
    target: 'node20',
    outDir: here('./dist'),
    emptyOutDir: true,
    minify: false,
    sourcemap: true,
    rollupOptions: {
      input: { 'wyrmspan-tune': here('./tune.ts') },
      output: { format: 'es', entryFileNames: '[name].mjs', chunkFileNames: 'chunks/[name]-[hash].mjs' },
    },
  },
});

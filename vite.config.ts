import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  base: '/wingspan/',
  // Online rooms record the build that made them, so devices on another
  // build get a warning (see networkStore).
  define: {
    __APP_BUILD__: JSON.stringify(process.env.GITHUB_SHA?.slice(0, 7) ?? 'dev'),
  },
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // Rollup already splits each game (engine + AI + card data + screens)
        // into lazy chunks; this only names them after their game instead of
        // after an arbitrary shared module. (Don't use manualChunks here: it
        // drags shared deps like React into a game chunk, which the entry
        // then has to load.) scripts/check-bundle.mjs enforces the split.
        chunkFileNames(chunk) {
          const ids = chunk.moduleIds.map((id) => id.replace(/\\/g, '/'));
          const game = ['wingspan', 'wyrmspan', 'finspan'].find((g) =>
            ids.some((id) => id.includes(`/src/${g}/`) || id.includes(`/src/ui/${g}/`)),
          );
          return `assets/${game ? `${game}-` : ''}[name]-[hash].js`;
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
  },
});

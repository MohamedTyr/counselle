import path from 'node:path';
import { defineConfig } from 'vitest/config';

// Mirrors the resolve.alias block in vite.config.ts (kept in sync by hand —
// the two-alias scheme is load-bearing, see frontend-plan.md §2).
export default defineConfig({
  resolve: {
    alias: {
      '@librechat/client': path.resolve(__dirname, 'src/vendor/librechat/client'),
      '~': path.resolve(__dirname, 'src/vendor/librechat/app'),
      $fonts: path.resolve(__dirname, 'public/fonts'),
      '@': path.resolve(__dirname, 'src'),
      'librechat-data-provider/react-query': path.resolve(
        __dirname,
        'src/vendor/librechat-data-provider/react-query/index.ts',
      ),
      'librechat-data-provider': path.resolve(
        __dirname,
        'src/vendor/librechat-data-provider/index.ts',
      ),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    css: false,
  },
});

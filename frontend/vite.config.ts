import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  // Upstream uses babel-plugin-transform-vite-meta-env; the vendored
  // utils/logger.ts reads process.env.* — shim the three keys it needs.
  define: {
    'process.env.NODE_ENV': JSON.stringify(mode),
    'process.env.VITE_ENABLE_LOGGER': JSON.stringify(process.env.VITE_ENABLE_LOGGER ?? ''),
    'process.env.VITE_LOGGER_FILTER': JSON.stringify(process.env.VITE_LOGGER_FILTER ?? ''),
  },
  server: {
    port: 5173,
    proxy: {
      '/v1': 'http://localhost:8000',
    },
  },
  resolve: {
    alias: {
      // The vendored LibreChat component package (packages/client/src at the
      // pinned commit) — both the bare package import and its internal
      // subpath imports (rewritten from `~/` at vendor time) resolve here.
      '@librechat/client': path.resolve(__dirname, 'src/vendor/librechat/client'),
      // Vendored LibreChat app files (client/src subset) keep their upstream
      // `~/` import style.
      '~': path.resolve(__dirname, 'src/vendor/librechat/app'),
      // style.css @font-face urls (upstream alias, kept verbatim).
      $fonts: path.resolve(__dirname, 'public/fonts'),
      // Counselle-authored code.
      '@': path.resolve(__dirname, 'src'),
    },
  },
}));

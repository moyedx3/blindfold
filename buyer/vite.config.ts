import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';
import { fileURLToPath } from 'node:url';

const shim = fileURLToPath(new URL('../packages/midnight-web/src/crypto-shim.ts', import.meta.url));
export default defineConfig({
  define: { global: 'globalThis' },
  resolve: { alias: { process: 'process/browser', buffer: 'buffer', util: 'util', crypto: shim, stream: 'stream-browserify', events: 'events' } },
  plugins: [react(), wasm()],
  optimizeDeps: { include: ['level', 'browser-level', 'abstract-level', 'level-supports', 'level-transcoder'], esbuildOptions: { target: 'esnext' } },
  build: { target: 'esnext' },
  worker: { format: 'es' },
  assetsInclude: ['**/*.wasm'],
  server: { fs: { allow: ['..'] } },
});

import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    rollupOptions: {
      input: {
        world: resolve(__dirname, 'index.html'),
        jandal: resolve(__dirname, 'jandal-flip/index.html'),
        trapline: resolve(__dirname, 'trap-line/index.html'),
      },
    },
  },
  // One copy of three.js: plain 'three' imports (ours and the addons') get the WebGPU build,
  // which re-exports the whole core API.
  resolve: { alias: [{ find: /^three$/, replacement: 'three/webgpu' }] },
  server: { host: true },
});

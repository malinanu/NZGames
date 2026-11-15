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
  server: { host: true },
});

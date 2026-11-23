import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 线上部署在 https://thinktwice.top/bgx/，所有资源与 API 都带 /bgx 前缀。
const BASE = '/bgx/';

export default defineConfig({
  base: BASE,
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      [`${BASE}api`]: {
        target: 'http://127.0.0.1:8787',
        changeOrigin: false,
        rewrite: (p) => p.replace(/^\/bgx/, ''),
      },
      [`${BASE}socket.io`]: {
        target: 'ws://127.0.0.1:8787',
        ws: true,
        rewrite: (p) => p.replace(/^\/bgx/, ''),
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});

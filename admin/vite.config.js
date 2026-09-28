import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    // Same-origin API in development (admin cookies stay first-party). Must match PORT in backend/.env.
    proxy: { '/api': { target: process.env.API_PROXY_TARGET || 'http://127.0.0.1:4100', changeOrigin: false } },
  },
  preview: { port: 5174 },
  build: { sourcemap: false },
  test: { environment: 'node', include: ['src/**/*.test.js'] },
});

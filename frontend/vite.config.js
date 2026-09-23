import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Same-origin API in development: cookies stay first-party and SameSite=Lax works.
    proxy: {
      '/api': { target: process.env.API_PROXY_TARGET || 'http://localhost:4000', changeOrigin: false },
    },
  },
  build: {
    sourcemap: false,
    // livekit-client is large but only downloaded when a call starts (lazy CallInterface).
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          livekit: ['livekit-client'],
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.js'],
  },
});

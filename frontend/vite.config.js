import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Same-origin API in development: cookies stay first-party and SameSite=Lax works.
    // Must match PORT in backend/.env. 127.0.0.1 (not "localhost") avoids Node
    // resolving to a different server bound on ::1 or 127.0.0.1 only.
    proxy: {
      '/api': {
        target: process.env.API_PROXY_TARGET || 'http://127.0.0.1:4100',
        changeOrigin: false,
        configure(proxy) {
          // If the API is down or restarting, answer with a real HTTP error instead
          // of dropping the browser's connection, and say why in this terminal.
          proxy.on('error', (err, req, res) => {
            console.error(`[achiever] API proxy error for ${req.method} ${req.url}: ${err.code || err.message}. Is the backend running on ${process.env.API_PROXY_TARGET || 'http://127.0.0.1:4100'}?`);
            if (res && !res.headersSent && typeof res.writeHead === 'function') {
              res.writeHead(502, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ success: false, message: "We couldn't connect to the ACHIEVER server. Please try again.", error: { code: 'BACKEND_UNREACHABLE' } }));
            }
          });
        },
      },
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

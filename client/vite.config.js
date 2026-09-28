import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The sandbox preview is served from a proxied host, so the dev server must
// accept any Host header and bind to all interfaces.
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
    strictPort: false,
    // The Arena viewer embeds the preview in a sandboxed iframe whose origin is
    // 'null'; Vite 6's default dev CORS would block our own module scripts there
    // (blank page). Reflecting the origin keeps embedded previews working.
    cors: { origin: true, credentials: true },
    proxy: {
      // Relative /api calls are proxied to the Express server, so the browser
      // never needs to know where the backend lives and CORS never fires in dev.
      '/api': {
        target: process.env.VITE_PROXY_TARGET || 'http://localhost:5000',
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    allowedHosts: true,
    // Production preview must behave exactly like dev for the embedded viewer:
    // same /api proxy and same permissive CORS (sandboxed frames are origin null).
    cors: { origin: true, credentials: true },
    // Proxies and browsers must never cache the shell: a stale index.html
    // pins users to old bundles (seen in the wild through the preview proxy).
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      Pragma: 'no-cache',
    },
    proxy: {
      '/api': {
        target: process.env.VITE_PROXY_TARGET || 'http://localhost:5000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
        },
      },
    },
  },
});

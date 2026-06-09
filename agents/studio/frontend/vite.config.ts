import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vireo Studio — production React app for chat-driven video editing.
// Backend at /api/chat/stream (SSE) and /api/* for the rest.
//
// In dev: vite proxy /api → localhost:PORT (we default to 8787).
// In prod: build outputs to dist/ which the Node server can serve static.

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    target: 'es2022',
  },
});

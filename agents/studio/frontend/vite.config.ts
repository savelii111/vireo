import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vireo Studio — production React app for chat-driven video editing.
// Backend at /api/chat/stream (SSE) and /api/* for the main app.
//
// Build optimizations (W2 2026-06-09):
//   - Manual chunks: vendor (react), icons (lucide), chat, editor
//   - Heavy components use React.lazy + Suspense
//   - Dev server proxies /api → :8011 to avoid CORS in dev

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: '0.0.0.0',
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:8011',
        changeOrigin: true,
        secure: false,
      },
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    cssCodeSplit: true,
    minify: 'esbuild',
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          // React core
          if (id.includes('node_modules/react') || id.includes('node_modules/scheduler')) {
            return 'vendor-react';
          }
          // Lucide icons (tree-shakeable but bundled eagerly)
          if (id.includes('node_modules/lucide-react')) {
            return 'vendor-icons';
          }
          // clsx is small, no need to split
          // Our own chat components (large)
          if (id.includes('/components/ChatPanel')) {
            return 'chat-panel';
          }
          // Timeline is the heaviest editor component
          if (id.includes('/components/Timeline')) {
            return 'timeline';
          }
          // Inspector + Preview are medium
          if (id.includes('/components/Inspector') || id.includes('/components/Preview')) {
            return 'inspector-preview';
          }
        },
      },
    },
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'lucide-react', 'clsx'],
  },
});

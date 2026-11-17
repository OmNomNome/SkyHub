import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// В режиме разработки фронтенд работает на :5173, а запросы /api
// прокидываются на backend :3000 — поэтому CORS не нужен.
export default defineConfig({
  plugins: [react()],
  server: {
    // Явно IPv4: в Node 17+ «localhost» может открыться только на IPv6 (::1),
    // и тогда http://localhost:5173 в части браузеров/утилит не открывается
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': 'http://127.0.0.1:3000',
    },
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 2500,
  },
});

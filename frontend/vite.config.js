import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': { target: 'http://localhost:3001', changeOrigin: true },
      '/ws':  { target: 'ws://localhost:3001',   ws: true },
    },
  },
  build: {
    target: 'es2020',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          // Core React
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          // Charting (groß — separat damit Dashboard nicht alles blockiert)
          'vendor-charts': ['recharts'],
          // Icons
          'vendor-icons': ['lucide-react'],
          // HTTP-Client
          'vendor-http': ['axios'],
        },
      },
    },
    chunkSizeWarningLimit: 600,
  },
});

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { compression } from 'vite-plugin-compression2';

export default defineConfig({
  server: {
    host: true,
  },
  oxc: {
    drop: process.env.NODE_ENV === 'production' ? ['console', 'debugger'] : [],
  },
  plugins: [
    react(),
    // Gzip
    compression({
      algorithm: 'gzip',
      exclude: [/\.(png|jpe?g|gif|webp|svg|ico|woff2?)$/i],
      threshold: 1024,
    }),
    // Brotli
    compression({
      algorithm: 'brotliCompress',
      exclude: [/\.(png|jpe?g|gif|webp|svg|ico|woff2?)$/i],
      threshold: 1024,
    }),
  ],
  build: {
    target: 'esnext',
    sourcemap: false,
    cssMinify: true,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('exceljs')) return 'vendor-excel';
            if (id.includes('recharts') || id.includes('d3-')) return 'vendor-charts';
            if (id.includes('qrcode.react') || id.includes('html5-qrcode')) return 'vendor-qr';
            if (id.includes('lucide-react')) return 'vendor-icons';
            if (id.includes('@supabase')) return 'vendor-supabase';
            if (id.includes('react-router')) return 'vendor-router';
            if (id.includes('react-dom') || id.includes('react')) return 'vendor-react';
          }
        },
      },
    },
  },
});

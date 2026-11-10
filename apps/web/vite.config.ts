import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { injectCsp } from './src/csp';

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'poster-csp',
      apply: 'build',
      transformIndexHtml: injectCsp,
    },
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
  build: {
    target: 'es2022',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (/\/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'react-vendor';
          if (id.includes('/node_modules/zod/')) return 'validation';
          if (/\/node_modules\/(parse5|entities)\//.test(id)) return 'html-parser';
          if (id.includes('/node_modules/css-tree/')) return 'css-parser';
          if (/\/packages\/core\/(src|dist)\//.test(id)) return 'poster-core';
          return undefined;
        },
      },
    },
  },
});

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
  },
});

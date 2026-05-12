import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'https://api.kite.trade',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
        secure: false,
        configure: (proxy) => {
          proxy.on('error', (err) => {
            console.error('[Proxy Error]', err.message);
          });
          proxy.on('proxyReq', (proxyReq, req) => {
            console.log('[Proxy Request]', req.method, req.url, '→', proxyReq.path);
          });
          proxy.on('proxyRes', (proxyRes, req) => {
            console.log('[Proxy Response]', req.url, proxyRes.statusCode);
          });
        },
      },
    },
  },
});

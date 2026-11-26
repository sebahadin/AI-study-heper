import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    // R2 permits this local origin; silently switching ports breaks direct uploads.
    port: 5173,
    strictPort: true,
    proxy: { '/api': { target: process.env.API_PROXY_TARGET || loadEnv(mode, process.cwd(), '').API_PROXY_TARGET || 'http://127.0.0.1:3000' } },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    restoreMocks: true,
  },
}));

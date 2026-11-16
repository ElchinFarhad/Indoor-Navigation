import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * PUBLIC_URL is the path the app is served from ("/" on its own domain,
 * "/<repository>" on GitHub Pages). It is the same variable the previous
 * build used, so deployment scripts did not have to change.
 */
const base = `${(process.env.PUBLIC_URL || '').replace(/\/+$/, '')}/`;

export default defineConfig({
  base,
  plugins: [react()],
  build: {
    outDir: 'build',
    target: ['es2019', 'safari13'],
    sourcemap: false,
  },
  server: { port: 3000 },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/setupTests.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
  },
});

import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// Shared by every service: `vitest run -c ../../vitest.service.config.ts`.
// SWC (not esbuild) because Nest DI needs emitted decorator metadata.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    root: process.cwd(),
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    exclude: ['**/*.integration.test.ts', '**/node_modules/**', '**/dist/**'],
  },
});

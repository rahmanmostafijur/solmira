import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// SWC is required because esbuild (vitest's default transformer) does not emit the
// decorator metadata NestJS dependency injection relies on.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    exclude: ['**/*.integration.test.ts', '**/node_modules/**', '**/dist/**'],
  },
});

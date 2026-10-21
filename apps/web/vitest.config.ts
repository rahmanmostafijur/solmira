import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  resolve: { alias: { '@': path.join(import.meta.dirname, 'src') } },
  test: {
    // Pure logic runs in node; component tests opt in with `// @vitest-environment jsdom`.
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts'],
  },
});

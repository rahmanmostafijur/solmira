import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['chaos/**/*.chaos.test.ts'],
    // Every scenario owns the stack (one database, one broker): they run one after another.
    fileParallelism: false,
    testTimeout: 180_000,
    hookTimeout: 120_000,
  },
});

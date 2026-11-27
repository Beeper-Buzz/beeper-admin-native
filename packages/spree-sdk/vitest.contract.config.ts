import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['contract/**/*.contract.ts'],
    globalSetup: ['contract/setup.ts'],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});

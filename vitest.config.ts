import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // In-process tests import service code that depends on @classquest/shared;
    // resolve it to source so no build step is needed.
    alias: {
      '@classquest/shared': fileURLToPath(new URL('./packages/shared/src/index.ts', import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    env: { LOG_LEVEL: 'silent' },
    // Integration/e2e tests talk to LocalStack + MySQL and need longer timeouts.
    testTimeout: 30_000,
    hookTimeout: 60_000,
    pool: 'forks',
    sequence: { concurrent: false },
    // Live suites share one running stack; run test files one at a time so
    // they never race each other (e.g. two concurrent demo seeds).
    fileParallelism: false,
  },
});

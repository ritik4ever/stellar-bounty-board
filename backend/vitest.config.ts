import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    pool: 'forks',
    maxConcurrency: 1,
    testTimeout: 15_000,
    // Rate limiting is disabled for tests only when BOTH `NODE_ENV=test`
    // (set by Vitest for the run) and this explicit opt-in are present (#1465).
    // Without it the limiters stay enabled and the suite would trip 429s, which
    // is the intended fail-closed behaviour for a stray `NODE_ENV=test`. See
    // `src/middleware/rateLimitGuard.ts`.
    env: {
      RATE_LIMIT_TEST_BYPASS: 'true',
    },
    snapshotFormat: {
      printBasicPrototype: false,
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts'],
      thresholds: {
        lines: 80,
      },
    },
  },
});

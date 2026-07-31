import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    setupFiles: ['test/setup.ts'],
    pool: 'forks',
    maxConcurrency: 1,
    testTimeout: 15_000,
    snapshotFormat: {
      printBasicPrototype: false,
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/index.ts',
        // Dead / unwired legacy files carried in from the mainline merge.
        // None of these are imported by the running app or the test suite:
        //   src/sanitize.ts + src/schemas.ts + src/store.ts are only used by
        //   their co-located (never-run) tests in src/;
        //   src/routes/*, src/middleware/requestContext.ts,
        //   src/services/archiveScheduler.ts and src/utils/colorContrast.ts
        //   are not imported anywhere (app.ts defines its own inline handlers);
        //   src/sanitize.test.ts + src/store.test.ts + src/types/express-request.ts
        //   are co-located test/type stubs.
        'src/sanitize.ts',
        'src/sanitize.test.ts',
        'src/schemas.ts',
        'src/store.ts',
        'src/store.test.ts',
        'src/routes/bounties.ts',
        'src/routes/health.ts',
        'src/middleware/requestContext.ts',
        'src/services/archiveScheduler.ts',
        'src/utils/colorContrast.ts',
        'src/types/express-request.ts',
      ],
      thresholds: {
        lines: 80,
      },
    },
  },
});

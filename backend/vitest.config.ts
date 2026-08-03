import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    pool: 'forks',
    maxConcurrency: 1,
    testTimeout: 15_000,
    snapshotFormat: {
      printBasicPrototype: false,
    },
    setupFiles: ['./test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/index.ts',
        // Test files co-located in src/ (run from test/ dir instead)
        'src/**/*.test.ts',
        // Legacy/dead modules not wired into the running app
        'src/routes/**',
        'src/store.ts',
        'src/schemas.ts',
        'src/sanitize.ts',
        'src/middleware/requestContext.ts',
        'src/services/archiveScheduler.ts',
        'src/utils/colorContrast.ts',
        'src/types/**',
        'src/docs/writeOpenApi.ts',
      ],
      thresholds: {
        lines: 80,
      },
    },
  },
});

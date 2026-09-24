import { defineConfig } from 'vitest/config';

/**
 * Vitest configuration used exclusively by Stryker mutation testing.
 *
 * It narrows the test surface to the deterministic, network-independent unit
 * tests that exercise `src/services/bountyStore.ts`. Keeping the mutation run
 * focused on these files makes each mutant fast to evaluate and avoids the
 * flakiness of suites that reach out to external services (e.g. the GitHub API).
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/bountyStore.test.ts', 'test/bountyStore.mutation.test.ts'],
    pool: 'forks',
    maxConcurrency: 1,
    testTimeout: 15_000,
    snapshotFormat: {
      printBasicPrototype: false,
    },
  },
});

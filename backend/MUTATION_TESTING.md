# Mutation testing — `bountyStore` service

This package uses [Stryker Mutator](https://stryker-mutator.io/) to measure the
_effectiveness_ of the unit tests for `src/services/bountyStore.ts` (issue #901).
Unlike line coverage, which only proves a line executed, mutation testing seeds
small faults ("mutants") into the source and checks whether the test suite fails
in response. A surviving mutant is a real gap: code that could be broken without
any test noticing.

## Running it

```bash
# from backend/
npm run test:mutation
```

The run:

- mutates only `src/services/bountyStore.ts` (see `stryker.conf.json`);
- executes the fast, deterministic, network-free tests selected by
  `vitest.stryker.config.ts` (`test/bountyStore.test.ts` and
  `test/bountyStore.mutation.test.ts`);
- writes an HTML report to `reports/mutation/bountyStore.html` and a JSON report
  to `reports/mutation/bountyStore.json` (both git-ignored).

The GitHub PR API existence check in `submitBounty` is mocked in the tests, so no
network access is required and results are reproducible in CI.

## Baseline & threshold

| Metric                        | Value  |
| ----------------------------- | ------ |
| Initial score (before tests)  | 33.37% |
| Current score (with tests)    | 78.23% |
| CI break threshold (enforced) | 75%    |

`thresholds.break` in `stryker.conf.json` is set to **75%**. Stryker exits
non-zero — failing the job — if the score drops below it. The small margin below
the current score (78.23%) absorbs the minor run-to-run variance from a couple of
timeout-prone mutants while still catching real regressions.

When you meaningfully improve the suite, ratchet the threshold up toward the new
score so it cannot silently regress.

## Known surviving mutants

A residual cluster of survivors lives in `getLockTimeoutMs()`, a private helper
whose only effect is the millisecond timeout passed to `proper-lockfile`. Its
return value is not observable through any public API without asserting on lock
internals, so those mutants are accepted rather than chased with brittle tests.

## CI wiring

`.github/workflows/mutation.yml` runs mutation testing:

- weekly (Mondays 06:00 UTC),
- on demand (`workflow_dispatch`), and
- on pull requests that touch `bountyStore.ts`, its tests, or the Stryker/Vitest
  mutation config.

The job fails if the score falls below the break threshold and uploads the HTML
report as a build artifact for inspection.

import { defineConfig, devices } from '@playwright/test';
import { tmpdir } from 'node:os';
import path from 'node:path';

const storeDirectory = path.join(tmpdir(), `stellar-bounty-board-e2e-${process.pid}`);

// ==============================================================================
// Playwright End-to-End Test Suite Configuration
// ==============================================================================
// Architectural Overview & Matrix of Deviations from Playwright Defaults:
//
// 1. Test Timeout: 60_000ms (Playwright Default: 30_000ms)
//    - Deviation: Doubled timeout headroom.
//    - Reason: Soroban smart contract invocations and Freighter wallet mock state
//      require significantly longer than standard Web2 API roundtrips.
//
// 2. Parallelism: fullyParallel: false (Playwright Default: true)
//    - Deviation: Explicitly forced sequential execution.
//    - Reason: Bounty lifecycle tests mutate shared in-memory escrow state. Concurrent
//      execution causes race conditions and flaky test failures.
//
// 3. Action Timeout: actionTimeout: 10000ms (Playwright Default: 0 / infinite)
//    - Deviation: Enforced 10s action deadline.
//    - Reason: Stalled DOM interactions or unclickable elements fail fast after 10s
//      rather than blocking the runner until the 60s test deadline expires.
//
// 4. Browser Matrix: [chromium] (Playwright Default: chromium, firefox, webkit)
//    - Deviation: Scoped exclusively to Chromium desktop in default E2E runs.
//    - Reason: Reduces CI runner memory consumption and accelerates validation loops.
//
// 5. Monorepo & CI Verification:
//    - Verified against `.github/workflows/playwright-e2e.yml`:
//      * Playwright starts the frontend and backend on ports 3000 and 3001.
//      * The backend uses test mode and an isolated temporary bounty store.
//      * Reporter generates HTML artifacts in CI while keeping terminal output concise.
// ==============================================================================

export default defineConfig({
  testDir: 'playwright/tests',

  // Overall Test Timeout (Deliberately chosen: 60s vs 30s tool default):
  timeout: 60_000,

  // Assertion Timeout (Standard Template Default: 5s):
  expect: { timeout: 5000 },

  // Execution Parallelism (Deliberately chosen: false vs true tool default):
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,

  // Reporter (Cross-checked with CI workflow):
  reporter: process.env.CI ? [['html', { open: 'never' }], ['list']] : 'list',

  use: {
    // Run headless in automated CI and local pre-commit runs
    headless: true,

    // Frontend Base Ingress URL (Deliberate deviation: points to Vite dev server on port 3000):
    baseURL: process.env.BASE_URL ?? 'http://localhost:3000',

    // Action Timeout (Deliberately chosen: 10s vs 0 / no timeout tool default):
    actionTimeout: 10000,

    // Diagnostic Tracing (Standard Template Default: captures traces on initial retry):
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  // BASE_URL supports an explicitly managed external stack. Otherwise the same
  // real app servers are started and stopped automatically locally and in CI.
  webServer: process.env.BASE_URL
    ? undefined
    : [
        {
          command: 'node --import tsx src/index.ts',
          cwd: path.join(__dirname, 'backend'),
          url: 'http://localhost:3001/api/health',
          reuseExistingServer: false,
          env: {
            NODE_ENV: 'test',
            PORT: '3001',
            STELLAR_AUTH_ENFORCED: 'false',
            BOUNTY_STORE_PATH: path.join(storeDirectory, 'bounties.json'),
            BOUNTY_AUDIT_STORE_PATH: path.join(storeDirectory, 'audit.json'),
          },
        },
        {
          command:
            'node node_modules/vite/bin/vite.js --config vite.config.ts --host localhost --strictPort',
          cwd: path.join(__dirname, 'frontend'),
          url: 'http://localhost:3000',
          reuseExistingServer: false,
          env: { VITE_API_URL: '/api' },
        },
      ],

  projects: [
    // Browser Matrix (Deliberately chosen: single browser project vs multi-engine default):
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});

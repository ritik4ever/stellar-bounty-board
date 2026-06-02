import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'playwright/tests',
  timeout: 60_000,
  expect: { timeout: 5000 },
  fullyParallel: false,
  use: {
    headless: true,
    baseURL: process.env.BASE_URL ?? 'http://localhost:3000',
    actionTimeout: 10000,
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});

import { defineConfig } from '@playwright/test';

// Quiet mode for every launch path (see tests/e2e/README.md). COD_TEST_VISIBLE=1 turns it off.
process.env.COD_TEST_QUIET ??= '1';

export default defineConfig({
  globalSetup: './tests/e2e/global-setup.ts',
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { trace: 'retain-on-failure', screenshot: 'only-on-failure' },
});

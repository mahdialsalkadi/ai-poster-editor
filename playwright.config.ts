import { defineConfig } from '@playwright/test';

const port = 4190;
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    viewport: { width: 1440, height: 1000 },
    locale: 'en-US',
    timezoneId: 'UTC',
    colorScheme: 'dark',
    reducedMotion: 'reduce',
    acceptDownloads: true,
    permissions: ['clipboard-read', 'clipboard-write'],
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: { chromiumSandbox: true },
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    command: 'pnpm test:e2e:serve',
    url: `http://127.0.0.1:${port}/api/health`,
    reuseExistingServer: false,
    timeout: 30_000,
    env: { POSTER_E2E: 'true', NODE_ENV: 'test', AI_PROVIDER: '' },
  },
});

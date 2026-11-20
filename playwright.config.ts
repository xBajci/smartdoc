import { defineConfig } from '@playwright/test'
import { MLFLOW_URL, serverEnvironment } from './e2e/support/environment'

const port = 3211
const baseURL = `http://127.0.0.1:${port}`

export default defineConfig({
  testDir: './e2e',
  testMatch: ['public/**/*.spec.ts', 'admin/**/*.spec.ts'],
  globalSetup: './e2e/support/global-setup.ts',
  // Tests share one database and reset it before each test, so they run one at a time.
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  outputDir: 'test-results',
  use: {
    baseURL,
    browserName: 'chromium',
    viewport: { width: 1440, height: 1000 },
    locale: 'cs-CZ',
    timezoneId: 'Europe/Prague',
    reducedMotion: 'reduce',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'node e2e/support/fake-mlflow.ts',
      url: `${MLFLOW_URL}/health`,
      reuseExistingServer: false,
    },
    {
      command: 'pnpm build && node .output/server/index.mjs',
      url: baseURL,
      env: serverEnvironment(port),
      // Never reuse: a server left over from development would run on the developer's database.
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
})

import { defineConfig, devices } from '@playwright/test'

const external = process.env.BASE_URL
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90000,
  expect: { timeout: 20000 },
  fullyParallel: false,
  workers: 2,
  retries: 0,
  reporter: [['list']],
  use: { baseURL: external ?? 'http://localhost:5241', trace: 'off' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], channel: 'chromium', viewport: { width: 1440, height: 880 } } },
    ...(process.env.CROSS_BROWSER ? [
      { name: 'firefox', use: { ...devices['Desktop Firefox'], viewport: { width: 1440, height: 880 } } },
      { name: 'webkit', use: { ...devices['Desktop Safari'], viewport: { width: 1440, height: 880 } } },
    ] : []),
  ],
  webServer: external ? undefined : { command: 'npm run preview', port: 5241, reuseExistingServer: true, timeout: 30000 },
})

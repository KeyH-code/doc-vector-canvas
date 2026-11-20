import { defineConfig } from '@playwright/test'

const origin = 'http://127.0.0.1:5173'

export default defineConfig({
  testDir: 'tests/e2e',
  expect: { timeout: 3_000 },
  use: {
    actionTimeout: 5_000,
    baseURL: origin,
    channel: 'chrome',
    viewport: { width: 1060, height: 840 },
  },
  webServer: {
    command: process.platform === 'win32' ? 'npm.cmd run dev' : 'npm run dev',
    url: `${origin}/spike.html`,
    reuseExistingServer: false,
  },
})

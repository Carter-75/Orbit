import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser', workers: 1, retries: 0, timeout: 90000,
  use: { baseURL: 'http://127.0.0.1:3040', channel: process.env.CI ? undefined : 'chrome', headless: true,
    actionTimeout: 15000, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: { command: 'node scripts/browser-preview.js', url: 'http://127.0.0.1:3040/health/ready',
    reuseExistingServer: process.env.ORBIT_REUSE_TEST_SERVER === 'true' && !process.env.CI, timeout: 60000,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 5000 } },
});

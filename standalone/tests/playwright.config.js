// The standalone add-on's browser tests (npm run test:standalone); npm test, which gates releases, never runs them.
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.js',
  workers: 1, // each test starts its own server
  timeout: 120_000,
  reporter: 'list',
  use: { browserName: 'chromium', headless: true },
});

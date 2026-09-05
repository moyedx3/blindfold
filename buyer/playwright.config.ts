import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'e2e', timeout: 60_000,
  use: { baseURL: 'http://127.0.0.1:5173', headless: true },
  webServer: { command: 'VITE_FAKE_WALLET=1 npx vite --host 127.0.0.1 --port 5173', url: 'http://127.0.0.1:5173', reuseExistingServer: !process.env.CI },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});

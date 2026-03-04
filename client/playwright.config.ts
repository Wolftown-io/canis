import { defineConfig, devices } from '@playwright/test';

const shouldStartBackend = process.env.KAIKU_E2E_SKIP_BACKEND !== '1';

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global.setup.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'https://localhost:5173',
    ignoreHTTPSErrors: true,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: shouldStartBackend
    ? [
        {
          command:
            'make -C .. docker-up && cd .. && DATABASE_URL=postgresql://voicechat:voicechat_dev@localhost:5433/voicechat REDIS_URL=redis://localhost:6379 RATE_LIMIT_ENABLED=false JWT_PRIVATE_KEY=LS0tLS1CRUdJTiBQUklWQVRFIEtFWS0tLS0tCk1DNENBUUF3QlFZREsyVndCQ0lFSUZuUDFodDNNcjlkOGJyYW4zV2IyTGFxSStqd2NnY0V4YXp2V0pQNWUrSG8KLS0tLS1FTkQgUFJJVkFURSBLRVktLS0tLQo= JWT_PUBLIC_KEY=LS0tLS1CRUdJTiBQVUJMSUMgS0VZLS0tLS0KTUNvd0JRWURLMlZ3QXlFQW80TlJjVnQ2ajF3OHRCWUtxUEJzS0krNUZVREkwVGtJaHF4WWlud05TRlU9Ci0tLS0tRU5EIFBVQkxJQyBLRVktLS0tLQo= cargo run -p vc-server',
          url: 'http://localhost:8080/health',
          reuseExistingServer: !process.env.CI,
          timeout: 180_000,
        },
        {
          command: 'bun run dev',
          url: 'https://localhost:5173',
          ignoreHTTPSErrors: true,
          reuseExistingServer: !process.env.CI,
        },
      ]
    : [
        {
          command: 'bun run dev',
          url: 'https://localhost:5173',
          ignoreHTTPSErrors: true,
          reuseExistingServer: !process.env.CI,
        },
      ],
});

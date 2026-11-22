import { defineConfig, devices } from '@playwright/test'

const PORT = 4173
const BASE_URL = `http://127.0.0.1:${PORT}`

/**
 * 本机已安装 Chrome，直接复用系统 Chrome，无需下载 Playwright 浏览器二进制。
 * 如需改用标准 chromium，可先执行 `npx playwright install chromium`，
 * 再以 `PLAYWRIGHT_CHANNEL=chromium npx playwright test` 运行。
 */
const CHANNEL = process.env.PLAYWRIGHT_CHANNEL ?? 'chrome'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: CHANNEL,
      use: {
        ...devices['Desktop Chrome'],
        channel: CHANNEL,
      },
    },
  ],
  webServer: {
    // `--mode test` 会加载 .env.test，把 API 指向同源地址，便于 page.route 拦截。
    command: `npm run dev -- --host 127.0.0.1 --port ${PORT} --mode test`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})

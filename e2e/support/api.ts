import type { Page, Route } from '@playwright/test'

export const TEST_THREAD_ID = 'u1:main'
export const TEST_EMAIL = 'buyer@example.com'

export const TEST_USER = {
  id: 1,
  username: '验收买家',
  email: TEST_EMAIL,
  role: 'user',
  created_at: null,
}

export const EMPTY_DASHBOARD = {
  user_email: TEST_EMAIL,
  stats: { published_count: 0, orders_count: 0, favourites_count: 0 },
  my_items: [],
  my_orders: [],
}

export const MARKET_INPUT_PLACEHOLDER =
  '问点什么，例如：预算 500 元以内推荐在售键盘'
export const APPROVAL_LOCKED_PLACEHOLDER =
  '请先完成上方审批后再继续对话'

export interface SessionOptions {
  /** 预置 access_token，默认 e2e-access-token。 */
  token?: string
  /** 预置 access_token_expires_at（毫秒时间戳）。 */
  expiresAt?: number
}

/**
 * 写入登录态并模拟 `/auth/me`，让受保护路由可以直接进入。
 * 必须在 `page.goto` 之前调用。
 */
export async function bootstrapSession(
  page: Page,
  options: SessionOptions = {},
): Promise<{ token: string; expiresAt: number }> {
  const token = options.token ?? 'e2e-access-token'
  const expiresAt = options.expiresAt ?? Date.now() + 60 * 60 * 1000

  await page.addInitScript(
    ({ nextToken, nextExpiresAt }) => {
      window.localStorage.setItem('access_token', nextToken)
      window.localStorage.setItem(
        'access_token_expires_at',
        String(nextExpiresAt),
      )
    },
    { nextToken: token, nextExpiresAt: expiresAt },
  )

  await page.route('**/auth/me', (route) =>
    route.fulfill({ json: TEST_USER }),
  )

  return { token, expiresAt }
}

/** 交易广场首屏所需的最小 API 模拟，避免未拦截请求落到 Vite。 */
export async function mockMarketBootstrap(page: Page): Promise<void> {
  await page.route(/\/items(\?.*)?$/, (route) =>
    route.fulfill({
      json: { total: 0, items: [], skip: 0, limit: 20 },
    }),
  )
  await page.route(/\/items\/tags$/, (route) =>
    route.fulfill({ json: [] }),
  )
  await page.route(/\/items\/ai\/approvals$/, (route) =>
    route.fulfill({ json: [] }),
  )
}

export async function fulfillJson(
  route: Route,
  body: unknown,
  status = 200,
): Promise<void> {
  await route.fulfill({ status, json: body })
}

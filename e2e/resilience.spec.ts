import { expect, test } from '@playwright/test'
import {
  APPROVAL_LOCKED_PLACEHOLDER,
  bootstrapSession,
  EMPTY_DASHBOARD,
  fulfillJson,
  MARKET_INPUT_PLACEHOLDER,
  mockMarketBootstrap,
  TEST_THREAD_ID,
  TEST_USER,
} from './support/api'

const FRESH_TOKEN = 'e2e-fresh-token'
const FAILURE_MESSAGE = '库存不足，无法创建订单。'

test('主动静默续期：Single-Flight 只调用 1 次 /auth/refresh 并刷新本地 token', async ({
  page,
}) => {
  const nearExpiry = Date.now() + 4 * 60 * 1000
  const { token: staleToken } = await bootstrapSession(page, {
    expiresAt: nearExpiry,
  })
  await mockMarketBootstrap(page)

  let refreshCalls = 0
  let refreshBearer = ''
  let meBearer = ''

  // 后注册的 /auth/me 覆盖 support 里的默认实现，用于捕获续期后的请求头。
  await page.route('**/auth/me', async (route) => {
    meBearer = route.request().headers()['authorization'] ?? ''
    await route.fulfill({ json: TEST_USER })
  })

  await page.route('**/auth/refresh', async (route) => {
    refreshCalls += 1
    refreshBearer = route.request().headers()['authorization'] ?? ''
    await route.fulfill({
      json: {
        access_token: FRESH_TOKEN,
        token_type: 'bearer',
        expires_in: 3600,
        role: 'user',
        user_id: TEST_USER.id,
        email: TEST_USER.email,
      },
    })
  })

  await page.goto('/market')
  await expect(
    page.getByRole('button', { name: '刷新商品' }),
  ).toBeVisible()

  await expect.poll(() => refreshCalls).toBe(1)
  expect(refreshBearer).toBe(`Bearer ${staleToken}`)
  await expect.poll(() => meBearer).toBe(`Bearer ${FRESH_TOKEN}`)

  await expect
    .poll(() =>
      page.evaluate(() => window.localStorage.getItem('access_token')),
    )
    .toBe(FRESH_TOKEN)

  const storedExpiry = await page.evaluate(() =>
    Number(window.localStorage.getItem('access_token_expires_at')),
  )
  expect(storedExpiry).toBeGreaterThan(Date.now() + 50 * 60 * 1000)

  // 再触发一次页面请求：新 token 有效期充足，不应再次续期。
  await page.getByRole('button', { name: '刷新商品' }).click()
  await page.waitForTimeout(400)
  expect(refreshCalls).toBe(1)
})

test('审批执行失败降级：OUT_OF_STOCK 转为执行失败、隐藏按钮并解锁输入框', async ({
  page,
}) => {
  await bootstrapSession(page)

  const approval = {
    approval_id: 101,
    thread_id: TEST_THREAD_ID,
    action: 'create_order',
    status: 'pending',
    payload: {
      item_name: '机械键盘',
      quantity: 1,
      unit_price: 499,
      amount: 499,
      threshold: 300,
      address: '上海市浦东新区世纪大道 1 号',
    },
    reason: '交易金额超过风控阈值',
    decision_comment: null,
    resolved_order_id: null,
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  }

  let failed = false
  let resumeCalls = 0

  await page.route(/\/items\/dashboard\/me$/, (route) =>
    fulfillJson(route, EMPTY_DASHBOARD),
  )
  await page.route(/\/items\/ai\/approvals$/, (route) =>
    fulfillJson(route, failed ? [] : [approval]),
  )
  await page.route(/\/items\/ai\/history(\?.*)?$/, (route) =>
    fulfillJson(route, []),
  )
  await page.route(/\/items\/ai\/threads\/[^/]+\/status$/, (route) =>
    fulfillJson(route, {
      thread_id: TEST_THREAD_ID,
      is_interrupted: !failed,
      pending_approvals: failed ? [] : [approval],
      last_message_at: null,
      last_role: null,
    }),
  )
  await page.route(/\/items\/ai\/threads\/[^/]+\/resume$/, (route) => {
    resumeCalls += 1
    failed = true
    return fulfillJson(
      route,
      {
        error: {
          code: 'OUT_OF_STOCK',
          message: FAILURE_MESSAGE,
          trace_id: 'trace-e2e-out-of-stock',
        },
      },
      400,
    )
  })

  await page.goto('/studio')
  await expect(page.getByText('个人工作台').first()).toBeVisible()

  await page.getByRole('tab', { name: /待审批收件箱/ }).click()
  await expect(page.getByText('机械键盘').first()).toBeVisible()

  await page
    .getByRole('button', { name: /在 Copilot 中定位该会话/ })
    .click()

  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText('高额订单人工审批')).toBeVisible()

  // 挂起态：输入框被锁，必须先完成审批。
  await expect(
    dialog.getByPlaceholder(APPROVAL_LOCKED_PLACEHOLDER),
  ).toBeDisabled()

  const approveButton = dialog.getByRole('button', { name: '批准并下单' })
  await expect(approveButton).toBeVisible()
  await approveButton.click()

  await expect(dialog.getByText('执行失败').first()).toBeVisible()
  await expect(dialog.getByText(FAILURE_MESSAGE)).toBeVisible()
  await expect(
    dialog.getByRole('button', { name: '批准并下单' }),
  ).toHaveCount(0)
  await expect(
    dialog.getByRole('button', { name: '拒绝操作' }),
  ).toHaveCount(0)

  // 失败后输入框解锁，用户可以继续对话。
  await expect(
    dialog.getByPlaceholder(MARKET_INPUT_PLACEHOLDER),
  ).toBeEnabled()

  expect(resumeCalls).toBe(1)
})

test('主动退出登录：发出 1 次 POST /auth/logout，接口 500 也不阻塞本地登出', async ({
  page,
}) => {
  const { token } = await bootstrapSession(page)
  await mockMarketBootstrap(page)

  let logoutCalls = 0
  let logoutBearer = ''

  await page.route('**/auth/logout', async (route) => {
    logoutCalls += 1
    logoutBearer = route.request().headers()['authorization'] ?? ''
    // 故意返回 500：验证前端容错，本地登出仍必须完成。
    await fulfillJson(
      route,
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: '服务暂时不可用',
          trace_id: 'trace-e2e-logout',
        },
      },
      500,
    )
  })

  await page.goto('/market')
  await expect(
    page.getByRole('button', { name: '打开账户菜单' }),
  ).toBeVisible()

  await page.getByRole('button', { name: '打开账户菜单' }).click()
  await page.getByRole('menuitem', { name: '退出登录' }).click()

  await expect.poll(() => logoutCalls).toBe(1)
  expect(logoutBearer).toBe(`Bearer ${token}`)

  // 接口失败不影响本地登出：token / 过期时间被清空，账户菜单消失。
  await expect
    .poll(() =>
      page.evaluate(() => window.localStorage.getItem('access_token')),
    )
    .toBeNull()
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.localStorage.getItem('access_token_expires_at'),
      ),
    )
    .toBeNull()
  await expect(
    page.getByRole('button', { name: '打开账户菜单' }),
  ).toHaveCount(0)

  // 只发一次：被动 401 兜底路径不得重复请求 /auth/logout。
  await page.waitForTimeout(300)
  expect(logoutCalls).toBe(1)
})

import { expect, test, type Page } from '@playwright/test'
import {
  bootstrapSession,
  EMPTY_DASHBOARD,
  fulfillJson,
  MARKET_INPUT_PLACEHOLDER,
  TEST_THREAD_ID,
  TEST_USER,
} from './support/api'

/**
 * Sprint H3-FE 地狱级混沌回归。
 *
 * 全部场景都是确定性 Mock：不依赖外网 LLM / 后端，失败可稳定复现。
 * 覆盖 SSE 二次断流续传、XSS/畸形 Markdown 免疫、连击防重、
 * 并发续期 Single-Flight 与审批失败后的确定性重提闭环。
 */

const FRESH_TOKEN = 'e2e-hell-chaos-fresh-token'
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9\-_:]{1,128}$/

function sseFrame(id: string, event: string, data: unknown): string {
  return `id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

/** 线程历史 / status 的静态 Mock，避免未拦截请求落到 Vite。 */
async function mockAgentThread(
  page: Page,
  options: {
    history?: unknown[]
    isInterrupted?: boolean
    pendingApprovals?: unknown[]
  } = {},
): Promise<void> {
  await page.route(/\/items\/ai\/history(\?.*)?$/, (route) =>
    fulfillJson(route, options.history ?? []),
  )
  await page.route(/\/items\/ai\/threads\/[^/]+\/status$/, (route) =>
    fulfillJson(route, {
      thread_id: TEST_THREAD_ID,
      is_interrupted: options.isInterrupted ?? false,
      pending_approvals: options.pendingApprovals ?? [],
      last_message_at: null,
      last_role: null,
    }),
  )
}

async function openCopilot(page: Page): Promise<void> {
  await page.getByRole('button', { name: '打开 AI 导购' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
}

async function sendPrompt(page: Page, prompt: string): Promise<void> {
  const input = page.getByPlaceholder(MARKET_INPUT_PLACEHOLDER)
  await expect(input).toBeEnabled()
  await input.fill(prompt)
  await input.press('Enter')
}

test.describe('Sprint H3-FE 地狱混沌', () => {
  test('Chaos 1：SSE 连续二次断流 + 游标递增续传，正文零丢字零重复', async ({
    page,
  }) => {
    await bootstrapSession(page)
    await page.route(/\/items(\?.*)?$/, (route) =>
      fulfillJson(route, { total: 0, items: [], skip: 0, limit: 20 }),
    )
    await page.route(/\/items\/tags$/, (route) => fulfillJson(route, []))
    await page.route(/\/items\/ai\/approvals$/, (route) =>
      fulfillJson(route, []),
    )
    await mockAgentThread(page)

    let attempts = 0
    const idempotencyKeys: string[] = []
    const lastEventIds: Array<string | undefined> = []

    await page.route('**/items/ai/agent/stream', async (route) => {
      attempts += 1
      const headers = route.request().headers()
      idempotencyKeys.push(headers['x-idempotency-key'] ?? '')
      lastEventIds.push(headers['last-event-id'])

      if (attempts === 1) {
        // 第 1 段后强行断流：没有终态事件。
        expect(headers['last-event-id']).toBeUndefined()
        await route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          headers: { 'cache-control': 'no-store' },
          body:
            sseFrame('1-0', 'intent', {
              intent: 'shopping_search',
              tools: ['search_items'],
            }) + sseFrame('2-0', 'token', { text: '第一段，' }),
        })
        return
      }

      if (attempts === 2) {
        // 第 2 段后再次断流。
        await route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          headers: { 'cache-control': 'no-store' },
          body: sseFrame('3-0', 'token', { text: '第二段，' }),
        })
        return
      }

      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        headers: { 'cache-control': 'no-store' },
        body:
          sseFrame('4-0', 'token', { text: '圆满收官。' }) +
          sseFrame('5-0', 'done', { steps: 1 }),
      })
    })

    await page.goto('/market')
    await openCopilot(page)
    await sendPrompt(page, '请分段讲一个键盘的故事')

    await expect.poll(() => attempts, { timeout: 30_000 }).toBe(3)

    expect(idempotencyKeys[0]).toMatch(IDEMPOTENCY_KEY_PATTERN)
    expect(idempotencyKeys[1]).toBe(idempotencyKeys[0])
    expect(idempotencyKeys[2]).toBe(idempotencyKeys[0])
    expect(lastEventIds[1]).toBe('2-0')
    expect(lastEventIds[2]).toBe('3-0')

    const paragraph = page
      .getByRole('dialog')
      .locator('article p')
      .first()
    await expect(paragraph).toHaveText('第一段，第二段，圆满收官。', {
      timeout: 20_000,
    })

    const text = await paragraph.innerText()
    expect(text.match(/第一段/g) ?? []).toHaveLength(1)
    expect(text.match(/第二段/g) ?? []).toHaveLength(1)
  })

  test('Chaos 2：高危 XSS 与畸形 Markdown 注入免疫，无 pageerror / 白屏', async ({
    page,
  }) => {
    const pageErrors: Error[] = []
    page.on('pageerror', (error) => pageErrors.push(error))

    await bootstrapSession(page)
    await page.route(/\/items(\?.*)?$/, (route) =>
      fulfillJson(route, { total: 0, items: [], skip: 0, limit: 20 }),
    )
    await page.route(/\/items\/tags$/, (route) => fulfillJson(route, []))
    await page.route(/\/items\/ai\/approvals$/, (route) =>
      fulfillJson(route, []),
    )
    await mockAgentThread(page)

    const malicious = [
      '<script>window.__xss = 1</script>',
      '',
      '<img src=x onerror="window.__xss = 2">',
      '',
      '[点我](javascript:window.__xss=3)',
      '',
      '| 超长表头 | B | C | D | E | F | G | H |',
      '| --- | --- | --- | --- | --- |',
      `| ${'嵌套|管道'.repeat(80)} | 2 | <script>window.__xss=4</script> |`,
      '| 缺列 | 只有两列 |',
      '| a | b | c | d | e | f | g | h | i | j |',
    ].join('\n')

    await page.route('**/items/ai/agent/stream', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        headers: { 'cache-control': 'no-store' },
        body:
          sseFrame('1-0', 'intent', { intent: 'chitchat', tools: [] }) +
          sseFrame('2-0', 'token', { text: malicious.slice(0, 70) }) +
          sseFrame('3-0', 'token', { text: malicious.slice(70) }) +
          sseFrame('4-0', 'done', { steps: 1 }),
      }),
    )

    await page.goto('/market')
    await openCopilot(page)
    await sendPrompt(page, '给我一段带表格的说明')

    const dialog = page.getByRole('dialog')
    await expect(dialog).toContainText('超长表头', { timeout: 20_000 })
    await expect(dialog).toContainText('点我')

    // 恶意标签必须按纯文本渲染，不能真的进入 DOM 执行。
    await expect(dialog).toContainText('window.__xss = 1')

    const maliciousLink = dialog.getByRole('link', { name: '点我' })
    await expect(maliciousLink).toBeVisible()
    const href = await maliciousLink.getAttribute('href')
    expect(href ?? '').not.toContain('javascript:')
    expect(await dialog.locator('img[src="x"]').count()).toBe(0)

    const xssFlag = await page.evaluate(
      () => (window as Window & { __xss?: number }).__xss,
    )
    expect(xssFlag).toBeUndefined()
    expect(pageErrors).toHaveLength(0)

    // 抽屉与导航栏必须完好，没有白屏。
    await expect(dialog).toBeVisible()
    await expect(
      page.getByRole('link', { name: '交易广场', exact: true }),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: '打开 AI 导购' }),
    ).toBeVisible()
  })

  test('Chaos 3a：抢购确认按钮 8 连击，实际只发 1 次请求且携带幂等键', async ({
    page,
  }) => {
    await bootstrapSession(page)

    const item = {
      id: 7,
      name: '机械键盘',
      price: 499,
      is_offer: true,
      is_sold: false,
      image_path: null,
      inventory: 5,
      owner_id: 2,
      tags: [],
      created_at: null,
      favorited: false,
      favourited_count: 0,
    }

    await page.route(/\/items(\?.*)?$/, (route) =>
      fulfillJson(route, { total: 1, items: [item], skip: 0, limit: 20 }),
    )
    await page.route(/\/items\/tags$/, (route) => fulfillJson(route, []))
    await page.route(/\/items\/ai\/approvals$/, (route) =>
      fulfillJson(route, []),
    )

    let buyCalls = 0
    const buyKeys: string[] = []

    await page.route(/\/items\/7\/buy$/, async (route) => {
      buyCalls += 1
      buyKeys.push(route.request().headers()['x-idempotency-key'] ?? '')
      // 模拟 400ms 网络延迟，放大连击窗口。
      await new Promise((resolve) => setTimeout(resolve, 400))
      await fulfillJson(route, {
        order_id: 9001,
        item_name: '机械键盘',
        unit_price: 499,
        quantity: 1,
        remaining_inventory: 4,
        message: '抢购成功',
      })
    })

    await page.goto('/market')
    await page.getByRole('button', { name: '立即抢购' }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText('确认下单')).toBeVisible()

    const confirm = dialog.getByRole('button', { name: '确认支付' })
    await expect(confirm).toBeEnabled()

    await confirm.evaluate((button) => {
      for (let index = 0; index < 8; index += 1) {
        button.dispatchEvent(
          new MouseEvent('click', { bubbles: true, cancelable: true }),
        )
      }
    })

    await expect(page.getByText('抢购成功')).toBeVisible({ timeout: 10_000 })
    expect(buyCalls).toBe(1)
    expect(buyKeys).toHaveLength(1)
    expect(buyKeys[0]).toMatch(IDEMPOTENCY_KEY_PATTERN)

    await page.waitForTimeout(300)
    expect(buyCalls).toBe(1)
  })

  test('Chaos 3b：审批「批准并下单」8 连击，只发 1 次 resume 请求', async ({
    page,
  }) => {
    await bootstrapSession(page)

    const approval = {
      approval_id: 301,
      thread_id: TEST_THREAD_ID,
      action: 'create_order',
      status: 'pending',
      payload: {
        item_id: 7,
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

    let resumed = false
    let resumeCalls = 0

    await page.route(/\/items\/dashboard\/me$/, (route) =>
      fulfillJson(route, EMPTY_DASHBOARD),
    )
    await page.route(/\/items\/ai\/approvals$/, (route) =>
      fulfillJson(route, resumed ? [] : [approval]),
    )
    await mockAgentThread(page)
    await page.route(/\/items\/ai\/threads\/[^/]+\/status$/, (route) =>
      fulfillJson(route, {
        thread_id: TEST_THREAD_ID,
        is_interrupted: !resumed,
        pending_approvals: resumed ? [] : [approval],
        last_message_at: null,
        last_role: null,
      }),
    )
    await page.route(/\/items\/ai\/threads\/[^/]+\/resume$/, async (route) => {
      resumeCalls += 1
      resumed = true
      await new Promise((resolve) => setTimeout(resolve, 300))
      await fulfillJson(route, {
        status: 'approved',
        approval_id: approval.approval_id,
        thread_id: TEST_THREAD_ID,
        order_id: 9002,
      })
    })

    await page.goto('/studio')
    await expect(page.getByText('个人工作台').first()).toBeVisible()
    await page.getByRole('tab', { name: /待审批收件箱/ }).click()
    await expect(page.getByText('机械键盘').first()).toBeVisible()

    const approve = page.getByRole('button', { name: '批准并下单' })
    await expect(approve).toBeVisible()

    await approve.evaluate((button) => {
      for (let index = 0; index < 8; index += 1) {
        button.dispatchEvent(
          new MouseEvent('click', { bubbles: true, cancelable: true }),
        )
      }
    })

    await expect(page.getByText('审批已通过').first()).toBeVisible({
      timeout: 10_000,
    })
    expect(resumeCalls).toBe(1)

    await page.waitForTimeout(300)
    expect(resumeCalls).toBe(1)
  })

  test('Chaos 4：5 路并发读接口撞击临期 Token，/auth/refresh 只发生 1 次', async ({
    page,
  }) => {
    const { token: staleToken } = await bootstrapSession(page)

    const authHeaders: Record<string, string[]> = {
      dashboard: [],
      tags: [],
      approvals: [],
      items: [],
      me: [],
    }
    const record = (bucket: keyof typeof authHeaders, route: Parameters<typeof fulfillJson>[0]) => {
      authHeaders[bucket].push(
        route.request().headers()['authorization'] ?? '',
      )
    }

    let refreshCalls = 0
    let refreshBearer = ''

    await page.route(/\/items\/dashboard\/me$/, (route) => {
      record('dashboard', route)
      return fulfillJson(route, EMPTY_DASHBOARD)
    })
    await page.route(/\/items\/tags$/, (route) => {
      record('tags', route)
      return fulfillJson(route, [])
    })
    await page.route(/\/items\/ai\/approvals$/, (route) => {
      record('approvals', route)
      return fulfillJson(route, [])
    })
    await page.route(/\/items(\?.*)?$/, (route) => {
      record('items', route)
      return fulfillJson(route, {
        total: 0,
        items: [],
        skip: 0,
        limit: 20,
      })
    })
    await page.route('**/auth/me', (route) => {
      record('me', route)
      return fulfillJson(route, TEST_USER)
    })
    await page.route('**/auth/refresh', async (route) => {
      refreshCalls += 1
      refreshBearer = route.request().headers()['authorization'] ?? ''
      // 模拟 250ms 续期延迟，让并发请求全部落在同一 Single-Flight 窗口。
      await new Promise((resolve) => setTimeout(resolve, 250))
      await fulfillJson(route, {
        access_token: FRESH_TOKEN,
        token_type: 'bearer',
        expires_in: 3600,
        role: 'user',
        user_id: TEST_USER.id,
        email: TEST_USER.email,
      })
    })

    await page.goto('/market')
    await expect(
      page.getByRole('button', { name: '刷新商品' }),
    ).toBeVisible()

    // 预置仅剩 2 分钟有效期：进入 10 分钟主动续期阈值。
    await page.evaluate(() => {
      window.localStorage.setItem(
        'access_token_expires_at',
        String(Date.now() + 2 * 60 * 1000),
      )
    })

    // 通过页面真实 API 模块同时发起 5 路读请求，全部经过同一个 axios
    // 拦截器与 ensureFreshToken，模拟并发撞击临期 Token。
    await page.evaluate(async () => {
      const load = (path: string) => import(/* @vite-ignore */ path)
      const [dashboard, tags, agent, items, auth] = await Promise.all([
        load('/src/api/dashboard.ts'),
        load('/src/api/tags.ts'),
        load('/src/api/agent.ts'),
        load('/src/api/items.ts'),
        load('/src/api/auth.ts'),
      ])

      await Promise.all([
        dashboard.getMyDashboard(),
        tags.listTags(),
        agent.listPendingApprovals(),
        items.listItems({ limit: 1 }),
        auth.getMe(),
      ])
    })

    expect(refreshCalls).toBe(1)
    expect(refreshBearer).toBe(`Bearer ${staleToken}`)

    for (const bucket of ['dashboard', 'tags', 'approvals', 'items', 'me']) {
      const captured = authHeaders[bucket].slice(-1)[0]
      expect(captured, `${bucket} 应携带续期后的 token`).toBe(
        `Bearer ${FRESH_TOKEN}`,
      )
    }

    await expect
      .poll(() =>
        page.evaluate(() => window.localStorage.getItem('access_token')),
      )
      .toBe(FRESH_TOKEN)

    // 后续业务请求继续使用新 token，且不再触发第二次续期。
    const itemsBefore = authHeaders.items.length
    await page.getByRole('button', { name: '刷新商品' }).click()
    await expect
      .poll(() => authHeaders.items.length, { timeout: 10_000 })
      .toBe(itemsBefore + 1)
    expect(authHeaders.items.slice(-1)[0]).toBe(`Bearer ${FRESH_TOKEN}`)
    expect(refreshCalls).toBe(1)
  })

  test('Chaos 5：审批失败后「重新提交该订单」确定性闭环，重新发起新的 SSE 下单', async ({
    page,
  }) => {
    await bootstrapSession(page)

    const approval = {
      approval_id: 401,
      thread_id: TEST_THREAD_ID,
      action: 'create_order',
      status: 'pending',
      payload: {
        item_id: 42,
        item_name: '降噪耳机',
        quantity: 2,
        unit_price: 599,
        amount: 1198,
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
    let streamCalls = 0
    let streamKey = ''
    let streamBody: { message?: string; thread_id?: string } | null = null

    await page.route(/\/items\/dashboard\/me$/, (route) =>
      fulfillJson(route, EMPTY_DASHBOARD),
    )
    await page.route(/\/items\/ai\/approvals$/, (route) =>
      fulfillJson(route, failed ? [] : [approval]),
    )
    await mockAgentThread(page)
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
      failed = true
      return fulfillJson(
        route,
        {
          error: {
            code: 'OUT_OF_STOCK',
            message: '库存不足，无法创建订单。',
            trace_id: 'trace-hell-out-of-stock',
          },
        },
        400,
      )
    })
    await page.route('**/items/ai/agent/stream', async (route) => {
      streamCalls += 1
      streamKey = route.request().headers()['x-idempotency-key'] ?? ''
      try {
        streamBody = JSON.parse(route.request().postData() ?? '{}') as {
          message?: string
          thread_id?: string
        }
      } catch {
        streamBody = null
      }

      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        headers: { 'cache-control': 'no-store' },
        body:
          sseFrame('9-0', 'token', { text: '已重新提交新的审批。' }) +
          sseFrame('10-0', 'done', { steps: 1 }),
      })
    })

    await page.goto('/studio')
    await expect(page.getByText('个人工作台').first()).toBeVisible()
    await page.getByRole('tab', { name: /待审批收件箱/ }).click()
    await expect(page.getByText('降噪耳机').first()).toBeVisible()

    await page.getByRole('button', { name: '批准并下单' }).click()
    await expect(page.getByText('执行失败').first()).toBeVisible()
    await expect(
      page.getByText('库存不足，无法创建订单。', { exact: true }),
    ).toBeVisible()

    const resubmit = page.getByRole('button', { name: '重新提交该订单' })
    await expect(resubmit).toBeVisible()
    await resubmit.click()

    await expect.poll(() => streamCalls, { timeout: 15_000 }).toBe(1)
    expect(streamKey).toMatch(IDEMPOTENCY_KEY_PATTERN)
    expect(streamBody).not.toBeNull()
    expect(streamBody?.thread_id).toBe(TEST_THREAD_ID)
    expect(streamBody?.message).toContain('42')
    expect(streamBody?.message).toContain('降噪耳机')
    expect(streamBody?.message).toContain('数量 2')
    expect(streamBody?.message).toContain('上海市浦东新区世纪大道 1 号')
    expect(streamBody?.message).toContain('create_order')

    // 抽屉自动打开并展示确定性指令，用户可在对话中继续跟进。
    await expect(page.getByRole('dialog')).toContainText('商品 ID 42')
  })
})

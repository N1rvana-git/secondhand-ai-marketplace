import { expect, test } from '@playwright/test'
import {
  bootstrapSession,
  fulfillJson,
  mockMarketBootstrap,
  MARKET_INPUT_PLACEHOLDER,
  TEST_THREAD_ID,
} from './support/api'

const PROMPT = '预算 500 元以内推荐在售键盘'
const FIRST_HALF = '预算 500 元'
const SECOND_HALF = '以内推荐这款键盘。'

function sseFrame(id: string, event: string, data: unknown): string {
  return `id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

test('SSE 断流后自动续播：复用幂等键、携带 Last-Event-ID 且前半句零重复', async ({
  page,
}) => {
  await bootstrapSession(page)
  await mockMarketBootstrap(page)

  await page.route(/\/items\/ai\/history(\?.*)?$/, (route) =>
    fulfillJson(route, []),
  )
  await page.route(/\/items\/ai\/threads\/[^/]+\/status$/, (route) =>
    fulfillJson(route, {
      thread_id: TEST_THREAD_ID,
      is_interrupted: false,
      pending_approvals: [],
      last_message_at: null,
      last_role: null,
    }),
  )

  let attempts = 0
  let firstIdempotencyKey = ''
  let secondIdempotencyKey = ''
  let secondLastEventId = ''

  await page.route('**/items/ai/agent/stream', async (route) => {
    attempts += 1
    const headers = route.request().headers()

    if (attempts === 1) {
      firstIdempotencyKey = headers['x-idempotency-key'] ?? ''
      expect(headers['last-event-id']).toBeUndefined()

      // 只发出 intent 与 token 前半句后直接断流，模拟真实网络中断。
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        headers: { 'cache-control': 'no-store' },
        body:
          sseFrame('1-0', 'intent', {
            intent: 'shopping_search',
            tools: ['search_items'],
          }) + sseFrame('2-0', 'token', { text: FIRST_HALF }),
      })
      return
    }

    secondIdempotencyKey = headers['x-idempotency-key'] ?? ''
    secondLastEventId = headers['last-event-id'] ?? ''

    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      headers: { 'cache-control': 'no-store' },
      body:
        sseFrame('2-1', 'token', { text: SECOND_HALF }) +
        sseFrame('3-0', 'done', { steps: 1 }),
    })
  })

  await page.goto('/market')
  await page.getByRole('button', { name: '打开 AI 导购' }).click()

  const input = page.getByPlaceholder(MARKET_INPUT_PLACEHOLDER)
  await expect(input).toBeEnabled()
  await input.fill(PROMPT)
  await input.press('Enter')

  await expect.poll(() => attempts, { timeout: 20_000 }).toBe(2)

  expect(firstIdempotencyKey).not.toBe('')
  expect(secondIdempotencyKey).toBe(firstIdempotencyKey)
  expect(secondLastEventId).toBe('2-0')

  const assistant = page.locator('article').filter({ hasText: 'AI 导购' })
  await expect(assistant).toContainText(`${FIRST_HALF}${SECOND_HALF}`, {
    timeout: 20_000,
  })

  const content = await assistant.innerText()
  expect(content.match(/预算 500 元/g) ?? []).toHaveLength(1)
})

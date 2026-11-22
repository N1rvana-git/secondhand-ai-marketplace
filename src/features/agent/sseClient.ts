/**
 * 纯 TypeScript SSE 客户端（零 React 依赖）。
 *
 * 协议要点：
 * - `POST /items/ai/agent/stream`，`Accept: text/event-stream`
 * - 帧以空行切分（`\r?\n\r?\n`），`:` 开头为 15s 心跳注释
 * - 完整解析 `id:` / `event:` / 多行 `data:`
 * - 未收到终态事件（done / error / aborted / interrupt_required）前意外断流时，
 *   携带相同 X-Idempotency-Key 与最新 Last-Event-ID 续播，最多重连 2 次（1s / 2s）
 */

import { API_BASE_URL, ensureIdempotencyKey } from '@/api/client'
import { ensureFreshToken } from '@/api/tokenRefresh'

export const SSE_TERMINAL_EVENTS = [
  'done',
  'error',
  'aborted',
  'interrupt_required',
] as const

export type SseTerminalEvent = (typeof SSE_TERMINAL_EVENTS)[number]

export function isTerminalSseEvent(
  event: string | null | undefined,
): event is SseTerminalEvent {
  return (
    typeof event === 'string' &&
    (SSE_TERMINAL_EVENTS as readonly string[]).includes(event)
  )
}

export interface SseFrame {
  id: string | null
  event: string | null
  /** 多行 data 以 \n 拼接后的原始字符串，由调用方做安全 JSON 解析 */
  data: string
}

const FRAME_SEPARATOR = /\r\n\r\n|\n\n|\r\r/
const LINE_SEPARATOR = /\r\n|\n|\r/

/**
 * 增量帧解析器。`push` 接受任意切分的文本块，内部维护半帧缓冲区。
 */
export class SseFrameParser {
  private buffer = ''
  private lastEventId: string | null
  private terminalEvent: SseTerminalEvent | null = null
  private readonly onFrame: (frame: SseFrame) => void

  constructor(
    onFrame: (frame: SseFrame) => void,
    initialEventId: string | null = null,
  ) {
    this.onFrame = onFrame
    this.lastEventId = initialEventId
  }

  push(chunk: string): void {
    if (!chunk) return
    this.buffer += chunk

    const parts = this.buffer.split(FRAME_SEPARATOR)
    this.buffer = parts.pop() ?? ''
    for (const part of parts) {
      this.dispatch(part)
    }
  }

  /** 流正常结束时冲刷末尾没有空行收尾的半帧。 */
  flush(): void {
    if (!this.buffer.trim()) {
      this.buffer = ''
      return
    }
    const rest = this.buffer
    this.buffer = ''
    this.dispatch(rest)
  }

  getLastEventId(): string | null {
    return this.lastEventId
  }

  getTerminalEvent(): SseTerminalEvent | null {
    return this.terminalEvent
  }

  private dispatch(rawFrame: string): void {
    if (!rawFrame.trim()) return

    let frameId: string | null = null
    let event: string | null = null
    const dataLines: string[] = []

    for (const line of rawFrame.split(LINE_SEPARATOR)) {
      if (!line || line.startsWith(':')) continue

      const colon = line.indexOf(':')
      const field = colon === -1 ? line : line.slice(0, colon)
      let value = colon === -1 ? '' : line.slice(colon + 1)
      if (value.startsWith(' ')) value = value.slice(1)

      if (field === 'id') {
        frameId = value
      } else if (field === 'event') {
        event = value
      } else if (field === 'data') {
        dataLines.push(value)
      }
    }

    if (frameId !== null) this.lastEventId = frameId
    // 仅带 id / retry 的帧不产生业务事件。
    if (!event && dataLines.length === 0) return

    const frame: SseFrame = {
      id: frameId,
      event,
      data: dataLines.join('\n'),
    }

    if (isTerminalSseEvent(event)) this.terminalEvent = event
    this.onFrame(frame)
  }
}

export class AgentStreamHttpError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'AgentStreamHttpError'
    this.status = status
    this.code = code
  }
}

export interface AgentStreamParams {
  message: string
  threadId: string
  idempotencyKey: string
  token: string
  /** 仅断线续传时携带 */
  lastEventId?: string | null
  signal?: AbortSignal
}

export interface AgentStreamHandlers {
  onFrame?: (frame: SseFrame) => void
  onReconnect?: (attempt: number, delayMs: number) => void
}

export type AgentStreamResult =
  | { status: 'completed'; terminal: SseTerminalEvent }
  | { status: 'aborted' }
  | {
      status: 'failed'
      error: unknown
      reconnects: number
      lastEventId: string | null
    }

const MAX_RECONNECTS = 2

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError')
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function fallbackHttpMessage(status: number): string {
  if (status === 401) return '登录状态已失效，请重新登录。'
  if (status === 403) return '当前账号无权使用 AI 导购。'
  if (status === 409) return '当前会话正忙，请稍后再试。'
  if (status === 422) return '消息未通过校验，请检查内容后重试。'
  if (status === 429) return '请求过于频繁，请稍后再试。'
  if (status >= 500) return 'AI 服务暂时不可用，请稍后重试。'
  return 'AI 会话建立失败，请稍后重试。'
}

function parseHttpError(
  status: number,
  rawBody: string,
): { code: string; message: string } {
  let code = `HTTP_${status}`
  let message = ''

  try {
    const parsed: unknown = JSON.parse(rawBody)
    if (isRecord(parsed)) {
      if (isRecord(parsed.error)) {
        if (typeof parsed.error.code === 'string') code = parsed.error.code
        if (typeof parsed.error.message === 'string') {
          message = parsed.error.message
        }
      }
      if (!message && typeof parsed.detail === 'string') {
        message = parsed.detail
      }
    }
  } catch {
    // 非 JSON 错误体：使用状态码兜底文案
  }

  return { code, message: message || fallbackHttpMessage(status) }
}

function wait(ms: number, signal?: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve(true)
      return
    }

    const timer = setTimeout(() => {
      cleanup()
      resolve(false)
    }, ms)

    const onAbort = () => {
      cleanup()
      resolve(true)
    }

    function cleanup() {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }

    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

async function openStream(
  params: AgentStreamParams,
  parser: SseFrameParser,
): Promise<'eof' | 'aborted'> {
  // 建立流之前先确保 token 新鲜：长对话可能跨越 token 有效期中段。
  const freshToken = (await ensureFreshToken()) ?? params.token

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
    Authorization: `Bearer ${freshToken}`,
    'X-Idempotency-Key': params.idempotencyKey,
    'X-Thread-ID': params.threadId,
  }
  if (params.lastEventId) {
    headers['Last-Event-ID'] = params.lastEventId
  }

  const response = await fetch(`${API_BASE_URL}/items/ai/agent/stream`, {
    method: 'POST',
    headers,
    // 只发送当前这一句，历史由后端 ChatRecord / BuyerMemory 管理。
    body: JSON.stringify({ message: params.message, thread_id: params.threadId }),
    signal: params.signal,
    cache: 'no-store',
  })

  if (!response.ok) {
    const rawBody = await response.text().catch(() => '')
    const { code, message } = parseHttpError(response.status, rawBody)

    if (response.status === 401 && typeof window !== 'undefined') {
      window.dispatchEvent(new Event('auth:unauthorized'))
    }
    throw new AgentStreamHttpError(response.status, code, message)
  }

  if (!response.body) {
    throw new Error('当前浏览器不支持流式响应读取')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()

  try {
    for (;;) {
      if (params.signal?.aborted) return 'aborted'

      const { done, value } = await reader.read()
      if (done) break

      parser.push(decoder.decode(value, { stream: true }))
      if (parser.getTerminalEvent()) break
    }

    if (params.signal?.aborted) return 'aborted'

    const tail = decoder.decode()
    if (tail) parser.push(tail)
    parser.flush()

    return 'eof'
  } finally {
    // 终态事件后服务端会主动关流；提前取消以避免悬挂的 reader。
    try {
      await reader.cancel()
    } catch {
      // 流已关闭 / 已被取消，忽略
    }
  }
}

export async function streamAgentChat(
  params: AgentStreamParams,
  handlers: AgentStreamHandlers = {},
): Promise<AgentStreamResult> {
  // 严格幂等：空串 / 非法字符 / 超长一律在进入重连循环前归一化一次，
  // 保证首包与后续续传使用完全相同的 X-Idempotency-Key。
  const normalized: AgentStreamParams = {
    ...params,
    idempotencyKey: ensureIdempotencyKey(params.idempotencyKey),
  }

  let lastEventId = normalized.lastEventId ?? null
  let reconnects = 0
  let lastError: unknown = null

  for (let attempt = 0; attempt <= MAX_RECONNECTS; attempt += 1) {
    if (normalized.signal?.aborted) return { status: 'aborted' }

    const parser = new SseFrameParser((frame) => {
      handlers.onFrame?.(frame)
    }, lastEventId)

    try {
      const outcome = await openStream(
        { ...normalized, lastEventId },
        parser,
      )
      lastEventId = parser.getLastEventId() ?? lastEventId

      const terminal = parser.getTerminalEvent()
      if (terminal) return { status: 'completed', terminal }
      if (outcome === 'aborted' || normalized.signal?.aborted) {
        return { status: 'aborted' }
      }

      lastError = new Error('流式连接在终态事件前中断')
    } catch (error) {
      if (normalized.signal?.aborted || isAbortError(error)) {
        return { status: 'aborted' }
      }

      lastEventId = parser.getLastEventId() ?? lastEventId

      // 客户端错误（4xx）不重连：鉴权 / 校验 / 会话忙需要用户显式处理。
      if (
        error instanceof AgentStreamHttpError &&
        error.status < 500
      ) {
        return { status: 'failed', error, reconnects, lastEventId }
      }

      lastError = error
    }

    if (attempt >= MAX_RECONNECTS) break

    reconnects += 1
    const delayMs = reconnects === 1 ? 1000 : 2000
    handlers.onReconnect?.(reconnects, delayMs)

    const aborted = await wait(delayMs, normalized.signal)
    if (aborted) return { status: 'aborted' }
  }

  return {
    status: 'failed',
    error: lastError ?? new Error('无法建立 AI 会话连接'),
    reconnects,
    lastEventId,
  }
}

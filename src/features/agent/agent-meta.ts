/**
 * AI 导购的展示层映射与格式化工具。
 * 只做纯函数映射，不依赖 React / Store，便于被 Store 与组件共享。
 */

export const INTENT_LABELS: Record<string, string> = {
  shopping_search: '商品检索',
  policy_qa: '规则咨询',
  order_action: '订单执行',
  chitchat: '常规对话',
}

export const TOOL_LABELS: Record<string, string> = {
  search_items: '检索平台在售商品',
  search_platform_policy: '查询平台交易规则',
  search_web_price: '全网市场比价',
  list_my_orders: '查询我的近期订单',
  create_order: '创建交易订单',
}

export const AGENT_ERROR_MESSAGES: Record<string, string> = {
  THREAD_BUSY: '当前会话正在生成回复，请稍后再试。',
  STREAM_TIMEOUT: '本次生成超时，请重新提问。',
  RUN_GONE: '这段回答已过期，请重新发送。',
  UPSTREAM_UNAVAILABLE: '模型服务暂时不可用，请稍后重试。',
  NETWORK_ERROR: '连接已中断，请检查网络后重试。',
  UNAUTHORIZED: '登录状态已失效，请重新登录。',
}

export function getIntentLabel(intent: string | null | undefined): string {
  if (!intent) return ''
  return INTENT_LABELS[intent] ?? intent
}

export function getToolLabel(name: string): string {
  return TOOL_LABELS[name] ?? name
}

export function describeAgentError(
  code: string | null | undefined,
  fallback: string,
): string {
  if (code && AGENT_ERROR_MESSAGES[code]) return AGENT_ERROR_MESSAGES[code]
  return fallback || '生成失败，请重试。'
}

const NAIVE_ISO_PATTERN =
  /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/

/**
 * 后端可能返回带时区的 ISO，也可能返回 naive datetime；后者按 UTC 解释，
 * 避免倒计时因浏览器本地时区产生整小时偏差。
 */
export function parseServerDate(
  value: string | null | undefined,
): Date | null {
  if (!value) return null
  const normalized = NAIVE_ISO_PATTERN.test(value)
    ? `${value.replace(' ', 'T')}Z`
    : value
  const date = new Date(normalized)
  return Number.isNaN(date.getTime()) ? null : date
}

export function formatCurrency(
  value: number | null | undefined,
): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: 'CNY',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

/** 审批有效期倒计时：mm:ss，超过一小时显示 hh:mm:ss。 */
export function formatCountdown(remainingMs: number): string {
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) return '已过期'
  const totalSeconds = Math.floor(remainingMs / 1000)
  const seconds = totalSeconds % 60
  const minutes = Math.floor(totalSeconds / 60) % 60
  const hours = Math.floor(totalSeconds / 3600)
  const pad = (value: number) => String(value).padStart(2, '0')
  return hours > 0
    ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
    : `${pad(minutes)}:${pad(seconds)}`
}

export function formatMessageTime(value: string): string {
  const date = parseServerDate(value)
  if (!date) return ''
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function readPayloadText(
  payload: Record<string, unknown>,
  key: string,
): string | null {
  const value = payload[key]
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return null
}

export function readPayloadNumber(
  payload: Record<string, unknown>,
  key: string,
): number | null {
  const value = payload[key]
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

export function readApprovalAddress(
  payload: Record<string, unknown>,
): string | null {
  const direct =
    readPayloadText(payload, 'address') ??
    readPayloadText(payload, 'shipping_address')
  if (direct) return direct

  const nested = payload.address ?? payload.shipping_address
  if (isRecord(nested)) {
    const parts = Object.values(nested).filter(
      (value): value is string =>
        typeof value === 'string' && value.trim().length > 0,
    )
    if (parts.length > 0) return parts.join(' ')
  }
  return null
}

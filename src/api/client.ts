import axios from 'axios'
import { API_BASE_URL } from '@/api/config'
import { ensureFreshToken } from '@/api/tokenRefresh'
import { getAccessToken } from '@/lib/auth-token'
import type { ApiErrorEnvelope } from '@/types/api'

export { API_BASE_URL }

interface ApiErrorInit {
  status: number
  code: string
  message: string
  traceId: string
  details: Record<string, unknown>
  retryAfter: number | null
}

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly traceId: string
  readonly details: Record<string, unknown>
  readonly retryAfter: number | null

  constructor(init: ApiErrorInit) {
    super(init.message)
    this.name = 'ApiError'
    this.status = init.status
    this.code = init.code
    this.traceId = init.traceId
    this.details = init.details
    this.retryAfter = init.retryAfter
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseRetryAfter(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null

  const seconds = Number.parseInt(String(value), 10)
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null
}

function fallbackMessage(status: number): string {
  switch (status) {
    case 400:
      return '请求参数有误，请检查后重试。'
    case 401:
      return '登录状态已失效，请重新登录。'
    case 403:
      return '无权限执行此操作。'
    case 404:
      return '请求的资源不存在。'
    case 409:
      return '当前状态冲突，请刷新后重试。'
    case 422:
      return '提交的数据未通过校验。'
    case 429:
      return '请求过于频繁，请稍后再试。'
    case 503:
      return '服务暂时不可用，请稍后再试。'
    default:
      return status >= 500
        ? '服务器开小差了，请稍后再试。'
        : '请求失败，请稍后重试。'
  }
}

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 20_000,
  headers: {
    Accept: 'application/json',
  },
})

/**
 * 后端开启 `IDEMPOTENCY_HEADER_REQUIRED=true` 时，以下写接口缺少合法
 * `X-Idempotency-Key` 会直接 422 / 428。前端在封装层兜底，绝不裸发。
 */
const IDEMPOTENT_WRITE_PATTERNS = [
  /\/items\/?$/,
  /\/items\/\d+\/buy\/?$/,
  /\/items\/ai\/agent\/stream\/?$/,
]

/** 后端约束：1–128 位字母 / 数字 / `-` `_` `:`。 */
export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9\-_:]{1,128}$/

export function isValidIdempotencyKey(key: string): boolean {
  return IDEMPOTENCY_KEY_PATTERN.test(key)
}

/**
 * 生成符合后端字符集的幂等键。`crypto.randomUUID()` 不可用（非安全上下文 /
 * 旧浏览器）时退化为时间戳 + 随机串，同样满足 1–128 位合法字符。
 */
export function createIdempotencyKey(): string {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return crypto.randomUUID()
  }
  return `idem-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 12)}`
}

/**
 * 归一化幂等键：调用方传入合法值则原样复用（重试期间保持同一 Key），
 * 否则生成新的合法 Key。空串 / 超长 / 非法字符一律兜底，绝不透传。
 */
export function ensureIdempotencyKey(key?: string | null): string {
  const normalized = typeof key === 'string' ? key.trim() : ''
  return isValidIdempotencyKey(normalized)
    ? normalized
    : createIdempotencyKey()
}

function requiresIdempotencyKey(
  method: string | undefined,
  url: string | undefined,
): boolean {
  if (!method || method.toLowerCase() !== 'post') return false
  const path = (url ?? '').split('?')[0] ?? ''
  return IDEMPOTENT_WRITE_PATTERNS.some((pattern) => pattern.test(path))
}

function isAuthLifecycleRequest(url: string | undefined): boolean {
  if (!url) return false
  const path = url.split('?')[0] ?? url
  return path.endsWith('/token') || path.endsWith('/auth/refresh')
}

apiClient.interceptors.request.use(async (config) => {
  // 登录 / 续期自身不能触发续期，否则会形成递归。
  if (!isAuthLifecycleRequest(config.url)) {
    try {
      await ensureFreshToken()
    } catch {
      // 续期失败不阻断原请求，让正常 401 流程统一处理。
    }
  }

  const token = getAccessToken()
  if (token) {
    config.headers.set('Authorization', `Bearer ${token}`)
  }

  // 兜底审计：任何受幂等保护的写请求都必须带合法 Key，即使调用方漏传。
  if (requiresIdempotencyKey(config.method, config.url)) {
    const current = config.headers.get('X-Idempotency-Key')
    const currentKey = typeof current === 'string' ? current : null
    if (!currentKey || !isValidIdempotencyKey(currentKey)) {
      config.headers.set('X-Idempotency-Key', ensureIdempotencyKey(currentKey))
    }
  }

  return config
})

apiClient.interceptors.response.use(
  (response) => response,
  (error: unknown) => {
    if (!axios.isAxiosError(error)) {
      return Promise.reject(error)
    }

    const status = error.response?.status ?? 0
    const requestUrl = error.config?.url ?? ''
    const responseData: unknown = error.response?.data
    const envelope = isRecord(responseData)
      ? (responseData as ApiErrorEnvelope)
      : undefined
    const headers = error.response?.headers as
      | Record<string, unknown>
      | undefined
    const retryAfter = parseRetryAfter(
      headers?.['retry-after'] ?? headers?.['Retry-After'],
    )

    const code =
      envelope?.error?.code ??
      (status === 0 ? 'NETWORK_ERROR' : `HTTP_${status}`)
    const backendMessage =
      envelope?.error?.message ??
      (typeof envelope?.detail === 'string' ? envelope.detail : undefined)

    let message = backendMessage ?? fallbackMessage(status)

    if (status === 403) {
      message = backendMessage ?? '无权限执行此操作。'
    } else if (status === 429) {
      message = retryAfter
        ? `请求过于频繁，请在 ${retryAfter} 秒后重试。`
        : '请求过于频繁，请稍后再试。'
    } else if (status === 0) {
      message =
        error.code === 'ECONNABORTED'
          ? '请求超时，请确认后端服务响应正常。'
          : '无法连接后端服务，请确认 FastAPI 服务已启动。'
    }

    const isTokenRequest = requestUrl.includes('/token')
    if (
      status === 401 &&
      !isTokenRequest &&
      typeof window !== 'undefined'
    ) {
      window.dispatchEvent(new Event('auth:unauthorized'))
    }

    return Promise.reject(
      new ApiError({
        status,
        code,
        message,
        traceId: envelope?.error?.trace_id ?? '',
        details: envelope?.error?.details ?? {},
        retryAfter,
      }),
    )
  },
)

export function resolveMediaUrl(path: string | null | undefined): string {
  if (!path) return ''
  if (path.startsWith('http://') || path.startsWith('https://')) return path
  return `${API_BASE_URL}/${path.replace(/^\//, '')}`
}

export function withIdempotencyKey(key?: string): Record<string, string> {
  return {
    'X-Idempotency-Key': ensureIdempotencyKey(key),
  }
}

export function getApiErrorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return '发生未知错误，请稍后重试。'
}

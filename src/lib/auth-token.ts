const ACCESS_TOKEN_KEY = 'access_token'
const ACCESS_TOKEN_EXPIRES_AT_KEY = 'access_token_expires_at'

/** 后端 TokenResponse 中与本地有效期持久化相关的最小字段。 */
export interface AccessTokenPayload {
  access_token: string
  expires_in: number
}

export function getAccessToken(): string | null {
  if (typeof window === 'undefined') return null
  return window.localStorage.getItem(ACCESS_TOKEN_KEY)
}

/**
 * 读取本地记录的 token 过期时间（毫秒时间戳）。
 * 旧版本登录态没有该字段时返回 null，交由正常 401 流程兜底。
 */
export function getAccessTokenExpiresAt(): number | null {
  if (typeof window === 'undefined') return null
  const raw = window.localStorage.getItem(ACCESS_TOKEN_EXPIRES_AT_KEY)
  if (!raw) return null
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 ? value : null
}

export function storeAccessToken(token: string): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(ACCESS_TOKEN_KEY, token)
}

export function storeAccessTokenExpiry(expiresAt: number): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(ACCESS_TOKEN_EXPIRES_AT_KEY, String(expiresAt))
}

/**
 * 登录 / 续期成功后的统一落盘：token 与过期时间同时写入，
 * 保证刷新页面后仍能判断是否需要主动续期。
 */
export function persistAccessToken(payload: AccessTokenPayload): {
  token: string
  expiresAt: number
} {
  const seconds = Number.isFinite(payload.expires_in)
    ? Math.max(0, payload.expires_in)
    : 0
  const expiresAt = Date.now() + seconds * 1000

  storeAccessToken(payload.access_token)
  storeAccessTokenExpiry(expiresAt)

  return { token: payload.access_token, expiresAt }
}

export function clearAccessToken(): void {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(ACCESS_TOKEN_KEY)
  window.localStorage.removeItem(ACCESS_TOKEN_EXPIRES_AT_KEY)
}

export { ACCESS_TOKEN_KEY, ACCESS_TOKEN_EXPIRES_AT_KEY }

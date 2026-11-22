/**
 * 主动静默 Token 续期协调器。
 *
 * 后端 `POST /auth/refresh` 依赖 `CurrentUser`，要求携带**尚未过期**的 Bearer
 * Token，因此只能在过期前主动续期。多个并发请求（Axios / SSE / 标签页唤醒）
 * 同时进入时，通过模块级 `inFlightRefresh` 复用同一个 Promise，
 * 保证瞬时只发出 1 次 `/auth/refresh`，避免并发雪崩。
 */

import axios from 'axios'
import { API_BASE_URL } from '@/api/config'
import {
  getAccessToken,
  getAccessTokenExpiresAt,
  persistAccessToken,
} from '@/lib/auth-token'
import { useAuthStore } from '@/stores/auth'
import type { TokenResponse } from '@/types/api'

/** 剩余有效期小于该阈值时主动续期，给长表单 / 长对话留足缓冲。 */
export const TOKEN_REFRESH_THRESHOLD_MS = 10 * 60 * 1000

/** Single-Flight：同一时刻只允许一个续期请求在途。 */
let inFlightRefresh: Promise<string | null> | null = null

export function isTokenNearExpiry(
  expiresAt: number | null,
  now: number = Date.now(),
): boolean {
  return (
    expiresAt !== null &&
    expiresAt > now &&
    expiresAt - now < TOKEN_REFRESH_THRESHOLD_MS
  )
}

async function performRefresh(currentToken: string): Promise<string | null> {
  try {
    const { data } = await axios.post<TokenResponse>(
      `${API_BASE_URL}/auth/refresh`,
      null,
      {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${currentToken}`,
        },
        timeout: 20_000,
      },
    )

    const nextToken =
      typeof data?.access_token === 'string' ? data.access_token : ''
    if (!nextToken) return getAccessToken()

    // 续期期间用户已登出 / 切换账号：丢弃迟到的结果，避免把旧会话写回去。
    if (getAccessToken() !== currentToken) return getAccessToken()

    const { expiresAt } = persistAccessToken(data)
    useAuthStore.getState().applyRefreshedToken(nextToken, expiresAt)
    return nextToken
  } catch {
    // 续期返回 401 或网络异常：静默失败，交回正常 401 管道处理。
    // 这里绝不递归重试 /auth/refresh，避免死循环。
    return getAccessToken()
  }
}

/**
 * 保证调用方拿到一个“当前可用”的 token。
 * - 无 token：返回 null；
 * - 距离过期仍充足：直接返回现有 token（零网络开销）；
 * - 剩余不足 10 分钟且尚未过期：Single-Flight 主动续期。
 * - 已过期：不主动续期（后端会拒绝），交由正常 401 流程。
 */
export function ensureFreshToken(): Promise<string | null> {
  const currentToken = getAccessToken()
  if (!currentToken) return Promise.resolve(null)

  if (!isTokenNearExpiry(getAccessTokenExpiresAt())) {
    return Promise.resolve(currentToken)
  }

  if (inFlightRefresh) return inFlightRefresh

  const refreshPromise = performRefresh(currentToken)
  inFlightRefresh = refreshPromise
  void refreshPromise.finally(() => {
    if (inFlightRefresh === refreshPromise) inFlightRefresh = null
  })

  return refreshPromise
}

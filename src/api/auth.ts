import { apiClient } from '@/api/client'
import { persistAccessToken } from '@/lib/auth-token'
import type {
  TokenResponse,
  UserPublic,
  UserRegisterRequest,
} from '@/types/api'

/**
 * 登录成功即把 token 与过期时间一起落盘，
 * 让请求拦截器在后续页面刷新后能判断是否需要主动续期。
 */
export async function login(
  email: string,
  password: string,
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    username: email,
    password,
  })

  const { data } = await apiClient.post<TokenResponse>('/token', body, {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  })

  persistAccessToken(data)
  return data
}

export async function register(
  payload: UserRegisterRequest,
): Promise<UserPublic> {
  const { data } = await apiClient.post<UserPublic>(
    '/users/register',
    payload,
  )
  return data
}

export async function getMe(): Promise<UserPublic> {
  const { data } = await apiClient.get<UserPublic>('/auth/me')
  return data
}

/** 续期成功同样刷新本地过期时间，保持 Store / localStorage 一致。 */
export async function refreshToken(): Promise<TokenResponse> {
  const { data } = await apiClient.post<TokenResponse>('/auth/refresh')
  persistAccessToken(data)
  return data
}

/**
 * 主动登出：后端据此递增 token_version，立即吊销该用户全部历史
 * Access Token 与 Refresh 能力。
 *
 * 请求失败（断网 / token 已过期 / 5xx）会正常 reject，由 Store 层容错，
 * 保证本地登出不被阻塞。
 */
export async function logoutServer(): Promise<void> {
  await apiClient.post('/auth/logout')
}

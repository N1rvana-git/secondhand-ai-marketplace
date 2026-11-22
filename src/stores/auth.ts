import { create } from 'zustand'
import {
  getMe,
  login as loginRequest,
  logoutServer,
} from '@/api/auth'
import {
  clearAccessToken,
  getAccessToken,
  getAccessTokenExpiresAt,
} from '@/lib/auth-token'
import { useAgentStore } from '@/stores/agent'
import type { UserPublic } from '@/types/api'

let hydrationPromise: Promise<void> | null = null

interface AuthState {
  token: string | null
  /** 本地 token 过期时间（毫秒时间戳），用于主动续期判断。 */
  expiresAt: number | null
  user: UserPublic | null
  isHydrated: boolean
  /** `force` 用于角色变更后强制重新拉取 /auth/me，刷新当前用户权限态。 */
  hydrate: (force?: boolean) => Promise<void>
  loginWithCredentials: (email: string, password: string) => Promise<void>
  /** 静默续期成功后的会话更新，只刷新 token 与有效期，不打断当前用户态。 */
  applyRefreshedToken: (token: string, expiresAt: number) => void
  /**
   * 主动登出（用户点击「退出登录」）：先通知后端吊销 token，
   * 再清理本地会话；接口失败不阻塞本地退出。
   */
  logout: () => Promise<void>
  /** 被动登出（全局 401）：只清理本地会话，不重复请求 `/auth/logout`。 */
  clearSession: () => void
}

export const useAuthStore = create<AuthState>((set, get) => ({
  token: getAccessToken(),
  expiresAt: getAccessTokenExpiresAt(),
  user: null,
  isHydrated: false,

  hydrate: async (force = false) => {
    if (get().isHydrated && !force) return
    if (hydrationPromise) return hydrationPromise

    hydrationPromise = (async () => {
      const token = getAccessToken()

      if (!token) {
        set({ token: null, expiresAt: null, user: null, isHydrated: true })
        return
      }

      try {
        const user = await getMe()
        set({
          token: getAccessToken(),
          expiresAt: getAccessTokenExpiresAt(),
          user,
          isHydrated: true,
        })
      } catch {
        clearAccessToken()
        set({
          token: null,
          expiresAt: null,
          user: null,
          isHydrated: true,
        })
      }
    })()

    try {
      await hydrationPromise
    } finally {
      hydrationPromise = null
    }
  },

  loginWithCredentials: async (email, password) => {
    const tokenResponse = await loginRequest(email, password)
    // login() 已落盘 token + expires_at；这里同步到 Store。
    const expiresAt = getAccessTokenExpiresAt()

    try {
      const user = await getMe()
      set({
        token: tokenResponse.access_token,
        expiresAt,
        user,
        isHydrated: true,
      })
    } catch (error) {
      clearAccessToken()
      set({ token: null, expiresAt: null, user: null, isHydrated: true })
      throw error
    }
  },

  applyRefreshedToken: (token, expiresAt) => {
    set({ token, expiresAt })
  },

  clearSession: () => {
    clearAccessToken()
    set({ token: null, expiresAt: null, user: null, isHydrated: true })
    // 清空 Copilot 内存中的私密对话与待审批，避免同一浏览器残留上一个账号的数据。
    useAgentStore.getState().resetOnLogout()
  },

  logout: async () => {
    // 主动登出：先让后端递增 token_version，吊销该用户全部历史 Access Token。
    // 断网 / token 已过期 / 服务端 5xx 都不能阻塞本地退出，故一律容错忽略。
    if (getAccessToken()) {
      try {
        await logoutServer()
      } catch {
        // 容错：接口失败时继续本地登出。
      }
    }

    get().clearSession()
  },
}))

if (typeof window !== 'undefined') {
  // 被动 401：token 已被服务端判定失效，直接清理本地态，避免重复请求 /auth/logout。
  window.addEventListener('auth:unauthorized', () => {
    useAuthStore.getState().clearSession()
  })
}

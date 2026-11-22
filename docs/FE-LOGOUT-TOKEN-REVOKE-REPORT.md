# 前端接入服务端登出吊销（`POST /auth/logout`）· 实现与验收报告

> **结论：需求 1–4 全部完成。`npm run typecheck`、`npm run build`、`npx playwright test e2e/resilience.spec.ts`（3 条用例）全部通过。**
>
> 采用最小改动：仅新增 1 个 API 封装、拆分 Store 的主动 / 被动登出、让「退出登录」等待本地清理完成后再提示，并向 `e2e/resilience.spec.ts` 追加 1 条确定性用例。未改动任何页面组件，未触碰后端与其它 API 模块。

| 项目 | 信息 |
| --- | --- |
| 执行时间 | 2026-11-22（Asia/Shanghai） |
| 前端仓库 | `D:\Projects-practice\Vue` |
| 技术栈 | React 19 · TypeScript 7 · Zustand 5 · Vite 8 · Axios · Sonner |
| 测试框架 | `@playwright/test ^1.65.1`，系统 Chrome（`channel: 'chrome'`） |
| E2E 基址 | `http://127.0.0.1:4173`（`npm run dev -- --mode test` + `.env.test` 同源 API） |
| 新增接口 | `POST /auth/logout`（递增 `token_version`，吊销该用户全部历史 Access Token 与 Refresh 能力） |
| 改动文件 | 4 个（2 个核心、1 个必要的一行 UI 调整、1 个 E2E 套件追加） |
| 类型检查 | `tsc --noEmit`，0 error |
| 生产构建 | `vite build` 成功；2600 modules；最大 chunk `react-vendor` **245.27 kB / gzip 78.14 kB** |
| E2E | **3 passed / 0 failed**（27.1s） |
| 总判定 | **PASS** |

---

## 1. 验收结论速览

| # | 验收项 | 结果 | 关键证据 |
| --- | --- | --- | --- |
| 1 | `src/api/auth.ts` 新增 `logoutServer()` | **PASS** | 调用 `apiClient.post('/auth/logout')`，复用统一 Axios 实例（自动带 Bearer Token） |
| 2 | 主动登出 / 被动 401 登出分离 | **PASS** | 主动路径先 `await logoutServer()`（容错），再 `clearSession()`；401 监听只调 `clearSession()` |
| 3 | 1 条 Playwright 校验 | **PASS** | `e2e/resilience.spec.ts` 第 3 条用例：1 次 POST + 清空本地 token + 500 仍完成登出 |
| 4 | 自检门禁 | **PASS** | typecheck / build / resilience 套件全部通过 |

---

## 2. 背景与目标

后端新增 `POST /auth/logout`：携带当前 Bearer Token 调用后，服务端递增该用户的 `token_version`，使**该用户所有历史 Access Token 与 Refresh 能力立即失效**（而不仅是当前设备）。

本次前端只需完成「最小接入」，不新增页面、不改动业务页面：

1. 在 API 层暴露 `logoutServer(): Promise<void>`。
2. Store 层区分**主动登出**与**被动 401 登出**：
   - 主动登出必须先通知服务端吊销，再清理本地；接口失败（断网 / 已过期 / 5xx）不得阻塞本地退出。
   - 全局 `auth:unauthorized`（401）事件仍只做本地清理，**不得**重复请求 `/auth/logout`（此时 token 已失效，再请求只会多一次 401）。
3. 用 Playwright 固化行为，且覆盖「接口 500 仍能本地登出」的容错分支。

---

## 3. 改动清单

### 3.1 新增

| 文件 | 内容 |
| --- | --- |
| `docs/FE-LOGOUT-TOKEN-REVOKE-REPORT.md` | 本报告 |

### 3.2 修改

| # | 文件 | 变更要点 |
| --- | --- | --- |
| 1 | `src/api/auth.ts` | 新增 `logoutServer()`：`POST /auth/logout` |
| 2 | `src/stores/auth.ts` | 新增 `clearSession()`（本地清理 + `agentStore.resetOnLogout()`）；`logout` 改为 async 主动登出；401 监听改调 `clearSession()` |
| 3 | `src/components/app/user-menu.tsx` | `handleLogout` 改为 `await logout()` 后再 toast（清单外**唯一**一处，共 2 行，见 §6 说明） |
| 4 | `e2e/resilience.spec.ts` | 追加 1 条主动登出用例（含 500 容错断言） |

**未改动**：任何页面（`src/pages/*`）、路由、`src/api/client.ts`、`src/api/tokenRefresh.ts`、`src/layouts/AppShell.tsx`、后端仓库。

---

## 4. 设计说明

### 4.1 主动登出时序

```text
用户点击「退出登录」(UserMenu)
        │
        ▼
UserMenu.handleLogout  ── await ──▶  useAuthStore.logout()
                                          │
                        ┌─────────────────┴──────────────────┐
                        │ 本地存在 token？                     │
                        └─────────────────┬──────────────────┘
                                有 │                  无 │
                                   ▼                    │
                    try { await logoutServer() }        │
                    ── POST /auth/logout ──▶ 后端        │
                    递增 token_version，吊销全部历史 token│
                                   │                    │
                    成功 / 失败（catch 吞掉）            │
                                   └────────┬───────────┘
                                            ▼
                                  clearSession()
                          ├─ clearAccessToken()（清 access_token + expires_at）
                          ├─ set({ token: null, expiresAt: null, user: null, isHydrated: true })
                          └─ useAgentStore.getState().resetOnLogout()
                                            │
                                            ▼
                             toast.success('已退出登录')
```

### 4.2 被动 401 登出时序

```text
任意请求返回 401（非 /token）
        │
        ▼
api/client.ts 响应拦截器 ── window.dispatchEvent('auth:unauthorized')
        │
        ├──▶ stores/auth.ts 监听器 ── clearSession()（纯本地，无网络请求）
        │
        └──▶ router/index.tsx 监听器 ── toast + navigate('/login')
```

关键点：401 分支**复用** `clearSession()`，因此不会经过 `logout()`，天然满足「不重复请求 `/auth/logout`」。

### 4.3 容错策略

| 场景 | 行为 |
| --- | --- |
| `/auth/logout` 返回 500 / 502 / 503 | `ApiError` 被 `catch {}` 吞掉，继续 `clearSession()`，用户仍正常退出 |
| 断网 / 超时 | 同上（`ECONNABORTED` / `NETWORK_ERROR` 均被 catch） |
| token 已过期（**请求本身**返回 401） | 拦截器会派发 `auth:unauthorized` → `clearSession()` 先执行；请求 reject 被 catch；随后再执行一次 `clearSession()`（幂等）。本地登出必定完成 |
| 本地无 token（重复点击 / 未登录） | 跳过网络请求（避免必然的 401 与无意义事件），直接 `clearSession()` |

> `clearSession()` 是幂等的：`clearAccessToken()` 对不存在的 key 无副作用；`resetOnLogout()` 只 abort 已为 null 的 controller 并重置为默认状态。

### 4.4 与 `AppShell` 的职责关系

`AppShell` 原有逻辑未改：`user` 变为 `null` 时也会调用 `resetOnLogout()`（`useEffect` 依赖 `user`）。

- 主动登出：`logout()` 内已调用一次；`AppShell` 的 effect 随后再调用一次（幂等，无额外网络/副作用）。
- 被动 401：`clearSession()` 内调用一次；`AppShell` effect 同样兜底一次。
- 保留 `AppShell` 的 effect 作为防御纵深：即使未来有其它途径把 `user` 置空，Copilot 私密会话也不会残留。

### 4.5 依赖与循环引用说明

`auth store` 新增了对 `stores/agent` 的静态导入（需求明确要求登出时执行 `resetOnLogout()`）。`stores/agent` 不反向依赖 `auth store`，因此不存在 `auth ↔ agent` 双向依赖。

现有链路 `api/client → api/tokenRefresh → stores/auth → stores/agent → api/client` 构成 ESM 循环，但所有跨模块调用都发生在函数体内部（而非模块顶层求值），且 `npm run build` 与全部 E2E 已验证运行正常。

### 4.6 主动登出时对「提示时机」的调整

`logout()` 变成 async 后，若 `user-menu` 仍同步调用并在下一行 toast，会出现「提示已退出、但本地 token 尚未清理（正在等待网络）」的窗口，慢网下可感知。因此将 `handleLogout` 改为 `await logout()` 后再提示。这是需求清单外唯一改动，不涉及页面。

---

## 5. 完整代码

### 5.1 `src/api/auth.ts`（全文，63 行）

```ts
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
```

**新增部分（diff 语义）**

```diff
+/**
+ * 主动登出：后端据此递增 token_version，立即吊销该用户全部历史
+ * Access Token 与 Refresh 能力。
+ *
+ * 请求失败（断网 / token 已过期 / 5xx）会正常 reject，由 Store 层容错，
+ * 保证本地登出不被阻塞。
+ */
+export async function logoutServer(): Promise<void> {
+  await apiClient.post('/auth/logout')
+}
```

### 5.2 `src/stores/auth.ts`（全文，132 行）

```ts
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
```

**关键改动（diff 语义）**

```diff
 import {
   getMe,
   login as loginRequest,
+  logoutServer,
 } from '@/api/auth'
 import {
   clearAccessToken,
   getAccessToken,
   getAccessTokenExpiresAt,
 } from '@/lib/auth-token'
+import { useAgentStore } from '@/stores/agent'
 import type { UserPublic } from '@/types/api'
@@
   /** 静默续期成功后的会话更新，只刷新 token 与有效期，不打断当前用户态。 */
   applyRefreshedToken: (token: string, expiresAt: number) => void
-  logout: () => void
+  /**
+   * 主动登出（用户点击「退出登录」）：先通知后端吊销 token，
+   * 再清理本地会话；接口失败不阻塞本地退出。
+   */
+  logout: () => Promise<void>
+  /** 被动登出（全局 401）：只清理本地会话，不重复请求 `/auth/logout`。 */
+  clearSession: () => void
 }
@@
-  logout: () => {
+  clearSession: () => {
     clearAccessToken()
     set({ token: null, expiresAt: null, user: null, isHydrated: true })
+    // 清空 Copilot 内存中的私密对话与待审批，避免同一浏览器残留上一个账号的数据。
+    useAgentStore.getState().resetOnLogout()
+  },
+
+  logout: async () => {
+    // 主动登出：先让后端递增 token_version，吊销该用户全部历史 Access Token。
+    // 断网 / token 已过期 / 服务端 5xx 都不能阻塞本地退出，故一律容错忽略。
+    if (getAccessToken()) {
+      try {
+        await logoutServer()
+      } catch {
+        // 容错：接口失败时继续本地登出。
+      }
+    }
+
+    get().clearSession()
   },
 }))
 
 if (typeof window !== 'undefined') {
+  // 被动 401：token 已被服务端判定失效，直接清理本地态，避免重复请求 /auth/logout。
   window.addEventListener('auth:unauthorized', () => {
-    useAuthStore.getState().logout()
+    useAuthStore.getState().clearSession()
   })
 }
```

### 5.3 `src/components/app/user-menu.tsx`（节选，第 22–35 行）

```tsx
export function UserMenu() {
  const user = useAuthStore((state) => state.user)
  const logout = useAuthStore((state) => state.logout)

  if (!user) return null

  const isAdmin = user.role === 'admin'

  const handleLogout = async () => {
    // Store 内已对 /auth/logout 做容错，这里等待其完成本地清理后再提示。
    await logout()
    toast.success('已退出登录')
  }
```

**改动（diff 语义）**

```diff
-  const handleLogout = () => {
-    logout()
-    toast.success('已退出登录')
-  }
+  const handleLogout = async () => {
+    // Store 内已对 /auth/logout 做容错，这里等待其完成本地清理后再提示。
+    await logout()
+    toast.success('已退出登录')
+  }
```

### 5.4 `e2e/resilience.spec.ts`（追加，第 178–235 行）

```ts
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
```

---

## 6. E2E 用例设计

| 步骤 | 动作 | 断言 |
| --- | --- | --- |
| 1 | `bootstrapSession(page)` 预置 `access_token` / `access_token_expires_at`，并 mock `GET /auth/me` | 会话可进入受保护页面 |
| 2 | `mockMarketBootstrap(page)` 补齐 `/items`、`/items/tags`、`/items/ai/approvals` | `/market` 首屏无真实请求 |
| 3 | `page.route('**/auth/logout')` 记录调用次数与 `Authorization` 头，**固定返回 500** | 覆盖容错分支 |
| 4 | 打开 `/market`，点击 `打开账户菜单` → `退出登录` | 登出入口可交互 |
| 5 | `expect.poll(() => logoutCalls).toBe(1)` | **恰好 1 次** POST |
| 6 | `expect(logoutBearer).toBe('Bearer e2e-access-token')` | 请求携带当前 Bearer Token |
| 7 | 轮询 `localStorage.access_token` / `access_token_expires_at` | 两者均为 `null`（本地登出完成） |
| 8 | `getByRole('button', { name: '打开账户菜单' })` | `toHaveCount(0)`（`user` 已清空） |
| 9 | 等待 300ms 后再次断言 `logoutCalls === 1` | 无重复请求（401 兜底路径不会二次触发） |

该用例为确定性 Mock，不依赖后端 / 外网，可重复稳定运行。

---

## 7. 行为矩阵

| 场景 | 请求 `/auth/logout` | 本地 token 清理 | `agentStore.resetOnLogout()` | 备注 |
| --- | --- | --- | --- | --- |
| 主动点击退出，接口 200 | 1 次 | ✅ | ✅ | 正常吊销 |
| 主动点击退出，接口 500 / 断网 / 超时 | 1 次（失败） | ✅ | ✅ | catch 容错，不阻塞 |
| 主动点击退出，本地无 token | 0 次 | ✅ | ✅ | 跳过必然 401 的请求 |
| 全局 401（任意受保护接口） | 0 次 | ✅ | ✅ | 直接 `clearSession()` |
| `/token` 登录失败 401 | 0 次 | — | — | 拦截器排除 `/token`，不派发事件 |
| 主动登出但 token 已过期（请求返回 401） | 1 次（401） | ✅ | ✅ | 拦截器派发事件 → `clearSession()`；catch 后再执行一次（幂等）；路由可能同时提示「登录状态已失效」 |

---

## 8. 验证记录

### 8.1 环境

```text
OS        : Windows
Shell     : PowerShell
Node      : 项目自带 node_modules（npm 脚本）
Chrome    : 系统 Chrome（Playwright channel: 'chrome'，headless）
Base URL  : http://127.0.0.1:4173
```

### 8.2 `npm run typecheck`

```text
> xianxiaobao-web@0.1.0 typecheck
> tsc --noEmit
```

**结果：0 error（无输出即通过）**

### 8.3 `npm run build`

```text
> xianxiaobao-web@0.1.0 build
> tsc --noEmit && vite build

vite v8.3.8 building client environment for production...
transforming...
✓ 2600 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                             2.17 kB │ gzip:  0.97 kB
dist/assets/index-BawqDAm2.css             99.45 kB │ gzip: 15.66 kB
dist/assets/tags-CeVEgJ5q.js                0.26 kB │ gzip:  0.17 kB
dist/assets/label-BHFxmbuG.js               0.57 kB │ gzip:  0.36 kB
dist/assets/rolldown-runtime-XKyaHtl9.js    0.72 kB │ gzip:  0.42 kB
dist/assets/input-xmLTON4r.js               0.97 kB │ gzip:  0.52 kB
dist/assets/card-Kkg9ESmG.js                1.33 kB │ gzip:  0.52 kB
dist/assets/LoginPage-Cf-tRI-Q.js           3.68 kB │ gzip:  1.71 kB
dist/assets/table-DCdLBnuL.js               6.23 kB │ gzip:  2.45 kB
dist/assets/RegisterPage-CTcPXgJ-.js        7.20 kB │ gzip:  2.89 kB
dist/assets/tabs-B4NBNO8p.js                8.86 kB │ gzip:  3.22 kB
dist/assets/AdminPage-DXx1j00Y.js          19.98 kB │ gzip:  5.55 kB
dist/assets/lucide-vendor-_6vEEMqe.js      27.95 kB │ gzip: 10.10 kB
dist/assets/alert-BNFWY3ou.js              32.49 kB │ gzip: 10.87 kB
dist/assets/StudioPage-ZYpK44Ub.js         32.52 kB │ gzip:  8.89 kB
dist/assets/MarketPage-BiP_C88Q.js         50.89 kB │ gzip: 13.57 kB
dist/assets/index-qDbg-GyG.js              65.73 kB │ gzip: 17.65 kB
dist/assets/vendor-DPJHPIiE.js            120.06 kB │ gzip: 39.34 kB
dist/assets/radix-vendor-xVOpswnW.js      151.60 kB │ gzip: 46.42 kB
dist/assets/markdown-vendor-Bk_aCZMj.js   164.62 kB │ gzip: 49.38 kB
dist/assets/react-vendor-BxEirQEO.js      245.27 kB │ gzip: 78.14 kB

✓ built in 1.05s
```

**结果：构建成功，无 > 500 kB chunk 告警。**

### 8.4 `npx playwright test e2e/resilience.spec.ts`

```text
Running 3 tests using 1 worker

  ok 1 [chrome] › e2e\resilience.spec.ts:16:1 › 主动静默续期：Single-Flight 只调用 1 次 /auth/refresh 并刷新本地 token (6.3s)
  ok 2 [chrome] › e2e\resilience.spec.ts:76:1 › 审批执行失败降级：OUT_OF_STOCK 转为执行失败、隐藏按钮并解锁输入框 (6.3s)
  ok 3 [chrome] › e2e\resilience.spec.ts:178:1 › 主动退出登录：发出 1 次 POST /auth/logout，接口 500 也不阻塞本地登出 (5.3s)

  3 passed (27.1s)
```

**结果：3 passed / 0 failed。** 新增用例为第 3 条。

---

## 9. 边界与已知限制

1. **主动登出会先经过请求拦截器的续期检查**：`apiClient` 的 request 拦截器会对除 `/token`、`/auth/refresh` 外的请求先 `ensureFreshToken()`。因此若点击退出时 token 距过期不足 10 分钟，会先多发 1 次 `/auth/refresh`，再发 `/auth/logout`。功能上正确（最终仍会吊销），但存在 1 次额外请求。
   - 若后续要求「登出绝不触发续期」，可在 `src/api/client.ts` 的 `isAuthLifecycleRequest()` 中增加 `/auth/logout` 判定（本次按最小改动原则未做）。
2. **token 已过期时主动登出的提示**：该请求返回 401 会触发全局 `auth:unauthorized`，路由守卫可能同时弹出「登录状态已失效」。本地登出不受影响；如需静默处理，需要在路由层增加「主动登出中」标志（本次未做）。
3. **`AppShell` 与 Store 各调用一次 `resetOnLogout()`**：`resetOnLogout` 幂等且无网络副作用，重复调用安全；保留 `AppShell` 的 effect 作为防御纵深。
4. **无 token 时跳过 `/auth/logout`**：避免必然 401 的无效请求与误导性事件；与「主动点击必须发请求」的需求在已登录场景（唯一真实场景）一致。
5. **`agentStore` 依赖**：`auth store` 新增 `stores/agent` 静态导入，`agent store` 不反向依赖 `auth store`；现有 ESM 循环链路（`client → tokenRefresh → auth → agent → client`）已由 build / E2E 验证不会在初始化期求值跨模块值。

---

## 10. 回滚方式

按文件回滚即可，无需迁移数据：

1. `src/api/auth.ts`：删除 `logoutServer()`。
2. `src/stores/auth.ts`：删除 `logoutServer` / `useAgentStore` 导入；删除 `clearSession`；把 `logout` 恢复为同步 `() => { clearAccessToken(); set(...) }`；401 监听恢复为 `logout()`。
3. `src/components/app/user-menu.tsx`：`handleLogout` 恢复为同步 `logout(); toast.success(...)`。
4. `e2e/resilience.spec.ts`：删除第 3 条用例（第 178 行起）。

---

## 11. 文件索引

| 文件 | 行号 | 说明 |
| --- | --- | --- |
| `src/api/auth.ts` | 54–63 | `logoutServer()` 定义 |
| `src/stores/auth.ts` | 28–34 | Store 接口：`logout`（async）/ `clearSession` |
| `src/stores/auth.ts` | 105–124 | `clearSession()` 与主动 `logout()` 实现 |
| `src/stores/auth.ts` | 127–132 | `auth:unauthorized` → `clearSession()` |
| `src/components/app/user-menu.tsx` | 30–34 | `handleLogout` 等待本地清理后提示 |
| `e2e/resilience.spec.ts` | 178–235 | 主动登出 + 500 容错用例 |

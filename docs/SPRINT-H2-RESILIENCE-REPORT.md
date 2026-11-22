# Sprint H2 前端运行期韧性加固 · 实现与门禁报告

> **结论：Sprint H2 实现完成，`typecheck` / `build` / Playwright 混沌与韧性用例全部通过。**
>
> 本轮仅修改前端仓库，未触碰后端仓库任何文件；UI 保持极简线性风格，新增图标全部来自 `lucide-react`，无 Emoji、无冗余特效。

| 项目 | 信息 |
| --- | --- |
| 执行时间 | 2026-11-21 15:51 — 16:08（Asia/Shanghai） |
| 前端仓库 | `D:\Projects-practice\Vue` |
| 技术栈 | React 19 · TypeScript · Zustand · Vite 8 · Axios · Sonner |
| 后端基线 | Sprint H1（审批状态新增 `executing / failed`；库存不足返回 `400 OUT_OF_STOCK`） |
| 测试框架 | `@playwright/test ^1.65.1`，系统 Chrome `channel: 'chrome'` |
| E2E 基址 | `http://127.0.0.1:4173`（Vite `--mode test` + `.env.test` 同源 API） |
| 类型检查 | 0 errors |
| 构建 | 成功；最大单 chunk **245.27 kB**，无 > 500 kB 告警 |
| Playwright | **3 passed / 0 failed** |

---

## 1. 改动 / 新增文件清单

### 1.1 新增

| 文件 | 职责 |
| --- | --- |
| `src/api/config.ts` | 独立导出 `API_BASE_URL`，避免续期器反向依赖 `client` 形成循环 |
| `src/api/tokenRefresh.ts` | `ensureFreshToken()` 与模块级 Single-Flight 续期协调器 |
| `src/components/ErrorBoundary.tsx` | 通用 Class ErrorBoundary，支持 `fallback` / `resetKeys` |
| `src/lib/errorToast.ts` | `showApiErrorToast()`：Trace ID 精简展示与一键复制 |
| `playwright.config.ts` | Playwright 配置：系统 Chrome、Vite test server、单 worker |
| `.env.test` | E2E 专用同源 API 地址，规避 CORS 预检对 `page.route` 的干扰 |
| `e2e/support/api.ts` | 登录态注入、`/auth/me` 模拟、交易广场基础 API 模拟与 JSON 响应工具 |
| `e2e/sse-reconnect.spec.ts` | 核心混沌用例：断流、`Last-Event-ID` 续播、幂等键复用、零重复 |
| `e2e/resilience.spec.ts` | 主动续期 Single-Flight 与审批失败降级用例 |

### 1.2 修改

| 文件 | 变更要点 |
| --- | --- |
| `src/lib/auth-token.ts` | 新增 `access_token_expires_at` 读写、`persistAccessToken()`；`clearAccessToken()` 同步清理有效期 |
| `src/api/auth.ts` | 登录 / 续期成功后统一落盘 token 与 `expires_at` |
| `src/api/client.ts` | 请求拦截器在 `/token`、`/auth/refresh` 之外 `await ensureFreshToken()` |
| `src/stores/auth.ts` | Store 新增 `expiresAt`、`applyRefreshedToken()`；登录 / 水合 / 登出同步有效期 |
| `src/features/agent/sseClient.ts` | 建立 SSE `fetch` 前先 `await ensureFreshToken()` |
| `src/layouts/AppShell.tsx` | `<Outlet />` 外包路由级 ErrorBoundary；新增 `visibilitychange` 主动续期监听 |
| `src/features/agent/MessageBubble.tsx` | `ReactMarkdown` 外包局部 ErrorBoundary，异常时降级为纯文本 `<pre>` |
| `src/types/api.ts` | `ApprovalRecord['status']` 扩展 `executing`、`failed` |
| `src/features/agent/ApprovalCard.tsx` | 渲染 `executing`（执行中 + Loader2 + 禁用操作）与 `failed`（Rose 徽章 + 失败原因 + 隐藏按钮） |
| `src/stores/agent.ts` | 审批失败降级、`interrupt_required` 对账、`agent_active_thread_u{userId}` 会话持久化 |
| `src/features/agent/CopilotDrawer.tsx` | 清空会话失败接入 `showApiErrorToast` |
| `src/pages/LoginPage.tsx` | 登录失败接入 `showApiErrorToast`，保留内联 Alert |
| `src/pages/RegisterPage.tsx` | 注册失败接入 `showApiErrorToast`，保留字段级错误 |
| `src/features/market/BuyConfirmDialog.tsx` | 抢购失败接入 `showApiErrorToast`，保留内联错误态 |
| `src/features/studio/ItemFormDialog.tsx` | 发布 / 保存 / AI 识图 / 图片上传失败接入 `showApiErrorToast` |
| `src/features/studio/MyItemsTable.tsx` | 删除商品、加载商品详情失败接入 `showApiErrorToast` |
| `package.json` | 新增 `@playwright/test` devDependency 与 `test:e2e` 脚本 |
| `package-lock.json` | 锁定 Playwright 依赖 |
| `.gitignore` | 忽略 `test-results` / `playwright-report` / `blob-report` / `playwright/.cache` |

---

## 2. 任务实现摘要

### 2.1 Single-Flight 主动静默 Token 续期（P0）

- `persistAccessToken()` 在登录与续期成功时同时写入 `access_token` 与 `access_token_expires_at = Date.now() + expires_in * 1000`。
- `ensureFreshToken()` 行为：
  - 无 token → 返回 `null`；
  - 距离过期 ≥ 10 分钟 → 零网络开销直接返回当前 token；
  - 剩余 < 10 分钟且尚未过期 → 主动 `POST /auth/refresh`；
  - 已过期 → 不主动续期，交由正常 401 流程处理。
- `inFlightRefresh` 为模块级共享 Promise：Axios、SSE、标签页唤醒同时触发时只发出 1 次 `/auth/refresh`，其余调用复用同一结果。
- 续期成功刷新 localStorage 并调用 `useAuthStore.applyRefreshedToken()`；续期 401 / 网络异常静默返回原 token，不递归重试。
- 若续期期间已登出或切换账号，丢弃迟到的续期结果，避免旧会话回写。

### 2.2 分层 ErrorBoundary 与 Trace-ID 排障闭环（P1）

- 路由层：`AppShell` 的 `<Outlet />` 外层包裹 `ErrorBoundary`，`resetKeys=[location.pathname]`；故障卡提供「刷新当前视图」「返回交易广场」，导航栏不受影响。
- Markdown 层：`MessageBubble` 内每条 AI 消息独立包裹 ErrorBoundary，异常时降级为 `<pre className="whitespace-pre-wrap text-sm">`，不拖垮整个 Copilot 对话流。
- `showApiErrorToast(err, fallbackTitle?)`：
  - 读取 `ApiError.message`、`code`、`traceId`；
  - 有 Trace ID 时展示 `Trace ID: <前 12 位>`，并提供「复制 Trace ID」action；
  - 无 Trace ID 时保持简洁提示；
  - 已接入抢购、发布 / 编辑 / 删除商品、审批决策、登录注册与清空会话等关键报错点。

### 2.3 对齐后端 Sprint H1 审批状态 + Copilot 体验加固（P0/P1）

- `ApprovalRecord['status']` 扩展为 `pending | executing | approved | rejected | expired | failed`。
- `ApprovalCard`：
  - `executing`：琥珀色「执行中」徽章 + `Loader2` + 「订单执行中…」+ 操作按钮禁用；
  - `failed`：Rose「执行失败」徽章 + `decision_comment` 失败原因 + 隐藏批准 / 拒绝按钮；
  - 兼容服务端直接返回的 `approved / rejected / expired` 状态。
- `decideApproval`：
  - 保留原有 `409 CONFLICT` → `stale` 处理；
  - 新增 `400 OUT_OF_STOCK` / `BUSINESS_RULE_VIOLATION`：本地卡片置为 `failed` 并写入后端 `error.message`，调用 `showApiErrorToast`，立即刷新线程状态与全局审批，解除输入锁；
  - 通用失败也统一透出 Trace ID。
- 会话持久化：当前线程写入 `agent_active_thread_u{userId}`，F5 后恢复到刷新前线程；非法或已失效的 id 自动回退 `main`；登出清理内存态。
- SSE 收到 `interrupt_required` 后异步触发 `fetchGlobalApprovals()` 与服务端对账，避免顶栏角标 / 审批队列漂移。

### 2.4 Playwright 回归与混沌套件（P1）

- `e2e/sse-reconnect.spec.ts`：
  - 首次流仅返回 `id: 1-0`（intent）与 `id: 2-0`（token 前半句）后断流；
  - 断言第 2 次请求携带完全相同的 `X-Idempotency-Key` 与 `Last-Event-ID: 2-0`；
  - 第二次补发剩余 token 与 `done`，断言正文完整拼接且前半句只出现 1 次。
- `e2e/resilience.spec.ts`：
  - 预置剩余 4 分钟有效期，拦截 `/auth/refresh` 返回新 token，断言仅调用 1 次且 localStorage 已刷新；
  - 模拟 `POST /items/ai/threads/*/resume` 返回 `400 OUT_OF_STOCK`，断言卡片降级「执行失败」、展示库存不足原因、按钮隐藏、Copilot 输入框解锁。

---

## 3. 门禁终端输出

### 3.1 `npm run typecheck`

```text
> xianxiaobao-web@0.1.0 typecheck
> tsc --noEmit

[exit code: 0]
```

### 3.2 `npm run build`

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
dist/assets/tags-BmvNvDh0.js                0.26 kB │ gzip:  0.17 kB
dist/assets/label-Da_V_f05.js               0.57 kB │ gzip:  0.35 kB
dist/assets/rolldown-runtime-XKyaHtl9.js    0.72 kB │ gzip:  0.42 kB
dist/assets/input-B9aj7D7-.js               0.97 kB │ gzip:  0.52 kB
dist/assets/card-B46PFWPg.js                1.33 kB │ gzip:  0.51 kB
dist/assets/LoginPage-C7K-3hIO.js           3.71 kB │ gzip:  1.72 kB
dist/assets/table-BgIsrKVk.js               6.23 kB │ gzip:  2.45 kB
dist/assets/RegisterPage-6bEY8ZB_.js        7.24 kB │ gzip:  2.90 kB
dist/assets/alert-k1KxJ2Df.js               7.78 kB │ gzip:  3.37 kB
dist/assets/tabs-CtkWkcom.js                8.87 kB │ gzip:  3.22 kB
dist/assets/AdminPage-DoRLXM6T.js          19.98 kB │ gzip:  5.55 kB
dist/assets/lucide-vendor-_6vEEMqe.js      27.95 kB │ gzip: 10.10 kB
dist/assets/StudioPage-CSBA-ASz.js         32.45 kB │ gzip:  8.85 kB
dist/assets/MarketPage-CBAM2aYB.js         50.80 kB │ gzip: 13.56 kB
dist/assets/index-A6GO1xPU.js              86.04 kB │ gzip: 24.35 kB
dist/assets/vendor-DPJHPIiE.js            120.06 kB │ gzip: 39.34 kB
dist/assets/radix-vendor-xVOpswnW.js      151.60 kB │ gzip: 46.42 kB
dist/assets/markdown-vendor-Bk_aCZMj.js   164.62 kB │ gzip: 49.38 kB
dist/assets/react-vendor-BxEirQEO.js      245.27 kB │ gzip: 78.14 kB

✓ built in 598ms
[exit code: 0]
```

### 3.3 `npx playwright test e2e/sse-reconnect.spec.ts e2e/resilience.spec.ts`

```text
Running 3 tests using 1 worker

  ok 1 [chrome] › e2e\resilience.spec.ts:16:1 › 主动静默续期：Single-Flight 只调用 1 次 /auth/refresh 并刷新本地 token (3.3s)
  ok 2 [chrome] › e2e\resilience.spec.ts:76:1 › 审批执行失败降级：OUT_OF_STOCK 转为执行失败、隐藏按钮并解锁输入框 (3.2s)
  ok 3 [chrome] › e2e\sse-reconnect.spec.ts:18:1 › SSE 断流后自动续播：复用幂等键、携带 Last-Event-ID 且前半句零重复 (4.6s)

  3 passed (15.7s)
[stderr]
[WebServer] (node:34852) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
[WebServer] (Use `node --trace-warnings ...` to show where the warning was created)
(node:76276) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
[exit code: 0]
```

---

## 4. 需人工注意的事项

1. **历史登录态不会主动续期**：若 localStorage 中只有 `access_token` 而没有 `access_token_expires_at`，首次不会触发主动续期，需要重新登录一次写入有效期；此后 F5、切回标签页与长对话均会复用有效期判断。
2. **Playwright 运行环境**：默认使用本机 Chrome（`channel: 'chrome'`），并通过 `.env.test` 将 API 指向 `http://127.0.0.1:4173` 同源地址；换到无 Chrome 的机器时执行 `npx playwright install chromium`，再以 `PLAYWRIGHT_CHANNEL=chromium npx playwright test e2e/sse-reconnect.spec.ts e2e/resilience.spec.ts` 运行。
3. **工作区权限修复**：为让 npm 与测试命令在本机运行，修复了 `D:\Projects-practice\Vue` 的 Windows 文件权限（为当前用户补齐完全控制）；备份与回滚脚本位于 `D:\Projects-practice\Vue-acl-recovery\`（`acl-backup-*.json.ps1`），未改动任何文件内容或所有者。

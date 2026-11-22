# Sprint H3-FE 验收报告：审批终态确定性重提、全量写接口幂等审计与地狱混沌测试

> **结论：任务 1–4 全部完成。`npm run typecheck`、`npm run build`、指定的 3 支 Playwright 套件（9 条用例）全部通过。**
>
> 本轮为确定性 Mock 验收：不依赖外网 LLM / 后端，Chaos 1–5 可重复稳定运行。后端仓库零改动，前端未引入任何 Emoji 图标（统一 `lucide-react`）。

| 项目 | 信息 |
| --- | --- |
| 验收时间 | 2026-11-21 22:09 — 22:20（Asia/Shanghai） |
| 前端 | React 19 + TypeScript 7 + Zustand 5 + Vite 8 |
| 浏览器 | Chrome（Playwright `channel: 'chrome'`，headless） |
| 测试基址 | `http://127.0.0.1:4173`（`npm run dev -- --mode test`） |
| 新增套件 | `e2e/hell-chaos.spec.ts`（6 条用例，覆盖 5 类混沌场景） |
| 总用例 | **9 passed**（hell-chaos 6 + resilience 2 + sse-reconnect 1） |
| 类型检查 | `tsc --noEmit`，0 error |
| 生产构建 | `vite build` 成功；最大 chunk `react-vendor` **245.27 kB / gzip 78.14 kB** |
| 总判定 | **PASS** |

---

## 1. 验收结论速览

| # | 验收项 | 结果 | 关键证据 |
| --- | --- | --- | --- |
| 1 | 审批终态「重新提交该订单」+ `executing` 主动刷新 | **PASS** | `ApprovalCard` 新增确定性按钮；`resubmitApprovalOrder` / `refreshApprovalStatus` 落地；Chaos 5 点击后自动发起新一轮 SSE |
| 2 | 3 个受幂等保护写接口严格 Header 审计 | **PASS** | 封装层 + axios 拦截器双重兜底；Chaos 1 / 3a / 5 均断言合法 `X-Idempotency-Key` |
| 3 | 地狱级 Playwright 混沌套件 | **PASS** | `e2e/hell-chaos.spec.ts` 6 条用例全部通过 |
| 4 | 强制自检门禁 | **PASS** | typecheck / build / 9 条 Playwright 全部通过 |

---

## 2. 任务 1：审批终态确定性重提闭环

### 2.1 `ApprovalCard` 能力升级

文件：`src/features/agent/ApprovalCard.tsx`

- 新增可选回调 `onResubmit?: (approval: ApprovalRecord) => void | Promise<void>`。
- `displayStatus` 为 `rejected` / `expired` / `failed` 且 `payload.item_id` 存在时，底部渲染次要按钮：
  - `variant="outline" size="sm"` + `RotateCcw` 图标；
  - 文案「重新提交该订单」；
  - 提交期间切换为 `Loader2` 并禁用，防止重复触发。
- `displayStatus === 'executing'` 时渲染「刷新状态」按钮：
  - `RefreshCw` 图标；
  - 调用线程 `status` 与全局 `approvals` 同步，防止后端完成对账后前端停留在旧状态。
- `decision.status === 'stale'` 仍映射为 `expired`，因此 409 失效卡同样可重提。

### 2.2 Store 新 Action

文件：`src/stores/agent.ts`

新增 `resubmitApprovalOrder(approval)`：

1. 从 `approval.payload` 提取 `item_id`、`item_name`、`quantity`（默认 1）、`address`（兼容 `shipping_address` 与嵌套对象）。
2. 校验登录态与 `thread_id` 合法性；当前线程 `streaming` / `loading` 时友好提示稍候。
3. 先完成目标线程 hydration（或切换到目标线程），再打开 Copilot 抽屉，避免抽屉挂载 hydrate 与 `sendMessage` 互相覆盖 `status`。
4. 目标线程仍处于 `interrupted` 时提示先完成审批，不强行发送。
5. 调用 `sendMessage` 下发确定性指令：

```text
请作为全新订单重新下单：商品 ID {item_id}（{item_name}），数量 {quantity}，收货地址：{address}。
不要受此前审批记录影响，请直接调用 create_order 提交新的审批。
```

新增 `refreshApprovalStatus(approval)`：

- `Promise.all` 并行拉取 `GET /items/ai/threads/{id}/status` 与 `GET /items/ai/approvals`；
- 服务端仍在队列中：原位刷新卡片；
- 服务端已不在队列：标记为「已结束 / 已失效」并提示「服务端状态已同步」，避免永久卡在 `executing`；
- 同步恢复线程 `interrupted` / `idle` 状态。

### 2.3 UI 接入

| 文件 | 接入内容 |
| --- | --- |
| `src/features/agent/CopilotDrawer.tsx` | `ApprovalCard` 接入 `onResubmit` 与 `onRefreshStatus` |
| `src/features/studio/ApprovalsInbox.tsx` | 工作台审批卡接入同一对回调，一键切入 Copilot 重新下单 |

### 2.4 验收证据（Chaos 5）

- 审批 #401 经 `400 OUT_OF_STOCK` 翻转为 `failed`；
- 卡片出现「重新提交该订单」；
- 点击后自动发起 `POST /items/ai/agent/stream`；
- 请求体 `message` 同时包含 `42`、`降噪耳机`、`数量 2`、`上海市浦东新区世纪大道 1 号`、`create_order`；
- 请求头携带合法 `X-Idempotency-Key`；
- 抽屉自动打开并展示该确定性指令。

---

## 3. 任务 2：全量写接口严格幂等审计

### 3.1 审计结果

| 受保护接口 | 前端封装 | 幂等键来源 | 重试语义 | 兜底 |
| --- | --- | --- | --- | --- |
| `POST /items` | `createItem(payload, idempotencyKey?)` | `ItemFormDialog` 的 `actionIdempotencyKey` | 失败重试复用同一 Key，成功后才轮换 | `withIdempotencyKey` + axios 拦截器 |
| `POST /items/{id}/buy` | `buyItem(itemId, idempotencyKey?)` | `BuyConfirmDialog` 的 `actionKey` | 「重试支付」复用同一 Key，弹窗重新打开才生成新 Key | `withIdempotencyKey` + axios 拦截器 |
| `POST /items/ai/agent/stream` | `streamAgentChat(params)` | `useAgentStore.sendMessage` 的 `createIdempotencyKey()` | SSE 自动续传复用同一个 Key；`retryMessage` 复用消息上的 Key | 进入重连循环前统一 `ensureIdempotencyKey` |

### 3.2 底层归一化规则

文件：`src/api/client.ts`

```ts
export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9\-_:]{1,128}$/

export function ensureIdempotencyKey(key?: string | null): string {
  const normalized = typeof key === 'string' ? key.trim() : ''
  return isValidIdempotencyKey(normalized)
    ? normalized
    : createIdempotencyKey()
}
```

- 合法键原样复用（保证单次动作重试期间 Key 不变）；
- 空串 / 超长 / 非法字符一律生成新键，绝不透传；
- `createIdempotencyKey()` 优先 `crypto.randomUUID()`，不可用时退化为时间戳 + 随机串，字符集合法。

### 3.3 Axios 拦截器兜底

文件：`src/api/client.ts`

```ts
const IDEMPOTENT_WRITE_PATTERNS = [
  /\/items\/?$/,
  /\/items\/\d+\/buy\/?$/,
  /\/items\/ai\/agent\/stream\/?$/,
]
```

请求拦截器对上述 `POST` 路径检查 `X-Idempotency-Key`：缺失或非法时立即补齐。即使未来新增调用方漏传，也不会发出缺 Header 的请求。

### 3.4 SSE 客户端兜底

文件：`src/features/agent/sseClient.ts`

- 在进入重连循环之前归一化一次 `idempotencyKey`；
- 首包与后续所有续传请求共用该值；
- 证明：Chaos 1 连续 3 次请求的 `X-Idempotency-Key` 完全一致。

### 3.5 交互级 Key 生命周期

| 交互 | 生成时机 | 轮换时机 | 说明 |
| --- | --- | --- | --- |
| `BuyConfirmDialog` | 打开弹窗 / 切换商品 | 下次打开或其他商品 | 「重试支付」复用；新增 `submittingRef` 同步 single-flight |
| `ItemFormDialog` | 组件挂载 | `createItem` 成功之后 | 发布失败重试复用同一 Key |
| `sendMessage` | 每次新消息 | 新一轮消息 | `retryMessage` 复用该轮 `idempotencyKey` |

### 3.6 验收证据

| 场景 | 断言 |
| --- | --- |
| Chaos 1 | 3 次 SSE 请求 Key 完全相同；`Last-Event-ID` 依次为 `2-0` / `3-0` |
| Chaos 3a | 8 连击后购买请求精确为 1 次，且携带合法 Key |
| Chaos 5 | 重提 SSE 携带全新合法 Key |

---

## 4. 任务 3：地狱级 Playwright 混沌套件

文件：`e2e/hell-chaos.spec.ts`

### 4.1 场景覆盖

| 场景 | 用例 | 关键断言 | 结果 |
| --- | --- | --- | --- |
| Chaos 1 | SSE 连续二次断流 + 游标递增续传 | 3 次请求同 Key；`Last-Event-ID` 为 `2-0` / `3-0`；正文精确等于「第一段，第二段，圆满收官。」；首段仅出现 1 次 | PASS |
| Chaos 2 | 高危 XSS 与畸形 Markdown | `window.__xss === undefined`；0 条 `pageerror`；`javascript:` 链接被清洗；恶意 `<img>` 未进入 DOM；抽屉与导航栏完好 | PASS |
| Chaos 3a | 抢购按钮 8 连击 | 400ms 延迟下实际 `POST /items/7/buy` 精确 1 次，且携带合法 Key | PASS |
| Chaos 3b | 审批「批准并下单」8 连击 | 300ms 延迟下实际 `POST .../resume` 精确 1 次；卡片最终「审批已通过」 | PASS |
| Chaos 4 | 5 路并发撞击临期 Token | 剩余 2 分钟有效期；5 路读接口并发；`POST /auth/refresh` 精确 1 次；后续业务请求全部携带新 Bearer | PASS |
| Chaos 5 | 失败后「重新提交该订单」 | 失败卡出现按钮；点击后自动发起新 SSE；message 含 item_id / 地址 / 数量；携带全新合法 Key | PASS |

### 4.2 确定性设计

- SSE 采用 `route.fulfill` 返回固定帧序列，断流点与游标完全可控；
- 连击通过同一元素同步派发 8 次 `MouseEvent`，不依赖真实人手速度；
- 并发续期通过页面真实 API 模块 `Promise.all` 同时发起 5 路读请求，全部经过同一 axios 拦截器与 `ensureFreshToken`；
- XSS 正文经 SSE 分片注入，覆盖流式拼接路径；
- 全部路由 Mock，不依赖外网 LLM / 后端。

### 4.3 为通过混沌测试所做的健壮性修复

| 文件 | 修复 |
| --- | --- |
| `src/features/market/BuyConfirmDialog.tsx` | 新增 `submittingRef` 同步 single-flight，8 连击也只发 1 次购买请求 |
| `src/features/agent/sseClient.ts` | 重连循环前归一化幂等键，保证 3 次请求完全一致 |
| `src/api/client.ts` | 三类写接口 Header 强制兜底 |

---

## 5. 任务 4：强制自检门禁真实结果

### 5.1 `npm run typecheck`

```text
> xianxiaobao-web@0.1.0 typecheck
> tsc --noEmit

[exit code: 0]
```

### 5.2 `npm run build`

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
dist/assets/tags-CKL6ICUg.js                0.26 kB │ gzip:  0.17 kB
dist/assets/label-DmcP4XuW.js               0.57 kB │ gzip:  0.35 kB
dist/assets/rolldown-runtime-XKyaHtl9.js    0.72 kB │ gzip:  0.42 kB
dist/assets/input-DAahTn3G.js               0.97 kB │ gzip:  0.52 kB
dist/assets/card-BZ59APX1.js                1.33 kB │ gzip:  0.52 kB
dist/assets/LoginPage-TxUJwOl3.js           3.71 kB │ gzip:  1.72 kB
dist/assets/table-TqE0l4Xa.js               6.23 kB │ gzip:  2.44 kB
dist/assets/RegisterPage-Dp0-xz3Z.js        7.24 kB │ gzip:  2.90 kB
dist/assets/alert-DSUulFLi.js               8.41 kB │ gzip:  3.64 kB
dist/assets/tabs-CoYiUTJA.js                8.86 kB │ gzip:  3.22 kB
dist/assets/AdminPage-DEA-vAdg.js          19.98 kB │ gzip:  5.55 kB
dist/assets/lucide-vendor-_6vEEMqe.js      27.95 kB │ gzip: 10.10 kB
dist/assets/StudioPage-DTjmPfF_.js         32.53 kB │ gzip:  8.90 kB
dist/assets/MarketPage-D_oEZQs_.js         50.89 kB │ gzip: 13.58 kB
dist/assets/index-BTZ6XOo2.js              89.63 kB │ gzip: 25.35 kB
dist/assets/vendor-DPJHPIiE.js            120.06 kB │ gzip: 39.34 kB
dist/assets/radix-vendor-xVOpswnW.js      151.60 kB │ gzip: 46.42 kB
dist/assets/markdown-vendor-Bk_aCZMj.js   164.62 kB │ gzip: 49.38 kB
dist/assets/react-vendor-BxEirQEO.js      245.27 kB │ gzip: 78.14 kB

✓ built in 751ms
```

**最大 chunk：`react-vendor-BxEirQEO.js`，245.27 kB（gzip 78.14 kB）。**

### 5.3 `npx playwright test e2e/sse-reconnect.spec.ts e2e/resilience.spec.ts e2e/hell-chaos.spec.ts`

```text
Running 9 tests using 1 worker

ok 1 [chrome] › e2e\hell-chaos.spec.ts:62:3 › Sprint H3-FE 地狱混沌 › Chaos 1：SSE 连续二次断流 + 游标递增续传，正文零丢字零重复 (7.8s)
ok 2 [chrome] › e2e\hell-chaos.spec.ts:147:3 › Sprint H3-FE 地狱混沌 › Chaos 2：高危 XSS 与畸形 Markdown 注入免疫，无 pageerror / 白屏 (3.9s)
ok 3 [chrome] › e2e\hell-chaos.spec.ts:223:3 › Sprint H3-FE 地狱混沌 › Chaos 3a：抢购确认按钮 8 连击，实际只发 1 次请求且携带幂等键 (5.0s)
ok 4 [chrome] › e2e\hell-chaos.spec.ts:295:3 › Sprint H3-FE 地狱混沌 › Chaos 3b：审批「批准并下单」8 连击，只发 1 次 resume 请求 (4.2s)
ok 5 [chrome] › e2e\hell-chaos.spec.ts:377:3 › Sprint H3-FE 地狱混沌 › Chaos 4：5 路并发读接口撞击临期 Token，/auth/refresh 只发生 1 次 (3.5s)
ok 6 [chrome] › e2e\hell-chaos.spec.ts:498:3 › Sprint H3-FE 地狱混沌 › Chaos 5：审批失败后「重新提交该订单」确定性闭环，重新发起新的 SSE 下单 (4.1s)
ok 7 [chrome] › e2e\resilience.spec.ts:16:1 › 主动静默续期：Single-Flight 只调用 1 次 /auth/refresh 并刷新本地 token (4.1s)
ok 8 [chrome] › e2e\resilience.spec.ts:76:1 › 审批执行失败降级：OUT_OF_STOCK 转为执行失败、隐藏按钮并解锁输入框 (4.1s)
ok 9 [chrome] › e2e\sse-reconnect.spec.ts:18:1 › SSE 断流后自动续播：复用幂等键、携带 Last-Event-ID 且前半句零重复 (5.6s)

9 passed (49.0s)
```

---

## 6. 改动 / 新增文件清单

| 文件 | 类型 | 说明 |
| --- | --- | --- |
| `src/api/client.ts` | 修改 | 幂等键校验 / 生成 / 归一化；3 类写接口 Header 强制兜底 |
| `src/features/agent/sseClient.ts` | 修改 | SSE 续传复用同一合法幂等键 |
| `src/features/agent/ApprovalCard.tsx` | 修改 | 终态重提 + `executing` 刷新状态按钮 |
| `src/stores/agent.ts` | 修改 | `resubmitApprovalOrder`、`refreshApprovalStatus`；共享幂等键生成器 |
| `src/features/agent/CopilotDrawer.tsx` | 修改 | 接入重提 / 刷新状态回调 |
| `src/features/studio/ApprovalsInbox.tsx` | 修改 | 工作台审批卡一键重提并切入 Copilot |
| `src/features/market/BuyConfirmDialog.tsx` | 修改 | `submittingRef` 连击 single-flight |
| `src/features/studio/ItemFormDialog.tsx` | 修改 | 统一幂等键生成器，成功后轮换 |
| `e2e/hell-chaos.spec.ts` | **新增** | 5 类地狱混沌场景（6 条用例） |

---

## 7. 人工注意事项

1. **幂等兜底范围**：仅覆盖任务指定的 3 个写接口（`POST /items`、`POST /items/{id}/buy`、`POST /items/ai/agent/stream`）。`resume` 等接口保持原契约，未擅自添加 Header；若生产后续对更多接口开启 `IDEMPOTENCY_HEADER_REQUIRED=true`，需要同步扩展 `IDEMPOTENT_WRITE_PATTERNS`。
2. **`executing` 对账语义**：后端未提供「单条审批终态」查询接口，刷新只能依赖线程 `status` 与全局 approvals。若审批已不在待处理队列，卡片会显示「已结束」并提示状态已同步，而非猜测为 approved / failed。
3. **自检口径**：`tsconfig.json` 的 `include` 仅包含 `src` 与 `vite.config.ts`，因此 `npm run typecheck` 不覆盖 `e2e/*.spec.ts`（由 Playwright esbuild 转译）；Chaos 1 依赖客户端 1s / 2s 重连退避，单条约 8s 属预期耗时，全部用例为 Mock，不需要后端或外网 LLM。

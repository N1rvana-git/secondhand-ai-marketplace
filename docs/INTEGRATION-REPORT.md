# 前后端联调问题修复报告

> 范围：前端工程 `D:\Projects-practice\Vue`（React 19 + TypeScript + Vite，目录名 `Vue` 为历史命名）
> ↔ 后端工程 `D:\Projects-practice\fastapi-practice-jzp`（FastAPI + SQLAlchemy 2.0）
>
> 日期：2026-11-20
> 结论：三个问题中，**429 响应头已修复**、**收藏初始态已补全（后端字段 + 前端首屏回显）**、**标签筛选已改为后端精确匹配**；AI 检索模式下的交易类型筛选仍按当前契约保留为前端本地过滤，并补充了“包含求购帖”的服务端开关。

---

## 0. 结论速览

| # | 问题 | 根因 | 处理 | 状态 |
| --- | --- | --- | --- | --- |
| 1 | 429 的 `Retry-After` 在跨域请求中读不到 | 后端 CORS `expose_headers` 未包含 `Retry-After`，浏览器把该响应头从 JS 可见集合中过滤掉 | 在 `create_app()` 的 `CORSMiddleware` 中显式暴露 `Retry-After`，并新增 429 真实路径的集成测试 | ✅ 已修复 |
| 2 | 收藏初始态缺少后端数据 | `GET /items`、`GET /items/{id}` 不返回“当前用户是否已收藏”和收藏总数，前端只能依赖本地 `Record<number, ...>` | `ItemRead` 增加 `favorited` / `favourited_count`；列表、详情、检索接口支持可选登录并按查看者回填；前端用响应回填收藏映射 | ✅ 已修复 |
| 3 | 标签与 AI 模式筛选语义 | `GET /items` 没有 `tag_id`，浏览模式只能把标签名塞进 `search`（只匹配名称/图片路径）；AI 检索接口没有交易类型参数 | 浏览模式新增 `tag_id` 精确关联过滤；检索接口新增 `include_wants`，让“全部/求购”有数据可筛；AI 交易类型仍为前端本地过滤 | ✅ 浏览模式已修复；AI 模式按契约确认可接受 |

---

## 1. 问题一：429 `Retry-After` 跨域不可读

### 1.1 现象

前端 `src/api/client.ts` 已经从响应头解析 `retry-after` 并写入 `ApiError.retryAfter`，`BuyConfirmDialog` 也按 `apiError.retryAfter ?? 30` 做精确/兜底倒计时。但浏览器里 `ApiError.retryAfter` 始终是 `null`，429 只能走 30 秒兜底，与后端限流窗口不一致。

### 1.2 根因

跨域场景下，浏览器只允许 JS 读取 CORS 安全列表内的响应头（`Content-Type`、`Content-Length` 等少数几个）。`Retry-After` 不在安全列表里，必须在 CORS 响应中显式声明：

```http
Access-Control-Expose-Headers: Retry-After
```

后端 `src/app/main.py` 的 `CORSMiddleware` 原先只暴露了链路/幂等相关的 4 个头，没有 `Retry-After`。后端本身确实在 429 响应上写入了 `Retry-After`（`RateLimitedError` 会设置该头），所以这是纯粹的 CORS 可见性问题，不是限流逻辑问题。

### 1.3 修复

`src/app/main.py` → `create_app()`：

```python
expose_headers=[
    "X-Trace-ID",
    "X-Request-ID",
    "X-Idempotency-Key",
    "X-Thread-ID",
    # 跨域 JS 只能读取显式 exposed 的响应头；缺了它 ApiError.retryAfter 恒为 null
    "Retry-After",
],
```

### 1.4 修复后的行为

- 429 响应仍然携带精确的 `Retry-After: <秒>`（来自 `RateLimitResult.retry_after`，最小 1 秒）。
- 浏览器 / Axios 能读到该头；`client.ts` 的 `parseRetryAfter` 会解析为数字，`BuyConfirmDialog` 显示后端给出的精确冷却秒数。
- 若后端未返回该头（例如代理剥离、非 CORS 场景或未来接口变更），前端仍回退 30 秒，行为不变。
- 其他已暴露头（`X-Trace-ID`、`X-Idempotency-Key` 等）不受影响。

### 1.5 验证

新增 `tests/integration/test_cors.py`：

- 带 `Origin: http://localhost:5173` 连续请求 `/items/search-by-text` 31 次（该接口限流 30 次/分钟/客户端）。
- 断言第 31 次为 `429`、`Retry-After` 可读、`Access-Control-Allow-Origin` 正确、`Access-Control-Expose-Headers` 包含 `retry-after`。

### 1.6 部署注意

- 需要重启后端进程才会加载新的 CORS 配置。
- 若生产环境在 FastAPI 前面还有 Nginx / 网关，确认没有用 `proxy_hide_header` 之类配置把 `Access-Control-Expose-Headers` 或 `Retry-After` 去掉；应用层已经正确输出，代理层不应二次加工 CORS 头。
- `max_age=600` 只影响预检缓存，不影响实际响应上 `Access-Control-Expose-Headers` 的读取。

---

## 2. 问题二：收藏初始态缺少后端数据

### 2.1 现象

- 刷新页面后，已收藏商品的心形初始为未收藏。
- 收藏计数必须等用户首次点击 toggle 后才有值。
- 原因：`GET /items` 与 `GET /items/{id}` 都不返回当前用户收藏状态，也不返回 `favourited_count`；前端只能维护本地 `Record<number, { favorited, count }>` 做即时反馈，无法首屏回显。

### 2.2 接口契约变更

`ItemRead`（列表、详情、检索结果共用）新增两个**只读**字段：

| 字段 | 类型 | 含义 |
| --- | --- | --- |
| `favorited` | `boolean` | 当前请求用户是否已收藏；匿名或未登录恒为 `false` |
| `favourited_count` | `integer` | 该商品被收藏的总次数，公开字段，匿名也可读 |

示例：

```json
{
  "id": 42,
  "name": "九成新机械键盘",
  "price": 299.0,
  "is_offer": true,
  "is_sold": false,
  "image_path": "/uploads/items/xxx.png",
  "inventory": 1,
  "owner_id": 3,
  "tags": [{ "id": 1, "name": "键盘" }],
  "created_at": "2026-11-20T10:00:00Z",
  "favorited": true,
  "favourited_count": 7
}
```

涉及的读接口：

| 接口 | 认证 | 说明 |
| --- | --- | --- |
| `GET /items` | 可选 Bearer | 登录时按当前用户回填 `favorited`；匿名时 `favorited=false`，计数照常返回 |
| `GET /items/{id}` | 可选 Bearer | 同上；详情弹窗打开时会重新拉取并同步 |
| `POST /items/search-by-text` | 可选 Bearer | 检索命中项同样带收藏字段 |
| `POST /items/search-by-image` | 可选 Bearer | 同上 |
| `PUT /items/{id}` | 必须登录 | 更新后的响应也带真实收藏字段（不再固定 0） |

### 2.3 后端实现

关键点：**不按商品逐条查收藏**，而是对当前页做两次聚合查询，保持 O(1) 查询数。

1. `src/app/modules/items/repository.py`
   - `favourite_counts(session, item_ids)`：`SELECT item_id, COUNT(*) ... WHERE item_id IN (...) GROUP BY item_id`。
   - `favourited_item_ids(session, user_id, item_ids)`：一次查出当前用户在这批商品中收藏了哪些。
2. `src/app/modules/items/service.py`
   - `serialize_items(session, items, user_id=...)`：统一把 `ItemModel` 转成 `ItemRead`，并回填 `favorited` / `favourited_count`。
3. `src/app/modules/items/router.py`
   - 读接口改用 `OptionalUser`（`get_current_user_optional`）：无 token / token 失效时按匿名处理，不返回 401，保证公开浏览不受影响。
   - 列表、详情、文本检索、图片检索、更新响应全部走 `serialize_items`。
4. `src/app/modules/items/schemas.py`
   - `ItemRead.favorited`、`ItemRead.favourited_count` 默认值分别为 `false` / `0`，老客户端忽略新字段即可。

> 无需数据库迁移：收藏表 `favourites` 已存在，新增字段全部由聚合查询计算得出。

### 2.4 前端实现

1. `src/types/api.ts`：`ItemRead` 增加 `favorited: boolean`、`favourited_count: number`。
2. `src/pages/MarketPage.tsx`
   - 新增 `seedFavorites(entries)`：用列表 / 检索 / 详情响应回填 `favorites` 映射；正在 toggle 的条目跳过，避免旧响应覆盖乐观更新。
   - 列表加载成功后回填；文本检索、以图搜图、找相似、详情 `getItem` 返回后同样回填。
   - `useEffect` 监听 `user?.id`：登录/退出/切换账号时清空本地收藏映射，避免串号显示上一个账号的状态。
   - 列表请求依赖加入 `user?.id`：登录态变化后用新 token 重新拉取首屏收藏状态。
3. `src/features/market/ItemDetailDialog.tsx`
   - 新增可选回调 `onItemLoaded`：详情接口返回后把最新 `favorited` / `favourited_count` 回传给页面，跨设备收藏变更也能在打开详情时同步。
4. `src/features/market/ItemCard.tsx` / `ItemDetailDialog.tsx` 无需改渲染逻辑：仍然读 `favorites[item.id]`，只是数据来源从“仅本地 toggle”变为“后端首屏 + 本地乐观更新”。

### 2.5 边界与兼容性

- **匿名用户**：`favorited` 恒为 `false`，`favourited_count` 正常返回；点击心形仍跳转登录。
- **token 过期**：`GET /items` 不会 401，而是按匿名返回；其他需要登录的接口仍会 401 并触发前端 `auth:unauthorized`。
- **乐观更新**：toggle 期间列表刷新不会覆盖该条目的本地状态；toggle 失败会回滚到点击前的状态。
- **手动刷新详情**：详情弹窗的“刷新实时库存”会重新请求 `GET /items/{id}`，收藏状态一并刷新。
- **响应体积**：每项只增加两个标量字段，可忽略。

### 2.6 验证

新增/扩展 `tests/integration/test_items.py::test_item_reads_expose_favourite_state`：

- 匿名列表：`favorited=false`、`favourited_count=0`。
- 用户 B 收藏后：
  - 作者 A 的列表：`favorited=false`、`favourited_count=1`；
  - 用户 B 的详情：`favorited=true`、`favourited_count=1`；
  - 匿名列表：`favorited=false`、`favourited_count=1`。
- 检索响应同样断言收藏字段存在且初始为 `false` / `0`。

---

## 3. 问题三：标签与 AI 模式的筛选语义

### 3.1 浏览模式：已改为后端精确标签过滤

**原行为**：热门标签点击后把标签名写入 `search`，后端 `GET /items?search=...` 只做 `name ILIKE` / `image_path ILIKE`。因此“商品确实打了该标签、但名称不含标签词”时不会被命中。

**新契约**：`GET /items` 新增可选查询参数 `tag_id`（整数）。

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `tag_id` | `integer?` | 按标签关联关系精确过滤，与 `search`、`is_offer_filter` 可组合 |

后端实现：

- `repository.list_items()`：`ItemModel.tags.any(TagModel.id == tag_id)`。
- `service.list_items()` / `router.read_items()` 透传。
- 分页 `total` 与列表使用同一组 filters，计数一致。

前端实现：

- `src/features/market/TagBar.tsx`：`onSelect` 从“回传标签名”改为回传完整 `TagRead`。
- `src/pages/MarketPage.tsx`：
  - 新增 `activeTagId`；
  - 浏览模式点击标签只设置 `tag_id`，不再把标签名写入 `browseSearch`；
  - 清除筛选 / 退出搜索 / 切换模式 / 切换图片检索时同步清空 `activeTagId`；
  - `hasBrowseFilters` 纳入标签过滤，空态下的“清除筛选”会一并清掉标签。
- `src/api/items.ts`：`ItemListParams` 增加 `tag_id`。

验证：`test_tag_filter_uses_membership_not_search_text` 创建一个名称不含“数码”但打了“数码”标签的商品，断言 `GET /items?tag_id=...` 能命中，而旧的 `?search=数码` 仍然命中 0 条。

### 3.2 AI 检索模式：标签仍作为语义检索提示词

AI 检索接口 `POST /items/search-by-text` 没有 `tag_id` 参数；前端在 AI 模式下点击标签仍会把标签名作为 `query_text` 发起语义/关键词混合检索。这是当前契约下的**预期行为**：

- 标签名进入检索词，由混合召回（向量 + 关键词）决定结果，而不是“列出该标签下所有商品”。
- 若需要“严格按标签列商品”，请使用浏览模式（走 `tag_id`），或后续给检索接口补 `tag_id` 过滤参数。
- 本次未给检索接口加 `tag_id`，避免改变“标签作为检索提示词”的既有语义。

### 3.3 AI 检索模式的“全部 / 出售 / 求购”

**原行为**：检索接口固定只召回 `is_offer = true` 的出售帖，前端却在 `data` 上本地过滤“全部/出售/求购”。结果“求购”永远为空，“全部”实际上也只有出售帖。

**本次改动**：

- `TextSearchRequest` 新增 `include_wants: bool = false`。
- 前端 AI 检索统一传 `include_wants: true`，让返回集合同时包含出售帖与求购帖；
- “全部/出售/求购”仍由前端 `filterByOffer()` 本地过滤（检索接口没有 `is_offer` 参数），与当前契约一致。

**仍然存在的边界（已确认可接受）**：

- 检索先按相关度取 Top-5，再在 5 条结果上本地过滤；选择“求购”时若 Top-5 恰好没有求购帖，会显示“当前筛选下没有结果”，而不是扩大到全部求购帖。
- 如果产品要求“筛选后仍有稳定数量”，建议下一步给检索接口增加 `is_offer` / `limit` 参数，由服务端过滤后再返回。本次不扩大改动面。

验证：`test_text_search_can_include_wanted_posts` 同时创建“机械键盘”（出售）与“求购机械键盘”（求购），断言默认检索只返回出售帖，`include_wants=true` 时两者都返回。

### 3.4 语义确认

| 场景 | 行为 | 是否预期 |
| --- | --- | --- |
| 浏览模式点标签 | 后端按 `tag_id` 精确过滤 | ✅ 修复后符合预期 |
| 浏览模式关键词 + 标签 | 两个条件 AND | ✅ 符合预期 |
| AI 模式点标签 | 标签名作为语义检索词，不做精确标签过滤 | ✅ 当前契约，已确认 |
| AI 模式“全部” | 返回出售 + 求购，前端不再二次排除求购 | ✅ 已改善 |
| AI 模式“出售/求购” | 前端在 Top-5 上本地过滤 | ✅ 当前契约，已确认；Top-5 截断为已知边界 |

---

## 4. 接口契约变更清单

### 4.1 `GET /items`

新增查询参数：

| 参数 | 位置 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| `tag_id` | query | integer | 否 | 标签精确过滤 |

认证：由“无认证”变为“可选认证”。携带 `Authorization: Bearer <token>` 时回填当前用户收藏状态。

### 4.2 `GET /items/{id}` / `PUT /items/{id}`

- 响应 `ItemRead` 增加 `favorited`、`favourited_count`。
- `GET` 支持可选认证；`PUT` 仍必须登录。

### 4.3 `POST /items/search-by-text`

请求体新增：

| 字段 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `include_wants` | boolean | `false` | 是否把求购帖纳入召回；默认保持“只搜出售帖”，不影响 AI 导购工具 |

响应 `data[]` 中的每一项增加 `favorited`、`favourited_count`；接口支持可选认证。

### 4.4 `POST /items/search-by-image`

响应 `data[]` 增加 `favorited`、`favourited_count`；接口支持可选认证。

### 4.5 兼容性

- 所有新增字段均为**加法**，老客户端忽略即可；没有改名或删除字段。
- 所有新增请求参数均可选，`extra="forbid"` 的写接口未新增必填字段。
- 无数据库 schema 变更，不需要 Alembic 迁移。
- 匿名访问行为保持不变（仍可浏览、检索；只是 `favorited` 恒为 `false`）。

---

## 5. 改动文件

### 后端（`D:\Projects-practice\fastapi-practice-jzp`）

| 文件 | 改动 |
| --- | --- |
| `src/app/main.py` | CORS `expose_headers` 增加 `Retry-After` |
| `src/app/modules/items/schemas.py` | `ItemRead` 增加收藏字段；`TextSearchRequest` 增加 `include_wants` |
| `src/app/modules/items/repository.py` | `tag_id` 过滤；收藏计数/当前用户收藏聚合查询；检索 `include_wants` |
| `src/app/modules/items/service.py` | `serialize_items()`；`tag_id` / `include_wants` 透传 |
| `src/app/modules/items/router.py` | 读接口可选认证；`tag_id` 参数；统一序列化；检索响应带收藏字段 |
| `tests/integration/test_items.py` | 收藏首屏、标签过滤、检索包含求购帖的集成测试 |
| `tests/integration/test_cors.py` | 429 + CORS `Retry-After` 暴露测试（新增） |

> 第二轮 SSE / 审批相关的后端改动见第 8 节；本轮**未修改任何前端源码**。

### 前端（`D:\Projects-practice\Vue`，第一轮改动；本轮未再修改）

| 文件 | 改动 |
| --- | --- |
| `src/types/api.ts` | `ItemRead` 增加 `favorited` / `favourited_count` |
| `src/api/items.ts` | `ItemListParams.tag_id`；`searchByText` 支持 `include_wants` |
| `src/pages/MarketPage.tsx` | 首屏收藏回填、账号切换清理、标签 `tag_id` 筛选、AI 检索传 `include_wants` |
| `src/features/market/TagBar.tsx` | `onSelect` 回传完整 `TagRead` |
| `src/features/market/ItemDetailDialog.tsx` | 详情加载后回传收藏状态 |

---

## 6. 验证记录

### 6.1 后端

```powershell
cd D:\Projects-practice\fastapi-practice-jzp
.\.venv\Scripts\python.exe -m pytest
.\.venv\Scripts\python.exe -m ruff check src/app tests
.\.venv\Scripts\python.exe -m ruff format --check src/app tests
.\.venv\Scripts\python.exe -m mypy
```

结果：

- `pytest`：**229 passed, 1 skipped**（skip 为需要真实 PostgreSQL 的用例）。
- `ruff check`：All checks passed。
- `ruff format --check`：全部已格式化。
- `mypy`：Success，无类型错误。

### 6.2 前端（第一轮验证，本轮未改前端源码）

```powershell
cd D:\Projects-practice\Vue
npm run typecheck
npm run build
```

结果：

- `tsc --noEmit`：通过。
- `vite build`：构建成功；仅保留既有的 chunk > 500 kB 提示，不影响功能。

### 6.3 手工联调建议

1. 重启后端（CORS 配置在启动时加载）。
2. 登录用户 A，收藏商品 X；刷新页面，确认心形保持已收藏、详情计数为 1。
3. 换用户 B 登录（或退出登录），确认不会显示 A 的收藏状态。
4. 给名称不含标签词的商品打标签，浏览模式点击该标签，确认能命中。
5. 触发任意接口 429（例如连续调用检索接口超过 30 次/分钟），确认前端倒计时使用后端返回的秒数而不是固定 30 秒。

---

## 7. 遗留与后续建议

1. **收藏表索引**：`favourites` 主键是 `(user_id, item_id)`，按 `item_id` 聚合计数无法充分利用该索引。收藏量很大时建议新增迁移：`CREATE INDEX ix_favourites_item_id ON favourites (item_id)`。
2. **列表收藏关联的预加载**：`ItemModel.favourited_by` 目前仍为 `lazy="selectin"`，列表查询会把收藏用户整行加载出来；本次收藏计数已不依赖该关系，后续可改为显式查询并移除该预加载，进一步降低列表开销。
3. **AI 检索的服务端筛选**：如产品要求“出售/求购筛选后仍保证 N 条结果”，建议给 `POST /items/search-by-text` 增加 `is_offer` 与 `limit`，把本地过滤下沉到服务端。
4. **AI 模式的标签精确过滤**：如需要“AI 模式点标签 = 列出该标签全部商品”，建议给检索接口增加 `tag_id`，并在检索时把标签过滤作为独立条件（而不是仅作为检索词）。
5. **前端兜底 30 秒**：保留是有意的降级策略；CORS 修复后正常路径会使用后端精确值。

---

## 8. 第二轮补充：SSE 续传、CORS/代理与审批契约（仅后端）

> 本轮严格遵守约束：**没有修改 `D:\Projects-practice\Vue` 下的任何前端源码**。
> 下文的前端行为描述均来自对现有实现的只读核对，用于确认后端契约。

### 8.1 CORS 与 SSE 代理缓冲

#### 允许的请求头

后端 `CORSMiddleware` 的 `allow_headers` 已覆盖 SSE 客户端实际会发送的头：

| 请求头 | 用途 |
| --- | --- |
| `Authorization` | JWT |
| `Content-Type` | JSON body |
| `Accept` | 声明接受 `text/event-stream` |
| `X-Idempotency-Key` | 同一条消息的续传/重试键 |
| `X-Thread-ID` | 会话 id |
| `Last-Event-ID` | 断线续传游标 |
| `X-Request-ID` / `X-Trace-ID` | 可观测性（额外保留） |

本轮补上了 `Accept`。`Last-Event-ID` 原本已允许。

#### 暴露的响应头

`expose_headers` 包含 `X-Trace-ID`、`X-Request-ID`、`X-Idempotency-Key`、`X-Thread-ID`、`Retry-After`。浏览器侧可以读取会话 id、幂等键和 429 冷却时间。

#### SSE 响应头

`src/app/modules/chat/stream.py::SSE_HEADERS` 固定输出：

```http
Content-Type: text/event-stream; charset=utf-8
Cache-Control: no-cache, no-transform
Connection: keep-alive
X-Accel-Buffering: no
```

`X-Accel-Buffering: no` 让 Nginx / Ingress 不对该响应做代理缓冲，token 才能逐帧到达浏览器。若网关仍配置了全局 `proxy_buffering on`，需要针对 SSE 路由关闭：

```nginx
location /items/ai/ {
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 3600s;
    proxy_http_version 1.1;
}
```

`proxy_read_timeout` 只需大于心跳间隔（默认 15 秒）即可；心跳帧为 SSE 注释 `: ping`。

### 8.2 SSE 续传与幂等重放

#### 流的作用域

事件缓冲区从“按 `thread_id`”改为“**按 run**”。run 的键由用户 id + `X-Idempotency-Key` 决定：

```text
chat:{user_id}:{X-Idempotency-Key}
```

这样同一会话的下一轮消息不会读到上一轮的 token / `done`；同一 run 的续传仍能按 `Last-Event-ID` 精确定位。

#### 断线续传

- 每个真实事件都带 `id:` 行（例如 `id: 1730000000000-0`）。
- 重连时携带 `Last-Event-ID: <最后收到的 id>`，后端从该 id **之后**补发，不重复已收到的帧。
- 若游标已经越过缓冲区末尾（例如缓冲区被淘汰），但幂等记录仍是 `completed`，后端补发一个终止帧：

```text
event: done
data: {"replayed": true, "thread_id": "u1:main", "reply": "你好，我是闲小宝", "interrupted": false}
```

#### 幂等缓存命中

同一 `X-Idempotency-Key` 的重试如果在 run 完成后到达（没有 `Last-Event-ID`），不再重放 token，而是直接返回上述 `done` 帧：

- `replayed: true`
- `reply`: 完整回复（从幂等记录中读取）
- `thread_id` / `interrupted`: 便于前端恢复会话状态

前端策略是“仅在气泡正文为空时用 `reply` 回填”，因此不会把同一段回复拼接两次。

#### 仍在运行中的同键请求

如果同键重试在 worker 尚未 finalize 时到达，幂等记录仍是 `pending`，后端会把它当作“附着到正在运行的流”，而不是缓存命中。此时应依赖 `Last-Event-ID` 续传，避免整段重放。

#### 相关实现

| 文件 | 改动 |
| --- | --- |
| `src/app/modules/chat/stream.py` | 缓冲区参数改为 `stream_key`，语义明确为“按 run”；Redis/内存实现同步调整 |
| `src/app/modules/chat/service.py` | 新 run 清理同键残留流；`_event_stream` 使用 run 键；`REPLAY` 命中时直接返回 `done`；游标越界时补发 `done`；`THREAD_BUSY` / 取消路径释放幂等键 |
| `tests/integration/test_chat_sse.py` | 续传尾部、缓存命中、游标越界、同会话下一轮隔离 |
| `tests/unit/test_stream.py` | 缓冲区按 run key 隔离 |

### 8.3 审批 payload 与状态一致性

#### payload 字段

`create_order` 触发人工审核时，`orders/service.py` 生成的 `ApprovalRequiredError.details` 就是持久化的审批 payload，字段固定为：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `item_name` | string | 商品名称 |
| `quantity` | integer | 购买数量 |
| `unit_price` | number | 单价 |
| `amount` | number | 总金额（`unit_price * quantity`） |
| `threshold` | number | 自动授权阈值 |
| `address` | string \| null | 收货地址 |
| `item_id` | integer | 商品 id（额外保留，便于重放下单） |

示例：

```json
{
  "item_id": 42,
  "item_name": "九成新机械键盘",
  "quantity": 1,
  "unit_price": 1500.0,
  "amount": 1500.0,
  "threshold": 1000.0,
  "address": "上海市浦东新区联调路 1 号"
}
```

#### expires_at 时区

- 数据库可能返回 naive datetime（尤其 SQLite）；`approvals.isoformat_utc()` 会把它按 UTC 补上 `+00:00` 再输出。
- `GET /items/ai/threads/{id}/status`、`GET /items/ai/approvals` 以及 SSE 的 `interrupt_required` 事件使用同一套序列化，`expires_at` / `created_at` 均形如：

```text
2026-11-22T10:00:00+00:00
```

前端用 `new Date(...)` 解析时不会因为缺少时区而被当作本地时间，倒计时不会偏移。

#### 409 与状态同步

`POST /items/ai/threads/{id}/resume` 在以下情况返回 409，并在 `error.details` 中带上前端定位卡片所需的信息：

| 情况 | details |
| --- | --- |
| 审批已被处理 | `{"approval_id": ..., "status": "approved" / "rejected" / "expired"}` |
| 审批已超时 | `{"approval_id": ..., "status": "expired", "expires_at": "...+00:00"}` |
| 并发争抢失败 | `{"approval_id": ..., "status": <当前状态>}` |

同时：

- `GET /items/ai/threads/{id}/status` 的 `is_interrupted` 只统计**当前用户在该会话**的 pending 审批，与 `pending_approvals` 保持一致；不再因为其他用户的审批而误报 true。
- `GET /items/ai/approvals` 与 `thread_status.pending_approvals` 共用 `approvals.list_pending()` + `approvals.serialize()`，同一审批记录在两个接口中的 JSON 完全一致（测试逐字段比较）。
- 409 之后再次读取两个接口，已处理/已过期的审批都不会再出现在 pending 列表，前端可立即把卡片置为「已失效」。

### 8.4 本轮验证

```powershell
cd D:\Projects-practice\fastapi-practice-jzp
.\.venv\Scripts\python.exe -m pytest
.\.venv\Scripts\python.exe -m ruff check src/app tests
.\.venv\Scripts\python.exe -m ruff format --check src/app tests
.\.venv\Scripts\python.exe -m mypy
```

结果：

- `pytest`：**229 passed, 1 skipped**。
- `ruff check` / `ruff format --check`：通过。
- `mypy`：Success，无类型错误。

新增/扩展的测试：

- `test_last_event_id_replays_only_the_missing_tail`
- `test_idempotent_retry_returns_only_a_replayed_done_frame`
- `test_cursor_past_the_end_falls_back_to_the_cached_done`
- `test_new_turn_on_the_same_thread_does_not_replay_the_previous_run`
- `test_sse_preflight_allows_every_stream_header`
- `test_approval_payload_contract_and_read_consistency`
- `test_buffer_is_scoped_per_run_key`

### 8.5 上线注意

1. 重启后端进程以加载 CORS / SSE 改动。
2. 多副本部署必须使用 Redis：幂等记录和事件流都依赖共享状态；内存实现只适用于单进程/测试。
3. 前端每条消息生成一次 `X-Idempotency-Key`，续传时复用同一个键并携带 `Last-Event-ID`；不要每次重连生成新键，否则会被当成新 run。
4. Nginx / Ingress 需允许长连接并关闭 SSE 缓冲；应用已经输出 `X-Accel-Buffering: no`。
5. `expires_at` 统一为 UTC 偏移格式；若前端已有“无时区按 UTC 解析”的兜底，可保留，但正常路径不再依赖它。

---

## 9. 第三轮 Bugfix：DSML 工具调用泄漏与自然语言检索空结果

> 本轮同样**没有修改任何前端源码**；修复全部落在后端。
>
> 复现对话：
>
> - 用户“通用的呢？” → AI 输出 `<｜｜DSML｜｜ calls> ...`
> - 用户“？你在说什么” → AI 再次输出原始标记
> - 用户“帮我下单这件高价商品，收货地址是广东省” → AI 声称搜不到键盘，但商品列表实际有键盘

### 9.1 根因一：Provider 把工具调用写在 `delta.content` 里

部分 OpenAI 兼容 Provider（DeepSeek web / 自建 harness）不使用标准的
`delta.tool_calls`，而是把工具调用序列化进正文：

```text
<｜｜DSML｜｜ calls> <｜｜DSML｜｜ invoke name="search_items">
  <｜｜DSML｜｜ parameter name="query" string="true">通用型键盘，办公和游戏都能用</｜｜DSML｜｜ parameter>
  <｜｜DSML｜｜ parameter name="category" string="true">键盘</｜｜DSML｜｜ parameter>
</｜｜DSML｜｜ invoke> </｜｜DSML｜｜ calls>
```

`LLMGateway._parse_sse()` 原来只解析 `delta.tool_calls`，因此：

1. DSML 标记被当成普通文本逐字推给前端并写入历史；
2. 没有任何 `tool_calls` 事件，`search_items` 从未真正执行；
3. AI 后续“搜不到键盘”的解释是模型在缺少工具结果时的编造，不是真实检索结果。

### 9.2 根因二：自然语言 query 被当成字面 LIKE 条件

`search_by_text_hybrid()` 原先把整句 `query` 作为 lexical 腿的 `keyword`：

```python
repository.hybrid_search(keyword=keyword or cleaned, category=category, ...)
```

于是检索条件变成：

```sql
name ILIKE '%通用型键盘，办公和游戏都能用%'
AND EXISTS (tag.name ILIKE '%键盘%')
```

即使商品确实打了“键盘”标签，名称也不可能包含整句自然语言，结果恒为空。
这就是“商品列表有键盘，但 AI 按键盘类目搜不到”的直接原因。

### 9.3 修复内容

#### 1）DSML 流式解析（`llm_gateway.py`）

新增 `_DsmlStreamFilter`：

- 识别单管线与双管线两种标记：`<｜DSML｜tool_calls>`、`<｜｜DSML｜｜ calls>`；
- 支持 `calls` / `tool_calls` / `function_calls` 外层标签；
- 从 `invoke name="..."` 与 `parameter name="..."` 提取参数；
- 支持 `string="true"`（字符串）与 `string="false"`（JSON 数字/布尔等）；
- 跨 SSE chunk 增量匹配：标记被任意切分也不会漏到前端；
- 块不完整时丢弃并记录 warning，绝不把半截标记输出给用户；
- Provider 同时返回原生 `tool_calls` 时以内置结构为准，避免同一调用执行两次。

解析结果作为正常的 `StreamEvent(type="tool_calls")` 交给运行时，后续工具执行、审批、持久化流程完全复用现有逻辑。

同时导出 `parse_dsml_tool_calls()`，供非流式 Runtime 使用。

#### 2）LangGraph Runtime 兜底（`runtime_langgraph.py`）

`_chatbot` 调用模型后，如果没有原生 `tool_calls` 但正文含 DSML：

- 用同一解析器清洗正文；
- 把 DSML 调用转换为 `AIMessage.tool_calls`；
- 让图正常路由到 `tools` 节点，而不是把标记当回答返回。

#### 3）Intent 上下文继承（`intent.py` / `stream_runtime.py`）

“通用的呢？”本身不含商品名词，原来的 `classify_intent()` 会判为 `chitchat`，工具列表为空。
本轮新增 `classify_intent_with_history()`：

- 短句且带指代/追问信号（`呢`、`吗`、`这个`、`还有`、`？` 等）时，回溯最近一条非 chitchat 的用户消息，继承其 intent；
- “谢谢”“好的”这类普通闲聊仍保持 `chitchat`，不会误开工具；
- Native 与 LangGraph 两个运行时都使用同一套上下文分类。

#### 4）工具白名单强制校验（`stream_runtime.py`）

DSML 兜底让模型可以用正文“写出”任意工具名。为避免绕过 Intent 白名单：

- Native Runtime 现在对每个调用检查 `name in decision.tools`；
- 不允许的调用返回 `TOOL_NOT_ALLOWED` 观察结果，并产生 `tool_end { ok: false }`；
- LangGraph 原本已有同样的 `allowed` 校验，两条路径行为一致。

#### 5）检索词修正（`items/service.py`）

```python
explicit_keyword = (keyword or "").strip() or None
category_value = (category or "").strip() or None
lexical_keyword = explicit_keyword
if lexical_keyword is None and not category_value:
    lexical_keyword = cleaned   # 无类目时才退回整句
```

效果：

- 有 `category` 时，lexical 腿只用类目/标签过滤，不再要求名称包含整句；
- 模型显式传 `keyword` 时仍以 `keyword` 为准；
- 没有 `category`/`keyword` 时保留原来的整句兜底，避免行为回退。

### 9.4 验证

新增/扩展测试：

- `test_dsml_tool_call_markup_is_parsed_and_never_streamed`：按 7 字符切块，断言标记不泄漏、参数正确；
- `test_dsml_marker_surrounding_text_is_preserved`：标记前后的正常文本保留；
- `test_truncated_dsml_markup_is_dropped_not_leaked`：截断块不泄漏；
- `test_langgraph_parses_dsml_tool_call_from_content`：LangGraph 路线同样能执行工具；
- `test_elided_follow_up_inherits_shopping_context` / `test_question_follow_up_inherits_order_context` / `test_plain_chitchat_does_not_inherit_tools`；
- `test_dsml_fallback_cannot_bypass_the_intent_tool_allow_list`：正文工具调用不能越权；
- `test_natural_language_query_with_category_matches_tagged_items`：自然语言 query + category 能命中打标签商品。

全量结果：**229 passed, 1 skipped**；`ruff`、`mypy` 全部通过。

### 9.5 已知边界

1. **旧会话历史**：修复前已经写入 `ai_chat_records` 的 DSML 原始文本不会被自动改写；前端历史里仍可能看到旧消息。开新会话或清除历史即可。新产生的回复不会再包含标记。
2. **其他 Provider 变体**：当前解析覆盖 DeepSeek DSML 的单/双管线、`calls`/`tool_calls`/`function_calls`。如果遇到新的标记语法，建议直接把原始片段加入 `tests/unit/test_llm_gateway.py` 作为回归样本。
3. **`category` 必须是平台标签词**：检索按 `tags.name ILIKE %category%` 过滤。若模型传入平台不存在的类目，结果仍可能为空；此时应由模型按 `reflection_hint` 放宽条件。



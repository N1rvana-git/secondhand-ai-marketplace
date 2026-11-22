export type UserRole = 'user' | 'admin'

export interface ApiErrorEnvelope {
  error?: {
    code: string
    message: string
    trace_id: string
    details?: Record<string, unknown>
  }
  detail?: string
}

export interface PageResponse<T> {
  items: T[]
  total: number
  skip: number
  limit: number
  has_more: boolean
}

// --- Auth & Users ---
export interface TokenResponse {
  access_token: string
  token_type: string
  expires_in: number
  role: UserRole
  user_id: number
  email: string | null
}

export interface UserPublic {
  id: number
  username: string
  email: string | null
  role: UserRole
  created_at: string | null
}

export interface UserAdminView extends UserPublic {
  phone: string | null
  feishu_open_id: string | null
}

export interface UserRegisterRequest {
  email: string
  password: string
  username?: string
}

export interface UserRoleUpdateRequest {
  role: UserRole
}

// --- Items & Tags (后端写接口开启 extra="forbid"，严禁传多余字段) ---
export interface TagRead {
  id: number
  name: string
}

export interface TagCreateRequest {
  name: string
}

export interface ItemRead {
  id: number
  name: string
  price: number
  is_offer: boolean | null
  is_sold: boolean
  image_path: string | null
  inventory: number
  owner_id: number | null
  tags: TagRead[]
  created_at: string | null
  /** 当前登录用户是否已收藏；匿名请求恒为 false */
  favorited: boolean
  /** 商品被收藏的总次数（公开字段） */
  favourited_count: number
}

export interface ItemCreateRequest {
  name: string
  price: number
  is_offer: boolean
  image_path?: string | null
  inventory: number
  tag_ids: number[]
}

export type ItemUpdateRequest = Partial<ItemCreateRequest>

export interface ItemListResponse {
  total: number
  items: ItemRead[]
  skip: number
  limit: number
}

export interface ItemSearchHit extends ItemRead {
  score: number | null
  match_reason: 'semantic' | 'lexical' | 'hybrid' | string | null
}

export interface SearchResponse {
  message: string
  data: ItemSearchHit[]
  mode: string
}

export interface ImageUploadResponse {
  filename: string
  url: string
  image_embedding: number[] | null
  message: string
}

export interface AnalyzeUploadResponse {
  message: string
  image_url: string
  suggested_tags: string[]
  suggested_title: string
}

export interface FavoriteToggleResponse {
  message: string
  favorited: boolean
  favourited_count: number
}

export interface BuyItemResponse {
  order_id: number
  item_name: string
  unit_price: number
  quantity: number
  remaining_inventory: number
  message: string
}

export interface DashboardResponse {
  user_email: string | null
  stats: {
    published_count: number
    orders_count: number
    favourites_count: number
  }
  my_items: Array<{
    id: number
    name: string
    price: number
    is_sold: boolean
  }>
  my_orders: Array<{
    order_id: number
    item_name: string
    price: number
    quantity: number
    status: string
    time: string | null
  }>
}

// --- System Readiness (GET /health/ready) ---
export interface CheckResult {
  name: string
  ok: boolean
  latency_ms: number
  detail: string | null
}

export interface ReadinessResponse {
  status: 'ok' | 'degraded' | string
  checks: CheckResult[]
  version: string
  environment: string
  timestamp: string
}

// --- AI Agent SSE & HITL Approvals ---
export type AgentEventType =
  | 'intent'
  | 'token'
  | 'tool_start'
  | 'tool_end'
  | 'interrupt_required'
  | 'done'
  | 'error'
  | 'aborted'

export interface ChatHistoryItem {
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: string | null
  thread_id: string | null
}

export interface ApprovalRecord {
  approval_id: number
  thread_id: string
  action: string
  status:
    | 'pending'
    | 'executing'
    | 'approved'
    | 'rejected'
    | 'expired'
    | 'failed'
  payload: Record<string, unknown>
  reason: string | null
  decision_comment: string | null
  resolved_order_id: number | null
  created_at: string | null
  expires_at: string | null
}

export interface ThreadStatusResponse {
  thread_id: string
  is_interrupted: boolean
  pending_approvals: ApprovalRecord[]
  last_message_at: string | null
  last_role: string | null
}

export interface ResumeThreadRequest {
  approved: boolean
  approval_id?: number
  comment?: string
}

export interface ResumeThreadResponse {
  status: string
  approval_id: number
  thread_id: string
  order_id: number | null
}

/**
 * `POST /items/ai/agent/stream` 的请求体。
 * 后端 `ChatService._build_messages` 会基于 ChatRecord + BuyerMemory 自行组窗，
 * 因此前端只允许发送当前这一句，禁止回传本地 messages 数组。
 */
export interface AgentStreamRequest {
  message: string
  thread_id: string
}

export interface AgentIntentEventData {
  intent: string
  tools: string[]
}

export interface AgentToolStartEventData {
  name: string
  /** 双 Runtime 异构：原生对象或 JSON 字符串（需安全解析） */
  arguments: Record<string, unknown> | string
}

export interface AgentToolEndEventData {
  name: string
  ok: boolean
}

export interface AgentTokenEventData {
  text?: string
  content?: string
}

export interface AgentInterruptEventData {
  approval_id: number
  thread_id: string
  action: string
  reason: string
  expires_at: string
  payload: Record<string, unknown>
  message: string
}

export interface AgentDoneEventData {
  steps?: number
  interrupted?: boolean
  replayed?: boolean
  reply?: string
}

export interface AgentErrorEventData {
  message: string
  code?: string
}

export interface AgentAbortedEventData {
  reason?: string
}

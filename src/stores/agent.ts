import { create } from 'zustand'
import { toast } from 'sonner'
import {
  clearChatHistory,
  getChatHistory,
  getThreadStatus,
  listPendingApprovals,
  resumeThread,
} from '@/api/agent'
import {
  ApiError,
  createIdempotencyKey,
  getApiErrorMessage,
} from '@/api/client'
import { getAccessToken } from '@/lib/auth-token'
import { showApiErrorToast } from '@/lib/errorToast'
import {
  describeAgentError,
  readApprovalAddress,
  readPayloadNumber,
  readPayloadText,
} from '@/features/agent/agent-meta'
import {
  AgentStreamHttpError,
  streamAgentChat,
  type SseFrame,
} from '@/features/agent/sseClient'
import type {
  AgentAbortedEventData,
  AgentDoneEventData,
  AgentErrorEventData,
  AgentIntentEventData,
  AgentInterruptEventData,
  AgentTokenEventData,
  AgentToolEndEventData,
  AgentToolStartEventData,
  ApprovalRecord,
  ChatHistoryItem,
  ResumeThreadRequest,
} from '@/types/api'

export type AgentStatus =
  | 'idle'
  | 'loading'
  | 'streaming'
  | 'interrupted'
  | 'error'

export interface AgentIntent {
  intent: string
  tools: string[]
}

export interface ToolCallStep {
  id: string
  name: string
  arguments: Record<string, unknown>
  status: 'running' | 'success' | 'error'
}

export interface AgentChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
  intent: AgentIntent | null
  tools: ToolCallStep[]
  status: 'done' | 'streaming' | 'error' | 'aborted' | 'interrupted'
  error: { message: string; code?: string } | null
  /** 用户原始提问，用于失败后重试 */
  sourceText: string | null
  /** 本轮幂等键：重试同一句必须复用 */
  idempotencyKey: string | null
}

export interface AgentThread {
  id: string
  title: string
  createdAt: string
}

export interface ApprovalDecision {
  status: 'approved' | 'rejected' | 'stale' | 'failed'
  orderId: number | null
  comment: string | null
  message: string | null
  decidedAt: string
}

export interface DecideApprovalResult {
  ok: boolean
  orderId: number | null
  message: string
}

interface AgentState {
  isOpen: boolean
  isExpanded: boolean
  userId: number | null
  threads: AgentThread[]
  currentThreadId: string | null
  messages: AgentChatMessage[]
  status: AgentStatus
  errorMessage: string | null
  hydratedThreadId: string | null
  /** 当前用户全部待审批记录（用于顶栏角标与审批队列） */
  pendingApprovals: ApprovalRecord[]
  /** 当前线程可见审批（含已处理卡片，刷新页面不丢挂起审批） */
  threadApprovals: ApprovalRecord[]
  approvalDecisions: Record<number, ApprovalDecision>
  decidingApprovalIds: number[]
  streamController: AbortController | null

  initForUser: (userId: number | null) => void
  setOpen: (open: boolean) => void
  toggleOpen: () => void
  setExpanded: (expanded: boolean) => void
  hydrateThread: (threadId?: string) => Promise<void>
  switchThread: (threadId: string) => Promise<void>
  createThread: () => Promise<void>
  sendMessage: (text: string) => Promise<void>
  retryMessage: (messageId: string) => Promise<void>
  stopStreaming: () => void
  fetchGlobalApprovals: () => Promise<void>
  refreshThreadApprovals: (threadId?: string) => Promise<void>
  /** executing 态主动对账：线程 status + 全局 approvals。 */
  refreshApprovalStatus: (approval: ApprovalRecord) => Promise<void>
  /** 终态审批的确定性重提：切到目标线程并直接下发全新订单指令。 */
  resubmitApprovalOrder: (approval: ApprovalRecord) => Promise<void>
  decideApproval: (
    threadId: string,
    approvalId: number,
    approved: boolean,
    comment?: string,
  ) => Promise<DecideApprovalResult>
  clearCurrentThread: () => Promise<void>
  resetOnLogout: () => void
}

const THREAD_STORAGE_PREFIX = 'xianxiaobao.agent.threads.v1.'
const MAX_THREADS = 24
const HISTORY_LIMIT = 50
const MAX_MESSAGE_LENGTH = 4000
const MAIN_THREAD_TITLE = '主会话'
export const NEW_THREAD_TITLE = '新会话'

export const THREAD_ID_PATTERN = /^[A-Za-z0-9._:-]{1,64}$/

export function isValidThreadId(value: string): boolean {
  return THREAD_ID_PATTERN.test(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function createMessageId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function buildMainThread(userId: number): AgentThread {
  return {
    id: `u${userId}:main`,
    title: MAIN_THREAD_TITLE,
    createdAt: new Date().toISOString(),
  }
}

function storageKey(userId: number): string {
  return `${THREAD_STORAGE_PREFIX}${userId}`
}

function readStoredThreads(userId: number): AgentThread[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(storageKey(userId))
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []

    return parsed.flatMap((entry): AgentThread[] => {
      if (!isRecord(entry)) return []
      const id = typeof entry.id === 'string' ? entry.id : ''
      if (!isValidThreadId(id)) return []
      const title =
        typeof entry.title === 'string' && entry.title.trim()
          ? entry.title.trim().slice(0, 40)
          : NEW_THREAD_TITLE
      const createdAt =
        typeof entry.createdAt === 'string'
          ? entry.createdAt
          : new Date().toISOString()
      return [{ id, title, createdAt }]
    })
  } catch {
    return []
  }
}

function writeStoredThreads(userId: number, threads: AgentThread[]): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(
      storageKey(userId),
      JSON.stringify(threads.slice(0, MAX_THREADS)),
    )
  } catch {
    // localStorage 满 / 隐私模式禁用：不影响当前会话
  }
}

const ACTIVE_THREAD_STORAGE_PREFIX = 'agent_active_thread_u'

function activeThreadStorageKey(userId: number): string {
  return `${ACTIVE_THREAD_STORAGE_PREFIX}${userId}`
}

/** 读取当前用户上次停留的会话线程；非法或已被清理的 id 返回 null。 */
function readStoredActiveThread(userId: number): string | null {
  if (typeof window === 'undefined') return null
  try {
    const value = window.localStorage.getItem(activeThreadStorageKey(userId))
    return value && isValidThreadId(value) ? value : null
  } catch {
    return null
  }
}

function writeStoredActiveThread(userId: number, threadId: string): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(activeThreadStorageKey(userId), threadId)
  } catch {
    // 持久化失败不影响当前会话
  }
}

function clearStoredActiveThread(userId: number): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(activeThreadStorageKey(userId))
  } catch {
    // 忽略隐私模式下的存储异常
  }
}

function normalizeToolArguments(
  raw: Record<string, unknown> | string | undefined,
): Record<string, unknown> {
  if (raw == null) return {}
  if (typeof raw === 'string') {
    const text = raw.trim()
    if (!text) return {}
    try {
      const parsed: unknown = JSON.parse(text)
      if (isRecord(parsed)) return parsed
      return { _value: parsed }
    } catch {
      return { _raw: raw }
    }
  }
  return raw
}

function mapHistoryToMessages(items: ChatHistoryItem[]): AgentChatMessage[] {
  return items
    .filter((item) => item.role === 'user' || item.role === 'assistant')
    .map((item) => ({
      id: createMessageId('history'),
      role: item.role === 'user' ? ('user' as const) : ('assistant' as const),
      content: typeof item.content === 'string' ? item.content : '',
      createdAt: item.timestamp ?? new Date().toISOString(),
      intent: null,
      tools: [],
      status: 'done' as const,
      error: null,
      sourceText: item.role === 'user' ? item.content : null,
      idempotencyKey: null,
    }))
}

function mergeApprovals(
  pending: ApprovalRecord[],
  existing: ApprovalRecord[],
  decisions: Record<number, ApprovalDecision>,
): ApprovalRecord[] {
  const merged = new Map<number, ApprovalRecord>()
  // 保留本地已处理 / 已失效的卡片，避免批准后刷新列表时卡片立即消失。
  for (const record of existing) {
    if (decisions[record.approval_id]) merged.set(record.approval_id, record)
  }
  for (const record of pending) merged.set(record.approval_id, record)
  return [...merged.values()].sort((a, b) => a.approval_id - b.approval_id)
}

function replaceThreadApprovals(
  global: ApprovalRecord[],
  threadId: string,
  pending: ApprovalRecord[],
): ApprovalRecord[] {
  return [
    ...global.filter((record) => record.thread_id !== threadId),
    ...pending,
  ]
}

function parseFrameData<T>(frame: SseFrame): T | null {
  if (!frame.data) return null
  try {
    return JSON.parse(frame.data) as T
  } catch {
    // 单帧 JSON 损坏时静默忽略，不中断整条流
    return null
  }
}

function titleFromMessage(text: string): string {
  const compact = text.replace(/\s+/g, ' ').trim()
  return compact.length > 18 ? `${compact.slice(0, 18)}…` : compact
}

export const useAgentStore = create<AgentState>((set, get) => {
  function patchAssistantMessage(
    threadId: string,
    assistantId: string,
    updater: (message: AgentChatMessage) => AgentChatMessage,
  ): void {
    if (get().currentThreadId !== threadId) return
    set((state) => ({
      messages: state.messages.map((message) =>
        message.id === assistantId ? updater(message) : message,
      ),
    }))
  }

  function handleStreamFrame(
    threadId: string,
    assistantId: string,
    frame: SseFrame,
  ): void {
    const event = frame.event ?? ''

    switch (event) {
      case 'intent': {
        const payload = parseFrameData<AgentIntentEventData>(frame)
        if (!payload || typeof payload.intent !== 'string') return
        const tools = Array.isArray(payload.tools)
          ? payload.tools.filter((tool): tool is string => typeof tool === 'string')
          : []
        patchAssistantMessage(threadId, assistantId, (message) => ({
          ...message,
          intent: { intent: payload.intent, tools },
        }))
        return
      }

      case 'tool_start': {
        const payload = parseFrameData<AgentToolStartEventData>(frame)
        if (!payload || typeof payload.name !== 'string' || !payload.name) return
        const step: ToolCallStep = {
          id: createMessageId('tool'),
          name: payload.name,
          arguments: normalizeToolArguments(payload.arguments),
          status: 'running',
        }
        patchAssistantMessage(threadId, assistantId, (message) => ({
          ...message,
          tools: [...message.tools, step],
        }))
        return
      }

      case 'tool_end': {
        const payload = parseFrameData<AgentToolEndEventData>(frame)
        if (!payload || typeof payload.name !== 'string') return
        const ok = payload.ok === true
        patchAssistantMessage(threadId, assistantId, (message) => {
          const tools = [...message.tools]
          for (let index = tools.length - 1; index >= 0; index -= 1) {
            if (tools[index].name === payload.name && tools[index].status === 'running') {
              tools[index] = { ...tools[index], status: ok ? 'success' : 'error' }
              break
            }
          }
          return { ...message, tools }
        })
        return
      }

      case 'token': {
        const payload = parseFrameData<AgentTokenEventData>(frame)
        const chunk = payload?.text ?? payload?.content ?? ''
        if (!chunk) return
        patchAssistantMessage(threadId, assistantId, (message) => ({
          ...message,
          content: message.content + chunk,
        }))
        return
      }

      case 'interrupt_required': {
        const payload = parseFrameData<AgentInterruptEventData>(frame)
        if (!payload) return
        const approvalId = Number(payload.approval_id)
        if (!Number.isFinite(approvalId)) return

        const approvalThreadId =
          typeof payload.thread_id === 'string' && payload.thread_id
            ? payload.thread_id
            : threadId
        const notice =
          typeof payload.message === 'string' ? payload.message.trim() : ''

        const record: ApprovalRecord = {
          approval_id: approvalId,
          thread_id: approvalThreadId,
          action:
            typeof payload.action === 'string' && payload.action
              ? payload.action
              : 'create_order',
          status: 'pending',
          payload: isRecord(payload.payload) ? payload.payload : {},
          reason: typeof payload.reason === 'string' ? payload.reason : null,
          decision_comment: null,
          resolved_order_id: null,
          created_at: new Date().toISOString(),
          expires_at:
            typeof payload.expires_at === 'string' ? payload.expires_at : null,
        }

        set((state) => {
          if (state.currentThreadId !== threadId) return {}
          const inGlobal = state.pendingApprovals.some(
            (item) => item.approval_id === approvalId,
          )
          const inThread = state.threadApprovals.some(
            (item) => item.approval_id === approvalId,
          )

          return {
            messages: state.messages.map((message) =>
              message.id === assistantId
                ? {
                    ...message,
                    content: notice
                      ? message.content
                        ? `${message.content}\n\n${notice}`
                        : notice
                      : message.content,
                    status: 'interrupted' as const,
                  }
                : message,
            ),
            status: 'interrupted' as const,
            pendingApprovals: inGlobal
              ? state.pendingApprovals
              : [...state.pendingApprovals, record],
            threadApprovals: inThread
              ? state.threadApprovals
              : [...state.threadApprovals, record],
          }
        })

        // 收到挂起帧后异步对账：顶栏角标与审批队列以服务端为准。
        // 不回刷线程审批快照，避免服务端尚未落库时把刚插入的卡片覆盖掉。
        void get().fetchGlobalApprovals()
        return
      }

      case 'done': {
        const payload = parseFrameData<AgentDoneEventData>(frame)
        const interrupted = payload?.interrupted === true
        const replayReply =
          payload?.replayed === true && typeof payload.reply === 'string'
            ? payload.reply
            : ''

        set((state) => {
          if (state.currentThreadId !== threadId) return {}
          return {
            messages: state.messages.map((message) =>
              message.id === assistantId
                ? {
                    ...message,
                    content:
                      !message.content && replayReply
                        ? replayReply
                        : message.content,
                    status: interrupted
                      ? ('interrupted' as const)
                      : ('done' as const),
                  }
                : message,
            ),
            status: interrupted ? ('interrupted' as const) : ('idle' as const),
          }
        })

        if (interrupted) void get().refreshThreadApprovals(threadId)
        return
      }

      case 'error': {
        const payload = parseFrameData<AgentErrorEventData>(frame)
        const fallback =
          typeof payload?.message === 'string' && payload.message.trim()
            ? payload.message.trim()
            : '生成失败，请重试。'
        const code =
          typeof payload?.code === 'string' && payload.code
            ? payload.code
            : undefined
        const display = describeAgentError(code, fallback)

        set((state) => {
          if (state.currentThreadId !== threadId) return {}
          return {
            messages: state.messages.map((message) =>
              message.id === assistantId
                ? {
                    ...message,
                    status: 'error' as const,
                    error: { message: display, code },
                  }
                : message,
            ),
            status: 'error' as const,
            errorMessage: display,
          }
        })
        return
      }

      case 'aborted': {
        const payload = parseFrameData<AgentAbortedEventData>(frame)
        const reason = payload?.reason?.trim()
        set((state) => {
          if (state.currentThreadId !== threadId) return {}
          return {
            messages: state.messages.map((message) =>
              message.id === assistantId
                ? { ...message, status: 'aborted' as const }
                : message,
            ),
            status: 'idle' as const,
            errorMessage: reason || null,
          }
        })
        return
      }

      default:
        return
    }
  }

  async function runTurn(params: {
    threadId: string
    assistantId: string
    text: string
    idempotencyKey: string
  }): Promise<void> {
    const token = getAccessToken()
    const controller = new AbortController()
    const previous = get().streamController

    if (previous && !previous.signal.aborted) previous.abort()
    set({ streamController: controller, status: 'streaming', errorMessage: null })

    if (!token) {
      if (get().currentThreadId === params.threadId) {
        set((state) => ({
          messages: state.messages.map((message) =>
            message.id === params.assistantId
              ? {
                  ...message,
                  status: 'error' as const,
                  error: {
                    code: 'UNAUTHORIZED',
                    message: describeAgentError(
                      'UNAUTHORIZED',
                      '登录状态已失效，请重新登录。',
                    ),
                  },
                }
              : message,
          ),
          status: 'error' as const,
          errorMessage: describeAgentError(
            'UNAUTHORIZED',
            '登录状态已失效，请重新登录。',
          ),
          streamController: null,
        }))
      }
      return
    }

    const outcome = await streamAgentChat(
      {
        message: params.text,
        threadId: params.threadId,
        idempotencyKey: params.idempotencyKey,
        token,
        signal: controller.signal,
      },
      {
        onFrame: (frame) =>
          handleStreamFrame(params.threadId, params.assistantId, frame),
      },
    )

    // 若本轮已被「停止生成 / 新对话 / 切换线程」接管，后续收尾全部让位，
    // 避免旧连接把新一轮对话的状态覆盖回 idle / error。
    const ownsController = get().streamController === controller
    if (ownsController) set({ streamController: null })
    if (!ownsController) return

    if (controller.signal.aborted || outcome.status === 'aborted') {
      if (get().currentThreadId === params.threadId) {
        set((state) => ({
          messages: state.messages.map((message) =>
            message.id === params.assistantId && message.status === 'streaming'
              ? { ...message, status: 'aborted' as const }
              : message,
          ),
          status:
            state.status === 'streaming' ? ('idle' as const) : state.status,
        }))
      }
      return
    }

    if (outcome.status === 'failed') {
      const error = outcome.error
      const code =
        error instanceof AgentStreamHttpError ? error.code : 'NETWORK_ERROR'
      const rawMessage =
        error instanceof Error && error.message
          ? error.message
          : '连接已中断，请检查网络后重试。'
      const display = describeAgentError(code, rawMessage)

      if (get().currentThreadId === params.threadId) {
        set((state) => ({
          messages: state.messages.map((message) =>
            message.id === params.assistantId
              ? {
                  ...message,
                  status: 'error' as const,
                  error: { message: display, code },
                }
              : message,
          ),
          status: 'error' as const,
          errorMessage: display,
        }))
      }
      return
    }

    // 兜底：已收到终态事件，但某些异常帧未改变状态时，避免输入框永久锁定。
    if (outcome.status === 'completed' && get().currentThreadId === params.threadId) {
      set((state) => ({
        status: state.status === 'streaming' ? ('idle' as const) : state.status,
        messages: state.messages.map((message) =>
          message.id === params.assistantId && message.status === 'streaming'
            ? { ...message, status: 'done' as const }
            : message,
        ),
      }))
    }
  }

  async function refreshThreadState(threadId: string): Promise<void> {
    const [history, status] = await Promise.all([
      getChatHistory({ thread_id: threadId, limit: HISTORY_LIMIT }),
      getThreadStatus(threadId),
    ])

    if (get().currentThreadId !== threadId) return

    set((state) => ({
      messages: mapHistoryToMessages(history),
      threadApprovals: mergeApprovals(
        status.pending_approvals,
        state.threadApprovals,
        state.approvalDecisions,
      ),
      status: status.is_interrupted ? 'interrupted' : 'idle',
      hydratedThreadId: threadId,
      errorMessage: null,
    }))
  }

  /** 审批结束后同步历史 / 线程状态 / 全局待审批；同步失败也要解除输入锁。 */
  async function syncThreadAfterDecision(threadId: string): Promise<void> {
    try {
      await refreshThreadState(threadId)
    } catch {
      set((state) => {
        if (state.currentThreadId !== threadId) return {}
        const hasUnresolved = state.threadApprovals.some(
          (record) => !state.approvalDecisions[record.approval_id],
        )
        return hasUnresolved ? {} : { status: 'idle' as const }
      })
    }
    await get().fetchGlobalApprovals()
  }

  return {
    isOpen: false,
    isExpanded: false,
    userId: null,
    threads: [],
    currentThreadId: null,
    messages: [],
    status: 'idle',
    errorMessage: null,
    hydratedThreadId: null,
    pendingApprovals: [],
    threadApprovals: [],
    approvalDecisions: {},
    decidingApprovalIds: [],
    streamController: null,

    setOpen: (open) => set({ isOpen: open }),

    toggleOpen: () => set((state) => ({ isOpen: !state.isOpen })),

    setExpanded: (expanded) => set({ isExpanded: expanded }),

    initForUser: (userId) => {
      if (userId == null) {
        get().resetOnLogout()
        return
      }
      if (get().userId === userId) return

      get().streamController?.abort()

      const stored = readStoredThreads(userId)
      const main = buildMainThread(userId)
      const threads = [
        main,
        ...stored.filter((thread) => thread.id !== main.id),
      ].slice(0, MAX_THREADS)

      // F5 后恢复上次停留的线程；仅接受仍存在于当前用户线程列表中的 id。
      const storedActiveThreadId = readStoredActiveThread(userId)
      const restoredThreadId =
        storedActiveThreadId != null &&
        threads.some((thread) => thread.id === storedActiveThreadId)
          ? storedActiveThreadId
          : main.id

      if (
        storedActiveThreadId != null &&
        restoredThreadId !== storedActiveThreadId
      ) {
        clearStoredActiveThread(userId)
      }

      writeStoredThreads(userId, threads)
      writeStoredActiveThread(userId, restoredThreadId)

      set({
        userId,
        threads,
        currentThreadId: restoredThreadId,
        messages: [],
        threadApprovals: [],
        approvalDecisions: {},
        decidingApprovalIds: [],
        pendingApprovals: [],
        status: 'idle',
        errorMessage: null,
        hydratedThreadId: null,
        streamController: null,
        isOpen: false,
      })
    },

    hydrateThread: async (threadId) => {
      const target = threadId ?? get().currentThreadId
      if (!target || !isValidThreadId(target)) return

      const state = get()
      const isSwitch = state.currentThreadId !== target
      if (isSwitch) {
        state.streamController?.abort()
        set({ streamController: null })
      }

      if (!state.threads.some((thread) => thread.id === target)) {
        const meta: AgentThread = {
          id: target,
          title: NEW_THREAD_TITLE,
          createdAt: new Date().toISOString(),
        }
        const threads = [meta, ...state.threads].slice(0, MAX_THREADS)
        set({ threads })
        if (state.userId) writeStoredThreads(state.userId, threads)
      }

      set({
        currentThreadId: target,
        status: 'loading',
        errorMessage: null,
        ...(isSwitch ? { messages: [], threadApprovals: [] } : {}),
      })
      if (state.userId) writeStoredActiveThread(state.userId, target)

      try {
        const [history, threadStatus] = await Promise.all([
          getChatHistory({ thread_id: target, limit: HISTORY_LIMIT }),
          getThreadStatus(target),
        ])

        if (get().currentThreadId !== target) return

        set((current) => ({
          messages: mapHistoryToMessages(history),
          threadApprovals: mergeApprovals(
            threadStatus.pending_approvals,
            current.threadApprovals,
            current.approvalDecisions,
          ),
          pendingApprovals: replaceThreadApprovals(
            current.pendingApprovals,
            target,
            threadStatus.pending_approvals,
          ),
          status: threadStatus.is_interrupted ? 'interrupted' : 'idle',
          hydratedThreadId: target,
          errorMessage: null,
        }))
      } catch (error) {
        if (get().currentThreadId !== target) return
        set({
          status: 'error',
          errorMessage: getApiErrorMessage(error),
        })
      }
    },

    switchThread: async (threadId) => {
      if (!isValidThreadId(threadId)) return
      if (threadId === get().currentThreadId && get().hydratedThreadId === threadId) {
        await get().refreshThreadApprovals(threadId)
        return
      }
      await get().hydrateThread(threadId)
    },

    createThread: async () => {
      const state = get()
      if (!state.userId) return

      const shortId = crypto.randomUUID().replace(/-/g, '').slice(0, 8)
      const threadId = `u${state.userId}:${shortId}`
      const thread: AgentThread = {
        id: threadId,
        title: NEW_THREAD_TITLE,
        createdAt: new Date().toISOString(),
      }
      const threads = [thread, ...state.threads].slice(0, MAX_THREADS)

      state.streamController?.abort()
      set({
        threads,
        currentThreadId: threadId,
        messages: [],
        threadApprovals: [],
        status: 'idle',
        errorMessage: null,
        hydratedThreadId: null,
        streamController: null,
      })
      writeStoredThreads(state.userId, threads)
      await get().hydrateThread(threadId)
    },

    sendMessage: async (text) => {
      const trimmed = text.trim()
      if (!trimmed || trimmed.length > MAX_MESSAGE_LENGTH) return

      const state = get()
      if (!state.userId || !state.currentThreadId) return
      if (
        state.status === 'streaming' ||
        state.status === 'loading' ||
        state.status === 'interrupted'
      ) {
        return
      }

      const threadId = state.currentThreadId
      const idempotencyKey = createIdempotencyKey()
      const now = new Date().toISOString()

      const userMessage: AgentChatMessage = {
        id: createMessageId('user'),
        role: 'user',
        content: trimmed,
        createdAt: now,
        intent: null,
        tools: [],
        status: 'done',
        error: null,
        sourceText: null,
        idempotencyKey: null,
      }
      const assistantMessage: AgentChatMessage = {
        id: createMessageId('assistant'),
        role: 'assistant',
        content: '',
        createdAt: now,
        intent: null,
        tools: [],
        status: 'streaming',
        error: null,
        sourceText: trimmed,
        idempotencyKey,
      }

      const currentThread = state.threads.find(
        (thread) => thread.id === threadId,
      )
      const shouldRetitle =
        currentThread != null &&
        (currentThread.title === NEW_THREAD_TITLE || !currentThread.title)

      let threads = state.threads
      if (shouldRetitle && state.userId) {
        threads = state.threads.map((thread) =>
          thread.id === threadId
            ? { ...thread, title: titleFromMessage(trimmed) }
            : thread,
        )
        writeStoredThreads(state.userId, threads)
      }

      set({
        threads,
        messages: [...state.messages, userMessage, assistantMessage],
        status: 'streaming',
        errorMessage: null,
      })

      await runTurn({
        threadId,
        assistantId: assistantMessage.id,
        text: trimmed,
        idempotencyKey,
      })
    },

    retryMessage: async (messageId) => {
      const state = get()
      const target = state.messages.find(
        (message) => message.id === messageId && message.role === 'assistant',
      )
      if (!target || !target.sourceText || !target.idempotencyKey) return
      if (
        state.status === 'streaming' ||
        state.status === 'loading' ||
        state.status === 'interrupted'
      ) {
        return
      }

      const threadId = state.currentThreadId
      if (!threadId) return

      set((current) => ({
        messages: current.messages.map((message) =>
          message.id === messageId
            ? {
                ...message,
                content: '',
                intent: null,
                tools: [],
                error: null,
                status: 'streaming' as const,
              }
            : message,
        ),
        status: 'streaming',
        errorMessage: null,
      }))

      // 重试同一句：复用该轮幂等键，后端可返回 replay 结果而不是重复执行工具。
      await runTurn({
        threadId,
        assistantId: messageId,
        text: target.sourceText,
        idempotencyKey: target.idempotencyKey,
      })
    },

    stopStreaming: () => {
      const controller = get().streamController
      if (!controller) return
      controller.abort()
      set((state) => ({
        streamController: null,
        status: state.status === 'streaming' ? 'idle' : state.status,
        messages: state.messages.map((message) =>
          message.status === 'streaming'
            ? { ...message, status: 'aborted' as const }
            : message,
        ),
      }))
    },

    fetchGlobalApprovals: async () => {
      if (!get().userId || !getAccessToken()) return
      try {
        const approvals = await listPendingApprovals()
        set({ pendingApprovals: approvals })
      } catch {
        // 角标属于增强信息，失败时静默，不阻断对话
      }
    },

    refreshThreadApprovals: async (threadId) => {
      const target = threadId ?? get().currentThreadId
      if (!target) return

      try {
        const threadStatus = await getThreadStatus(target)
        set((state) => {
          const pendingApprovals = replaceThreadApprovals(
            state.pendingApprovals,
            target,
            threadStatus.pending_approvals,
          )

          if (state.currentThreadId !== target) {
            return { pendingApprovals }
          }

          let status = state.status
          if (threadStatus.is_interrupted && status !== 'streaming') {
            status = 'interrupted'
          } else if (!threadStatus.is_interrupted && status === 'interrupted') {
            status = 'idle'
          }

          return {
            pendingApprovals,
            threadApprovals: mergeApprovals(
              threadStatus.pending_approvals,
              state.threadApprovals,
              state.approvalDecisions,
            ),
            status,
          }
        })
      } catch {
        // 静默：下次打开抽屉 / 操作审批时再同步
      }
    },

    refreshApprovalStatus: async (approval) => {
      const threadId = approval.thread_id
      if (!isValidThreadId(threadId)) return

      try {
        const [threadStatus, globalApprovals] = await Promise.all([
          getThreadStatus(threadId),
          listPendingApprovals(),
        ])
        const serverRecord = threadStatus.pending_approvals.find(
          (record) => record.approval_id === approval.approval_id,
        )

        set((state) => {
          const threadApprovals = state.threadApprovals.map((record) =>
            record.approval_id === approval.approval_id
              ? serverRecord ?? record
              : record,
          )

          // 服务端已不在待处理队列：说明对账已完成（通过 / 失败 / 失效），
          // 保留卡片上下文并标记为已结束，避免永久停留在 executing。
          const approvalDecisions = serverRecord
            ? state.approvalDecisions
            : {
                ...state.approvalDecisions,
                [approval.approval_id]: {
                  status: 'stale' as const,
                  orderId: null,
                  comment: null,
                  message: '该审批已结束，服务端状态已同步。',
                  decidedAt: new Date().toISOString(),
                },
              }

          let status = state.status
          if (state.currentThreadId === threadId) {
            if (threadStatus.is_interrupted && status !== 'streaming') {
              status = 'interrupted'
            } else if (
              !threadStatus.is_interrupted &&
              status === 'interrupted'
            ) {
              status = 'idle'
            }
          }

          return {
            threadApprovals,
            approvalDecisions,
            pendingApprovals: globalApprovals,
            status,
          }
        })

        toast.success(
          serverRecord ? '审批仍在执行中，状态已同步' : '审批已结束，状态已同步',
        )
      } catch (error) {
        showApiErrorToast(error, '审批状态同步失败')
      }
    },

    resubmitApprovalOrder: async (approval) => {
      const payload = approval.payload ?? {}
      const itemId = readPayloadText(payload, 'item_id')
      if (!itemId) {
        toast.error('无法重新提交', {
          description: '该审批记录缺少商品 ID，请重新发起下单。',
        })
        return
      }
      if (!get().userId) {
        toast.error('请先登录后再重新提交订单')
        return
      }
      if (!isValidThreadId(approval.thread_id)) {
        toast.error('无法重新提交', {
          description: '该审批关联的会话标识无效。',
        })
        return
      }

      const itemName =
        readPayloadText(payload, 'item_name') ??
        readPayloadText(payload, 'name') ??
        '该商品'
      const rawQuantity = readPayloadNumber(payload, 'quantity')
      const quantity =
        rawQuantity != null && rawQuantity > 0 ? rawQuantity : 1
      const address =
        readApprovalAddress(payload) ?? '与原审批一致的收货地址'

      const current = get()
      if (current.status === 'streaming' || current.status === 'loading') {
        toast.info('当前会话正在生成回复，请稍候再重新提交该订单。')
        return
      }

      // 先完成目标线程的 hydration，再打开抽屉，避免抽屉挂载时的 hydrate
      // 与紧接着的 sendMessage 互相覆盖 status。
      if (current.currentThreadId !== approval.thread_id) {
        await get().switchThread(approval.thread_id)
      } else if (current.hydratedThreadId !== approval.thread_id) {
        await get().hydrateThread(approval.thread_id)
      } else {
        await get().refreshThreadApprovals(approval.thread_id)
      }

      set({ isOpen: true })

      const ready = get()
      if (ready.currentThreadId !== approval.thread_id) {
        toast.error('无法切换会话', {
          description: '目标会话加载失败，请稍后重试。',
        })
        return
      }
      if (ready.status === 'streaming' || ready.status === 'loading') {
        toast.info('当前会话正在生成回复，请稍候再重新提交该订单。')
        return
      }
      if (ready.status === 'interrupted') {
        toast.info('当前会话仍待审批', {
          description: '请先完成会话中的审批后，再重新提交该订单。',
        })
        return
      }

      const command =
        `请作为全新订单重新下单：商品 ID ${itemId}（${itemName}），` +
        `数量 ${quantity}，收货地址：${address}。` +
        '不要受此前审批记录影响，请直接调用 create_order 提交新的审批。'

      await get().sendMessage(command)
    },

    decideApproval: async (threadId, approvalId, approved, comment) => {
      const trimmedComment = comment?.trim() ?? ''

      if (get().decidingApprovalIds.includes(approvalId)) {
        return {
          ok: false,
          orderId: null,
          message: '该审批正在处理中，请稍候。',
        }
      }
      if (!isValidThreadId(threadId)) {
        return { ok: false, orderId: null, message: '会话标识无效。' }
      }

      set((state) => ({
        decidingApprovalIds: [...state.decidingApprovalIds, approvalId],
      }))

      try {
        const payload: ResumeThreadRequest = {
          approved,
          approval_id: approvalId,
        }
        if (trimmedComment) payload.comment = trimmedComment

        const result = await resumeThread(threadId, payload)
        const orderId =
          typeof result.order_id === 'number' ? result.order_id : null

        set((state) => ({
          approvalDecisions: {
            ...state.approvalDecisions,
            [approvalId]: {
              status: approved ? 'approved' : 'rejected',
              orderId,
              comment: trimmedComment || null,
              message: null,
              decidedAt: new Date().toISOString(),
            },
          },
          pendingApprovals: state.pendingApprovals.filter(
            (record) => record.approval_id !== approvalId,
          ),
        }))

        if (approved && typeof window !== 'undefined') {
          // 通知交易广场静默刷新库存（不改变其检索 / 列表逻辑）
          window.dispatchEvent(new CustomEvent('market:inventory-changed'))
        }

        await syncThreadAfterDecision(threadId)

        return {
          ok: true,
          orderId,
          message: approved ? '已批准并完成下单。' : '已拒绝该笔订单。',
        }
      } catch (error) {
        const message = getApiErrorMessage(error)
        // 409：审批已被处理或已过期，立即同步服务端状态，避免按钮卡死。
        const isConflict = error instanceof ApiError && error.status === 409
        // Sprint H1：批准时库存不足 / 业务规则拦截，后端会把审批标记为 failed。
        // 本地必须同步降级为「执行失败」，否则卡片会卡在 pending 并锁死输入框。
        const isExecutionFailure =
          error instanceof ApiError &&
          error.status === 400 &&
          (error.code === 'OUT_OF_STOCK' ||
            error.code === 'BUSINESS_RULE_VIOLATION')

        if (isExecutionFailure) {
          showApiErrorToast(error, '审批执行失败')
          const decidedAt = new Date().toISOString()

          set((state) => {
            const threadApprovals = state.threadApprovals.map((record) =>
              record.approval_id === approvalId
                ? {
                    ...record,
                    status: 'failed' as const,
                    decision_comment: message,
                  }
                : record,
            )
            const stillLocked = threadApprovals.some(
              (record) =>
                record.approval_id !== approvalId &&
                (record.status === 'pending' ||
                  record.status === 'executing') &&
                !state.approvalDecisions[record.approval_id],
            )

            return {
              approvalDecisions: {
                ...state.approvalDecisions,
                [approvalId]: {
                  status: 'failed' as const,
                  orderId: null,
                  comment: trimmedComment || null,
                  message,
                  decidedAt,
                },
              },
              threadApprovals,
              // 失败审批不再计入顶栏角标；服务端对账在下面立即执行。
              pendingApprovals: state.pendingApprovals.filter(
                (record) => record.approval_id !== approvalId,
              ),
              status:
                state.currentThreadId === threadId && !stillLocked
                  ? ('idle' as const)
                  : state.status,
            }
          })

          await syncThreadAfterDecision(threadId)
          return { ok: false, orderId: null, message }
        }

        if (isConflict) {
          // 服务端已失效：卡片转为「已失效」态，同时移除角标计数。
          set((state) => ({
            approvalDecisions: {
              ...state.approvalDecisions,
              [approvalId]: {
                status: 'stale',
                orderId: null,
                comment: trimmedComment || null,
                message,
                decidedAt: new Date().toISOString(),
              },
            },
            pendingApprovals: state.pendingApprovals.filter(
              (record) => record.approval_id !== approvalId,
            ),
          }))
        }

        showApiErrorToast(error, '审批未完成')
        await syncThreadAfterDecision(threadId)

        return { ok: false, orderId: null, message }
      } finally {
        set((state) => ({
          decidingApprovalIds: state.decidingApprovalIds.filter(
            (id) => id !== approvalId,
          ),
        }))
      }
    },

    clearCurrentThread: async () => {
      const threadId = get().currentThreadId
      if (!threadId) return

      await clearChatHistory(threadId)

      set((state) => {
        const decisions = { ...state.approvalDecisions }
        for (const approval of state.threadApprovals) {
          delete decisions[approval.approval_id]
        }
        return {
          messages: [],
          threadApprovals: [],
          approvalDecisions: decisions,
          pendingApprovals: state.pendingApprovals.filter(
            (record) => record.thread_id !== threadId,
          ),
          status: 'idle',
          errorMessage: null,
          hydratedThreadId: threadId,
        }
      })

      await get().fetchGlobalApprovals()
    },

    resetOnLogout: () => {
      get().streamController?.abort()
      set({
        isOpen: false,
        isExpanded: false,
        userId: null,
        threads: [],
        currentThreadId: null,
        messages: [],
        status: 'idle',
        errorMessage: null,
        hydratedThreadId: null,
        pendingApprovals: [],
        threadApprovals: [],
        approvalDecisions: {},
        decidingApprovalIds: [],
        streamController: null,
      })
    },
  }
})

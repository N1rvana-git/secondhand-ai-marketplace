import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import {
  Loader2,
  Maximize2,
  Minimize2,
  PackageSearch,
  Plus,
  RotateCcw,
  Search,
  SendHorizontal,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Square,
  Trash2,
  X,
  type LucideIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import { showApiErrorToast } from '@/lib/errorToast'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { ApprovalCard } from '@/features/agent/ApprovalCard'
import { MessageBubble } from '@/features/agent/MessageBubble'
import {
  formatCurrency,
  readPayloadNumber,
  readPayloadText,
} from '@/features/agent/agent-meta'
import { cn } from '@/lib/utils'
import { useAgentStore, NEW_THREAD_TITLE } from '@/stores/agent'
import { useAuthStore } from '@/stores/auth'

const NEW_THREAD_VALUE = '__new_thread__'

interface Suggestion {
  icon: LucideIcon
  title: string
  hint: string
  prompt: string
}

const SUGGESTIONS: Suggestion[] = [
  {
    icon: Search,
    title: '预算 500 元以内推荐在售键盘',
    hint: '结合库存与价格，给出可直接下单的清单',
    prompt: '预算 500 元以内推荐在售键盘',
  },
  {
    icon: ShieldCheck,
    title: '平台退换货与防骗规则是什么？',
    hint: '检索平台交易规则与安全提示',
    prompt: '平台退换货与防骗规则是什么？',
  },
  {
    icon: PackageSearch,
    title: '查一下我最近的订单',
    hint: '按时间汇总订单状态与金额',
    prompt: '查一下我最近的订单',
  },
  {
    icon: Sparkles,
    title: '帮我挑选高性价比数码好物',
    hint: '多轮比价后再给出推荐理由',
    prompt: '帮我挑选高性价比数码好物',
  },
]

export function CopilotDrawer() {
  const user = useAuthStore((state) => state.user)

  const isOpen = useAgentStore((state) => state.isOpen)
  const setOpen = useAgentStore((state) => state.setOpen)
  const isExpanded = useAgentStore((state) => state.isExpanded)
  const setExpanded = useAgentStore((state) => state.setExpanded)
  const threads = useAgentStore((state) => state.threads)
  const currentThreadId = useAgentStore((state) => state.currentThreadId)
  const messages = useAgentStore((state) => state.messages)
  const status = useAgentStore((state) => state.status)
  const errorMessage = useAgentStore((state) => state.errorMessage)
  const pendingApprovals = useAgentStore((state) => state.pendingApprovals)
  const threadApprovals = useAgentStore((state) => state.threadApprovals)
  const approvalDecisions = useAgentStore((state) => state.approvalDecisions)
  const decidingApprovalIds = useAgentStore((state) => state.decidingApprovalIds)
  const sendMessage = useAgentStore((state) => state.sendMessage)
  const retryMessage = useAgentStore((state) => state.retryMessage)
  const stopStreaming = useAgentStore((state) => state.stopStreaming)
  const switchThread = useAgentStore((state) => state.switchThread)
  const createThread = useAgentStore((state) => state.createThread)
  const hydrateThread = useAgentStore((state) => state.hydrateThread)
  const refreshThreadApprovals = useAgentStore(
    (state) => state.refreshThreadApprovals,
  )
  const refreshApprovalStatus = useAgentStore(
    (state) => state.refreshApprovalStatus,
  )
  const resubmitApprovalOrder = useAgentStore(
    (state) => state.resubmitApprovalOrder,
  )
  const decideApproval = useAgentStore((state) => state.decideApproval)
  const clearCurrentThread = useAgentStore((state) => state.clearCurrentThread)

  const [draft, setDraft] = useState('')
  const [confirmClear, setConfirmClear] = useState(false)
  const [isClearing, setIsClearing] = useState(false)

  const scrollRef = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const userId = user?.id ?? null
  const isStreaming = status === 'streaming'
  const isInterrupted = status === 'interrupted'
  const isHydrating = status === 'loading'
  const canSend =
    Boolean(user) &&
    !isStreaming &&
    !isInterrupted &&
    !isHydrating &&
    draft.trim().length > 0

  // 打开抽屉：首次 hydrate，之后仅同步线程状态（含刷新页面后的挂起审批）
  useEffect(() => {
    if (!isOpen || !userId) return
    const state = useAgentStore.getState()
    const threadId = state.currentThreadId
    if (!threadId) return
    if (state.hydratedThreadId !== threadId) {
      void state.hydrateThread(threadId)
    } else {
      void state.refreshThreadApprovals(threadId)
    }
  }, [isOpen, userId])

  // 仅在用户接近底部时跟随滚动，向上翻历史时不被拉回
  const handleScroll = () => {
    const element = scrollRef.current
    if (!element) return
    stickToBottom.current =
      element.scrollHeight - element.scrollTop - element.clientHeight < 96
  }

  useEffect(() => {
    if (!isOpen || !stickToBottom.current) return
    const element = scrollRef.current
    if (!element) return
    element.scrollTop = element.scrollHeight
  }, [isOpen, messages, threadApprovals, status, currentThreadId])

  // 多行自适应输入框
  useEffect(() => {
    const element = textareaRef.current
    if (!element) return
    element.style.height = 'auto'
    element.style.height = `${Math.min(element.scrollHeight, 160)}px`
  }, [draft, isOpen])

  const handleSend = () => {
    if (!canSend) return
    const text = draft.trim()
    setDraft('')
    stickToBottom.current = true
    void sendMessage(text)
  }

  const handleThreadChange = (value: string) => {
    if (value === NEW_THREAD_VALUE) {
      stickToBottom.current = true
      setDraft('')
      void createThread()
      return
    }
    if (value === currentThreadId) return
    stickToBottom.current = true
    setDraft('')
    void switchThread(value)
  }

  const handleJumpToThread = (threadId: string) => {
    stickToBottom.current = true
    if (threadId === currentThreadId) {
      void refreshThreadApprovals(threadId)
      return
    }
    void switchThread(threadId)
  }

  const handleClearConfirm = async () => {
    setIsClearing(true)
    try {
      await clearCurrentThread()
      toast.success('当前会话记忆已清空')
      setConfirmClear(false)
      setDraft('')
    } catch (error) {
      showApiErrorToast(error, '清空失败')
    } finally {
      setIsClearing(false)
    }
  }

  const activeThread = threads.find((thread) => thread.id === currentThreadId)
  const subtitle = !user
    ? '登录后启用 AI 导购'
    : isInterrupted
      ? '会话挂起 · 等待人工审批'
      : isStreaming
        ? '正在生成回复'
        : '流式对话 · 工具可追溯'

  return (
    <DialogPrimitive.Root open={isOpen} onOpenChange={setOpen} modal={false}>
      <DialogPrimitive.Trigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label="打开 AI 导购"
          className="relative gap-1.5 bg-background px-2.5"
        >
          <Sparkles className="size-3.5" />
          <span className="hidden sm:inline">AI 导购</span>
          {pendingApprovals.length > 0 ? (
            <span className="absolute -right-1.5 -top-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 font-mono text-[9px] font-semibold tabular-nums text-amber-950 shadow-sm ring-2 ring-background">
              {pendingApprovals.length > 99 ? '99+' : pendingApprovals.length}
            </span>
          ) : null}
        </Button>
      </DialogPrimitive.Trigger>

      <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          aria-describedby={undefined}
          onInteractOutside={(event) => event.preventDefault()}
          className={cn(
            'fixed inset-y-0 right-0 z-50 flex h-full w-full flex-col border-l border-border bg-background shadow-2xl outline-none transition-[width] data-[state=closed]:animate-out data-[state=closed]:duration-150 data-[state=closed]:slide-out-to-right data-[state=open]:animate-in data-[state=open]:duration-200 data-[state=open]:slide-in-from-right sm:w-[460px]',
            isExpanded && 'sm:w-[680px]',
          )}
        >
          <header className="shrink-0 border-b border-border">
            <div className="flex items-center gap-2 px-3 py-2.5">
              <div className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-muted/40">
                <Sparkles className="size-3.5 text-foreground" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <DialogPrimitive.Title className="text-[13px] font-semibold leading-4 tracking-tight text-foreground">
                    AI 导购
                  </DialogPrimitive.Title>
                  <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
                    Copilot
                  </span>
                </div>
                <p className="mt-0.5 flex items-center gap-1.5 truncate text-[10px] text-muted-foreground">
                  <span
                    className={cn(
                      'size-1.5 shrink-0 rounded-full',
                      isInterrupted
                        ? 'bg-amber-500'
                        : isStreaming
                          ? 'animate-pulse bg-sky-500'
                          : user
                            ? 'bg-emerald-500'
                            : 'bg-muted-foreground/40',
                    )}
                  />
                  {subtitle}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-0.5">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={isExpanded ? '切换为标准宽度' : '切换为宽屏'}
                  onClick={() => setExpanded(!isExpanded)}
                >
                  {isExpanded ? (
                    <Minimize2 className="size-3.5" />
                  ) : (
                    <Maximize2 className="size-3.5" />
                  )}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="清空当前会话记忆"
                  disabled={!user || !currentThreadId}
                  onClick={() => setConfirmClear((value) => !value)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
                <DialogPrimitive.Close asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="关闭 AI 导购"
                  >
                    <X className="size-3.5" />
                  </Button>
                </DialogPrimitive.Close>
              </div>
            </div>

            {user ? (
              <div className="flex items-center gap-1.5 px-3 pb-2.5">
                <Select
                  value={currentThreadId ?? ''}
                  onValueChange={handleThreadChange}
                >
                  <SelectTrigger
                    size="sm"
                    className="h-7 min-w-0 flex-1 text-[11px]"
                    aria-label="切换会话"
                  >
                    <SelectValue placeholder="选择会话" />
                  </SelectTrigger>
                  <SelectContent align="end">
                    {threads.map((thread) => (
                      <SelectItem
                        key={thread.id}
                        value={thread.id}
                        className="text-xs"
                      >
                        {thread.title}
                      </SelectItem>
                    ))}
                    <SelectSeparator />
                    <SelectItem
                      value={NEW_THREAD_VALUE}
                      className="text-xs"
                    >
                      <span className="flex items-center gap-1.5">
                        <Plus className="size-3" />
                        新建会话
                      </span>
                    </SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  aria-label="新建会话"
                  onClick={() => {
                    stickToBottom.current = true
                    setDraft('')
                    void createThread()
                  }}
                >
                  <Plus className="size-3.5" />
                </Button>
              </div>
            ) : null}

            {confirmClear ? (
              <div className="flex items-center gap-2 border-t border-rose-500/20 bg-rose-50/60 px-3 py-2 dark:border-rose-500/20 dark:bg-rose-950/20">
                <span className="flex-1 text-[10px] leading-4 text-rose-700 dark:text-rose-300">
                  清空后不可恢复，确定删除「{activeThread?.title ?? NEW_THREAD_TITLE}
                  」的全部记忆？
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-[10px]"
                  onClick={() => setConfirmClear(false)}
                >
                  取消
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  className="h-6 px-2 text-[10px]"
                  disabled={isClearing}
                  onClick={() => void handleClearConfirm()}
                >
                  {isClearing ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : null}
                  确认清空
                </Button>
              </div>
            ) : null}

            {pendingApprovals.length > 0 ? (
              <div className="border-t border-amber-500/20 bg-amber-50/50 px-3 py-2 dark:border-amber-500/20 dark:bg-amber-950/20">
                <div className="flex items-center gap-1.5 text-[10px] font-medium text-amber-700 dark:text-amber-300">
                  <ShieldAlert className="size-3" />
                  <span>待审批队列</span>
                  <span className="font-mono tabular-nums">
                    {pendingApprovals.length}
                  </span>
                  <span className="ml-auto text-[9px] font-normal text-amber-700/70 dark:text-amber-300/70">
                    点击跳转到对应会话
                  </span>
                </div>
                <div className="mt-1.5 flex gap-1.5 overflow-x-auto pb-0.5">
                  {pendingApprovals.map((approval) => {
                    const name =
                      readPayloadText(approval.payload, 'item_name') ??
                      readPayloadText(approval.payload, 'name') ??
                      '高额订单'
                    const amount = readPayloadNumber(
                      approval.payload,
                      'amount',
                    )
                    return (
                      <button
                        key={approval.approval_id}
                        type="button"
                        onClick={() => handleJumpToThread(approval.thread_id)}
                        className={cn(
                          'shrink-0 rounded-md border border-amber-500/30 bg-background/70 px-2 py-1 text-left transition-colors hover:bg-background',
                          approval.thread_id === currentThreadId &&
                            'ring-1 ring-amber-500/50',
                        )}
                      >
                        <span className="block max-w-[150px] truncate text-[10.5px] font-medium text-foreground">
                          {name}
                        </span>
                        <span className="block font-mono text-[9px] tabular-nums text-muted-foreground">
                          #{approval.approval_id} · {formatCurrency(amount)}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
            ) : null}
          </header>

          {!user ? (
            <div className="flex flex-1 items-center justify-center px-6">
              <div className="w-full max-w-xs text-center">
                <div className="mx-auto flex size-10 items-center justify-center rounded-full border border-border bg-muted/40">
                  <ShieldAlert className="size-4 text-muted-foreground" />
                </div>
                <h3 className="mt-4 text-sm font-medium text-foreground">
                  登录后开启 AI 导购
                </h3>
                <p className="mt-1.5 text-[11px] leading-5 text-muted-foreground">
                  AI 导购会读取你的订单与长期偏好记忆，并可能触发高额订单人工审批，需要登录后使用。
                </p>
                <Button asChild size="sm" className="mt-4">
                  <Link to="/login">前往登录</Link>
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div
                ref={scrollRef}
                onScroll={handleScroll}
                className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
              >
                {isHydrating && messages.length === 0 ? (
                  <div className="space-y-4 px-4 py-5">
                    <div className="flex justify-end">
                      <Skeleton className="h-9 w-2/5 rounded-2xl" />
                    </div>
                    <div className="space-y-2">
                      <Skeleton className="h-2.5 w-24" />
                      <Skeleton className="h-3 w-full" />
                      <Skeleton className="h-3 w-5/6" />
                      <Skeleton className="h-3 w-2/3" />
                    </div>
                  </div>
                ) : status === 'error' &&
                  messages.length === 0 &&
                  errorMessage ? (
                  <div className="px-4 py-5">
                    <Alert variant="destructive">
                      <ShieldAlert />
                      <AlertTitle className="text-xs">会话加载失败</AlertTitle>
                      <AlertDescription className="text-[11px] leading-5">
                        {errorMessage}
                      </AlertDescription>
                    </Alert>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="mt-3 gap-1.5"
                      onClick={() => void hydrateThread()}
                    >
                      <RotateCcw className="size-3.5" />
                      重新加载会话
                    </Button>
                  </div>
                ) : messages.length === 0 && threadApprovals.length === 0 ? (
                  <div className="px-4 py-8">
                    <div className="text-center">
                      <div className="mx-auto flex size-9 items-center justify-center rounded-full border border-border bg-muted/40">
                        <Sparkles className="size-4 text-foreground" />
                      </div>
                      <h3 className="mt-3 text-[13px] font-medium text-foreground">
                        今天想找点什么？
                      </h3>
                      <p className="mx-auto mt-1 max-w-[280px] text-[11px] leading-5 text-muted-foreground">
                        AI 会检索在售商品、核对交易规则；高额订单必须先由你确认。
                      </p>
                    </div>

                    <div className="mt-5 grid gap-2">
                      {SUGGESTIONS.map((suggestion) => (
                        <button
                          key={suggestion.prompt}
                          type="button"
                          onClick={() => {
                            stickToBottom.current = true
                            void sendMessage(suggestion.prompt)
                          }}
                          className="group flex items-start gap-2.5 rounded-lg border border-border bg-card px-3 py-2.5 text-left transition-colors hover:bg-accent/50 focus-visible:ring-[2px] focus-visible:ring-ring/40 focus-visible:outline-none"
                        >
                          <suggestion.icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                          <span className="min-w-0 flex-1">
                            <span className="block text-[11.5px] font-medium leading-5 text-foreground">
                              {suggestion.title}
                            </span>
                            <span className="mt-0.5 block text-[10px] leading-4 text-muted-foreground">
                              {suggestion.hint}
                            </span>
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-5 px-4 py-4">
                    {messages.map((message) => (
                      <MessageBubble
                        key={message.id}
                        message={message}
                        onRetry={(messageId) => void retryMessage(messageId)}
                      />
                    ))}

                    {threadApprovals.length > 0 ? (
                      <div className="space-y-2.5">
                        {threadApprovals.map((approval) => (
                          <ApprovalCard
                            key={approval.approval_id}
                            approval={approval}
                            decision={approvalDecisions[approval.approval_id]}
                            isDeciding={decidingApprovalIds.includes(
                              approval.approval_id,
                            )}
                            onDecide={(approvalId, approved, comment) =>
                              decideApproval(
                                approval.thread_id,
                                approvalId,
                                approved,
                                comment,
                              )
                            }
                            onResubmit={(record) =>
                              resubmitApprovalOrder(record)
                            }
                            onRefreshStatus={(record) =>
                              refreshApprovalStatus(record)
                            }
                          />
                        ))}
                      </div>
                    ) : null}
                  </div>
                )}
              </div>

              <div className="shrink-0 border-t border-border bg-background px-3 py-2.5">
                {isInterrupted ? (
                  <div className="mb-2 flex items-start gap-1.5 rounded-md border border-amber-500/30 bg-amber-50/60 px-2.5 py-1.5 dark:border-amber-500/25 dark:bg-amber-950/20">
                    <ShieldAlert className="mt-0.5 size-3 shrink-0 text-amber-600 dark:text-amber-400" />
                    <p className="text-[10px] leading-4 text-amber-800 dark:text-amber-300">
                      当前会话有待审批的高额订单，请先在上方卡片完成审批。
                    </p>
                  </div>
                ) : null}

                <div className="rounded-xl border border-border bg-card shadow-xs transition-[color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/25">
                  <Textarea
                    ref={textareaRef}
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (
                        event.key === 'Enter' &&
                        !event.shiftKey &&
                        !event.nativeEvent.isComposing
                      ) {
                        event.preventDefault()
                        handleSend()
                      }
                    }}
                    rows={1}
                    maxLength={4000}
                    disabled={isInterrupted || isHydrating}
                    placeholder={
                      isInterrupted
                        ? '请先完成上方审批后再继续对话'
                        : '问点什么，例如：预算 500 元以内推荐在售键盘'
                    }
                    className="max-h-40 min-h-[42px] resize-none border-0 bg-transparent px-3 py-2.5 text-[13px] leading-6 shadow-none focus-visible:ring-0 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-transparent"
                  />
                  <div className="flex items-center justify-between gap-2 px-2 pb-2">
                    <span
                      className={cn(
                        'font-mono text-[9.5px] tabular-nums',
                        draft.length > 3800
                          ? 'text-amber-600 dark:text-amber-400'
                          : 'text-muted-foreground/70',
                      )}
                    >
                      {draft.length} / 4000
                    </span>

                    {isStreaming ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={stopStreaming}
                        className="h-7 gap-1.5 px-2 text-[11px]"
                      >
                        <Square className="size-3 fill-current" />
                        停止生成
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        size="icon-sm"
                        onClick={handleSend}
                        disabled={!canSend}
                        aria-label="发送消息"
                        className="size-7 rounded-lg"
                      >
                        <SendHorizontal className="size-3.5" />
                      </Button>
                    )}
                  </div>
                </div>

                <p className="mt-1.5 text-center text-[9.5px] text-muted-foreground">
                  Enter 发送 · Shift + Enter 换行 · 高额订单需人工确认
                </p>
              </div>
            </>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

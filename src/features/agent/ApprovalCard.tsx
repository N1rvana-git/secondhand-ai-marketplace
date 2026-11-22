import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  CheckCircle2,
  Clock,
  ExternalLink,
  Loader2,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  formatCountdown,
  formatCurrency,
  parseServerDate,
  readApprovalAddress,
  readPayloadNumber,
  readPayloadText,
} from '@/features/agent/agent-meta'
import { cn } from '@/lib/utils'
import type {
  ApprovalDecision,
  DecideApprovalResult,
} from '@/stores/agent'
import type { ApprovalRecord } from '@/types/api'

interface ApprovalCardProps {
  approval: ApprovalRecord
  decision?: ApprovalDecision
  isDeciding: boolean
  onDecide: (
    approvalId: number,
    approved: boolean,
    comment: string,
  ) => Promise<DecideApprovalResult>
  /** 终态（拒绝 / 失效 / 执行失败）下确定性重提该订单。 */
  onResubmit?: (approval: ApprovalRecord) => void | Promise<void>
  /** executing 态主动对账线程状态与全局审批队列。 */
  onRefreshStatus?: (approval: ApprovalRecord) => void | Promise<void>
}

export function ApprovalCard({
  approval,
  decision,
  isDeciding,
  onDecide,
  onResubmit,
  onRefreshStatus,
}: ApprovalCardProps) {
  const [comment, setComment] = useState('')
  const [pendingAction, setPendingAction] = useState<
    'approve' | 'reject' | null
  >(null)
  const [isResubmitting, setIsResubmitting] = useState(false)
  const [isRefreshingStatus, setIsRefreshingStatus] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  const displayStatus: ApprovalRecord['status'] = decision
    ? decision.status === 'stale'
      ? 'expired'
      : decision.status
    : approval.status

  const isPending = displayStatus === 'pending'
  const isExecuting = displayStatus === 'executing'
  const isFailed = displayStatus === 'failed'
  const isResolved = !isPending && !isExecuting
  const isLocked = isDeciding || pendingAction != null || !isPending

  useEffect(() => {
    if (isResolved) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [isResolved])

  const payload = approval.payload ?? {}
  const itemName =
    readPayloadText(payload, 'item_name') ??
    readPayloadText(payload, 'name') ??
    '高额交易订单'
  const quantity = readPayloadNumber(payload, 'quantity')
  const unitPrice = readPayloadNumber(payload, 'unit_price')
  const amount = readPayloadNumber(payload, 'amount')
  const threshold = readPayloadNumber(payload, 'threshold')
  const address = readApprovalAddress(payload)
  const failureReason =
    decision?.message ??
    approval.decision_comment ??
    '订单执行失败，请重新发起购买。'
  const resolvedOrderId = decision?.orderId ?? approval.resolved_order_id
  const itemId = readPayloadText(payload, 'item_id')
  const isTerminal =
    displayStatus === 'rejected' ||
    displayStatus === 'expired' ||
    displayStatus === 'failed'
  // 拒绝 / 失效 / 执行失败后，用确定性 UI 让用户重新发起同一笔订单，
  // 不再依赖 LLM 对历史上下文的判断。
  const canResubmit = isTerminal && itemId != null

  const expiresAt = parseServerDate(approval.expires_at)
  const remainingMs = expiresAt ? expiresAt.getTime() - now : null
  const isExpired = remainingMs != null && remainingMs <= 0
  const isUrgent =
    remainingMs != null && remainingMs > 0 && remainingMs <= 60_000

  const handleResubmit = async () => {
    if (!onResubmit || isResubmitting) return
    setIsResubmitting(true)
    try {
      await onResubmit(approval)
    } finally {
      setIsResubmitting(false)
    }
  }

  const handleRefreshStatus = async () => {
    if (!onRefreshStatus || isRefreshingStatus) return
    setIsRefreshingStatus(true)
    try {
      await onRefreshStatus(approval)
    } finally {
      setIsRefreshingStatus(false)
    }
  }

  const handleDecide = async (approved: boolean) => {
    if (isLocked) return
    setPendingAction(approved ? 'approve' : 'reject')
    const result = await onDecide(approval.approval_id, approved, comment)
    setPendingAction(null)

    if (result.ok) {
      toast.success(approved ? '已批准并完成下单' : '已拒绝该笔订单', {
        description: approved
          ? result.orderId != null
            ? `订单 #${result.orderId} 已创建，交易广场库存已同步。`
            : '审批已通过。'
          : '该笔高额订单不会被执行。',
      })
      return
    }

    // 失败提示统一由 stores/agent 的 showApiErrorToast 透出（含 Trace ID），
    // 卡片只负责状态降级，避免重复 toast。
  }

  return (
    <div className="overflow-hidden rounded-xl border border-amber-500/40 bg-amber-50/40 dark:border-amber-500/30 dark:bg-amber-950/20">
      <div className="flex items-center gap-2 border-b border-amber-500/25 px-3.5 py-2.5">
        <ShieldAlert className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
        <span className="text-[11px] font-semibold tracking-tight text-amber-900 dark:text-amber-200">
          高额订单人工审批
        </span>
        <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-amber-700/70 dark:text-amber-400/70">
          #{approval.approval_id}
        </span>

        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          {isExecuting ? (
            <Badge
              variant="warning"
              className="gap-1 px-1.5 py-0 text-[9.5px]"
            >
              <Loader2 className="size-2.5 animate-spin" />
              执行中
            </Badge>
          ) : isFailed ? (
            <Badge variant="danger" className="px-1.5 py-0 text-[9.5px]">
              执行失败
            </Badge>
          ) : displayStatus === 'approved' ? (
            <Badge variant="success" className="px-1.5 py-0 text-[9.5px]">
              已通过
            </Badge>
          ) : displayStatus === 'rejected' ? (
            <Badge variant="danger" className="px-1.5 py-0 text-[9.5px]">
              已拒绝
            </Badge>
          ) : displayStatus === 'expired' ? (
            <Badge variant="outline" className="px-1.5 py-0 text-[9.5px]">
              已失效
            </Badge>
          ) : (
            <Badge
              variant="warning"
              className="px-1.5 py-0 text-[9.5px]"
            >
              待审批
            </Badge>
          )}
          {isPending ? (
            <span
              className={cn(
                'inline-flex items-center gap-1 font-mono text-[10px] tabular-nums',
                isExpired
                  ? 'text-rose-600 dark:text-rose-400'
                  : isUrgent
                    ? 'text-amber-700 dark:text-amber-300'
                    : 'text-muted-foreground',
              )}
            >
              <Clock className="size-2.5" />
              {remainingMs == null
                ? '--:--'
                : isExpired
                  ? '已过期'
                  : formatCountdown(remainingMs)}
            </span>
          ) : null}
        </span>
      </div>

      <div className="space-y-3 px-3.5 py-3">
        <div>
          <p className="text-[13px] font-semibold leading-5 text-foreground">
            {itemName}
          </p>
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            该笔交易金额超过风控阈值，需要你显式确认后才会创建订单。
          </p>
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5">
          <div>
            <dt className="text-[9.5px] uppercase tracking-[0.12em] text-muted-foreground">
              数量
            </dt>
            <dd className="mt-0.5 font-mono text-[12px] tabular-nums text-foreground">
              {quantity ?? '—'}
            </dd>
          </div>
          <div>
            <dt className="text-[9.5px] uppercase tracking-[0.12em] text-muted-foreground">
              单价
            </dt>
            <dd className="mt-0.5 font-mono text-[12px] tabular-nums text-foreground">
              {formatCurrency(unitPrice)}
            </dd>
          </div>
          <div>
            <dt className="text-[9.5px] uppercase tracking-[0.12em] text-muted-foreground">
              总金额
            </dt>
            <dd className="mt-0.5 font-mono text-[14px] font-semibold tabular-nums text-amber-900 dark:text-amber-200">
              {formatCurrency(amount)}
            </dd>
          </div>
          <div>
            <dt className="text-[9.5px] uppercase tracking-[0.12em] text-muted-foreground">
              触发阈值
            </dt>
            <dd className="mt-0.5 font-mono text-[12px] tabular-nums text-foreground">
              {formatCurrency(threshold)}
            </dd>
          </div>
        </dl>

        {address ? (
          <div className="rounded-md border border-amber-500/25 bg-background/60 px-2.5 py-2">
            <p className="text-[9.5px] uppercase tracking-[0.12em] text-muted-foreground">
              收货地址
            </p>
            <p className="mt-0.5 text-[11px] leading-5 text-foreground/90">
              {address}
            </p>
          </div>
        ) : null}

        {approval.reason ? (
          <div>
            <p className="text-[9.5px] uppercase tracking-[0.12em] text-muted-foreground">
              审批原因
            </p>
            <p className="mt-0.5 text-[11px] leading-5 text-foreground/90">
              {approval.reason}
            </p>
          </div>
        ) : null}

        {isExecuting ? (
          <div className="flex items-center gap-2 rounded-md border border-amber-500/25 bg-background/60 px-2.5 py-2">
            <Loader2 className="size-3.5 shrink-0 animate-spin text-amber-600 dark:text-amber-400" />
            <span className="text-[11px] font-medium text-amber-800 dark:text-amber-300">
              订单执行中…
            </span>
          </div>
        ) : null}

        {isFailed ? (
          <div className="flex items-start gap-2 rounded-md border border-rose-500/25 bg-rose-50/60 px-2.5 py-2 dark:border-rose-500/20 dark:bg-rose-950/20">
            <XCircle className="mt-0.5 size-3.5 shrink-0 text-rose-600 dark:text-rose-400" />
            <div className="min-w-0">
              <p className="text-[11px] font-medium text-rose-700 dark:text-rose-300">
                执行失败
              </p>
              <p className="mt-0.5 break-words text-[10px] leading-4 text-rose-700/80 dark:text-rose-300/80">
                {failureReason}
              </p>
            </div>
          </div>
        ) : null}

        {displayStatus === 'approved' ? (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-emerald-600/25 bg-emerald-50/70 px-2.5 py-2 dark:border-emerald-500/25 dark:bg-emerald-950/25">
            <CheckCircle2 className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <span className="text-[11px] font-medium text-emerald-800 dark:text-emerald-300">
              审批已通过
            </span>
            {resolvedOrderId != null ? (
              <Link
                to="/studio"
                className="ml-auto inline-flex items-center gap-1 rounded-md border border-emerald-600/25 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-emerald-800 transition-colors hover:bg-emerald-100/70 dark:border-emerald-500/25 dark:text-emerald-300 dark:hover:bg-emerald-900/30"
              >
                订单 #{resolvedOrderId}
                <ExternalLink className="size-2.5" />
              </Link>
            ) : null}
          </div>
        ) : null}

        {displayStatus === 'rejected' ? (
          <div className="flex items-center gap-2 rounded-md border border-rose-500/20 bg-rose-50/60 px-2.5 py-2 dark:border-rose-500/20 dark:bg-rose-950/20">
            <XCircle className="size-3.5 shrink-0 text-rose-600 dark:text-rose-400" />
            <span className="text-[11px] text-rose-700 dark:text-rose-300">
              已拒绝，未创建订单
            </span>
          </div>
        ) : null}

        {displayStatus === 'expired' ? (
          <div className="flex items-start gap-2 rounded-md border border-rose-500/25 bg-rose-50/60 px-2.5 py-2 dark:border-rose-500/20 dark:bg-rose-950/20">
            <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-rose-600 dark:text-rose-400" />
            <div className="min-w-0">
              <p className="text-[11px] font-medium text-rose-700 dark:text-rose-300">
                该审批已失效或已被处理
              </p>
              <p className="mt-0.5 text-[10px] leading-4 text-rose-700/80 dark:text-rose-300/80">
                {decision?.message ?? '请刷新会话以同步最新状态。'}
              </p>
            </div>
          </div>
        ) : null}

        {isPending || isExecuting ? (
          <>
            <div>
              <label
                htmlFor={`approval-comment-${approval.approval_id}`}
                className="text-[9.5px] uppercase tracking-[0.12em] text-muted-foreground"
              >
                审批备注（可选）
              </label>
              <Textarea
                id={`approval-comment-${approval.approval_id}`}
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                disabled={isLocked}
                rows={2}
                maxLength={200}
                placeholder="例如：地址已核对，同意下单"
                className="mt-1 min-h-[52px] resize-none border-amber-500/30 bg-background/70 text-[11px] leading-5 shadow-none focus-visible:border-amber-500/60 focus-visible:ring-amber-500/20 dark:bg-background/40"
              />
            </div>

            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                disabled={isLocked}
                onClick={() => void handleDecide(true)}
                className="h-8 flex-1 gap-1.5 bg-amber-600 text-white shadow-none hover:bg-amber-700 dark:bg-amber-500 dark:text-amber-950 dark:hover:bg-amber-400"
              >
                {pendingAction === 'approve' ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <ShieldCheck className="size-3.5" />
                )}
                批准并下单
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isLocked}
                onClick={() => void handleDecide(false)}
                className="h-8 flex-1 gap-1.5 border-amber-500/40 bg-background/60 text-foreground shadow-none hover:bg-amber-100/60 dark:hover:bg-amber-950/30"
              >
                {pendingAction === 'reject' ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <XCircle className="size-3.5" />
                )}
                拒绝操作
              </Button>
            </div>
          </>
        ) : null}

        {decision?.comment ? (
          <p className="border-t border-amber-500/20 pt-2 text-[10px] leading-4 text-muted-foreground">
            备注：{decision.comment}
          </p>
        ) : null}

        {canResubmit || isExecuting ? (
          <div className="flex flex-wrap items-center gap-2 border-t border-amber-500/20 pt-2">
            {canResubmit ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isResubmitting || !onResubmit}
                onClick={() => void handleResubmit()}
                className="h-7 gap-1.5 border-amber-500/40 bg-background/60 px-2 text-[10.5px] text-foreground shadow-none hover:bg-amber-100/60 dark:hover:bg-amber-950/30"
              >
                {isResubmitting ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <RotateCcw className="size-3" />
                )}
                重新提交该订单
              </Button>
            ) : null}

            {isExecuting ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isRefreshingStatus || !onRefreshStatus}
                onClick={() => void handleRefreshStatus()}
                className="h-7 gap-1.5 border-amber-500/40 bg-background/60 px-2 text-[10.5px] text-foreground shadow-none hover:bg-amber-100/60 dark:hover:bg-amber-950/30"
              >
                {isRefreshingStatus ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <RefreshCw className="size-3" />
                )}
                刷新状态
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}

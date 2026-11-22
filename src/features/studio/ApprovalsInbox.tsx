import { useEffect, useMemo, useState } from 'react'
import {
  ExternalLink,
  Loader2,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ApprovalCard } from '@/features/agent/ApprovalCard'
import { useAgentStore } from '@/stores/agent'
import type { ApprovalRecord } from '@/types/api'

interface ApprovalsInboxProps {
  /** 审批通过后刷新 Dashboard，让新订单立即出现在「我的订单」Tab。 */
  onApprovalDecided: () => void
}

export function ApprovalsInbox({ onApprovalDecided }: ApprovalsInboxProps) {
  const pendingApprovals = useAgentStore((state) => state.pendingApprovals)
  const approvalDecisions = useAgentStore((state) => state.approvalDecisions)
  const decidingApprovalIds = useAgentStore(
    (state) => state.decidingApprovalIds,
  )
  const fetchGlobalApprovals = useAgentStore(
    (state) => state.fetchGlobalApprovals,
  )
  const decideApproval = useAgentStore((state) => state.decideApproval)
  const refreshApprovalStatus = useAgentStore(
    (state) => state.refreshApprovalStatus,
  )
  const resubmitApprovalOrder = useAgentStore(
    (state) => state.resubmitApprovalOrder,
  )
  const setOpen = useAgentStore((state) => state.setOpen)
  const switchThread = useAgentStore((state) => state.switchThread)

  const [resolvedRecords, setResolvedRecords] = useState<ApprovalRecord[]>([])
  const [isRefreshing, setIsRefreshing] = useState(false)

  // 单一真相源：进入收件箱时拉取全局待审批，列表直接复用 Phase 3 store。
  useEffect(() => {
    void fetchGlobalApprovals()
  }, [fetchGlobalApprovals])

  const records = useMemo(() => {
    const merged = new Map<number, ApprovalRecord>()
    for (const record of resolvedRecords) {
      merged.set(record.approval_id, record)
    }
    for (const record of pendingApprovals) {
      merged.set(record.approval_id, record)
    }
    return [...merged.values()].sort(
      (a, b) => b.approval_id - a.approval_id,
    )
  }, [pendingApprovals, resolvedRecords])

  const refresh = async () => {
    setIsRefreshing(true)
    try {
      await fetchGlobalApprovals()
    } finally {
      setIsRefreshing(false)
    }
  }

  const openInCopilot = (threadId: string) => {
    setOpen(true)
    void switchThread(threadId)
  }

  const handleDecide = async (
    approval: ApprovalRecord,
    approved: boolean,
    comment: string,
  ) => {
    // 保留一份本地快照，批准后即使服务端列表移除了记录，卡片仍展示结果态。
    setResolvedRecords((current) =>
      current.some((record) => record.approval_id === approval.approval_id)
        ? current
        : [approval, ...current],
    )

    const result = await decideApproval(
      approval.thread_id,
      approval.approval_id,
      approved,
      comment,
    )

    if (result.ok && approved) onApprovalDecided()
    return result
  }

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <header className="flex items-start justify-between gap-3 border-b border-border/70 px-4 py-3.5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-3.5 text-muted-foreground" />
            <h2 className="text-[13px] font-semibold tracking-tight text-foreground">
              待审批收件箱
            </h2>
            <Badge
              variant={pendingApprovals.length > 0 ? 'warning' : 'secondary'}
              className="px-1.5 font-mono text-[10px] tabular-nums"
            >
              {pendingApprovals.length}
            </Badge>
          </div>
          <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
            与 AI 导购共用同一份审批数据；高额订单必须在这里显式确认。
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="刷新待审批列表"
          title="刷新待审批列表"
          disabled={isRefreshing}
          onClick={() => void refresh()}
          className="shrink-0 text-muted-foreground"
        >
          <RefreshCw
            className={isRefreshing ? 'size-3.5 animate-spin' : 'size-3.5'}
          />
        </Button>
      </header>

      {records.length === 0 ? (
        <div className="px-6 py-16 text-center">
          <div className="mx-auto flex size-10 items-center justify-center rounded-full border border-border bg-emerald-50 dark:bg-emerald-950/30">
            <ShieldCheck className="size-4 text-emerald-600 dark:text-emerald-400" />
          </div>
          <p className="mt-4 text-sm font-medium text-foreground">
            没有待审批事项
          </p>
          <p className="mx-auto mt-1.5 max-w-sm text-xs leading-5 text-muted-foreground">
            AI 导购触发高额订单风控时，审批卡片会自动出现在这里。
          </p>
        </div>
      ) : (
        <div className="grid gap-3 p-4 xl:grid-cols-2">
          {records.map((approval) => (
            <div key={approval.approval_id} className="space-y-2">
              <ApprovalCard
                approval={approval}
                decision={approvalDecisions[approval.approval_id]}
                isDeciding={decidingApprovalIds.includes(
                  approval.approval_id,
                )}
                onDecide={(_approvalId, approved, comment) =>
                  handleDecide(approval, approved, comment)
                }
                onResubmit={(record) => resubmitApprovalOrder(record)}
                onRefreshStatus={(record) => refreshApprovalStatus(record)}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 w-full gap-1.5 text-[11px] text-muted-foreground hover:text-foreground"
                onClick={() => openInCopilot(approval.thread_id)}
              >
                <ExternalLink className="size-3" />
                在 Copilot 中定位该会话
                <span className="font-mono text-[9px] text-muted-foreground/70">
                  {approval.thread_id}
                </span>
              </Button>
            </div>
          ))}
        </div>
      )}

      {isRefreshing && records.length > 0 ? (
        <div className="flex items-center justify-center gap-1.5 border-t border-border/70 px-4 py-2 text-[10px] text-muted-foreground">
          <Loader2 className="size-3 animate-spin" />
          正在同步审批状态
        </div>
      ) : null}
    </section>
  )
}

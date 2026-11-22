import { useCallback, useEffect, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  RefreshCw,
  ServerCog,
} from 'lucide-react'
import { getApiErrorMessage } from '@/api/client'
import { getReadiness } from '@/api/dashboard'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { formatDateTime } from '@/lib/format'
import type { ReadinessResponse } from '@/types/api'

function statusVariant(
  status: string,
): 'success' | 'warning' | 'danger' | 'secondary' {
  if (status === 'ok') return 'success'
  if (status === 'degraded') return 'warning'
  return 'danger'
}

function statusLabel(status: string): string {
  if (status === 'ok') return '运行正常'
  if (status === 'degraded') return '部分降级'
  return status || '未知'
}

export function SystemReadinessCard() {
  const [readiness, setReadiness] = useState<ReadinessResponse | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const load = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      // 503 也携带合法 ReadinessResponse，getReadiness 已放行该状态码。
      setReadiness(await getReadiness())
    } catch (loadError) {
      setError(getApiErrorMessage(loadError))
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load, reloadKey])

  const status = readiness?.status ?? 'unknown'
  const variant = statusVariant(status)

  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-b border-border/70 pb-4">
        <div className="flex items-center gap-2">
          <Activity className="size-3.5 text-muted-foreground" />
          <CardTitle className="text-[13px]">系统运行时探针</CardTitle>
          {readiness ? (
            <Badge variant={variant} className="ml-1 gap-1 text-[10px]">
              <span
                className={cn(
                  'size-1 rounded-full',
                  status === 'ok'
                    ? 'bg-emerald-500'
                    : status === 'degraded'
                      ? 'bg-amber-500'
                      : 'bg-rose-500',
                )}
              />
              {statusLabel(status)}
              <span className="font-mono text-[9px] opacity-70">
                {status}
              </span>
            </Badge>
          ) : null}
        </div>
        <CardDescription className="text-[11px] leading-5">
          通过 GET /health/ready 检查数据库、Redis 等依赖；degraded 仍返回完整明细。
        </CardDescription>
        <CardAction>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="刷新系统探针"
            title="刷新系统探针"
            disabled={isLoading}
            onClick={() => setReloadKey((key) => key + 1)}
            className="text-muted-foreground"
          >
            <RefreshCw
              className={cn('size-3.5', isLoading && 'animate-spin')}
            />
          </Button>
        </CardAction>
      </CardHeader>

      <CardContent className="space-y-4 pt-4">
        {error ? (
          <Alert variant="destructive" className="py-2.5">
            <AlertTriangle />
            <AlertTitle className="text-xs">探针请求失败</AlertTitle>
            <AlertDescription className="flex items-center justify-between gap-3 text-[11px]">
              <span className="truncate">{error}</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 shrink-0 px-1.5 text-[11px]"
                onClick={() => setReloadKey((key) => key + 1)}
              >
                重试
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="grid gap-2 sm:grid-cols-3">
          {[
            {
              label: '运行环境',
              value: readiness?.environment ?? '—',
              mono: true,
            },
            {
              label: '版本号',
              value: readiness?.version ?? '—',
              mono: true,
            },
            {
              label: '最近探测',
              value: readiness ? formatDateTime(readiness.timestamp) : '—',
              mono: true,
            },
          ].map((entry) => (
            <div
              key={entry.label}
              className="rounded-lg border border-border/70 bg-muted/20 px-3 py-2.5"
            >
              <p className="text-[9.5px] uppercase tracking-[0.12em] text-muted-foreground">
                {entry.label}
              </p>
              {isLoading && !readiness ? (
                <Skeleton className="mt-1.5 h-3.5 w-20" />
              ) : (
                <p
                  className={cn(
                    'mt-1 text-[12px] font-medium text-foreground',
                    entry.mono && 'font-mono tabular-nums',
                  )}
                >
                  {entry.value}
                </p>
              )}
            </div>
          ))}
        </div>

        {isLoading && !readiness ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {Array.from({ length: 2 }).map((_, index) => (
              <div
                key={index}
                className="rounded-lg border border-border/70 px-3 py-2.5"
              >
                <Skeleton className="h-3.5 w-24" />
                <Skeleton className="mt-2 h-3 w-40" />
              </div>
            ))}
          </div>
        ) : readiness && readiness.checks.length > 0 ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {readiness.checks.map((check) => (
              <div
                key={check.name}
                className="flex items-start justify-between gap-3 rounded-lg border border-border/70 bg-background px-3 py-2.5"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    {check.ok ? (
                      <CheckCircle2 className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                    ) : (
                      <AlertTriangle className="size-3.5 shrink-0 text-rose-600 dark:text-rose-400" />
                    )}
                    <p className="truncate font-mono text-[11.5px] font-medium text-foreground">
                      {check.name}
                    </p>
                  </div>
                  {check.detail ? (
                    <p className="mt-1 line-clamp-1 text-[10px] leading-4 text-muted-foreground">
                      {check.detail}
                    </p>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="font-mono text-[10.5px] tabular-nums text-muted-foreground">
                    {check.latency_ms} ms
                  </span>
                  <Badge
                    variant={check.ok ? 'success' : 'danger'}
                    className="px-1.5 py-0 text-[9.5px]"
                  >
                    {check.ok ? '正常' : '异常'}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        ) : readiness && readiness.checks.length === 0 ? (
          <div className="flex items-center gap-2 rounded-lg border border-border/70 bg-muted/20 px-3 py-3 text-[11px] text-muted-foreground">
            <ServerCog className="size-3.5" />
            后端未返回依赖探针明细。
          </div>
        ) : null}

        {isLoading && readiness ? (
          <div className="flex items-center justify-center gap-1.5 text-[10px] text-muted-foreground">
            <Loader2 className="size-3 animate-spin" />
            正在刷新探针
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

import { RefreshCw, Server, Tags } from 'lucide-react'
import { API_BASE_URL } from '@/api/client'
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
import { cn } from '@/lib/utils'
import { formatTime } from '@/lib/format'
import {
  useBackendHealth,
  type BackendStatus,
} from '@/hooks/use-backend-health'

const statusConfig: Record<
  BackendStatus,
  {
    label: string
    variant: 'secondary' | 'success' | 'warning' | 'danger'
    dot: string
  }
> = {
  checking: {
    label: '检测中',
    variant: 'secondary',
    dot: 'bg-muted-foreground',
  },
  online: {
    label: '已连接',
    variant: 'success',
    dot: 'bg-emerald-500',
  },
  degraded: {
    label: '部分可用',
    variant: 'warning',
    dot: 'bg-amber-500',
  },
  offline: {
    label: '未连接',
    variant: 'danger',
    dot: 'bg-rose-500',
  },
}

interface ServiceRowProps {
  label: string
  path: string
  checking: boolean
  ok: boolean
  detail: string | null
  error: string | null
}

function ServiceRow({
  label,
  path,
  checking,
  ok,
  detail,
  error,
}: ServiceRowProps) {
  const stateLabel = checking ? '检测中' : ok ? '正常' : '失败'

  return (
    <div className="flex items-start justify-between gap-3 rounded-md border border-border/80 bg-background/40 px-3 py-2.5">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'size-1.5 shrink-0 rounded-full',
              checking
                ? 'bg-muted-foreground'
                : ok
                  ? 'bg-emerald-500'
                  : 'bg-rose-500',
            )}
          />
          <p className="text-xs font-medium text-foreground">{label}</p>
        </div>
        <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">
          {path}
        </p>
        {detail ? (
          <p className="mt-1 text-[11px] tabular-nums text-muted-foreground">
            {detail}
          </p>
        ) : null}
        {error ? (
          <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-rose-600 dark:text-rose-400">
            {error}
          </p>
        ) : null}
      </div>
      <span
        className={cn(
          'shrink-0 text-[11px] tabular-nums',
          checking
            ? 'text-muted-foreground'
            : ok
              ? 'text-emerald-600 dark:text-emerald-400'
              : 'text-rose-600 dark:text-rose-400',
        )}
      >
        {stateLabel}
      </span>
    </div>
  )
}

export function BackendStatusCard() {
  const health = useBackendHealth()
  const config = statusConfig[health.status]
  const checking = health.status === 'checking'

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-0">
        <div className="flex items-center gap-2">
          <Server className="size-4 text-muted-foreground" />
          <CardTitle>后端连通性</CardTitle>
        </div>
        <CardDescription>
          通过 REST 契约实时验证前后端联调链路。
        </CardDescription>
        <CardAction>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={health.refresh}
            disabled={checking}
            aria-label="重新检测后端连通性"
            className="text-muted-foreground"
          >
            <RefreshCw
              className={cn('size-3.5', checking && 'animate-spin')}
            />
          </Button>
        </CardAction>
      </CardHeader>

      <CardContent className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-muted-foreground">
            {health.latencyMs === null
              ? '等待响应'
              : `往返 ${health.latencyMs} ms`}
          </span>
          <Badge variant={config.variant} className="gap-1.5">
            <span className={cn('size-1 rounded-full', config.dot)} />
            {config.label}
          </Badge>
        </div>

        <div className="rounded-md border border-border/80 bg-muted/30 px-3 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <Tags className="size-3.5 text-muted-foreground" />
              <span className="text-[11px] font-medium text-foreground">
                标签列表
              </span>
            </div>
            <span className="text-[10px] tabular-nums text-muted-foreground">
              商品 {health.itemTotal ?? '—'} · 标签{' '}
              {health.tagCount ?? '—'}
            </span>
          </div>

          {health.tags.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {health.tags.map((tag) => (
                <Badge key={tag.id} variant="outline">
                  {tag.name}
                </Badge>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-[11px] text-muted-foreground">
              {checking
                ? '正在获取标签…'
                : health.tagsError
                  ? '标签加载失败'
                  : '暂无标签'}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <ServiceRow
            label="商品接口"
            path="GET /items?limit=1"
            checking={checking}
            ok={health.itemTotal !== null}
            detail={
              health.itemTotal === null
                ? null
                : `共 ${health.itemTotal} 件商品`
            }
            error={health.itemsError}
          />
          <ServiceRow
            label="标签接口"
            path="GET /items/tags"
            checking={checking}
            ok={health.tagCount !== null}
            detail={
              health.tagCount === null
                ? null
                : `共 ${health.tagCount} 个标签`
            }
            error={health.tagsError}
          />
        </div>

        <div className="rounded-md border border-border/80 bg-muted/40 px-3 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              API Base
            </span>
            <span className="text-[10px] tabular-nums text-muted-foreground">
              {formatTime(health.checkedAt)}
            </span>
          </div>
          <code className="mt-1 block break-all font-mono text-[10px] leading-4 text-foreground/80">
            {API_BASE_URL}
          </code>
        </div>

        {health.status === 'offline' ? (
          <p className="text-[11px] leading-5 text-muted-foreground">
            请确认 FastAPI 服务已在{' '}
            <span className="font-mono text-foreground">localhost:8000</span>{' '}
            启动，并允许当前来源跨域访问。
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}

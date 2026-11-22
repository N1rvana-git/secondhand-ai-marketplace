import { useCallback, useEffect, useState } from 'react'
import {
  AlertTriangle,
  Heart,
  Package,
  Plus,
  RefreshCw,
  ShieldCheck,
  ShoppingBag,
} from 'lucide-react'
import { getApiErrorMessage } from '@/api/client'
import { getMyDashboard } from '@/api/dashboard'
import { PageHeader } from '@/components/app/page-header'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs'
import { ApprovalsInbox } from '@/features/studio/ApprovalsInbox'
import { ItemFormDialog } from '@/features/studio/ItemFormDialog'
import { MyItemsTable } from '@/features/studio/MyItemsTable'
import { MyOrdersTable } from '@/features/studio/MyOrdersTable'
import { cn } from '@/lib/utils'
import { useAgentStore } from '@/stores/agent'
import { useAuthStore } from '@/stores/auth'
import type { DashboardResponse, ItemRead } from '@/types/api'

function formatNumber(value: number | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return new Intl.NumberFormat('zh-CN').format(value)
}

export default function StudioPage() {
  const user = useAuthStore((state) => state.user)
  const pendingApprovals = useAgentStore((state) => state.pendingApprovals)

  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [formOpen, setFormOpen] = useState(false)
  const [editingItem, setEditingItem] = useState<ItemRead | null>(null)

  const fetchDashboard = useCallback(async (mode: 'initial' | 'refresh') => {
    if (mode === 'initial') setIsLoading(true)
    else setIsRefreshing(true)
    setError(null)

    try {
      const data = await getMyDashboard()
      setDashboard(data)
    } catch (loadError) {
      setError(getApiErrorMessage(loadError))
    } finally {
      if (mode === 'initial') setIsLoading(false)
      else setIsRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void fetchDashboard('initial')
  }, [fetchDashboard, reloadKey])

  const refresh = () => void fetchDashboard('refresh')

  const openCreate = () => {
    setEditingItem(null)
    setFormOpen(true)
  }

  const openEdit = (item: ItemRead) => {
    setEditingItem(item)
    setFormOpen(true)
  }

  const handleFormOpenChange = (open: boolean) => {
    setFormOpen(open)
    if (!open) setEditingItem(null)
  }

  const stats = dashboard?.stats
  const isInitialLoading = isLoading && dashboard === null
  const isInitialError = Boolean(error) && dashboard === null && !isLoading

  const kpis = [
    {
      key: 'published',
      label: '在售与历史发布',
      hint: '累计发布商品数',
      value: stats?.published_count,
      icon: Package,
    },
    {
      key: 'orders',
      label: '我的订单数',
      hint: '含 AI 审批生成订单',
      value: stats?.orders_count,
      icon: ShoppingBag,
    },
    {
      key: 'favourites',
      label: '商品累计被收藏',
      hint: '全站买家收藏次数',
      value: stats?.favourites_count,
      icon: Heart,
    },
  ]

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-16 pt-6 sm:px-6 sm:pt-8">
      <PageHeader
        eyebrow="Studio / Phase 4"
        title="个人工作台"
        description={`${user?.username ?? '你'}，在这里管理发布、订单与 AI 高额交易审批。`}
        badge={
          user?.role === 'admin' ? (
            <Badge variant="outline" className="gap-1">
              <ShieldCheck className="size-3" />
              管理员
            </Badge>
          ) : (
            <Badge variant="secondary">卖家工作台</Badge>
          )
        }
        actions={
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isRefreshing}
              onClick={refresh}
            >
              <RefreshCw
                className={cn(
                  'size-3.5',
                  isRefreshing && 'animate-spin',
                )}
              />
              刷新数据
            </Button>
            <Button type="button" size="sm" onClick={openCreate}>
              <Plus className="size-3.5" />
              发布新商品
            </Button>
          </>
        }
      />

      <section aria-label="工作台概览" className="grid gap-3 sm:grid-cols-3">
        {kpis.map((kpi) => {
          const Icon = kpi.icon

          return (
            <div
              key={kpi.key}
              className="rounded-xl border border-border bg-card px-4 py-4"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-[11px] font-medium text-muted-foreground">
                  {kpi.label}
                </p>
                <Icon className="size-3.5 shrink-0 text-muted-foreground" />
              </div>
              <div className="mt-3 h-9">
                {isInitialLoading ? (
                  <Skeleton className="h-8 w-20" />
                ) : (
                  <p className="font-mono text-[30px] font-semibold leading-none tracking-[-0.02em] tabular-nums text-foreground">
                    {formatNumber(kpi.value)}
                  </p>
                )}
              </div>
              <p className="mt-2 text-[10px] text-muted-foreground">
                {kpi.hint}
              </p>
            </div>
          )
        })}
      </section>

      {error ? (
        <Alert variant="destructive" className="mt-4 py-2.5">
          <AlertTriangle />
          <AlertTitle className="text-xs">
            {isInitialError ? '工作台加载失败' : '数据刷新失败'}
          </AlertTitle>
          <AlertDescription className="flex items-center justify-between gap-3 text-[11px]">
            <span className="truncate">{error}</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 shrink-0 px-1.5 text-[11px]"
              onClick={() => {
                if (isInitialError) setReloadKey((key) => key + 1)
                else refresh()
              }}
            >
              重试
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {isInitialLoading ? (
        <div className="mt-6 space-y-3">
          <div className="flex gap-5 border-b border-border/70 pb-3">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-24" />
          </div>
          <div className="rounded-xl border border-border bg-card p-4">
            <Skeleton className="h-4 w-32" />
            {Array.from({ length: 4 }).map((_, index) => (
              <div
                key={index}
                className="mt-3 flex items-center gap-4 border-t border-border/60 pt-3"
              >
                <Skeleton className="h-3.5 w-1/2" />
                <Skeleton className="ml-auto h-3.5 w-16" />
                <Skeleton className="h-5 w-14" />
              </div>
            ))}
          </div>
        </div>
      ) : dashboard ? (
        <Tabs defaultValue="items" className="mt-6 gap-4">
          <TabsList
            variant="line"
            className="h-9 w-full justify-start gap-5 overflow-x-auto border-b border-border/70 p-0"
          >
            <TabsTrigger
              value="items"
              className="h-9 flex-none gap-1.5 px-0 text-xs"
            >
              <Package className="size-3.5" />
              我的发布
              <Badge
                variant="secondary"
                className="px-1.5 font-mono text-[9.5px] tabular-nums"
              >
                {dashboard.my_items.length}
              </Badge>
            </TabsTrigger>
            <TabsTrigger
              value="orders"
              className="h-9 flex-none gap-1.5 px-0 text-xs"
            >
              <ShoppingBag className="size-3.5" />
              我的订单
              <Badge
                variant="secondary"
                className="px-1.5 font-mono text-[9.5px] tabular-nums"
              >
                {dashboard.my_orders.length}
              </Badge>
            </TabsTrigger>
            <TabsTrigger
              value="approvals"
              className="h-9 flex-none gap-1.5 px-0 text-xs"
            >
              <ShieldCheck className="size-3.5" />
              待审批收件箱
              <Badge
                variant={pendingApprovals.length > 0 ? 'warning' : 'secondary'}
                className="px-1.5 font-mono text-[9.5px] tabular-nums"
              >
                {pendingApprovals.length}
              </Badge>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="items">
            <MyItemsTable
              items={dashboard.my_items}
              onCreate={openCreate}
              onEdit={openEdit}
              onChanged={refresh}
            />
          </TabsContent>

          <TabsContent value="orders">
            <MyOrdersTable orders={dashboard.my_orders} />
          </TabsContent>

          <TabsContent value="approvals">
            <ApprovalsInbox onApprovalDecided={refresh} />
          </TabsContent>
        </Tabs>
      ) : null}

      {formOpen ? (
        <ItemFormDialog
          open
          mode={editingItem ? 'edit' : 'create'}
          item={editingItem}
          onOpenChange={handleFormOpenChange}
          onSaved={refresh}
        />
      ) : null}
    </div>
  )
}

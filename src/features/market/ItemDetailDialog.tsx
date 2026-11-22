import { useEffect, useState } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  Heart,
  ImageOff,
  Loader2,
  LogIn,
  Package,
  RefreshCw,
  ScanSearch,
  ShoppingBag,
  Tag,
  type LucideIcon,
} from 'lucide-react'
import { getApiErrorMessage, resolveMediaUrl } from '@/api/client'
import { getItem } from '@/api/items'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { formatDate } from '@/lib/format'
import type { ItemRead } from '@/types/api'
import {
  formatPrice,
  getPurchaseState,
  type FavoriteState,
  type MarketItem,
  type PurchaseKind,
} from '@/features/market/market-utils'

interface ItemDetailDialogProps {
  item: MarketItem | null
  open: boolean
  onOpenChange: (open: boolean) => void
  favorite: FavoriteState | undefined
  userId: number | null | undefined
  isSearching: boolean
  onToggleFavorite: (item: ItemRead) => void
  onFindSimilar: (item: MarketItem) => void
  onBuy: (item: MarketItem) => void
  /** 详情接口返回后回传，用于同步首屏收藏状态（含跨设备变更）。 */
  onItemLoaded?: (item: ItemRead) => void
}

const purchaseIcons: Record<PurchaseKind, LucideIcon> = {
  buy: ShoppingBag,
  login: LogIn,
  sold: AlertCircle,
  own: Package,
  want: Tag,
}

export function ItemDetailDialog({
  item,
  open,
  onOpenChange,
  favorite,
  userId,
  isSearching,
  onToggleFavorite,
  onFindSimilar,
  onBuy,
  onItemLoaded,
}: ItemDetailDialogProps) {
  const [latest, setLatest] = useState<ItemRead | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [imageFailed, setImageFailed] = useState(false)

  const itemId = item?.id ?? null

  useEffect(() => {
    if (!open || itemId == null) return
    let cancelled = false

    setIsLoading(true)
    setLoadError(null)

    getItem(itemId)
      .then((data) => {
        if (cancelled) return
        setLatest(data)
        onItemLoaded?.(data)
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoadError(getApiErrorMessage(error))
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [open, itemId, reloadKey, onItemLoaded])

  useEffect(() => {
    setImageFailed(false)
    setLatest(null)
  }, [itemId])

  const current: MarketItem | null = item
    ? latest
      ? { ...item, ...latest }
      : item
    : null

  if (!current) {
    return null
  }

  const purchase = getPurchaseState(current, userId)
  const PurchaseIcon = purchaseIcons[purchase.kind]
  const isWant = current.is_offer === false
  const isFavorited = Boolean(favorite?.favorited)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[90svh] gap-0 overflow-hidden p-0 sm:max-w-4xl"
        showCloseButton
      >
        <div className="grid max-h-[90svh] grid-cols-1 overflow-y-auto md:grid-cols-[1.02fr_1fr] md:overflow-hidden">
          <div className="relative aspect-[16/10] overflow-hidden bg-muted md:aspect-auto md:h-full md:min-h-[500px]">
            {current.image_path && !imageFailed ? (
              <img
                src={resolveMediaUrl(current.image_path)}
                alt={current.name}
                onError={() => setImageFailed(true)}
                className="absolute inset-0 size-full object-cover"
              />
            ) : (
              <div className="flex size-full min-h-[220px] flex-col items-center justify-center gap-2 text-muted-foreground/70">
                <ImageOff className="size-7" strokeWidth={1.25} />
                <span className="text-[11px]">暂无图片</span>
              </div>
            )}
            <div className="absolute left-4 top-4 flex flex-wrap gap-1.5">
              <Badge
                variant="outline"
                className="border-border/60 bg-background/80 text-[10px] font-normal text-foreground backdrop-blur-md"
              >
                {isWant ? '求购帖' : '出售帖'}
              </Badge>
              {current.is_sold ? (
                <Badge
                  variant="outline"
                  className="border-border/60 bg-background/80 text-[10px] font-normal text-muted-foreground backdrop-blur-md"
                >
                  已售出
                </Badge>
              ) : null}
            </div>
          </div>

          <div className="flex min-h-0 flex-col p-5 sm:p-6 md:max-h-[90svh] md:overflow-y-auto">
            <div className="pr-8">
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                Listing #{String(current.id).padStart(4, '0')}
              </p>
              <DialogTitle className="mt-2 text-xl leading-7 tracking-[-0.02em]">
                {current.name}
              </DialogTitle>
              <DialogDescription className="mt-1.5 text-xs leading-5">
                {isWant ? '求购信息' : '在售商品'} · 由用户 #
                {current.owner_id ?? '—'} 发布
              </DialogDescription>
            </div>

            <div className="mt-5 flex items-end justify-between gap-4">
              <p className="flex items-baseline gap-1 font-mono text-[26px] font-semibold leading-none tracking-tight text-foreground">
                <span className="text-xs font-normal text-muted-foreground">
                  ¥
                </span>
                <span className="tabular-nums">
                  {formatPrice(current.price)}
                </span>
              </p>

              <div className="text-right">
                <p className="text-[10px] text-muted-foreground">
                  实时剩余库存
                </p>
                <div className="mt-1 flex items-center justify-end gap-1.5">
                  {isLoading ? (
                    <Loader2 className="size-3 animate-spin text-muted-foreground" />
                  ) : (
                    <span
                      className={cn(
                        'size-1.5 rounded-full',
                        current.inventory > 0
                          ? 'bg-emerald-500'
                          : 'bg-muted-foreground/50',
                      )}
                    />
                  )}
                  <span className="font-mono text-sm font-medium tabular-nums text-foreground">
                    {current.inventory}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="size-6 text-muted-foreground"
                    onClick={() => setReloadKey((key) => key + 1)}
                    disabled={isLoading}
                    aria-label="刷新实时库存"
                    title="刷新实时库存"
                  >
                    <RefreshCw
                      className={cn('size-3', isLoading && 'animate-spin')}
                    />
                  </Button>
                </div>
              </div>
            </div>

            {loadError ? (
              <Alert variant="destructive" className="mt-4 py-2.5">
                <AlertCircle />
                <AlertTitle className="text-xs">库存同步失败</AlertTitle>
                <AlertDescription className="flex items-center justify-between gap-2 text-[11px]">
                  <span className="truncate">{loadError}</span>
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

            <Tabs defaultValue="detail" className="mt-6">
              <TabsList
                variant="line"
                className="h-8 w-full justify-start gap-4 border-b border-border/70 p-0"
              >
                <TabsTrigger
                  value="detail"
                  className="h-8 flex-none px-0 text-xs"
                >
                  商品详情
                </TabsTrigger>
                <TabsTrigger
                  value="trade"
                  className="h-8 flex-none px-0 text-xs"
                >
                  交易说明
                </TabsTrigger>
              </TabsList>

              <TabsContent value="detail" className="pt-4">
                <div className="space-y-4">
                  <div>
                    <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                      标签
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {current.tags.length > 0 ? (
                        current.tags.map((tag) => (
                          <Badge
                            key={tag.id}
                            variant="outline"
                            className="border-border/70 bg-transparent px-2 py-0.5 text-[10px] font-normal text-muted-foreground"
                          >
                            <Tag className="size-2.5" />
                            {tag.name}
                          </Badge>
                        ))
                      ) : (
                        <span className="text-[11px] text-muted-foreground">
                          暂无标签
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-lg border border-border/70 bg-muted/20 p-3.5">
                    <div>
                      <p className="text-[10px] text-muted-foreground">
                        发布时间
                      </p>
                      <p className="mt-0.5 text-[11px] font-medium text-foreground">
                        {formatDate(current.created_at)}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] text-muted-foreground">
                        库存状态
                      </p>
                      <p className="mt-0.5 text-[11px] font-medium text-foreground">
                        {current.is_sold || current.inventory <= 0
                          ? '已售罄'
                          : `剩余 ${current.inventory} 件`}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] text-muted-foreground">
                        商品类型
                      </p>
                      <p className="mt-0.5 text-[11px] font-medium text-foreground">
                        {isWant ? '求购信息' : '出售商品'}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] text-muted-foreground">
                        商品编号
                      </p>
                      <p className="mt-0.5 font-mono text-[11px] font-medium tabular-nums text-foreground">
                        #{current.id}
                      </p>
                    </div>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="trade" className="pt-4">
                <div className="space-y-3">
                  {[
                    {
                      title: '实时库存校验',
                      description:
                        '打开详情会重新拉取最新库存，提交订单时后端会再次校验。',
                    },
                    {
                      title: '幂等防重复扣减',
                      description:
                        '每次下单携带独立幂等键，网络波动重试不会重复扣库存。',
                    },
                    {
                      title: '交易边界',
                      description:
                        '求购帖不参与抢购，且无法购买自己发布的商品。',
                    },
                  ].map((item) => (
                    <div key={item.title} className="flex items-start gap-2.5">
                      <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                      <div>
                        <p className="text-[11px] font-medium text-foreground">
                          {item.title}
                        </p>
                        <p className="mt-0.5 text-[11px] leading-5 text-muted-foreground">
                          {item.description}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </TabsContent>
            </Tabs>

            <div className="mt-6 flex flex-col gap-2 border-t border-border/70 pt-4 sm:flex-row sm:items-center">
              <div className="flex gap-2 sm:contents">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => onToggleFavorite(current)}
                  aria-pressed={isFavorited}
                  className="flex-1 sm:flex-none"
                >
                  <Heart
                    className={cn(
                      'size-3.5',
                      isFavorited && 'fill-rose-500 text-rose-500',
                    )}
                  />
                  {isFavorited ? '已收藏' : '收藏'}
                  {favorite && favorite.count > 0 ? (
                    <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                      {favorite.count}
                    </span>
                  ) : null}
                </Button>

                {current.image_path ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => onFindSimilar(current)}
                    disabled={isSearching}
                    className="flex-1 sm:flex-none"
                  >
                    {isSearching ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <ScanSearch className="size-3.5" />
                    )}
                    找相似
                  </Button>
                ) : null}
              </div>

              <Button
                type="button"
                className="w-full sm:ml-auto sm:w-auto"
                disabled={purchase.disabled}
                onClick={() => onBuy(current)}
              >
                <PurchaseIcon className="size-4" />
                {purchase.label}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

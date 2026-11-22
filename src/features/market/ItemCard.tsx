import { useEffect, useRef, useState } from 'react'
import {
  AlertCircle,
  Heart,
  ImageOff,
  LogIn,
  Package,
  ScanSearch,
  Search,
  ShoppingBag,
  Sparkles,
  Tag,
  type LucideIcon,
} from 'lucide-react'
import { resolveMediaUrl } from '@/api/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  formatPrice,
  getMatchLabel,
  getPurchaseState,
  type FavoriteState,
  type MarketItem,
  type MarketMode,
  type PurchaseKind,
} from '@/features/market/market-utils'

interface ItemCardProps {
  item: MarketItem
  mode: MarketMode
  index: number
  favorite: FavoriteState | undefined
  userId: number | null | undefined
  isSearching: boolean
  onOpen: (item: MarketItem) => void
  onBuy: (item: MarketItem) => void
  onToggleFavorite: (item: MarketItem) => void
  onFindSimilar: (item: MarketItem) => void
}

const actionIcons: Record<PurchaseKind, LucideIcon> = {
  buy: ShoppingBag,
  login: LogIn,
  sold: AlertCircle,
  own: Package,
  want: Tag,
}

export function ItemCard({
  item,
  mode,
  index,
  favorite,
  userId,
  isSearching,
  onOpen,
  onBuy,
  onToggleFavorite,
  onFindSimilar,
}: ItemCardProps) {
  const [imageFailed, setImageFailed] = useState(false)
  const [imageLoaded, setImageLoaded] = useState(false)
  const imageRef = useRef<HTMLImageElement | null>(null)

  useEffect(() => {
    setImageFailed(false)
    // 缓存命中时 <img> 可能在 React 挂载监听器之前就 complete，onLoad 不再
    // 触发；主动检查一次，避免同一张图在检索结果里变成永久空白。
    const image = imageRef.current
    setImageLoaded(Boolean(image?.complete && image.naturalWidth > 0))
  }, [item.image_path])

  const purchase = getPurchaseState(item, userId)
  const ActionIcon = actionIcons[purchase.kind]
  const matchLabel = getMatchLabel(item, mode, index)
  const isTopVisualMatch = mode === 'image' && index === 0
  const isFavorited = Boolean(favorite?.favorited)
  const favoriteCount = favorite?.count ?? 0
  const isWant = item.is_offer === false

  const MatchIcon =
    mode === 'image'
      ? ScanSearch
      : item.match_reason === 'lexical'
        ? Search
        : Sparkles

  return (
    <article
      className={cn(
        'group relative flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card transition-[border-color,box-shadow] duration-300 hover:border-foreground/15 hover:shadow-[0_18px_44px_-34px_rgba(9,9,11,0.45)]',
        isTopVisualMatch && 'ring-1 ring-foreground/10',
      )}
    >
      <button
        type="button"
        onClick={() => onOpen(item)}
        className="absolute inset-0 z-0 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        aria-label={`查看「${item.name}」详情`}
      />

      <div className="pointer-events-none relative aspect-[4/3] overflow-hidden bg-muted">
        {!(imageLoaded && !imageFailed) ? (
          item.image_path && !imageFailed ? (
            <div className="absolute inset-0 animate-pulse bg-foreground/[0.04]" />
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-muted-foreground/60">
              <ImageOff className="size-6" strokeWidth={1.25} />
              <span className="text-[10px]">暂无图片</span>
            </div>
          )
        ) : null}

        {item.image_path && !imageFailed ? (
          <img
            ref={imageRef}
            src={resolveMediaUrl(item.image_path)}
            alt={item.name}
            loading="lazy"
            onLoad={() => setImageLoaded(true)}
            onError={() => setImageFailed(true)}
            className={cn(
              'absolute inset-0 size-full object-cover transition-[transform,opacity] duration-500 ease-out group-hover:scale-[1.03]',
              imageLoaded ? 'opacity-100' : 'opacity-0',
            )}
          />
        ) : null}

        {matchLabel ? (
          <span
            className={cn(
              'absolute left-3 top-3 z-10 inline-flex items-center gap-1.5 rounded-full border border-border/50 bg-background/80 px-2.5 py-1 text-[10px] font-medium text-foreground shadow-[0_1px_2px_rgba(9,9,11,0.06)] backdrop-blur-md',
              isTopVisualMatch && 'border-foreground/20 bg-background/90',
            )}
          >
            <MatchIcon className="size-3 text-muted-foreground" />
            {matchLabel}
          </span>
        ) : null}
      </div>

      <div className="pointer-events-none relative z-10 flex flex-1 flex-col gap-3 px-4 pb-4 pt-3.5">
        <h3 className="line-clamp-2 text-[13px] font-medium leading-5 tracking-[-0.01em] text-foreground">
          {item.name}
        </h3>

        <div className="flex items-end justify-between gap-2">
          <p className="flex items-baseline gap-1 font-mono text-[17px] font-semibold tracking-tight text-foreground">
            <span className="text-[11px] font-normal text-muted-foreground">
              ¥
            </span>
            <span className="tabular-nums">{formatPrice(item.price)}</span>
          </p>
          <Badge
            variant="outline"
            className="border-border/70 bg-transparent px-1.5 py-0 font-mono text-[10px] font-normal tabular-nums text-muted-foreground"
          >
            {item.inventory > 0 ? `余 ${item.inventory}` : '无库存'}
          </Badge>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <Badge
            variant="outline"
            className={cn(
              'border-border/70 bg-transparent px-1.5 py-0 text-[10px] font-normal',
              isWant ? 'text-amber-700/80 dark:text-amber-400/80' : 'text-muted-foreground',
            )}
          >
            {isWant ? '求购' : '出售'}
          </Badge>
          {item.is_sold ? (
            <Badge
              variant="outline"
              className="border-border/70 bg-transparent px-1.5 py-0 text-[10px] font-normal text-muted-foreground"
            >
              已售出
            </Badge>
          ) : null}
          {item.tags.slice(0, 2).map((tag) => (
            <Badge
              key={tag.id}
              variant="outline"
              className="max-w-[104px] border-border/70 bg-transparent px-1.5 py-0 text-[10px] font-normal text-muted-foreground"
            >
              <span className="truncate">{tag.name}</span>
            </Badge>
          ))}
          {item.tags.length > 2 ? (
            <Badge
              variant="outline"
              className="border-border/70 bg-transparent px-1.5 py-0 text-[10px] font-normal text-muted-foreground"
            >
              +{item.tags.length - 2}
            </Badge>
          ) : null}
        </div>

        <div className="pointer-events-auto mt-auto pt-1">
          <Button
            type="button"
            variant={
              purchase.kind === 'buy' || purchase.kind === 'login'
                ? 'default'
                : 'outline'
            }
            className="h-9 w-full gap-1.5 text-[12px]"
            disabled={purchase.disabled}
            onClick={() => onBuy(item)}
          >
            <ActionIcon className="size-3.5" />
            {purchase.label}
          </Button>
        </div>
      </div>

      <div className="pointer-events-none absolute right-3 top-3 z-20 flex items-center gap-1.5">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          aria-label={isFavorited ? '取消收藏' : '收藏'}
          aria-pressed={isFavorited}
          title={
            favoriteCount > 0
              ? `${isFavorited ? '取消收藏' : '收藏'} · ${favoriteCount} 人收藏`
              : isFavorited
                ? '取消收藏'
                : '收藏'
          }
          onClick={() => onToggleFavorite(item)}
          className={cn(
            'pointer-events-auto h-8 gap-1 border border-border/50 bg-background/80 px-1.5 shadow-sm backdrop-blur-md transition-all hover:bg-background',
            favoriteCount === 0 &&
              !isFavorited &&
              'sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100',
          )}
        >
          <Heart
            className={cn(
              'size-3.5',
              isFavorited && 'fill-rose-500 text-rose-500',
            )}
          />
          {favoriteCount > 0 ? (
            <span
              className={cn(
                'font-mono text-[10px] tabular-nums',
                isFavorited ? 'text-rose-500' : 'text-muted-foreground',
              )}
            >
              {favoriteCount}
            </span>
          ) : null}
        </Button>

        {item.image_path ? (
          <Button
            type="button"
            variant="secondary"
            size="icon-sm"
            aria-label="找相似"
            title="找相似"
            disabled={isSearching}
            onClick={() => onFindSimilar(item)}
            className="pointer-events-auto border border-border/50 bg-background/80 shadow-sm backdrop-blur-md transition-all hover:bg-background sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
          >
            <ScanSearch className="size-3.5" />
          </Button>
        ) : null}
      </div>
    </article>
  )
}

import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  AlertCircle,
  ArrowRight,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  ScanSearch,
  Search,
  SearchX,
  SlidersHorizontal,
  Sparkles,
  Store,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { getApiErrorMessage, resolveMediaUrl } from '@/api/client'
import {
  listItems,
  searchByImage,
  searchByText,
  toggleFavorite,
} from '@/api/items'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { BuyConfirmDialog } from '@/features/market/BuyConfirmDialog'
import { ItemCard } from '@/features/market/ItemCard'
import { ItemDetailDialog } from '@/features/market/ItemDetailDialog'
import { OmnibarSearch } from '@/features/market/OmnibarSearch'
import { TagBar } from '@/features/market/TagBar'
import {
  PAGE_SIZE_OPTIONS,
  filterByOffer,
  imageUrlToFile,
  isFeatureUnavailable,
  validateImageFile,
  type FavoriteMap,
  type MarketItem,
  type MarketMode,
  type OfferFilter,
} from '@/features/market/market-utils'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth'
import type { ItemRead, SearchResponse, TagRead } from '@/types/api'

const offerFilters: Array<{ value: OfferFilter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'offer', label: '出售' },
  { value: 'want', label: '求购' },
]

function MarketGridSkeleton() {
  return (
    <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: 8 }).map((_, index) => (
        <div
          key={index}
          className="overflow-hidden rounded-xl border border-border bg-card"
        >
          <Skeleton className="aspect-[4/3] w-full rounded-none" />
          <div className="space-y-3 px-4 pb-4 pt-3.5">
            <div className="space-y-1.5">
              <Skeleton className="h-3.5 w-4/5" />
              <Skeleton className="h-3.5 w-3/5" />
            </div>
            <Skeleton className="h-5 w-1/3" />
            <div className="flex gap-1.5">
              <Skeleton className="h-4 w-10 rounded-md" />
              <Skeleton className="h-4 w-12 rounded-md" />
            </div>
            <Skeleton className="h-9 w-full" />
          </div>
        </div>
      ))}
    </div>
  )
}

export default function MarketPage() {
  const user = useAuthStore((state) => state.user)
  const navigate = useNavigate()

  const [mode, setMode] = useState<MarketMode>('browse')
  const [query, setQuery] = useState('')
  const [browseSearch, setBrowseSearch] = useState('')
  const [offerFilter, setOfferFilter] = useState<OfferFilter>('all')
  const [activeTag, setActiveTag] = useState<string | null>(null)
  const [activeTagId, setActiveTagId] = useState<number | null>(null)

  const [items, setItems] = useState<MarketItem[]>([])
  const [total, setTotal] = useState(0)
  const [skip, setSkip] = useState(0)
  const [limit, setLimit] = useState<number>(PAGE_SIZE_OPTIONS[0])
  const [isLoading, setIsLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const [hits, setHits] = useState<MarketItem[]>([])
  const [engineMode, setEngineMode] = useState<string | null>(null)
  const [searchMessage, setSearchMessage] = useState<string | null>(null)
  const [isSearching, setIsSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [visualUnavailable, setVisualUnavailable] = useState(false)

  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null)

  const [favorites, setFavorites] = useState<FavoriteMap>({})
  const [detailItem, setDetailItem] = useState<MarketItem | null>(null)
  const [buyTarget, setBuyTarget] = useState<MarketItem | null>(null)

  const requestSequence = useRef(0)
  const resultsRef = useRef<HTMLElement | null>(null)
  const favoriteInFlight = useRef<Set<number>>(new Set())
  const lastSearchKind = useRef<'text' | 'image' | null>(null)
  // AI 审批下单成功后只做静默刷新：不闪骨架屏、不改变检索与列表逻辑。
  const silentRefreshRef = useRef(false)

  useEffect(() => {
    const handleInventoryChanged = () => {
      silentRefreshRef.current = true
      setReloadKey((key) => key + 1)
    }

    window.addEventListener('market:inventory-changed', handleInventoryChanged)
    return () => {
      window.removeEventListener(
        'market:inventory-changed',
        handleInventoryChanged,
      )
    }
  }, [])

  /**
   * 用后端返回的收藏字段回填首屏状态。列表 / 检索 / 详情都会带上当前用户的
   * `favorited` 与公开的 `favourited_count`，刷新后无需先 toggle 才能显示心形。
   */
  const seedFavorites = useCallback((entries: ItemRead[]) => {
    if (entries.length === 0) return
    setFavorites((current) => {
      const next = { ...current }
      for (const entry of entries) {
        // 正在 toggle 的条目以后端返回的 toggle 结果为准，避免旧响应覆盖。
        if (favoriteInFlight.current.has(entry.id)) continue
        next[entry.id] = {
          favorited: entry.favorited,
          count: entry.favourited_count,
        }
      }
      return next
    })
  }, [])

  const seedFavorite = useCallback(
    (entry: ItemRead) => seedFavorites([entry]),
    [seedFavorites],
  )

  useEffect(() => {
    const isSilentRefresh = silentRefreshRef.current
    silentRefreshRef.current = false

    if (mode !== 'browse') {
      requestSequence.current += 1
      return
    }

    let cancelled = false
    const sequence = ++requestSequence.current

    if (!isSilentRefresh) setIsLoading(true)
    setListError(null)

    listItems({
      skip,
      limit,
      search: browseSearch || undefined,
      is_offer_filter:
        offerFilter === 'all' ? undefined : offerFilter === 'offer',
      tag_id: activeTagId ?? undefined,
    })
      .then((response) => {
        if (cancelled || sequence !== requestSequence.current) return
        setItems(response.items)
        setTotal(response.total)
        seedFavorites(response.items)
      })
      .catch((error: unknown) => {
        if (cancelled || sequence !== requestSequence.current) return
        setListError(getApiErrorMessage(error))
      })
      .finally(() => {
        if (cancelled || sequence !== requestSequence.current) return
        setIsLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [
    mode,
    skip,
    limit,
    browseSearch,
    offerFilter,
    activeTagId,
    user?.id,
    reloadKey,
    seedFavorites,
  ])

  // 切换账号（含退出登录）时清空本地收藏映射，避免串号显示上一个人的状态。
  useEffect(() => {
    setFavorites({})
    favoriteInFlight.current.clear()
  }, [user?.id])

  useEffect(() => {
    const url = imagePreviewUrl
    return () => {
      if (url?.startsWith('blob:')) URL.revokeObjectURL(url)
    }
  }, [imagePreviewUrl])

  const isBusy = isSearching || (mode === 'browse' && isLoading)
  const visibleHits = filterByOffer(hits, offerFilter)
  const displayItems = mode === 'browse' ? items : visibleHits
  const resultCount = mode === 'browse' ? total : visibleHits.length
  const isFilteredOutOfHits =
    mode !== 'browse' && hits.length > 0 && displayItems.length === 0
  const totalPages = Math.max(1, Math.ceil(total / limit))
  const currentPage = Math.floor(skip / limit) + 1
  const hasBrowseFilters =
    Boolean(browseSearch) || offerFilter !== 'all' || activeTagId != null

  const clearImage = () => {
    setImageFile(null)
    setImagePreviewUrl(null)
  }

  const goToLogin = (description: string) => {
    toast.error('需要登录', { description })
    navigate(`/login?redirect=${encodeURIComponent('/market')}`, {
      state: { from: '/market' },
    })
  }

  const runHybridSearch = async (
    rawQuery: string,
    tagName: string | null = null,
  ) => {
    const text = rawQuery.trim()

    if (!text) {
      toast.error('请输入检索描述', {
        description: '用一句话描述你想找的商品，例如“适合通勤的降噪耳机”。',
      })
      return
    }
    if (text.length > 500) {
      toast.error('检索描述最多 500 个字符')
      return
    }

    setIsSearching(true)
    setSearchError(null)
    setVisualUnavailable(false)
    lastSearchKind.current = 'text'

    try {
      const response = await searchByText(text, { includeWants: true })
      setMode('hybrid')
      setHits(response.data)
      setEngineMode(response.mode)
      setSearchMessage(response.message)
      setActiveTag(tagName)
      setQuery(text)
      setSkip(0)
      clearImage()
      seedFavorites(response.data)
    } catch (error) {
      const message = getApiErrorMessage(error)
      setSearchError(message)
      toast.error('语义检索失败', { description: message })
    } finally {
      setIsSearching(false)
    }
  }

  const runImageSearch = async (file: File) => {
    const validationError = validateImageFile(file)
    if (validationError) {
      toast.error('图片不符合要求', { description: validationError })
      return
    }

    setImageFile(file)
    setImagePreviewUrl(URL.createObjectURL(file))
    setIsSearching(true)
    setSearchError(null)
    setVisualUnavailable(false)
    lastSearchKind.current = 'image'

    try {
      const response = await searchByImage(file)
      setMode('image')
      setHits(response.data)
      setEngineMode(response.mode)
      setSearchMessage(response.message)
      setActiveTag(null)
      setActiveTagId(null)
      setQuery('')
      setSkip(0)
      seedFavorites(response.data)
    } catch (error) {
      if (isFeatureUnavailable(error)) {
        setVisualUnavailable(true)
        setMode('browse')
        setHits([])
        setEngineMode(null)
        setSearchMessage(null)
        setActiveTag(null)
        setActiveTagId(null)
        setSearchError(null)
      } else {
        const message = getApiErrorMessage(error)
        setSearchError(message)
        toast.error('以图搜图失败', { description: message })
      }
    } finally {
      setIsSearching(false)
    }
  }

  const exitSearch = () => {
    setMode('browse')
    setHits([])
    setEngineMode(null)
    setSearchMessage(null)
    setActiveTag(null)
    setActiveTagId(null)
    setSearchError(null)
    setVisualUnavailable(false)
    setBrowseSearch('')
    setQuery('')
    setSkip(0)
    clearImage()
  }

  const handleModeChange = (nextMode: 'browse' | 'hybrid') => {
    if (nextMode === mode) return

    if (nextMode === 'browse') {
      setMode('browse')
      setHits([])
      setEngineMode(null)
      setSearchMessage(null)
      setActiveTag(null)
      setActiveTagId(null)
      setSearchError(null)
      setVisualUnavailable(false)
      setQuery(browseSearch)
      clearImage()
      return
    }

    setMode('hybrid')
    setHits([])
    setEngineMode(null)
    setSearchMessage(null)
    setActiveTag(null)
    setActiveTagId(null)
    setSearchError(null)
    setVisualUnavailable(false)
    clearImage()
  }

  const handleSubmit = () => {
    if (mode === 'hybrid' || mode === 'image') {
      void runHybridSearch(query)
      return
    }

    setActiveTag(null)
    setActiveTagId(null)
    setSearchError(null)
    setVisualUnavailable(false)
    setBrowseSearch(query.trim())
    setQuery(query.trim())
    setSkip(0)
    clearImage()
  }

  const handleTagSelect = (tag: TagRead) => {
    if (activeTag === tag.name) {
      if (mode === 'browse') {
        setBrowseSearch('')
        setQuery('')
        setActiveTag(null)
        setActiveTagId(null)
        setSkip(0)
      } else {
        exitSearch()
      }
      return
    }

    if (mode === 'browse') {
      setActiveTag(tag.name)
      setActiveTagId(tag.id)
      setQuery(tag.name)
      // 标签筛选走后端 tag_id（精确的关联关系），不再把标签名塞进 search。
      setBrowseSearch('')
      setSkip(0)
      setVisualUnavailable(false)
      return
    }

    setQuery(tag.name)
    void runHybridSearch(tag.name, tag.name)
  }

  const handleClearImage = () => {
    clearImage()
    setVisualUnavailable(false)

    if (mode === 'image') {
      setMode('browse')
      setHits([])
      setEngineMode(null)
      setSearchMessage(null)
      setActiveTag(null)
      setActiveTagId(null)
      setSearchError(null)
      setQuery('')
      setSkip(0)
    }
  }

  const handleFindSimilar = async (source: MarketItem) => {
    if (isSearching) return

    setDetailItem(null)
    setIsSearching(true)
    setSearchError(null)
    setVisualUnavailable(false)
    lastSearchKind.current = null

    try {
      let response: SearchResponse | null = null
      let usedImage = false

      if (source.image_path) {
        try {
          const file = await imageUrlToFile(
            resolveMediaUrl(source.image_path),
            source.name,
          )
          response = await searchByImage(file)
          usedImage = true
        } catch {
          // CORS / unreachable media / 503 all degrade to semantic search.
        }
      }

      if (!response) {
        response = await searchByText(source.name)
        if (response.data.length > 0) {
          toast.success('已通过语义相似度为你找到相关商品')
        }
      }

      if (response.data.length === 0) {
        toast.info('没有找到相似商品', {
          description: '可以换一个描述，或直接浏览全部商品。',
        })
      }

      setMode(usedImage ? 'image' : 'hybrid')
      setHits(response.data)
      setEngineMode(response.mode)
      setSearchMessage(response.message)
      setActiveTag(null)
      setActiveTagId(null)
      setQuery(source.name)
      setSkip(0)
      clearImage()
      seedFavorites(response.data)

      if (usedImage && source.image_path) {
        setImagePreviewUrl(resolveMediaUrl(source.image_path))
      }
    } catch (error) {
      const message = getApiErrorMessage(error)
      setSearchError(message)
      toast.error('找相似失败', { description: message })
    } finally {
      setIsSearching(false)
    }
  }

  const handleToggleFavorite = async (target: ItemRead) => {
    if (!user) {
      goToLogin('登录后即可收藏心仪商品。')
      return
    }

    const previous = favorites[target.id]
    const wasFavorited = previous?.favorited ?? false
    const previousCount = previous?.count ?? 0

    if (favoriteInFlight.current.has(target.id)) return
    favoriteInFlight.current.add(target.id)

    setFavorites((current) => ({
      ...current,
      [target.id]: {
        favorited: !wasFavorited,
        count: Math.max(0, previousCount + (wasFavorited ? -1 : 1)),
      },
    }))

    try {
      const response = await toggleFavorite(target.id)
      setFavorites((current) => ({
        ...current,
        [target.id]: {
          favorited: response.favorited,
          count: response.favourited_count,
        },
      }))
      toast.success(response.message)
    } catch (error) {
      setFavorites((current) => {
        const next = { ...current }
        if (previous) {
          next[target.id] = previous
        } else {
          delete next[target.id]
        }
        return next
      })
      toast.error('收藏操作失败', {
        description: getApiErrorMessage(error),
      })
    } finally {
      favoriteInFlight.current.delete(target.id)
    }
  }

  const handleBuyRequest = (target: MarketItem) => {
    if (!user) {
      goToLogin('登录后即可参与抢购。')
      return
    }
    if (target.is_offer === false) return

    if (target.is_sold || target.inventory <= 0) {
      toast.info('商品已售罄')
      return
    }
    if (target.owner_id === user.id) {
      toast.info('这是你自己的发布，不能购买')
      return
    }

    setDetailItem(null)
    setBuyTarget(target)
  }

  const applyInventory = (itemId: number, remaining: number) => {
    const patch = (entry: MarketItem): MarketItem =>
      entry.id === itemId
        ? { ...entry, inventory: remaining, is_sold: remaining <= 0 }
        : entry

    setItems((current) => current.map(patch))
    setHits((current) => current.map(patch))
    setDetailItem((current) =>
      current && current.id === itemId ? patch(current) : current,
    )
    setBuyTarget((current) =>
      current && current.id === itemId ? patch(current) : current,
    )
  }

  const handlePurchased = (itemId: number, remainingInventory: number) => {
    applyInventory(itemId, remainingInventory)
    setReloadKey((key) => key + 1)
  }

  const handleOutOfStock = (itemId: number) => {
    applyInventory(itemId, 0)
    setReloadKey((key) => key + 1)
  }

  const clearKeyword = () => {
    setBrowseSearch('')
    setQuery('')
    setActiveTag(null)
    setActiveTagId(null)
    setSkip(0)
  }

  const clearAllFilters = () => {
    setBrowseSearch('')
    setQuery('')
    setActiveTag(null)
    setActiveTagId(null)
    setOfferFilter('all')
    setSkip(0)
  }

  const goToPage = (page: number) => {
    const nextSkip = Math.max(0, (page - 1) * limit)
    setSkip(nextSkip)
    window.requestAnimationFrame(() => {
      resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }

  const retrySearch = () => {
    if (lastSearchKind.current === 'text' && query.trim()) {
      void runHybridSearch(query)
      return
    }
    if (lastSearchKind.current === 'image' && imageFile) {
      void runImageSearch(imageFile)
      return
    }
    setSearchError(null)
  }

  const isInitialError =
    mode === 'browse' && Boolean(listError) && items.length === 0 && !isLoading

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-16 pt-6 sm:px-6 sm:pt-8">
      <header className="pb-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex items-center gap-1.5 font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              <Store className="size-3" />
              Market
            </div>
            <h1 className="mt-2 text-[26px] font-semibold tracking-[-0.03em] text-foreground">
              交易广场
            </h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              在流转的好物里，找到刚刚好的那一件。
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span className="inline-flex h-7 items-center gap-1.5 rounded-full border border-border/70 px-2.5 text-[10px] text-muted-foreground">
              <span
                className={cn(
                  'size-1.5 rounded-full',
                  user ? 'bg-emerald-500' : 'bg-muted-foreground/40',
                )}
              />
              <span className="max-w-[150px] truncate">
                {user ? `${user.username} · 已登录` : '公开浏览'}
              </span>
            </span>
            {user ? (
              <Button
                asChild
                variant="ghost"
                size="sm"
                className="h-7 gap-1 px-2 text-[11px]"
              >
                <Link to="/studio">
                  我的工作台
                  <ArrowUpRight className="size-3" />
                </Link>
              </Button>
            ) : null}
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-3xl">
        <OmnibarSearch
          mode={mode}
          query={query}
          onQueryChange={setQuery}
          onSubmit={handleSubmit}
          onModeChange={handleModeChange}
          onImageSelect={(file) => void runImageSearch(file)}
          onClearImage={handleClearImage}
          imagePreviewUrl={imagePreviewUrl}
          isSearching={isSearching}
        />

        {visualUnavailable ? (
          <Alert className="mt-3 border-border bg-muted/25 px-3.5 py-2.5">
            <ScanSearch className="text-muted-foreground" />
            <AlertTitle className="text-xs">视觉检索暂不可用</AlertTitle>
            <AlertDescription className="text-[11px] leading-5">
              当前环境未启用视觉模型（CN-CLIP），建议改用 AI 语义描述检索。
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-2 flex h-7 w-fit gap-1 px-2.5 text-[11px]"
                onClick={() => handleModeChange('hybrid')}
              >
                切换到 AI 语义检索
                <ArrowRight className="size-3" />
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}
      </div>

      <TagBar
        activeTag={activeTag}
        onSelect={handleTagSelect}
        canCreate={Boolean(user)}
      />

      <section ref={resultsRef} className="mt-5 scroll-mt-20">
        {mode !== 'browse' ? (
          <div
            className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border/70 bg-muted/25 px-3.5 py-2.5"
            title={searchMessage ?? undefined}
          >
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              {mode === 'image' ? (
                <ScanSearch className="size-3.5" />
              ) : (
                <Sparkles className="size-3.5" />
              )}
              <span>检索模式</span>
              <span className="font-mono text-[10px] tracking-[0.08em] text-foreground">
                {engineMode ?? '—'}
              </span>
              <span className="text-border">/</span>
              <span>
                命中{' '}
                <span className="font-mono tabular-nums text-foreground">
                  {hits.length}
                </span>{' '}
                件
              </span>
              {mode === 'image' ? (
                <span className="hidden text-[10px] text-muted-foreground sm:inline">
                  · Top-1 已标记
                </span>
              ) : null}
            </div>

            {offerFilter !== 'all' ? (
              <Badge
                variant="outline"
                className="border-border/70 bg-transparent px-2 py-0 text-[10px] font-normal text-muted-foreground"
              >
                已筛选 {visibleHits.length} 件
              </Badge>
            ) : null}

            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="ml-auto h-7 gap-1 px-2 text-[11px] text-muted-foreground hover:text-foreground"
              onClick={exitSearch}
            >
              <X className="size-3" />
              退出搜索结果，返回全部商品
            </Button>
          </div>
        ) : null}

        <div
          className={cn(
            'flex flex-wrap items-center justify-between gap-2',
            mode !== 'browse' && 'mt-4',
          )}
        >
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5">
              <SlidersHorizontal className="size-3.5 text-muted-foreground" />
              <div
                className="inline-flex items-center rounded-lg border border-border/80 bg-muted/40 p-0.5"
                role="group"
                aria-label="交易类型筛选"
              >
                {offerFilters.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={offerFilter === option.value}
                    onClick={() => {
                      setOfferFilter(option.value)
                      setSkip(0)
                    }}
                    className={cn(
                      'h-7 rounded-md px-2.5 text-[11px] font-medium transition-colors',
                      offerFilter === option.value
                        ? 'bg-background text-foreground shadow-xs'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            {mode === 'browse' && browseSearch ? (
              <button
                type="button"
                onClick={clearKeyword}
                className="inline-flex h-7 max-w-[220px] items-center gap-1.5 rounded-full border border-border/80 bg-muted/30 px-2.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                aria-label="清除关键词筛选"
              >
                <Search className="size-3 shrink-0" />
                <span className="truncate">{browseSearch}</span>
                <X className="size-3 shrink-0" />
              </button>
            ) : null}
          </div>

          <div className="flex items-center gap-3">
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              {resultCount} 件
            </span>
            {mode === 'browse' ? (
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-muted-foreground">每页</span>
                <Select
                  value={String(limit)}
                  onValueChange={(value) => {
                    setLimit(Number(value))
                    setSkip(0)
                  }}
                >
                  <SelectTrigger
                    size="sm"
                    className="h-7 w-[64px] text-[11px]"
                    aria-label="每页商品数量"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent align="end">
                    {PAGE_SIZE_OPTIONS.map((size) => (
                      <SelectItem
                        key={size}
                        value={String(size)}
                        className="text-xs"
                      >
                        {size}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
          </div>
        </div>

        {listError && mode === 'browse' && items.length > 0 ? (
          <Alert variant="destructive" className="mt-4 py-2.5">
            <AlertCircle />
            <AlertTitle className="text-xs">列表刷新失败</AlertTitle>
            <AlertDescription className="flex items-center justify-between gap-2 text-[11px]">
              <span className="truncate">{listError}</span>
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

        {searchError ? (
          <Alert variant="destructive" className="mt-4 py-2.5">
            <AlertCircle />
            <AlertTitle className="text-xs">检索未完成</AlertTitle>
            <AlertDescription className="flex items-center justify-between gap-2 text-[11px]">
              <span className="truncate">{searchError}</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 shrink-0 px-1.5 text-[11px]"
                onClick={retrySearch}
              >
                重试
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}

        {isBusy ? (
          <MarketGridSkeleton />
        ) : isInitialError ? (
          <div className="mt-4 rounded-xl border border-dashed border-border bg-muted/10 px-6 py-16 text-center">
            <div className="mx-auto flex size-10 items-center justify-center rounded-full border border-border bg-background">
              <AlertCircle className="size-4 text-muted-foreground" />
            </div>
            <p className="mt-4 text-sm font-medium text-foreground">
              商品加载失败
            </p>
            <p className="mx-auto mt-1.5 max-w-sm text-xs leading-5 text-muted-foreground">
              {listError}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-4"
              onClick={() => setReloadKey((key) => key + 1)}
            >
              <RefreshCw className="size-3.5" />
              重新加载
            </Button>
          </div>
        ) : displayItems.length === 0 ? (
          <div className="mt-4 rounded-xl border border-dashed border-border bg-muted/10 px-6 py-16 text-center">
            <div className="mx-auto flex size-10 items-center justify-center rounded-full border border-border bg-background">
              {mode === 'browse' ? (
                <SearchX className="size-4 text-muted-foreground" />
              ) : (
                <ScanSearch className="size-4 text-muted-foreground" />
              )}
            </div>
            <p className="mt-4 text-sm font-medium text-foreground">
              {isFilteredOutOfHits
                ? '当前筛选下没有结果'
                : mode === 'browse' || engineMode
                  ? '没有找到匹配的商品'
                  : '用一句话描述你想找的东西'}
            </p>
            <p className="mx-auto mt-1.5 max-w-sm text-xs leading-5 text-muted-foreground">
              {isFilteredOutOfHits
                ? '命中的商品中没有符合当前交易类型的条目。'
                : mode === 'browse'
                  ? hasBrowseFilters
                    ? '试试清除关键词或切换为全部交易类型。'
                    : '商品广场暂时还没有上新。'
                  : engineMode
                    ? '换个描述或图片再试，也可以返回全部商品继续浏览。'
                    : 'AI 会结合关键词与语义双路召回，输入描述后开始检索。'}
            </p>
            {isFilteredOutOfHits ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-4"
                onClick={() => setOfferFilter('all')}
              >
                清除筛选
              </Button>
            ) : mode === 'browse' ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-4"
                onClick={
                  hasBrowseFilters
                    ? clearAllFilters
                    : () => setReloadKey((key) => key + 1)
                }
              >
                {hasBrowseFilters ? '清除筛选' : '刷新商品'}
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-4"
                onClick={exitSearch}
              >
                返回全部商品
              </Button>
            )}
          </div>
        ) : (
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {displayItems.map((item, index) => (
              <ItemCard
                key={item.id}
                item={item}
                mode={mode}
                index={index}
                favorite={favorites[item.id]}
                userId={user?.id}
                isSearching={isSearching}
                onOpen={setDetailItem}
                onBuy={handleBuyRequest}
                onToggleFavorite={(target) => void handleToggleFavorite(target)}
                onFindSimilar={(target) => void handleFindSimilar(target)}
              />
            ))}
          </div>
        )}

        {mode === 'browse' && !isBusy && total > limit ? (
          <nav
            className="mt-8 flex items-center justify-between border-t border-border/70 pt-4"
            aria-label="分页"
          >
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={skip === 0}
              onClick={() => goToPage(currentPage - 1)}
            >
              <ChevronLeft className="size-3.5" />
              上一页
            </Button>
            <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
              第 {currentPage} / {totalPages} 页
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={skip + limit >= total}
              onClick={() => goToPage(currentPage + 1)}
            >
              下一页
              <ChevronRight className="size-3.5" />
            </Button>
          </nav>
        ) : null}
      </section>

      <ItemDetailDialog
        item={detailItem}
        open={Boolean(detailItem)}
        onOpenChange={(open) => {
          if (!open) setDetailItem(null)
        }}
        favorite={detailItem ? favorites[detailItem.id] : undefined}
        userId={user?.id}
        isSearching={isSearching}
        onToggleFavorite={(target) => void handleToggleFavorite(target)}
        onFindSimilar={(target) => void handleFindSimilar(target)}
        onBuy={handleBuyRequest}
        onItemLoaded={seedFavorite}
      />

      <BuyConfirmDialog
        item={buyTarget}
        open={Boolean(buyTarget)}
        onOpenChange={(open) => {
          if (!open) setBuyTarget(null)
        }}
        onPurchased={handlePurchased}
        onOutOfStock={handleOutOfStock}
      />
    </div>
  )
}

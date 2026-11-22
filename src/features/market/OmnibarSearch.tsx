import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
} from 'react'
import {
  ImagePlus,
  Info,
  Loader2,
  ScanSearch,
  Search,
  Sparkles,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import type { MarketMode } from '@/features/market/market-utils'

interface OmnibarSearchProps {
  mode: MarketMode
  query: string
  onQueryChange: (value: string) => void
  onSubmit: () => void
  onModeChange: (mode: 'browse' | 'hybrid') => void
  onImageSelect: (file: File) => void
  onClearImage: () => void
  imagePreviewUrl: string | null
  isSearching: boolean
}

const placeholders: Record<MarketMode, string> = {
  browse: '搜索商品名称，如：机械键盘、露营灯、通勤背包',
  hybrid: '描述你想找的东西，如：适合通勤的轻便降噪耳机',
  image: '已按图片检索，可继续用文字描述补充',
}

export function OmnibarSearch({
  mode,
  query,
  onQueryChange,
  onSubmit,
  onModeChange,
  onImageSelect,
  onClearImage,
  imagePreviewUrl,
  isSearching,
}: OmnibarSearchProps) {
  const [isDragging, setIsDragging] = useState(false)
  const dragDepth = useRef(0)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const previousMode = useRef(mode)

  useEffect(() => {
    if (mode === 'hybrid' && previousMode.current !== 'hybrid') {
      inputRef.current?.focus()
    }
    previousMode.current = mode
  }, [mode])

  const isAiMode = mode !== 'browse'

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    onSubmit()
  }

  const handleFileInput = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) onImageSelect(file)
    event.target.value = ''
  }

  const handleDragEnter = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    if (!Array.from(event.dataTransfer.types).includes('Files')) return
    dragDepth.current += 1
    setIsDragging(true)
  }

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setIsDragging(false)
  }

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    dragDepth.current = 0
    setIsDragging(false)
    const file = event.dataTransfer.files?.[0]
    if (file) onImageSelect(file)
  }

  return (
    <div
      className={cn(
        'relative rounded-xl border border-border bg-card shadow-[0_1px_2px_rgba(9,9,11,0.04)] transition-[border-color,box-shadow]',
        isDragging && 'border-foreground/25 shadow-[0_0_0_3px_rgba(24,24,27,0.06)]',
      )}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="flex items-center gap-1 border-b border-border/70 px-2 py-1.5">
        <div
          className="flex items-center rounded-md bg-muted/60 p-0.5"
          role="group"
          aria-label="检索方式"
        >
          <button
            type="button"
            aria-pressed={mode === 'browse'}
            onClick={() => onModeChange('browse')}
            className={cn(
              'inline-flex h-7 items-center gap-1.5 rounded-[5px] px-2.5 text-[11px] font-medium transition-colors',
              mode === 'browse'
                ? 'bg-background text-foreground shadow-xs'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Search className="size-3" />
            <span className="hidden sm:inline">关键词筛选</span>
            <span className="sm:hidden">关键词</span>
          </button>
          <button
            type="button"
            aria-pressed={isAiMode}
            onClick={() => onModeChange('hybrid')}
            className={cn(
              'inline-flex h-7 items-center gap-1.5 rounded-[5px] px-2.5 text-[11px] font-medium transition-colors',
              isAiMode
                ? 'bg-background text-foreground shadow-xs'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Sparkles className="size-3" />
            <span className="hidden sm:inline">AI 混合语义检索</span>
            <span className="sm:hidden">AI 检索</span>
          </button>
        </div>

        <div className="ml-auto flex items-center gap-1 pr-0.5">
          <Popover>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="size-7 text-muted-foreground"
                aria-label="检索方式说明"
              >
                <Info className="size-3.5" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72">
              <PopoverHeader>
                <PopoverTitle className="text-xs">检索方式</PopoverTitle>
                <PopoverDescription className="text-[11px]">
                  两种通道共用同一份在售商品数据。
                </PopoverDescription>
              </PopoverHeader>
              <div className="mt-3 space-y-2.5 text-[11px] leading-5 text-muted-foreground">
                <p>
                  <span className="font-medium text-foreground">关键词筛选</span>
                  ：按商品名称匹配，可叠加出售 / 求购筛选。
                </p>
                <p>
                  <span className="font-medium text-foreground">AI 混合语义检索</span>
                  ：关键词与向量双路召回，由后端融合排序。
                </p>
                <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground/80">
                  hybrid / lexical / pgvector
                </p>
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      <form
        onSubmit={handleSubmit}
        className="flex items-center gap-2 p-2"
        role="search"
        aria-busy={isSearching}
      >
        <div className="relative min-w-0 flex-1">
          {mode === 'browse' ? (
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          ) : mode === 'image' ? (
            <ScanSearch className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          ) : (
            <Sparkles className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          )}
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            maxLength={500}
            placeholder={placeholders[mode]}
            className="h-10 w-full rounded-md border border-transparent bg-muted/30 pl-9 pr-3 text-sm text-foreground outline-none transition-[background-color,border-color,box-shadow] placeholder:text-muted-foreground/80 focus-visible:border-border focus-visible:bg-background focus-visible:ring-[3px] focus-visible:ring-ring/15"
            aria-label="搜索商品"
          />
        </div>

        {imagePreviewUrl ? (
          <div className="relative size-10 shrink-0 overflow-hidden rounded-md border border-border bg-muted">
            <img
              src={imagePreviewUrl}
              alt="以图搜图预览"
              className="size-full object-cover"
            />
            <button
              type="button"
              onClick={onClearImage}
              className="absolute right-0 top-0 flex size-4 items-center justify-center rounded-bl-md bg-foreground/75 text-background transition-colors hover:bg-foreground"
              aria-label="清空以图搜图"
            >
              <X className="size-2.5" />
            </button>
          </div>
        ) : null}

        <input
          ref={fileInputRef}
          type="file"
          accept=".jpg,.jpeg,.png,.webp,.gif,image/jpeg,image/png,image/webp,image/gif"
          onChange={handleFileInput}
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
        />

        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-10 shrink-0"
          onClick={() => fileInputRef.current?.click()}
          aria-label="以图搜图"
          title="以图搜图（JPG / PNG / WebP / GIF，最大 10MB）"
          disabled={isSearching}
        >
          <ImagePlus className="size-4" />
        </Button>

        <Button
          type="submit"
          className="h-10 shrink-0 gap-1.5 px-3 sm:px-4"
          disabled={isSearching}
        >
          {isSearching ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : mode === 'browse' ? (
            <Search className="size-3.5" />
          ) : (
            <Sparkles className="size-3.5" />
          )}
          <span className="text-[13px]">
            {mode === 'browse' ? '搜索' : '检索'}
          </span>
        </Button>
      </form>

      {isDragging ? (
        <div className="pointer-events-none absolute inset-0 z-30 flex flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-foreground/25 bg-background/90 backdrop-blur-sm">
          <ImagePlus className="size-5 text-foreground" />
          <p className="text-xs font-medium text-foreground">松开以图搜图</p>
          <p className="text-[10px] text-muted-foreground">
            JPG / PNG / WebP / GIF · 最大 10MB
          </p>
        </div>
      ) : null}
    </div>
  )
}

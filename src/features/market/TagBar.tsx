import { useEffect, useState, type FormEvent } from 'react'
import { Loader2, Plus, Tag } from 'lucide-react'
import { toast } from 'sonner'
import { ApiError, getApiErrorMessage } from '@/api/client'
import { createTag, listTags } from '@/api/tags'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import type { TagRead } from '@/types/api'

interface TagBarProps {
  activeTag: string | null
  onSelect: (tag: TagRead) => void
  canCreate: boolean
}

export function TagBar({ activeTag, onSelect, canCreate }: TagBarProps) {
  const [tags, setTags] = useState<TagRead[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [name, setName] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)

    listTags()
      .then((data) => {
        if (cancelled) return
        setTags(data)
        setLoadError(null)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setLoadError(getApiErrorMessage(error))
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [reloadKey])

  const handleDialogChange = (open: boolean) => {
    setIsDialogOpen(open)
    if (!open) {
      setName('')
      setFormError(null)
    }
  }

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const trimmed = name.trim()

    if (!trimmed) {
      setFormError('请输入标签名称。')
      return
    }

    setFormError(null)
    setIsCreating(true)

    try {
      const created = await createTag({ name: trimmed })
      setTags((current) =>
        current.some((tag) => tag.id === created.id)
          ? current
          : [...current, created],
      )
      toast.success('标签已创建', { description: `#${created.name}` })
      handleDialogChange(false)
    } catch (error) {
      if (
        error instanceof ApiError &&
        (error.status === 422 || error.code === 'VALIDATION_ERROR')
      ) {
        setFormError(
          error.message.includes('已存在')
            ? '该标签已存在，换一个名称试试。'
            : error.message,
        )
      } else {
        setFormError(getApiErrorMessage(error))
      }
    } finally {
      setIsCreating(false)
    }
  }

  return (
    <div className="mt-3 flex items-center gap-3">
      <div className="flex shrink-0 items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        <Tag className="size-3" />
        <span className="hidden sm:inline">热门标签</span>
      </div>

      {isLoading ? (
        <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
          {[56, 72, 64, 88, 60].map((width) => (
            <Skeleton
              key={width}
              className="h-7 shrink-0 rounded-full"
              style={{ width }}
            />
          ))}
        </div>
      ) : loadError ? (
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="truncate text-[11px] text-muted-foreground">
            标签暂时不可用
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-[11px]"
            onClick={() => setReloadKey((key) => key + 1)}
          >
            重新加载
          </Button>
        </div>
      ) : tags.length === 0 ? (
        <div className="min-w-0 flex-1">
          <span className="text-[11px] text-muted-foreground">
            还没有标签，发布商品时可以创建。
          </span>
        </div>
      ) : (
        <ScrollArea className="min-w-0 flex-1 whitespace-nowrap">
          <div
            className="flex w-max items-center gap-1.5 py-1 pr-1"
            role="group"
            aria-label="热门标签"
          >
            {tags.map((tag) => {
              const isActive = activeTag === tag.name
              return (
                <button
                  key={tag.id}
                  type="button"
                  aria-pressed={isActive}
                  onClick={() => onSelect(tag)}
                  className={cn(
                    'inline-flex h-7 items-center rounded-full border px-3 text-[11px] font-medium transition-colors',
                    isActive
                      ? 'border-foreground bg-foreground text-background'
                      : 'border-border/80 bg-background text-muted-foreground hover:border-foreground/20 hover:text-foreground',
                  )}
                >
                  {tag.name}
                </button>
              )
            })}
          </div>
          <ScrollBar orientation="horizontal" className="h-1.5" />
        </ScrollArea>
      )}

      {canCreate ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 shrink-0 gap-1 rounded-full border-dashed px-2.5 text-[11px]"
          onClick={() => setIsDialogOpen(true)}
        >
          <Plus className="size-3" />
          新建标签
        </Button>
      ) : null}

      <Dialog open={isDialogOpen} onOpenChange={handleDialogChange}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>新建标签</DialogTitle>
            <DialogDescription>
              创建一个商品标签，最多 32 个字符。
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreate} className="space-y-4" noValidate>
            <div className="space-y-2">
              <Label htmlFor="new-tag-name">标签名称</Label>
              <Input
                id="new-tag-name"
                value={name}
                onChange={(event) => {
                  setName(event.target.value)
                  if (formError) setFormError(null)
                }}
                placeholder="如：数码、家居、摄影"
                maxLength={32}
                autoFocus
                aria-invalid={Boolean(formError)}
                disabled={isCreating}
              />
              {formError ? (
                <p className="text-[11px] leading-4 text-destructive">
                  {formError}
                </p>
              ) : (
                <p className="text-[11px] leading-4 text-muted-foreground">
                  标签会在商品广场中作为快捷筛选展示。
                </p>
              )}
            </div>

            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline" disabled={isCreating}>
                  取消
                </Button>
              </DialogClose>
              <Button
                type="submit"
                disabled={isCreating || name.trim().length === 0}
              >
                {isCreating ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : null}
                创建标签
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}

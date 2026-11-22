import { useEffect, useState } from 'react'
import {
  AlertTriangle,
  Loader2,
  Plus,
  RefreshCw,
  Tag,
  Tags,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import { getApiErrorMessage } from '@/api/client'
import { createTag, deleteTag, listTags } from '@/api/tags'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { MAX_TAG_NAME_LENGTH } from '@/features/studio/studio-utils'
import type { TagRead } from '@/types/api'

export function TagGovernancePanel() {
  const [tags, setTags] = useState<TagRead[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const [newName, setNewName] = useState('')
  const [isCreating, setIsCreating] = useState(false)

  const [deleteTarget, setDeleteTarget] = useState<TagRead | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    setError(null)

    listTags()
      .then((data) => {
        if (!cancelled) setTags(data)
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(getApiErrorMessage(loadError))
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [reloadKey])

  const handleCreate = async () => {
    const name = newName.trim()
    if (!name || isCreating) return
    if (name.length > MAX_TAG_NAME_LENGTH) {
      toast.error(`标签名最多 ${MAX_TAG_NAME_LENGTH} 个字符`)
      return
    }

    setIsCreating(true)
    try {
      const created = await createTag({ name })
      toast.success('标签已创建', {
        description: `「${created.name}」已加入全站标签库。`,
      })
      setNewName('')
      setReloadKey((key) => key + 1)
    } catch (createError) {
      toast.error('创建标签失败', {
        description: getApiErrorMessage(createError),
      })
    } finally {
      setIsCreating(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget || isDeleting) return

    setIsDeleting(true)
    setDeleteError(null)

    try {
      await deleteTag(deleteTarget.id)
      toast.success('标签已删除', {
        description: `「${deleteTarget.name}」已从全站标签库移除。`,
      })
      setDeleteTarget(null)
      setReloadKey((key) => key + 1)
      window.dispatchEvent(new CustomEvent('market:inventory-changed'))
    } catch (deleteFailure) {
      setDeleteError(getApiErrorMessage(deleteFailure))
      toast.error('删除标签失败', {
        description: getApiErrorMessage(deleteFailure),
      })
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <header className="flex items-start justify-between gap-3 border-b border-border/70 px-4 py-3.5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Tags className="size-3.5 text-muted-foreground" />
            <h2 className="text-[13px] font-semibold tracking-tight text-foreground">
              平台标签治理
            </h2>
            <Badge variant="outline" className="tabular-nums">
              {tags.length}
            </Badge>
          </div>
          <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
            新建与删除标签仅管理员可操作，删除前需二次确认。
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="刷新标签列表"
          title="刷新标签列表"
          disabled={isLoading}
          onClick={() => setReloadKey((key) => key + 1)}
          className="shrink-0 text-muted-foreground"
        >
          <RefreshCw
            className={cn('size-3.5', isLoading && 'animate-spin')}
          />
        </Button>
      </header>

      <div className="flex items-center gap-2 border-b border-border/70 px-4 py-3">
        <Input
          value={newName}
          maxLength={MAX_TAG_NAME_LENGTH}
          placeholder="新标签名称"
          aria-label="新标签名称"
          onChange={(event) => setNewName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
              event.preventDefault()
              void handleCreate()
            }
          }}
          className="h-8 text-[11.5px]"
        />
        <Button
          type="button"
          size="sm"
          className="h-8 shrink-0 gap-1"
          disabled={!newName.trim() || isCreating}
          onClick={() => void handleCreate()}
        >
          {isCreating ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Plus className="size-3.5" />
          )}
          新建
        </Button>
      </div>

      {error ? (
        <div className="px-4 pt-3">
          <Alert variant="destructive" className="py-2.5">
            <AlertTriangle />
            <AlertTitle className="text-xs">标签列表加载失败</AlertTitle>
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
        </div>
      ) : null}

      {isLoading && tags.length === 0 ? (
        <div className="grid gap-2 p-4">
          {Array.from({ length: 6 }).map((_, index) => (
            <div
              key={index}
              className="flex items-center justify-between gap-3"
            >
              <Skeleton className="h-3.5 w-28" />
              <Skeleton className="h-6 w-6" />
            </div>
          ))}
        </div>
      ) : tags.length === 0 ? (
        <div className="px-6 py-14 text-center">
          <Tag className="mx-auto size-5 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium text-foreground">暂无标签</p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            在上方输入名称创建第一个平台标签。
          </p>
        </div>
      ) : (
        <ul className="grid gap-2 p-4 sm:grid-cols-2 xl:grid-cols-3">
          {tags.map((tag) => (
            <li
              key={tag.id}
              className="flex min-w-0 items-center gap-3 rounded-lg border border-border/70 bg-background px-3 py-2 transition-colors hover:bg-muted/30"
            >
              <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                #{tag.id}
              </span>
              <span className="flex min-w-0 flex-1 items-center gap-1.5">
                <Tag className="size-3 shrink-0 text-muted-foreground" />
                <span className="truncate text-[12px] font-medium text-foreground">
                  {tag.name}
                </span>
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`删除标签「${tag.name}」`}
                title="删除标签"
                className="ml-auto size-7 text-muted-foreground hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40 dark:hover:text-rose-400"
                onClick={() => {
                  setDeleteError(null)
                  setDeleteTarget(tag)
                }}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && !isDeleting) {
            setDeleteTarget(null)
            setDeleteError(null)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除该标签？</AlertDialogTitle>
            <AlertDialogDescription>
              「{deleteTarget?.name}
              」将从全站标签库移除，并与相关商品解除关联，此操作不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>

          {deleteError ? (
            <Alert variant="destructive" className="py-2.5">
              <AlertTriangle />
              <AlertTitle className="text-xs">删除被拒绝</AlertTitle>
              <AlertDescription className="text-[11px] leading-5">
                {deleteError}
              </AlertDescription>
            </Alert>
          ) : null}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(event) => {
                event.preventDefault()
                void handleDelete()
              }}
            >
              {isDeleting ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Trash2 className="size-3.5" />
              )}
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}

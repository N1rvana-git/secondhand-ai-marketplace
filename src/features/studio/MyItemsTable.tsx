import { useEffect, useState } from 'react'
import {
  AlertTriangle,
  Eye,
  ImageOff,
  Loader2,
  Package,
  Pencil,
  Plus,
  Tag,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import { getApiErrorMessage, resolveMediaUrl } from '@/api/client'
import { deleteItem, getItem } from '@/api/items'
import { showApiErrorToast } from '@/lib/errorToast'
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatPrice } from '@/features/market/market-utils'
import { formatDate } from '@/lib/format'
import type { DashboardResponse, ItemRead } from '@/types/api'

type StudioItem = DashboardResponse['my_items'][number]

interface MyItemsTableProps {
  items: StudioItem[]
  onCreate: () => void
  /** 打开编辑前已通过 `GET /items/{id}` 拉取完整 ItemRead。 */
  onEdit: (item: ItemRead) => void
  /** 删除成功后刷新 Dashboard。 */
  onChanged: () => void
}

export function MyItemsTable({
  items,
  onCreate,
  onEdit,
  onChanged,
}: MyItemsTableProps) {
  const [editLoadingId, setEditLoadingId] = useState<number | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<StudioItem | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const [previewId, setPreviewId] = useState<number | null>(null)
  const [previewItem, setPreviewItem] = useState<ItemRead | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)

  useEffect(() => {
    if (previewId == null) return
    let cancelled = false

    setPreviewItem(null)
    setPreviewError(null)
    setPreviewLoading(true)

    getItem(previewId)
      .then((data) => {
        if (!cancelled) setPreviewItem(data)
      })
      .catch((error: unknown) => {
        if (!cancelled) setPreviewError(getApiErrorMessage(error))
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [previewId])

  const closePreview = () => {
    setPreviewId(null)
    setPreviewItem(null)
    setPreviewError(null)
  }

  const handleEdit = async (itemId: number) => {
    setEditLoadingId(itemId)
    setActionError(null)

    try {
      // 关键契约：dashboard.my_items 只有 { id, name, price, is_sold }，
      // 必须拉取完整 ItemRead 后再交给编辑表单，避免残缺数据覆盖库存 / 标签。
      const fullItem = await getItem(itemId)
      onEdit(fullItem)
    } catch (error) {
      const message = getApiErrorMessage(error)
      setActionError(message)
      showApiErrorToast(error, '无法加载商品详情')
    } finally {
      setEditLoadingId(null)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget || isDeleting) return

    setIsDeleting(true)
    setDeleteError(null)

    try {
      await deleteItem(deleteTarget.id)
      toast.success('商品已删除', {
        description: `「${deleteTarget.name}」已从你的发布中移除。`,
      })
      setDeleteTarget(null)
      setActionError(null)
      onChanged()
      window.dispatchEvent(new CustomEvent('market:inventory-changed'))
    } catch (error) {
      const message = getApiErrorMessage(error)
      setDeleteError(message)
      setActionError(message)
      showApiErrorToast(error, '删除失败')
    } finally {
      setIsDeleting(false)
    }
  }

  const closeDeleteDialog = () => {
    if (isDeleting) return
    setDeleteTarget(null)
    setDeleteError(null)
  }

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <header className="flex items-start justify-between gap-3 border-b border-border/70 px-4 py-3.5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Package className="size-3.5 text-muted-foreground" />
            <h2 className="text-[13px] font-semibold tracking-tight text-foreground">
              我的发布
            </h2>
          </div>
          <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
            在售与历史发布共 {items.length} 件，历史订单关联中的商品不可删除。
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 shrink-0 gap-1 px-2 text-[11px]"
          onClick={onCreate}
        >
          <Plus className="size-3" />
          发布
        </Button>
      </header>

      {actionError ? (
        <div className="px-4 pt-3">
          <Alert variant="destructive" className="py-2.5">
            <AlertTriangle />
            <AlertTitle className="text-xs">操作未完成</AlertTitle>
            <AlertDescription className="text-[11px] leading-5">
              {actionError}
            </AlertDescription>
          </Alert>
        </div>
      ) : null}

      {items.length === 0 ? (
        <div className="px-6 py-16 text-center">
          <div className="mx-auto flex size-10 items-center justify-center rounded-full border border-border bg-muted/30">
            <Package className="size-4 text-muted-foreground" />
          </div>
          <p className="mt-4 text-sm font-medium text-foreground">
            还没有发布商品
          </p>
          <p className="mx-auto mt-1.5 max-w-sm text-xs leading-5 text-muted-foreground">
            上传一张图片，AI 会自动给出标题建议与标签，确认后即可上架。
          </p>
          <Button type="button" size="sm" className="mt-4" onClick={onCreate}>
            <Plus className="size-3.5" />
            发布第一件商品
          </Button>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="pl-4">商品名称</TableHead>
              <TableHead className="text-right">价格</TableHead>
              <TableHead>状态</TableHead>
              <TableHead className="pr-4 text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.id}>
                <TableCell className="max-w-[360px] pl-4">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                      #{item.id}
                    </span>
                    <span className="line-clamp-1 text-[12.5px] font-medium text-foreground">
                      {item.name}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="text-right font-mono text-[12px] tabular-nums text-foreground">
                  ¥{formatPrice(item.price)}
                </TableCell>
                <TableCell>
                  <Badge
                    variant={item.is_sold ? 'outline' : 'success'}
                    className="text-[10px]"
                  >
                    {item.is_sold ? '已售罄' : '在售中'}
                  </Badge>
                </TableCell>
                <TableCell className="pr-4">
                  <div className="flex items-center justify-end gap-0.5">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`预览「${item.name}」`}
                      title="预览"
                      onClick={() => setPreviewId(item.id)}
                    >
                      <Eye className="size-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`编辑「${item.name}」`}
                      title="编辑"
                      disabled={editLoadingId !== null}
                      onClick={() => void handleEdit(item.id)}
                    >
                      {editLoadingId === item.id ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <Pencil className="size-3.5" />
                      )}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`删除「${item.name}」`}
                      title="删除"
                      className="text-muted-foreground hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40 dark:hover:text-rose-400"
                      onClick={() => {
                        setDeleteError(null)
                        setDeleteTarget(item)
                      }}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) closeDeleteDialog()
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除该商品？</AlertDialogTitle>
            <AlertDialogDescription>
              「{deleteTarget?.name}」将从交易广场与你的发布中永久移除，此操作不可撤销。
              如果该商品已有历史订单，后端会拒绝删除并返回具体原因。
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

      <Dialog
        open={previewId !== null}
        onOpenChange={(open) => {
          if (!open) closePreview()
        }}
      >
        <DialogContent className="max-h-[88svh] gap-0 overflow-y-auto p-0 sm:max-w-lg">
          {previewLoading ? (
            <div className="space-y-4 p-5">
              <DialogTitle className="sr-only">商品预览</DialogTitle>
              <Skeleton className="aspect-[16/9] w-full rounded-lg" />
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-7 w-1/3" />
              <Skeleton className="h-3 w-full" />
            </div>
          ) : previewError ? (
            <div className="p-5">
              <DialogTitle className="sr-only">商品预览</DialogTitle>
              <Alert variant="destructive">
                <AlertTriangle />
                <AlertTitle className="text-xs">商品详情加载失败</AlertTitle>
                <AlertDescription className="text-[11px] leading-5">
                  {previewError}
                </AlertDescription>
              </Alert>
            </div>
          ) : previewItem ? (
            <div>
              <div className="relative aspect-[16/9] overflow-hidden bg-muted">
                {previewItem.image_path ? (
                  <img
                    src={resolveMediaUrl(previewItem.image_path)}
                    alt={previewItem.name}
                    className="absolute inset-0 size-full object-cover"
                  />
                ) : (
                  <div className="flex size-full items-center justify-center gap-2 text-muted-foreground/70">
                    <ImageOff className="size-6" strokeWidth={1.25} />
                    <span className="text-[11px]">暂无图片</span>
                  </div>
                )}
                <div className="absolute left-3 top-3 flex flex-wrap gap-1.5">
                  <Badge
                    variant="outline"
                    className="border-border/60 bg-background/80 text-[10px] font-normal backdrop-blur-md"
                  >
                    {previewItem.is_offer === false ? '求购帖' : '出售帖'}
                  </Badge>
                  <Badge
                    variant={previewItem.is_sold ? 'outline' : 'success'}
                    className="text-[10px]"
                  >
                    {previewItem.is_sold ? '已售罄' : '在售中'}
                  </Badge>
                </div>
              </div>

              <div className="space-y-4 p-5">
                <div className="pr-8">
                  <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                    Listing #{String(previewItem.id).padStart(4, '0')}
                  </p>
                  <DialogTitle className="mt-1.5 text-lg leading-6 tracking-[-0.02em]">
                    {previewItem.name}
                  </DialogTitle>
                  <DialogDescription className="mt-1 text-[11px]">
                    发布于 {formatDate(previewItem.created_at)}
                  </DialogDescription>
                </div>

                <div className="flex items-end justify-between gap-3">
                  <p className="flex items-baseline gap-1 font-mono text-2xl font-semibold tracking-tight text-foreground">
                    <span className="text-xs font-normal text-muted-foreground">
                      ¥
                    </span>
                    <span className="tabular-nums">
                      {formatPrice(previewItem.price)}
                    </span>
                  </p>
                  <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                    库存 {previewItem.inventory}
                  </span>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {previewItem.tags.length > 0 ? (
                    previewItem.tags.map((tag) => (
                      <Badge
                        key={tag.id}
                        variant="outline"
                        className="px-2 py-0 text-[10px] font-normal text-muted-foreground"
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

                <div className="flex items-center justify-end gap-2 border-t border-border/70 pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={closePreview}
                  >
                    关闭
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => {
                      const target = previewItem
                      closePreview()
                      onEdit(target)
                    }}
                  >
                    <Pencil className="size-3.5" />
                    编辑该商品
                  </Button>
                </div>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </section>
  )
}

import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import {
  AlertTriangle,
  ImagePlus,
  Loader2,
  Plus,
  Tag,
  Upload,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  createIdempotencyKey,
  getApiErrorMessage,
  resolveMediaUrl,
} from '@/api/client'
import { showApiErrorToast } from '@/lib/errorToast'
import {
  analyzeUpload,
  createItem,
  updateItem,
  uploadImage,
} from '@/api/items'
import { listTags } from '@/api/tags'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { validateImageFile } from '@/features/market/market-utils'
import {
  MAX_ITEM_INVENTORY,
  MAX_ITEM_NAME_LENGTH,
  MAX_ITEM_PRICE,
  MAX_TAG_NAME_LENGTH,
  MAX_TAGS,
  dedupeTagNames,
  resolveTagIds,
  validateItemForm,
  type ItemFormValues,
} from '@/features/studio/studio-utils'
import { cn } from '@/lib/utils'
import type {
  ItemCreateRequest,
  ItemRead,
  TagRead,
} from '@/types/api'

interface ItemFormDialogProps {
  open: boolean
  mode: 'create' | 'edit'
  /** 编辑模式必须传入通过 `GET /items/{id}` 拉取到的完整 ItemRead。 */
  item: ItemRead | null
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}

function buildInitialValues(
  mode: 'create' | 'edit',
  item: ItemRead | null,
): ItemFormValues {
  if (mode === 'edit' && item) {
    return {
      name: item.name,
      price: String(item.price),
      inventory: String(item.inventory),
      is_offer: item.is_offer ?? true,
      image_path: item.image_path,
    }
  }

  return {
    name: '',
    price: '',
    inventory: '1',
    is_offer: true,
    image_path: null,
  }
}

export function ItemFormDialog({
  open,
  mode,
  item,
  onOpenChange,
  onSaved,
}: ItemFormDialogProps) {
  const [form, setForm] = useState<ItemFormValues>(() =>
    buildInitialValues(mode, item),
  )
  const [selectedNames, setSelectedNames] = useState<string[]>(
    () => item?.tags.map((tag) => tag.name) ?? [],
  )
  const [existingTags, setExistingTags] = useState<TagRead[]>([])
  const [tagInput, setTagInput] = useState('')
  const [isLoadingTags, setIsLoadingTags] = useState(true)
  const [isUploading, setIsUploading] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [tagHint, setTagHint] = useState<string | null>(null)
  const [actionIdempotencyKey, setActionIdempotencyKey] = useState(
    () => createIdempotencyKey(),
  )

  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let cancelled = false
    setIsLoadingTags(true)

    listTags()
      .then((tags) => {
        if (!cancelled) setExistingTags(tags)
      })
      .catch((error: unknown) => {
        if (!cancelled) setTagHint(getApiErrorMessage(error))
      })
      .finally(() => {
        if (!cancelled) setIsLoadingTags(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  const imagePreview = form.image_path
    ? resolveMediaUrl(form.image_path)
    : null

  const customNames = selectedNames.filter(
    (name) => !existingTags.some((tag) => tag.name === name),
  )

  const toggleTag = (name: string) => {
    if (selectedNames.includes(name)) {
      setSelectedNames(selectedNames.filter((entry) => entry !== name))
      return
    }
    if (selectedNames.length >= MAX_TAGS) {
      toast.error(`最多只能选择 ${MAX_TAGS} 个标签`)
      return
    }
    setSelectedNames([...selectedNames, name])
  }

  const addTagName = () => {
    const name = tagInput.trim()
    if (!name) return
    if (name.length > MAX_TAG_NAME_LENGTH) {
      toast.error(`标签名最多 ${MAX_TAG_NAME_LENGTH} 个字符`)
      return
    }
    if (selectedNames.includes(name)) {
      setTagInput('')
      return
    }
    if (selectedNames.length >= MAX_TAGS) {
      toast.error(`最多只能选择 ${MAX_TAGS} 个标签`)
      return
    }
    setSelectedNames([...selectedNames, name])
    setTagInput('')
  }

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    const validationError = validateImageFile(file)
    if (validationError) {
      toast.error('图片不符合要求', { description: validationError })
      return
    }

    setIsUploading(true)
    setFormError(null)

    try {
      if (mode === 'create') {
        // 发布模式：一次请求同时完成上传 + 视觉打标；视觉模型关闭时后端
        // 仍返回 200 与 image_url，只是 suggested_tags 为空，不能按错误处理。
        const result = await analyzeUpload(file)
        const suggestedTitle =
          typeof result.suggested_title === 'string'
            ? result.suggested_title.trim()
            : ''

        setForm((current) => ({
          ...current,
          image_path: result.image_url,
          name: current.name.trim()
            ? current.name
            : suggestedTitle || current.name,
        }))

        const suggested = dedupeTagNames(
          Array.isArray(result.suggested_tags) ? result.suggested_tags : [],
        )
        if (suggested.length > 0) {
          setSelectedNames((current) =>
            dedupeTagNames([...current, ...suggested]).slice(0, MAX_TAGS),
          )
          setTagHint(null)
          toast.success('AI 已推荐标签', {
            description: suggested.join(' · '),
          })
        } else {
          setTagHint('当前环境未启用视觉打标，可手动选择或输入标签')
        }
      } else {
        // 编辑模式：只替换图片，不触碰用户已经写好的标题与标签。
        const result = await uploadImage(file)
        setForm((current) => ({ ...current, image_path: result.url }))
        setTagHint(null)
        toast.success('图片已更新')
      }
    } catch (error) {
      showApiErrorToast(
        error,
        mode === 'create' ? 'AI 识别失败' : '图片上传失败',
      )
    } finally {
      setIsUploading(false)
    }
  }

  const handleSubmit = async () => {
    if (isSubmitting) return

    const validationError = validateItemForm(form)
    if (validationError) {
      setFormError(validationError)
      return
    }

    setIsSubmitting(true)
    setFormError(null)

    try {
      const tagIds = await resolveTagIds(selectedNames, existingTags)

      // 严格白名单载荷：后端 ItemCreate / ItemUpdate 均为 extra="forbid"，
      // 禁止 spread 表单或 ItemRead，避免 is_sold / owner_id 等只读字段泄漏。
      const payload: ItemCreateRequest = {
        name: form.name.trim(),
        price: Number(form.price),
        is_offer: Boolean(form.is_offer),
        image_path: form.image_path || null,
        inventory: Number(form.inventory),
        tag_ids: tagIds,
      }

      if (mode === 'edit') {
        if (!item) throw new Error('缺少待编辑的商品数据。')
        await updateItem(item.id, payload)
        toast.success('商品已更新')
      } else {
        await createItem(payload, actionIdempotencyKey)
        toast.success('商品已发布', {
          description: '已同步到交易广场。',
        })
        setActionIdempotencyKey(createIdempotencyKey())
      }

      onSaved()
      window.dispatchEvent(new CustomEvent('market:inventory-changed'))
      onOpenChange(false)
    } catch (error) {
      const message = getApiErrorMessage(error)
      setFormError(message)
      showApiErrorToast(
        error,
        mode === 'create' ? '发布失败' : '保存失败',
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && isSubmitting) return
        onOpenChange(next)
      }}
    >
      <DialogContent className="max-h-[90svh] gap-0 overflow-y-auto p-0 sm:max-w-2xl">
        <DialogHeader className="border-b border-border/70 px-5 pb-4 pt-5">
          <DialogTitle className="text-base tracking-tight">
            {mode === 'create' ? '发布新商品' : '编辑商品'}
          </DialogTitle>
          <DialogDescription className="text-[11px] leading-5">
            {mode === 'create'
              ? '上传图片后 AI 会自动给出标题与标签建议；提交前请确认价格、库存与标签。'
              : '编辑只会更新白名单字段，图片更换不会覆盖你已填写的标题与标签。'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 px-5 py-5">
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label className="text-[11px] font-medium text-foreground">
                商品图片
              </Label>
              <span className="text-[10px] text-muted-foreground">
                JPG / PNG / WebP / GIF · ≤ 10MB
              </span>
            </div>

            <div className="relative overflow-hidden rounded-lg border border-dashed border-border bg-muted/20">
              {imagePreview ? (
                <div className="relative aspect-[16/9]">
                  <img
                    src={imagePreview}
                    alt="商品预览"
                    className="absolute inset-0 size-full object-cover"
                  />
                  <div className="absolute right-2 top-2 flex gap-1.5">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="h-7 gap-1 border border-border/60 bg-background/80 px-2 text-[10px] backdrop-blur-md"
                      disabled={isUploading}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <Upload className="size-3" />
                      更换
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      size="icon-sm"
                      aria-label="移除图片"
                      title="移除图片"
                      disabled={isUploading}
                      className="size-7 border border-border/60 bg-background/80 backdrop-blur-md"
                      onClick={() =>
                        setForm((current) => ({
                          ...current,
                          image_path: null,
                        }))
                      }
                    >
                      <X className="size-3" />
                    </Button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={isUploading}
                  onClick={() => fileInputRef.current?.click()}
                  className="flex aspect-[16/6] w-full flex-col items-center justify-center gap-2 text-muted-foreground transition-colors hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isUploading ? (
                    <Loader2 className="size-5 animate-spin" />
                  ) : (
                    <ImagePlus className="size-5" strokeWidth={1.25} />
                  )}
                  <span className="text-[11px]">
                    {isUploading
                      ? mode === 'create'
                        ? '正在上传并识别图片…'
                        : '正在上传图片…'
                      : '点击上传图片'}
                  </span>
                </button>
              )}

              {isUploading && imagePreview ? (
                <div className="absolute inset-0 flex items-center justify-center bg-background/60 backdrop-blur-[1px]">
                  <Loader2 className="size-5 animate-spin text-foreground" />
                </div>
              ) : null}
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept=".jpg,.jpeg,.png,.webp,.gif,image/jpeg,image/png,image/webp,image/gif"
              className="hidden"
              onChange={(event) => void handleFileChange(event)}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_140px]">
            <div className="space-y-1.5">
              <Label
                htmlFor="item-name"
                className="text-[11px] font-medium text-foreground"
              >
                商品名称
              </Label>
              <Input
                id="item-name"
                value={form.name}
                maxLength={MAX_ITEM_NAME_LENGTH}
                placeholder="例如：95 新 HHKB Pro 2 静电容键盘"
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
                className="h-9"
              />
              <p className="text-[10px] text-muted-foreground">
                1–{MAX_ITEM_NAME_LENGTH} 个字符
              </p>
            </div>

            <div className="space-y-1.5">
              <Label
                htmlFor="item-inventory"
                className="text-[11px] font-medium text-foreground"
              >
                库存
              </Label>
              <Input
                id="item-inventory"
                type="number"
                inputMode="numeric"
                min={0}
                max={MAX_ITEM_INVENTORY}
                step={1}
                value={form.inventory}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    inventory: event.target.value,
                  }))
                }
                className="h-9 font-mono tabular-nums"
              />
              <p className="text-[10px] text-muted-foreground">
                发售卖品建议默认 1
              </p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="space-y-1.5">
              <Label
                htmlFor="item-price"
                className="text-[11px] font-medium text-foreground"
              >
                价格（元）
              </Label>
              <Input
                id="item-price"
                type="number"
                inputMode="decimal"
                min={0}
                max={MAX_ITEM_PRICE}
                step="0.01"
                value={form.price}
                placeholder="0.00"
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    price: event.target.value,
                  }))
                }
                className="h-9 font-mono tabular-nums"
              />
              <p className="text-[10px] text-muted-foreground">
                0 – {MAX_ITEM_PRICE.toLocaleString('en-US')}
              </p>
            </div>

            <div className="space-y-1.5">
              <Label className="text-[11px] font-medium text-foreground">
                商品类型
              </Label>
              <div className="flex h-9 items-center gap-2 rounded-md border border-input bg-transparent px-3 dark:bg-input/20">
                <Switch
                  id="item-offer"
                  checked={form.is_offer}
                  onCheckedChange={(checked) =>
                    setForm((current) => ({
                      ...current,
                      is_offer: checked,
                    }))
                  }
                />
                <Label
                  htmlFor="item-offer"
                  className="text-[11.5px] font-normal text-foreground"
                >
                  {form.is_offer ? '出售' : '求购'}
                </Label>
                <span className="ml-auto text-[10px] text-muted-foreground">
                  {form.is_offer ? '参与抢购' : '仅展示需求'}
                </span>
              </div>
              <p className="text-[10px] text-muted-foreground">
                求购帖不会生成库存订单
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label className="flex items-center gap-1.5 text-[11px] font-medium text-foreground">
                <Tag className="size-3" />
                标签
              </Label>
              <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                {selectedNames.length}/{MAX_TAGS}
              </span>
            </div>

            {isLoadingTags ? (
              <div className="flex flex-wrap gap-1.5">
                {Array.from({ length: 6 }).map((_, index) => (
                  <span
                    key={index}
                    className="h-6 w-16 animate-pulse rounded-full bg-muted"
                  />
                ))}
              </div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {existingTags.map((tag) => {
                  const selected = selectedNames.includes(tag.name)
                  return (
                    <button
                      key={tag.id}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => toggleTag(tag.name)}
                      className={cn(
                        'inline-flex h-6 items-center gap-1 rounded-full border px-2 text-[10.5px] transition-colors',
                        selected
                          ? 'border-foreground/20 bg-secondary text-foreground'
                          : 'border-border/80 bg-transparent text-muted-foreground hover:bg-muted/50 hover:text-foreground',
                      )}
                    >
                      {selected ? <X className="size-2.5" /> : null}
                      {tag.name}
                    </button>
                  )
                })}

                {customNames.map((name) => (
                  <Badge
                    key={`custom-${name}`}
                    variant="secondary"
                    className="h-6 gap-1 rounded-full px-2 text-[10.5px] font-normal"
                  >
                    <Tag className="size-2.5" />
                    {name}
                    <button
                      type="button"
                      aria-label={`移除标签 ${name}`}
                      className="ml-0.5 rounded-full text-muted-foreground hover:text-foreground"
                      onClick={() =>
                        setSelectedNames(
                          selectedNames.filter((entry) => entry !== name),
                        )
                      }
                    >
                      <X className="size-2.5" />
                    </button>
                  </Badge>
                ))}

                {existingTags.length === 0 && customNames.length === 0 ? (
                  <span className="text-[11px] text-muted-foreground">
                    暂无可选标签，可在右侧输入新标签。
                  </span>
                ) : null}
              </div>
            )}

            <div className="flex items-center gap-2">
              <Input
                value={tagInput}
                maxLength={MAX_TAG_NAME_LENGTH}
                placeholder="输入新标签名，回车添加"
                onChange={(event) => setTagInput(event.target.value)}
                onKeyDown={(event) => {
                  if (
                    event.key === 'Enter' &&
                    !event.nativeEvent.isComposing
                  ) {
                    event.preventDefault()
                    addTagName()
                  }
                }}
                className="h-8 text-[11.5px]"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 shrink-0 gap-1"
                disabled={!tagInput.trim()}
                onClick={addTagName}
              >
                <Plus className="size-3" />
                添加
              </Button>
            </div>

            {tagHint ? (
              <p className="text-[10px] leading-4 text-muted-foreground">
                {tagHint}
              </p>
            ) : null}
          </div>

          {formError ? (
            <Alert variant="destructive" className="py-2.5">
              <AlertTriangle />
              <AlertTitle className="text-xs">提交未完成</AlertTitle>
              <AlertDescription className="text-[11px] leading-5">
                {formError}
              </AlertDescription>
            </Alert>
          ) : null}
        </div>

        <DialogFooter className="border-t border-border/70 px-5 py-3.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isSubmitting}
            onClick={() => onOpenChange(false)}
          >
            取消
          </Button>
          <Button
            type="button"
            size="sm"
            className="gap-1.5"
            disabled={isSubmitting || isUploading}
            onClick={() => void handleSubmit()}
          >
            {isSubmitting ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : mode === 'create' ? (
              <Plus className="size-3.5" />
            ) : (
              <Tag className="size-3.5" />
            )}
            {mode === 'create' ? '发布商品' : '保存修改'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

import { ApiError } from '@/api/client'
import { createTag, listTags } from '@/api/tags'
import type { TagRead } from '@/types/api'

export const MAX_TAGS = 32
export const MAX_TAG_NAME_LENGTH = 32
export const MAX_ITEM_NAME_LENGTH = 120
export const MAX_ITEM_PRICE = 10_000_000
export const MAX_ITEM_INVENTORY = 1_000_000

type BadgeVariant =
  | 'default'
  | 'secondary'
  | 'destructive'
  | 'outline'
  | 'success'
  | 'warning'
  | 'danger'

export interface OrderStatusMeta {
  label: string
  variant: BadgeVariant
}

const ORDER_STATUS_META: Record<string, OrderStatusMeta> = {
  paid: { label: '已支付', variant: 'success' },
  pending: { label: '待处理', variant: 'warning' },
  completed: { label: '已完成', variant: 'secondary' },
  cancelled: { label: '已取消', variant: 'danger' },
}

export function getOrderStatusMeta(status: string): OrderStatusMeta {
  return (
    ORDER_STATUS_META[status] ?? {
      label: status || '未知状态',
      variant: 'outline',
    }
  )
}

function parseServerDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const naive = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(
    value,
  )
  const date = new Date(naive ? `${value.replace(' ', 'T')}Z` : value)
  return Number.isNaN(date.getTime()) ? null : date
}

/** 下单时间本地化：统一补齐到分钟，避免不同浏览器展示不一致。 */
export function formatOrderTime(value: string | null | undefined): string {
  const date = parseServerDate(value)
  if (!date) return '—'
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}

export function dedupeTagNames(names: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const raw of names) {
    const name = raw.trim()
    if (!name || seen.has(name)) continue
    seen.add(name)
    result.push(name)
  }
  return result
}

/**
 * 把表单里的「标签名」映射为后端要求的 `tag_ids`。
 *
 * - 已有标签直接复用 id；
 * - 新建 / AI 推荐但库中不存在的标签，逐个 `POST /items/tags` 创建；
 * - 并发创建撞上 422（同名重复）时，重拉一次标签列表取其 id，保证提交不中断。
 */
export async function resolveTagIds(
  selectedNames: string[],
  existingTags: TagRead[],
): Promise<number[]> {
  const names = dedupeTagNames(selectedNames)
  const byName = new Map(existingTags.map((tag) => [tag.name, tag.id]))
  const ids: number[] = []

  for (const name of names) {
    const existingId = byName.get(name)
    if (existingId != null) {
      ids.push(existingId)
      continue
    }

    try {
      const created = await createTag({ name })
      byName.set(created.name, created.id)
      ids.push(created.id)
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 422) throw error

      const refreshed = await listTags()
      const found = refreshed.find((tag) => tag.name === name)
      if (!found) throw error
      byName.set(found.name, found.id)
      ids.push(found.id)
    }
  }

  return ids
}

export interface ItemFormValues {
  name: string
  price: string
  inventory: string
  is_offer: boolean
  image_path: string | null
}

export function validateItemForm(values: ItemFormValues): string | null {
  const name = values.name.trim()
  if (name.length === 0) return '请填写商品名称。'
  if (name.length > MAX_ITEM_NAME_LENGTH) {
    return `商品名称最多 ${MAX_ITEM_NAME_LENGTH} 个字符。`
  }

  if (values.price.trim() === '') return '请填写商品价格。'
  const price = Number(values.price)
  if (!Number.isFinite(price)) return '请填写有效的商品价格。'
  if (price < 0 || price > MAX_ITEM_PRICE) {
    return `价格需在 0 到 ${MAX_ITEM_PRICE.toLocaleString('en-US')} 之间。`
  }

  if (values.inventory.trim() === '') return '请填写库存数量。'
  const inventory = Number(values.inventory)
  if (!Number.isFinite(inventory)) return '请填写有效的库存数量。'
  if (!Number.isInteger(inventory)) return '库存必须为整数。'
  if (inventory < 0 || inventory > MAX_ITEM_INVENTORY) {
    return `库存需为 0 到 ${MAX_ITEM_INVENTORY.toLocaleString('en-US')} 之间的整数。`
  }

  return null
}

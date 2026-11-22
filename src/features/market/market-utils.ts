import { ApiError } from '@/api/client'
import type { ItemRead, ItemSearchHit } from '@/types/api'

export type MarketMode = 'browse' | 'hybrid' | 'image'
export type OfferFilter = 'all' | 'offer' | 'want'

export interface FavoriteState {
  favorited: boolean
  count: number
}

export type FavoriteMap = Record<number, FavoriteState>

/**
 * A listing rendered in the market grid. Search hits carry the retrieval
 * metadata (`score` / `match_reason`); plain listings leave it undefined.
 */
export interface MarketItem extends ItemRead {
  score?: number | null
  match_reason?: ItemSearchHit['match_reason']
}

export type PurchaseKind = 'buy' | 'login' | 'sold' | 'own' | 'want'

export interface PurchaseState {
  kind: PurchaseKind
  label: string
  disabled: boolean
}

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024
export const PAGE_SIZE_OPTIONS = [12, 24, 36] as const

const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'gif']
const IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]

export function formatPrice(value: number): string {
  return new Intl.NumberFormat('zh-CN', {
    maximumFractionDigits: 2,
  }).format(value)
}

export function formatScore(value: number | null | undefined): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  // RRF 融合分在纯 lexical 模式下约为 0.016，两位小数会全部显示成 0.02；
  // 小分值保留四位，与后端 JSON 的 score 精度一致。
  return value < 0.1 ? value.toFixed(4) : value.toFixed(2)
}

export function getPurchaseState(
  item: ItemRead,
  userId: number | null | undefined,
): PurchaseState {
  if (item.is_offer === false) {
    return { kind: 'want', label: '求购信息', disabled: true }
  }
  if (item.is_sold || item.inventory <= 0) {
    return { kind: 'sold', label: '已售罄', disabled: true }
  }
  if (userId != null && item.owner_id === userId) {
    return { kind: 'own', label: '我的发布', disabled: true }
  }
  if (userId == null) {
    return { kind: 'login', label: '登录后抢购', disabled: false }
  }
  return { kind: 'buy', label: '立即抢购', disabled: false }
}

export function getMatchLabel(
  item: MarketItem,
  mode: MarketMode,
  index: number,
): string | null {
  if (mode === 'image') {
    if (index === 0) return '视觉匹配度最高'
    const score = formatScore(item.score)
    return score ? `视觉匹配 · ${score}` : '视觉匹配'
  }

  if (mode !== 'hybrid') return null

  if (item.match_reason === 'hybrid') {
    const score = formatScore(item.score)
    return score ? `混合匹配 · ${score}` : '混合匹配'
  }
  if (item.match_reason === 'semantic') {
    const score = formatScore(item.score)
    return score ? `语义匹配 · ${score}` : '语义匹配'
  }
  if (item.match_reason === 'lexical') {
    const score = formatScore(item.score)
    return score ? `关键词匹配 · ${score}` : '关键词匹配'
  }

  const score = formatScore(item.score)
  return score ? `语义匹配 · ${score}` : '语义匹配'
}

export function filterByOffer(
  items: MarketItem[],
  filter: OfferFilter,
): MarketItem[] {
  if (filter === 'all') return items
  if (filter === 'offer') return items.filter((item) => item.is_offer !== false)
  return items.filter((item) => item.is_offer === false)
}

export function validateImageFile(file: File): string | null {
  const extension = file.name.includes('.')
    ? (file.name.split('.').pop() ?? '').toLowerCase()
    : ''
  const hasValidExtension = IMAGE_EXTENSIONS.includes(extension)
  const hasValidType = IMAGE_MIME_TYPES.includes(file.type)

  if (!hasValidExtension && !hasValidType) {
    return '仅支持 JPG、PNG、WebP、GIF 格式的图片。'
  }
  if (file.size === 0) {
    return '图片内容为空，请重新选择。'
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return '图片大小不能超过 10MB。'
  }
  return null
}

export function isFeatureUnavailable(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'FEATURE_UNAVAILABLE'
}

export function createIdempotencyKey(): string {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return crypto.randomUUID()
  }
  return `market-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`
}

/**
 * Pull a remote listing image into a File so it can be posted to
 * `/items/search-by-image`. Any CORS / decoding failure is surfaced to the
 * caller, which then gracefully falls back to semantic text search.
 */
export async function imageUrlToFile(
  url: string,
  name: string,
): Promise<File> {
  const response = await fetch(url, {
    mode: 'cors',
    credentials: 'omit',
  })

  if (!response.ok) {
    throw new Error(`图片获取失败（HTTP ${response.status}）`)
  }

  const blob = await response.blob()
  const type = blob.type || 'image/jpeg'

  if (!type.startsWith('image/')) {
    throw new Error('返回内容不是有效图片')
  }
  if (blob.size > MAX_IMAGE_BYTES) {
    throw new Error('图片大小超过 10MB')
  }

  const extension = type.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg'
  const safeName =
    name
      .trim()
      .slice(0, 40)
      .replace(/[\\/:*?"<>|]/g, '') || 'similar-item'

  return new File([blob], `${safeName}.${extension}`, { type })
}

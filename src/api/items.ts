import { apiClient, withIdempotencyKey } from '@/api/client'
import type {
  AnalyzeUploadResponse,
  BuyItemResponse,
  FavoriteToggleResponse,
  ImageUploadResponse,
  ItemCreateRequest,
  ItemListResponse,
  ItemRead,
  ItemUpdateRequest,
  SearchResponse,
} from '@/types/api'

export interface ItemListParams {
  skip?: number
  limit?: number
  search?: string
  is_offer_filter?: boolean
  tag_id?: number
}

export interface TextSearchOptions {
  /** 检索结果是否包含求购帖（后端默认只返回出售帖） */
  includeWants?: boolean
}

export async function listItems(
  params?: ItemListParams,
): Promise<ItemListResponse> {
  const { data } = await apiClient.get<ItemListResponse>('/items', {
    params,
  })
  return data
}

export async function getItem(itemId: number): Promise<ItemRead> {
  const { data } = await apiClient.get<ItemRead>(`/items/${itemId}`)
  return data
}

export async function createItem(
  payload: ItemCreateRequest,
  idempotencyKey?: string,
): Promise<ItemRead> {
  const { data } = await apiClient.post<ItemRead>('/items', payload, {
    headers: withIdempotencyKey(idempotencyKey),
  })
  return data
}

export async function updateItem(
  itemId: number,
  payload: ItemUpdateRequest,
): Promise<ItemRead> {
  const { data } = await apiClient.put<ItemRead>(
    `/items/${itemId}`,
    payload,
  )
  return data
}

export async function deleteItem(itemId: number): Promise<void> {
  await apiClient.delete(`/items/${itemId}`)
}

export async function uploadImage(
  file: File,
): Promise<ImageUploadResponse> {
  const formData = new FormData()
  formData.append('file', file)

  const { data } = await apiClient.post<ImageUploadResponse>(
    '/items/upload-image',
    formData,
  )
  return data
}

export async function analyzeUpload(
  file: File,
): Promise<AnalyzeUploadResponse> {
  const formData = new FormData()
  formData.append('file', file)

  const { data } = await apiClient.post<AnalyzeUploadResponse>(
    '/items/analyze-upload',
    formData,
  )
  return data
}

export async function searchByText(
  queryText: string,
  options?: TextSearchOptions,
): Promise<SearchResponse> {
  const { data } = await apiClient.post<SearchResponse>(
    '/items/search-by-text',
    {
      query_text: queryText,
      ...(options?.includeWants ? { include_wants: true } : {}),
    },
  )
  return data
}

export async function searchByImage(
  file: File,
): Promise<SearchResponse> {
  const formData = new FormData()
  formData.append('file', file)

  const { data } = await apiClient.post<SearchResponse>(
    '/items/search-by-image',
    formData,
  )
  return data
}

export async function toggleFavorite(
  itemId: number,
): Promise<FavoriteToggleResponse> {
  const { data } = await apiClient.post<FavoriteToggleResponse>(
    `/items/${itemId}/favorite`,
  )
  return data
}

export async function buyItem(
  itemId: number,
  idempotencyKey?: string,
): Promise<BuyItemResponse> {
  const { data } = await apiClient.post<BuyItemResponse>(
    `/items/${itemId}/buy`,
    undefined,
    {
      headers: withIdempotencyKey(idempotencyKey),
    },
  )
  return data
}

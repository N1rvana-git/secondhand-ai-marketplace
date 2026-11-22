import { apiClient } from '@/api/client'
import type { TagCreateRequest, TagRead } from '@/types/api'

export async function listTags(): Promise<TagRead[]> {
  const { data } = await apiClient.get<TagRead[]>('/items/tags')
  return data
}

export async function createTag(
  payload: TagCreateRequest,
): Promise<TagRead> {
  const { data } = await apiClient.post<TagRead>('/items/tags', payload)
  return data
}

export async function deleteTag(tagId: number): Promise<void> {
  await apiClient.delete(`/items/tags/${tagId}`)
}

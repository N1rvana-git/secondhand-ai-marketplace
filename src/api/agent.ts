import { apiClient } from '@/api/client'
import type {
  ApprovalRecord,
  ChatHistoryItem,
  ResumeThreadRequest,
  ResumeThreadResponse,
  ThreadStatusResponse,
} from '@/types/api'

export async function getChatHistory(params?: {
  skip?: number
  limit?: number
  thread_id?: string
}): Promise<ChatHistoryItem[]> {
  const { data } = await apiClient.get<ChatHistoryItem[]>(
    '/items/ai/history',
    { params },
  )
  return data
}

export async function clearChatHistory(
  threadId?: string,
): Promise<{ message: string; deleted: number }> {
  const { data } = await apiClient.delete<{
    message: string
    deleted: number
  }>('/items/ai/history', {
    params: threadId ? { thread_id: threadId } : undefined,
  })
  return data
}

export async function getThreadStatus(
  threadId: string,
): Promise<ThreadStatusResponse> {
  const { data } = await apiClient.get<ThreadStatusResponse>(
    `/items/ai/threads/${encodeURIComponent(threadId)}/status`,
  )
  return data
}

export async function resumeThread(
  threadId: string,
  payload: ResumeThreadRequest,
): Promise<ResumeThreadResponse> {
  const { data } = await apiClient.post<ResumeThreadResponse>(
    `/items/ai/threads/${encodeURIComponent(threadId)}/resume`,
    payload,
  )
  return data
}

export async function listPendingApprovals(): Promise<ApprovalRecord[]> {
  const { data } = await apiClient.get<ApprovalRecord[]>(
    '/items/ai/approvals',
  )
  return data
}

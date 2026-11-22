import { apiClient } from '@/api/client'
import type {
  DashboardResponse,
  PageResponse,
  ReadinessResponse,
  UserAdminView,
  UserPublic,
  UserRoleUpdateRequest,
} from '@/types/api'

export async function getMyDashboard(): Promise<DashboardResponse> {
  const { data } = await apiClient.get<DashboardResponse>(
    '/items/dashboard/me',
  )
  return data
}

export async function listAllUsers(params?: {
  skip?: number
  limit?: number
}): Promise<PageResponse<UserAdminView>> {
  const { data } = await apiClient.get<PageResponse<UserAdminView>>(
    '/users/admin/all',
    { params },
  )
  return data
}

export async function updateUserRole(
  userId: number,
  payload: UserRoleUpdateRequest,
): Promise<UserPublic> {
  const { data } = await apiClient.patch<UserPublic>(
    `/users/${userId}/role`,
    payload,
  )
  return data
}

/**
 * 运维就绪探针。
 * 后端在 `degraded` 时返回 HTTP 503，但响应体仍是合法的
 * `ReadinessResponse` JSON；这里放行 200 / 503 两种状态码，
 * 让运维卡片可以展示完整的依赖明细，而不是被统一错误拦截器吞掉。
 */
export async function getReadiness(): Promise<ReadinessResponse> {
  const { data } = await apiClient.get<ReadinessResponse>('/health/ready', {
    validateStatus: (status) => status === 200 || status === 503,
  })
  return data
}

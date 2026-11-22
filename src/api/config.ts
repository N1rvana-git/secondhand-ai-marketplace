/**
 * API 基础地址独立成模块，避免 `tokenRefresh` 为了拿到 baseURL
 * 反向依赖 `client`（那会形成拦截器 - 续期器 - client 的循环依赖）。
 */
export const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000'
).replace(/\/+$/, '')

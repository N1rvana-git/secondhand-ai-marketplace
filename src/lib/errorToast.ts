import { toast } from 'sonner'
import { ApiError } from '@/api/client'

const SHORT_TRACE_ID_LENGTH = 12

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readTraceId(error: unknown): string {
  if (error instanceof ApiError) return error.traceId.trim()

  if (isRecord(error)) {
    if (typeof error.trace_id === 'string') return error.trace_id.trim()
    if (
      isRecord(error.error) &&
      typeof error.error.trace_id === 'string'
    ) {
      return error.error.trace_id.trim()
    }
  }

  return ''
}

function readErrorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim()
  }
  if (isRecord(error) && typeof error.message === 'string' && error.message.trim()) {
    return error.message.trim()
  }
  return '发生未知错误，请稍后重试。'
}

function copyTraceId(traceId: string): void {
  if (typeof navigator === 'undefined' || !navigator.clipboard) return
  void navigator.clipboard
    .writeText(traceId)
    .then(() => {
      toast.success('Trace ID 已复制', { description: traceId })
    })
    .catch(() => {
      // 剪贴板不可用：保持安静，不遮挡原始错误信息。
    })
}

/**
 * 统一 API 报错出口：后端下发 trace_id 时附带精简排障码与一键复制，
 * 没有 trace_id 时保持简洁提示，避免所有错误都堆砌技术细节。
 */
export function showApiErrorToast(
  err: unknown,
  fallbackTitle = '操作失败',
): void {
  const traceId = readTraceId(err)
  const message = readErrorMessage(err)

  if (!traceId) {
    toast.error(fallbackTitle, { description: message })
    return
  }

  toast.error(fallbackTitle, {
    description: `${message} · Trace ID: ${traceId.slice(
      0,
      SHORT_TRACE_ID_LENGTH,
    )}`,
    action: {
      label: '复制 Trace ID',
      onClick: () => copyTraceId(traceId),
    },
  })
}

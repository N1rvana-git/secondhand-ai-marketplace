import type { UserRole } from '@/types/api'

export function getInitials(
  username?: string | null,
  email?: string | null,
): string {
  const source = username?.trim() || email?.split('@')[0]?.trim() || 'U'
  const words = source.split(/\s+/).filter(Boolean)

  if (words.length > 1) {
    return words
      .slice(0, 2)
      .map((word) => word.charAt(0))
      .join('')
      .toUpperCase()
  }

  return source.slice(0, 2).toUpperCase()
}

export function roleLabel(role: UserRole | null | undefined): string {
  if (role === 'admin') return '管理员'
  if (role === 'user') return '普通用户'
  return '访客'
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '未记录'

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '未记录'

  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(date)
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '未记录'

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '未记录'

  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}

export function formatTime(value: string | null | undefined): string {
  if (!value) return '尚未检测'

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '尚未检测'

  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date)
}

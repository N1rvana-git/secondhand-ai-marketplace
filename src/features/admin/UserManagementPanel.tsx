import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Loader2,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Users,
} from 'lucide-react'
import { toast } from 'sonner'
import { getApiErrorMessage } from '@/api/client'
import { listAllUsers, updateUserRole } from '@/api/dashboard'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { formatDate } from '@/lib/format'
import { useAuthStore } from '@/stores/auth'
import type {
  PageResponse,
  UserAdminView,
  UserRole,
} from '@/types/api'

const PAGE_LIMIT = 20

interface RoleChangeTarget {
  user: UserAdminView
  nextRole: UserRole
}

export function UserManagementPanel() {
  const currentUser = useAuthStore((state) => state.user)
  const navigate = useNavigate()

  const [skip, setSkip] = useState(0)
  const [pageData, setPageData] = useState<PageResponse<UserAdminView> | null>(
    null,
  )
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const [roleTarget, setRoleTarget] = useState<RoleChangeTarget | null>(null)
  const [isUpdating, setIsUpdating] = useState(false)

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    setError(null)

    listAllUsers({ skip, limit: PAGE_LIMIT })
      .then((data) => {
        if (!cancelled) setPageData(data)
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(getApiErrorMessage(loadError))
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [skip, reloadKey])

  const total = pageData?.total ?? 0
  const currentPage = Math.floor(skip / PAGE_LIMIT) + 1
  const totalPages = Math.max(1, Math.ceil(total / PAGE_LIMIT))
  const hasNext = pageData?.has_more === true

  const isSelfDemotion =
    roleTarget?.user.id === currentUser?.id &&
    roleTarget?.nextRole === 'user'
  const isDemotion = roleTarget?.nextRole === 'user'

  const handleConfirmRoleChange = async () => {
    if (!roleTarget || isUpdating) return

    const { user: target, nextRole } = roleTarget
    const isSelf = currentUser?.id === target.id
    setIsUpdating(true)

    try {
      await updateUserRole(target.id, { role: nextRole })
      toast.success(nextRole === 'admin' ? '已授予管理员权限' : '已降级为普通用户', {
        description: `用户「${target.username}」的角色已更新。`,
      })
      setRoleTarget(null)
      setReloadKey((key) => key + 1)

      if (isSelf) {
        // 强制重新拉取 /auth/me，让顶栏导航与路由守卫立即感知新角色。
        await useAuthStore.getState().hydrate(true)
        if (nextRole === 'user') {
          navigate('/market', { replace: true })
        }
      }
    } catch (roleError) {
      toast.error('角色变更失败', {
        description: getApiErrorMessage(roleError),
      })
    } finally {
      setIsUpdating(false)
    }
  }

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <header className="flex items-start justify-between gap-3 border-b border-border/70 px-4 py-3.5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Users className="size-3.5 text-muted-foreground" />
            <h2 className="text-[13px] font-semibold tracking-tight text-foreground">
              用户与 RBAC 角色
            </h2>
            <Badge variant="outline" className="tabular-nums">
              {total}
            </Badge>
          </div>
          <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
            分页对齐 GET /users/admin/all；降级管理员需二次确认。
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="刷新用户列表"
          title="刷新用户列表"
          disabled={isLoading}
          onClick={() => setReloadKey((key) => key + 1)}
          className="shrink-0 text-muted-foreground"
        >
          <RefreshCw
            className={cn('size-3.5', isLoading && 'animate-spin')}
          />
        </Button>
      </header>

      {error ? (
        <div className="px-4 pt-3">
          <Alert variant="destructive" className="py-2.5">
            <AlertTriangle />
            <AlertTitle className="text-xs">用户列表加载失败</AlertTitle>
            <AlertDescription className="flex items-center justify-between gap-3 text-[11px]">
              <span className="truncate">{error}</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 shrink-0 px-1.5 text-[11px]"
                onClick={() => setReloadKey((key) => key + 1)}
              >
                重试
              </Button>
            </AlertDescription>
          </Alert>
        </div>
      ) : null}

      {isLoading && !pageData ? (
        <div className="space-y-3 p-4">
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="flex items-center gap-4">
              <Skeleton className="h-3.5 w-10" />
              <Skeleton className="h-3.5 w-36" />
              <Skeleton className="h-3.5 w-40" />
              <Skeleton className="ml-auto h-6 w-20" />
            </div>
          ))}
        </div>
      ) : pageData && pageData.items.length === 0 ? (
        <div className="px-6 py-14 text-center">
          <Users className="mx-auto size-5 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium text-foreground">暂无用户</p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            当前分页没有返回任何账号。
          </p>
        </div>
      ) : pageData ? (
        <Table className="min-w-[880px]">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="pl-4">ID</TableHead>
              <TableHead>用户名</TableHead>
              <TableHead>邮箱</TableHead>
              <TableHead>角色</TableHead>
              <TableHead>飞书绑定</TableHead>
              <TableHead>注册时间</TableHead>
              <TableHead className="pr-4 text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pageData.items.map((entry) => {
              const isSelf = entry.id === currentUser?.id
              const isAdmin = entry.role === 'admin'

              return (
                <TableRow key={entry.id}>
                  <TableCell className="pl-4 font-mono text-[11px] tabular-nums text-muted-foreground">
                    #{entry.id}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5 whitespace-nowrap">
                      <span className="text-[12.5px] font-medium text-foreground">
                        {entry.username}
                      </span>
                      {isSelf ? (
                        <Badge
                          variant="secondary"
                          className="shrink-0 whitespace-nowrap px-1.5 py-0 text-[9px]"
                        >
                          当前账号
                        </Badge>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="max-w-[220px]">
                    <span className="block truncate text-[11.5px] text-muted-foreground">
                      {entry.email ?? '—'}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={isAdmin ? 'default' : 'outline'}
                      className="text-[10px]"
                    >
                      {isAdmin ? '管理员' : '普通用户'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        entry.feishu_open_id ? 'success' : 'secondary'
                      }
                      className="text-[10px]"
                    >
                      {entry.feishu_open_id ? '已绑定' : '未绑定'}
                    </Badge>
                  </TableCell>
                  <TableCell className="whitespace-nowrap font-mono text-[10.5px] tabular-nums text-muted-foreground">
                    {formatDate(entry.created_at)}
                  </TableCell>
                  <TableCell className="pr-4 text-right">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className={cn(
                        'h-7 gap-1 whitespace-nowrap px-2 text-[10.5px]',
                        isAdmin &&
                          'border-rose-200/70 text-rose-700 hover:bg-rose-50 dark:border-rose-900/60 dark:text-rose-400 dark:hover:bg-rose-950/40',
                      )}
                      onClick={() =>
                        setRoleTarget({
                          user: entry,
                          nextRole: isAdmin ? 'user' : 'admin',
                        })
                      }
                    >
                      {isAdmin ? (
                        <ShieldAlert className="size-3" />
                      ) : (
                        <ShieldCheck className="size-3" />
                      )}
                      {isAdmin ? '降级为普通用户' : '设为管理员'}
                    </Button>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      ) : null}

      <footer className="flex items-center justify-between gap-3 border-t border-border/70 px-4 py-3">
        <span className="font-mono text-[10.5px] tabular-nums text-muted-foreground">
          共 {total} 位用户 · 第 {currentPage} / {totalPages} 页
        </span>
        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 gap-1 px-2 text-[10.5px]"
            disabled={skip === 0 || isLoading}
            onClick={() =>
              setSkip((current) => Math.max(0, current - PAGE_LIMIT))
            }
          >
            <ChevronLeft className="size-3" />
            上一页
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 gap-1 px-2 text-[10.5px]"
            disabled={!hasNext || isLoading}
            onClick={() => setSkip((current) => current + PAGE_LIMIT)}
          >
            下一页
            <ChevronRight className="size-3" />
          </Button>
        </div>
      </footer>

      <AlertDialog
        open={roleTarget !== null}
        onOpenChange={(open) => {
          if (!open && !isUpdating) setRoleTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {isSelfDemotion
                ? '确认降级当前管理员账号？'
                : isDemotion
                  ? '确认降级该管理员？'
                  : '确认授予管理员权限？'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {isSelfDemotion
                ? `降级后你将立即失去系统管理权限并跳转回交易广场。你的账号「${roleTarget?.user.username ?? ''}」将变为普通用户。`
                : isDemotion
                  ? `「${roleTarget?.user.username ?? ''}」将失去用户管理、标签治理与系统探针访问权限。`
                  : `「${roleTarget?.user.username ?? ''}」将获得管理员控制台的完整访问权限。`}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {isSelfDemotion ? (
            <Alert variant="destructive" className="py-2.5">
              <ShieldAlert />
              <AlertTitle className="text-xs">高风险操作</AlertTitle>
              <AlertDescription className="text-[11px] leading-5">
                这是你当前登录的账号。确认后页面会立即刷新权限并离开管理控制台。
              </AlertDescription>
            </Alert>
          ) : null}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={isUpdating}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={isUpdating}
              className={cn(
                isDemotion &&
                  'bg-destructive text-destructive-foreground hover:bg-destructive/90',
              )}
              onClick={(event) => {
                event.preventDefault()
                void handleConfirmRoleChange()
              }}
            >
              {isUpdating ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : isDemotion ? (
                <ShieldAlert className="size-3.5" />
              ) : (
                <ShieldCheck className="size-3.5" />
              )}
              确认变更
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}

import { Link } from 'react-router-dom'
import {
  ChevronDown,
  LayoutDashboard,
  LogOut,
  ShieldCheck,
} from 'lucide-react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { getInitials, roleLabel } from '@/lib/format'
import { useAuthStore } from '@/stores/auth'
import { toast } from 'sonner'

export function UserMenu() {
  const user = useAuthStore((state) => state.user)
  const logout = useAuthStore((state) => state.logout)

  if (!user) return null

  const isAdmin = user.role === 'admin'

  const handleLogout = async () => {
    // Store 内已对 /auth/logout 做容错，这里等待其完成本地清理后再提示。
    await logout()
    toast.success('已退出登录')
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex h-8 items-center gap-2 rounded-full border border-border bg-background pl-1 pr-2 outline-none transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/40"
          aria-label="打开账户菜单"
        >
          <Avatar className="size-6 border border-border">
            <AvatarFallback className="text-[10px]">
              {getInitials(user.username, user.email)}
            </AvatarFallback>
          </Avatar>
          <span className="hidden max-w-24 truncate text-xs font-medium text-foreground sm:block">
            {user.username}
          </span>
          <Badge
            variant={isAdmin ? 'default' : 'secondary'}
            className="hidden px-1.5 text-[10px] sm:inline-flex"
          >
            {roleLabel(user.role)}
          </Badge>
          <ChevronDown className="size-3 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="p-2 font-normal">
          <div className="flex items-start gap-2.5">
            <Avatar className="size-9 border border-border">
              <AvatarFallback className="text-xs">
                {getInitials(user.username, user.email)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <p className="truncate text-sm font-medium text-foreground">
                  {user.username}
                </p>
                <Badge
                  variant={isAdmin ? 'default' : 'secondary'}
                  className="px-1.5 text-[10px]"
                >
                  {roleLabel(user.role)}
                </Badge>
              </div>
              <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                {user.email ?? '未绑定邮箱'}
              </p>
            </div>
          </div>
        </DropdownMenuLabel>

        <DropdownMenuSeparator />

        <DropdownMenuItem asChild>
          <Link to="/studio">
            <LayoutDashboard />
            个人工作台
          </Link>
        </DropdownMenuItem>

        {isAdmin ? (
          <DropdownMenuItem asChild>
            <Link to="/admin">
              <ShieldCheck />
              系统管理
            </Link>
          </DropdownMenuItem>
        ) : null}

        <DropdownMenuSeparator />

        <DropdownMenuItem variant="destructive" onClick={handleLogout}>
          <LogOut />
          退出登录
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

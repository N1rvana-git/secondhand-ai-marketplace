import { Link } from 'react-router-dom'
import { Menu, ShieldCheck, Store, LayoutDashboard } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useAuthStore } from '@/stores/auth'

export function MobileNav() {
  const user = useAuthStore((state) => state.user)
  const isAdmin = user?.role === 'admin'

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="md:hidden"
          aria-label="打开导航菜单"
        >
          <Menu className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56 md:hidden">
        <DropdownMenuLabel>导航</DropdownMenuLabel>
        <DropdownMenuItem asChild>
          <Link to="/market">
            <Store />
            交易广场
          </Link>
        </DropdownMenuItem>
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

        {!user ? (
          <>
            <DropdownMenuSeparator />
            <div className="grid grid-cols-2 gap-2 p-1">
              <Button asChild variant="outline" size="sm">
                <Link to="/login">登录</Link>
              </Button>
              <Button asChild size="sm">
                <Link to="/register">注册</Link>
              </Button>
            </div>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

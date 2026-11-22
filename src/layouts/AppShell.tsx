import { useEffect } from 'react'
import {
  Link,
  NavLink,
  Outlet,
  useLocation,
  useNavigate,
} from 'react-router-dom'
import { AlertTriangle, ArrowLeft, Package2, RotateCcw } from 'lucide-react'
import { ensureFreshToken } from '@/api/tokenRefresh'
import { Brand } from '@/components/brand'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { MobileNav } from '@/components/app/mobile-nav'
import { ThemeToggle } from '@/components/app/theme-toggle'
import { UserMenu } from '@/components/app/user-menu'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { CopilotDrawer } from '@/features/agent/CopilotDrawer'
import { cn } from '@/lib/utils'
import { useAgentStore } from '@/stores/agent'
import { useAuthStore } from '@/stores/auth'

const baseNavItems = [
  { to: '/market', label: '交易广场' },
  { to: '/studio', label: '个人工作台' },
]

function navLinkClass({ isActive }: { isActive: boolean }) {
  return cn(
    'inline-flex h-8 items-center rounded-md px-3 text-[13px] font-medium transition-colors',
    isActive
      ? 'bg-secondary text-foreground'
      : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
  )
}

/** 路由层渲染异常：保留导航栏，只在内容区展示极简线性故障卡。 */
function RouteErrorFallback({
  error,
  onReset,
}: {
  error: Error
  onReset: () => void
}) {
  const navigate = useNavigate()

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
      <section
        role="alert"
        className="rounded-xl border border-border bg-card px-4 py-5 sm:px-5"
      >
        <div className="flex items-start gap-3">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-muted/40">
            <AlertTriangle className="size-4 text-muted-foreground" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-[13px] font-semibold tracking-tight text-foreground">
              当前视图渲染失败
            </h2>
            <p className="mt-1 text-[11.5px] leading-5 text-muted-foreground">
              导航与登录状态仍然可用。可以刷新当前视图，或返回交易广场继续浏览。
            </p>
            {error.message ? (
              <p className="mt-2 break-words border-l-2 border-border pl-2 font-mono text-[10.5px] leading-5 text-muted-foreground/80">
                {error.message}
              </p>
            ) : null}
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                onClick={onReset}
                className="h-8 gap-1.5 px-2.5 text-[11.5px]"
              >
                <RotateCcw className="size-3.5" />
                刷新当前视图
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  onReset()
                  navigate('/market')
                }}
                className="h-8 gap-1.5 px-2.5 text-[11.5px]"
              >
                <ArrowLeft className="size-3.5" />
                返回交易广场
              </Button>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}

export function AppShell() {
  const user = useAuthStore((state) => state.user)
  const isAdmin = user?.role === 'admin'
  const location = useLocation()

  const initForUser = useAgentStore((state) => state.initForUser)
  const fetchGlobalApprovals = useAgentStore(
    (state) => state.fetchGlobalApprovals,
  )
  const resetOnLogout = useAgentStore((state) => state.resetOnLogout)
  const toggleCopilot = useAgentStore((state) => state.toggleOpen)

  // 登录后初始化线程并拉取全局待审批；登出时清空内存中的私密对话与审批。
  useEffect(() => {
    if (user) {
      initForUser(user.id)
      void fetchGlobalApprovals()
    } else {
      resetOnLogout()
    }
  }, [user, initForUser, fetchGlobalApprovals, resetOnLogout])

  // 标签页从后台切回时主动检查 token：避免挂机后首次点击才掉线丢草稿。
  useEffect(() => {
    if (!user) return

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void ensureFreshToken()
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [user])

  // 全局快捷键：Ctrl/Cmd + J 唤起 / 收起 Copilot
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return
      if (event.key.toLowerCase() !== 'j') return
      event.preventDefault()
      toggleCopilot()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [toggleCopilot])

  return (
    <div className="flex min-h-svh flex-col bg-background">
      <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-2 px-4 sm:px-6">
          <Brand className="mr-1 shrink-0" />

          <Separator
            orientation="vertical"
            className="mx-1 hidden h-4 sm:block"
          />

          <nav
            className="hidden items-center gap-0.5 md:flex"
            aria-label="主导航"
          >
            {baseNavItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={navLinkClass}
              >
                {item.label}
              </NavLink>
            ))}
            {isAdmin ? (
              <NavLink to="/admin" className={navLinkClass}>
                系统管理
              </NavLink>
            ) : null}
          </nav>

          <div className="ml-auto flex items-center gap-1">
            <ThemeToggle />
            <CopilotDrawer />

            <Separator
              orientation="vertical"
              className="mx-1 hidden h-4 sm:block"
            />

            {user ? (
              <UserMenu />
            ) : (
              <div className="hidden items-center gap-1.5 sm:flex">
                <Button asChild variant="ghost" size="sm">
                  <Link to="/login">登录</Link>
                </Button>
                <Button asChild size="sm">
                  <Link to="/register">注册</Link>
                </Button>
              </div>
            )}

            <MobileNav />
          </div>
        </div>
      </header>

      <main className="flex-1">
        <ErrorBoundary
          resetKeys={[location.pathname]}
          fallback={(error, reset) => (
            <RouteErrorFallback error={error} onReset={reset} />
          )}
        >
          <Outlet />
        </ErrorBoundary>
      </main>

      <footer className="border-t border-border/80">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-4 px-4 text-[10px] text-muted-foreground sm:px-6">
          <div className="flex items-center gap-2">
            <Package2 className="size-3.5" />
            <span>闲小宝 · 二手交易与 AI 导购</span>
          </div>
          <span className="hidden font-mono uppercase tracking-[0.16em] sm:inline">
            Phase 3 · Copilot
          </span>
        </div>
      </footer>
    </div>
  )
}

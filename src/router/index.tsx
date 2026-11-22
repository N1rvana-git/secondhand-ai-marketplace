import {
  lazy,
  Suspense,
  useEffect,
  type ReactNode,
} from 'react'
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom'
import { toast } from 'sonner'
import { BrandMark } from '@/components/brand'
import { Skeleton } from '@/components/ui/skeleton'
import { AuthLayout } from '@/layouts/AuthLayout'
import { AppShell } from '@/layouts/AppShell'
import NotFoundPage from '@/pages/NotFoundPage'
import { GuestOnly, RequireAdmin, RequireAuth } from '@/router/guards'
import { useAuthStore } from '@/stores/auth'

// 路由级懒加载：Market / Studio / Admin / Login / Register 各自独立分包，
// 首屏只加载 AppShell 与当前路由，避免单个 800 kB+ 巨型 bundle。
const AdminPage = lazy(() => import('@/pages/AdminPage'))
const LoginPage = lazy(() => import('@/pages/LoginPage'))
const MarketPage = lazy(() => import('@/pages/MarketPage'))
const RegisterPage = lazy(() => import('@/pages/RegisterPage'))
const StudioPage = lazy(() => import('@/pages/StudioPage'))

function BootScreen() {
  return (
    <div className="flex min-h-svh items-center justify-center bg-background px-6">
      <div className="w-full max-w-56">
        <div className="flex items-center justify-center gap-2">
          <BrandMark />
          <span className="text-sm font-semibold tracking-[-0.01em]">
            闲小宝
          </span>
        </div>
        <div className="mt-6 space-y-2">
          <Skeleton className="h-2 w-full" />
          <Skeleton className="mx-auto h-2 w-3/4" />
        </div>
        <p className="mt-4 text-center text-[11px] text-muted-foreground">
          正在恢复会话
        </p>
      </div>
    </div>
  )
}

/** 路由懒加载的统一骨架：保持页面留白节奏，避免整页白屏闪烁。 */
function RouteFallback() {
  return (
    <div
      className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-10"
      aria-busy="true"
      aria-live="polite"
    >
      <Skeleton className="h-2.5 w-24" />
      <Skeleton className="mt-3 h-7 w-48" />
      <Skeleton className="mt-2.5 h-3.5 w-full max-w-md" />
      <div className="mt-8 grid gap-3 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <Skeleton key={index} className="h-24 w-full rounded-xl" />
        ))}
      </div>
      <Skeleton className="mt-4 h-64 w-full rounded-xl" />
      <span className="sr-only">页面加载中</span>
    </div>
  )
}

function LazyPage({ children }: { children: ReactNode }) {
  return <Suspense fallback={<RouteFallback />}>{children}</Suspense>
}

function AppBootstrap() {
  const hydrate = useAuthStore((state) => state.hydrate)
  const isHydrated = useAuthStore((state) => state.isHydrated)
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    void hydrate()
  }, [hydrate])

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' })
  }, [location.pathname])

  useEffect(() => {
    const handleUnauthorized = () => {
      if (!useAuthStore.getState().isHydrated) return
      if (
        location.pathname === '/login' ||
        location.pathname === '/register'
      ) {
        return
      }

      toast.error('登录状态已失效', {
        description: '请重新登录后继续。',
      })
      navigate('/login', {
        replace: true,
        state: { from: `${location.pathname}${location.search}` },
      })
    }

    window.addEventListener('auth:unauthorized', handleUnauthorized)
    return () => {
      window.removeEventListener('auth:unauthorized', handleUnauthorized)
    }
  }, [location.pathname, location.search, navigate])

  if (!isHydrated) {
    return <BootScreen />
  }

  return (
    <Routes>
      <Route path="/" element={<Navigate to="/market" replace />} />

      <Route element={<AppShell />}>
        <Route
          path="/market"
          element={
            <LazyPage>
              <MarketPage />
            </LazyPage>
          }
        />

        <Route element={<RequireAuth />}>
          <Route
            path="/studio"
            element={
              <LazyPage>
                <StudioPage />
              </LazyPage>
            }
          />

          <Route element={<RequireAdmin />}>
            <Route
              path="/admin"
              element={
                <LazyPage>
                  <AdminPage />
                </LazyPage>
              }
            />
          </Route>
        </Route>

        <Route path="*" element={<NotFoundPage />} />
      </Route>

      <Route element={<GuestOnly />}>
        <Route element={<AuthLayout />}>
          <Route
            path="/login"
            element={
              <LazyPage>
                <LoginPage />
              </LazyPage>
            }
          />
          <Route
            path="/register"
            element={
              <LazyPage>
                <RegisterPage />
              </LazyPage>
            }
          />
        </Route>
      </Route>
    </Routes>
  )
}

export function AppRouter() {
  return (
    <BrowserRouter>
      <AppBootstrap />
    </BrowserRouter>
  )
}

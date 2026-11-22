import { useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import {
  ArrowRight,
  CircleAlert,
  Eye,
  EyeOff,
  Loader2,
  LockKeyhole,
  Mail,
} from 'lucide-react'
import { toast } from 'sonner'
import { getApiErrorMessage } from '@/api/client'
import { showApiErrorToast } from '@/lib/errorToast'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuthStore } from '@/stores/auth'

function getRedirectTarget(from: string | undefined): string {
  if (!from || !from.startsWith('/') || from.startsWith('//')) {
    return '/market'
  }
  if (from === '/login' || from === '/register') return '/market'
  return from
}

export default function LoginPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const loginWithCredentials = useAuthStore(
    (state) => state.loginWithCredentials,
  )

  const routeState = location.state as {
    from?: string
    email?: string
  } | null

  const [email, setEmail] = useState(routeState?.email ?? '')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const normalizedEmail = email.trim()

    if (!normalizedEmail || !password) {
      setError('请输入邮箱与密码。')
      return
    }

    setError(null)
    setIsSubmitting(true)

    try {
      await loginWithCredentials(normalizedEmail, password)
      const username = useAuthStore.getState().user?.username
      toast.success('登录成功', {
        description: `欢迎回来，${username ?? normalizedEmail}`,
      })
      navigate(getRedirectTarget(routeState?.from), { replace: true })
    } catch (submitError) {
      const message = getApiErrorMessage(submitError)
      setError(message)
      showApiErrorToast(submitError, '登录失败')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Card className="border-border/80 shadow-[0_1px_2px_rgba(9,9,11,0.04)]">
      <CardHeader className="pb-6">
        <p className="mb-2 font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
          Welcome back
        </p>
        <CardTitle className="text-2xl tracking-[-0.025em]">
          登录闲小宝
        </CardTitle>
        <CardDescription className="leading-6">
          继续管理你的闲置、收藏与订单。
        </CardDescription>
      </CardHeader>

      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          {error ? (
            <Alert variant="destructive">
              <CircleAlert />
              <AlertTitle>无法登录</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="login-email">邮箱</Label>
            <div className="relative">
              <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="login-email"
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="h-10 pl-9"
                disabled={isSubmitting}
                aria-invalid={Boolean(error)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="login-password">密码</Label>
            <div className="relative">
              <LockKeyhole className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="login-password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                placeholder="输入登录密码"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="h-10 pl-9 pr-10"
                disabled={isSubmitting}
                aria-invalid={Boolean(error)}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => setShowPassword((current) => !current)}
                className="absolute right-1 top-1 size-8 text-muted-foreground"
                aria-label={showPassword ? '隐藏密码' : '显示密码'}
              >
                {showPassword ? (
                  <EyeOff className="size-4" />
                ) : (
                  <Eye className="size-4" />
                )}
              </Button>
            </div>
          </div>

          <Button
            type="submit"
            className="mt-2 h-10 w-full"
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                正在登录
              </>
            ) : (
              <>
                登录
                <ArrowRight className="size-4" />
              </>
            )}
          </Button>
        </form>
      </CardContent>

      <CardFooter className="justify-center border-t border-border/70 pt-4 text-xs text-muted-foreground">
        还没有账户？
        <Link
          to="/register"
          className="ml-1 font-medium text-foreground underline-offset-4 hover:underline"
        >
          创建账户
        </Link>
      </CardFooter>
    </Card>
  )
}

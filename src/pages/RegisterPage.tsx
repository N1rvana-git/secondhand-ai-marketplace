import { useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  ArrowRight,
  CircleAlert,
  Eye,
  EyeOff,
  Loader2,
  LockKeyhole,
  Mail,
  ShieldCheck,
  UserRound,
} from 'lucide-react'
import { toast } from 'sonner'
import { ApiError, getApiErrorMessage } from '@/api/client'
import { register } from '@/api/auth'
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
import { cn } from '@/lib/utils'

const STRENGTH_LABELS = ['未设置', '较弱', '一般', '良好', '强']
const STRENGTH_COLORS = [
  'bg-muted',
  'bg-rose-500/70',
  'bg-amber-500/70',
  'bg-emerald-500/70',
  'bg-emerald-500',
]

type RegisterField = 'username' | 'email' | 'password'
type RegisterFieldErrors = Partial<Record<RegisterField, string>>

function evaluatePassword(password: string): number {
  if (!password) return 0

  const checks = [
    password.length >= 8,
    /[a-z]/.test(password) && /[A-Z]/.test(password),
    /\d/.test(password),
    /[^A-Za-z0-9]/.test(password),
  ]

  return Math.max(1, checks.filter(Boolean).length)
}

export default function RegisterPage() {
  const navigate = useNavigate()

  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<RegisterFieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const passwordBytes = useMemo(
    () => new TextEncoder().encode(password).length,
    [password],
  )
  const strength = evaluatePassword(password)
  const strengthLabel = STRENGTH_LABELS[strength]
  const activeStrengthBars = password ? Math.max(1, strength) : 0

  const clearFieldError = (field: RegisterField) => {
    setFieldErrors((current) => {
      if (!current[field]) return current
      const next = { ...current }
      delete next[field]
      return next
    })
    setFormError(null)
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const trimmedUsername = username.trim()
    const normalizedEmail = email.trim()
    const nextErrors: RegisterFieldErrors = {}

    if (
      trimmedUsername &&
      (trimmedUsername.length < 2 || trimmedUsername.length > 64)
    ) {
      nextErrors.username = '用户名需为 2–64 个字符，或保持留空。'
    }

    if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) {
      nextErrors.email = '请输入有效的邮箱地址。'
    }

    if (password.length < 8) {
      nextErrors.password = '密码至少需要 8 个字符。'
    } else if (passwordBytes > 72) {
      nextErrors.password = '密码超过 72 字节上限，请缩短后重试。'
    }

    if (Object.keys(nextErrors).length > 0) {
      setFieldErrors(nextErrors)
      setFormError('请修正表单中标出的字段后重试。')
      return
    }

    setFieldErrors({})
    setFormError(null)
    setIsSubmitting(true)

    try {
      await register({
        email: normalizedEmail,
        password,
        ...(trimmedUsername ? { username: trimmedUsername } : {}),
      })
      toast.success('账户已创建', {
        description: '请使用新账户登录。',
      })
      navigate('/login', {
        replace: true,
        state: { email: normalizedEmail },
      })
    } catch (submitError) {
      const message = getApiErrorMessage(submitError)

      if (submitError instanceof ApiError && submitError.status === 409) {
        setFieldErrors({ email: message })
      } else {
        setFieldErrors({})
      }

      setFormError(message)
      showApiErrorToast(submitError, '注册失败')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Card className="border-border/80 shadow-[0_1px_2px_rgba(9,9,11,0.04)]">
      <CardHeader className="pb-6">
        <p className="mb-2 font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
          Get started
        </p>
        <CardTitle className="text-2xl tracking-[-0.025em]">
          创建账户
        </CardTitle>
        <CardDescription className="leading-6">
          一个账号同时拥有买家与卖家能力。
        </CardDescription>
      </CardHeader>

      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          {formError ? (
            <Alert variant="destructive">
              <CircleAlert />
              <AlertTitle>
                {Object.keys(fieldErrors).length > 0
                  ? '请检查注册信息'
                  : '无法创建账户'}
              </AlertTitle>
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          ) : null}

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="register-username">用户名</Label>
              <span className="text-[10px] text-muted-foreground">
                选填 · 2–64 字符
              </span>
            </div>
            <div className="relative">
              <UserRound className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="register-username"
                type="text"
                autoComplete="username"
                placeholder="给自己取一个名字"
                value={username}
                onChange={(event) => {
                  setUsername(event.target.value)
                  clearFieldError('username')
                }}
                className="h-10 pl-9"
                maxLength={64}
                disabled={isSubmitting}
                aria-invalid={Boolean(fieldErrors.username)}
                aria-describedby={
                  fieldErrors.username ? 'register-username-error' : undefined
                }
              />
            </div>
            {fieldErrors.username ? (
              <p
                id="register-username-error"
                className="text-[11px] leading-4 text-rose-600 dark:text-rose-400"
              >
                {fieldErrors.username}
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="register-email">邮箱</Label>
            <div className="relative">
              <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="register-email"
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value)
                  clearFieldError('email')
                }}
                className="h-10 pl-9"
                disabled={isSubmitting}
                aria-invalid={Boolean(fieldErrors.email)}
                aria-describedby={
                  fieldErrors.email ? 'register-email-error' : undefined
                }
              />
            </div>
            {fieldErrors.email ? (
              <p
                id="register-email-error"
                className="text-[11px] leading-4 text-rose-600 dark:text-rose-400"
              >
                {fieldErrors.email}
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="register-password">密码</Label>
              <span
                className={cn(
                  'text-[10px] tabular-nums',
                  passwordBytes > 72
                    ? 'text-rose-600 dark:text-rose-400'
                    : 'text-muted-foreground',
                )}
              >
                {passwordBytes} / 72 字节
              </span>
            </div>
            <div className="relative">
              <LockKeyhole className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="register-password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                placeholder="至少 8 个字符"
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value)
                  clearFieldError('password')
                }}
                className="h-10 pl-9 pr-10"
                disabled={isSubmitting}
                aria-invalid={
                  Boolean(fieldErrors.password) || passwordBytes > 72
                }
                aria-describedby={
                  fieldErrors.password ? 'register-password-error' : undefined
                }
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

            {fieldErrors.password ? (
              <p
                id="register-password-error"
                className="text-[11px] leading-4 text-rose-600 dark:text-rose-400"
              >
                {fieldErrors.password}
              </p>
            ) : passwordBytes > 72 ? (
              <p className="text-[11px] leading-4 text-rose-600 dark:text-rose-400">
                密码超过 72 字节上限，请缩短后重试。
              </p>
            ) : null}

            <div className="space-y-1.5 pt-0.5">
              <div
                className="grid grid-cols-4 gap-1"
                aria-hidden="true"
              >
                {Array.from({ length: 4 }).map((_, index) => (
                  <span
                    key={index}
                    className={cn(
                      'h-1 rounded-full transition-colors',
                      index < activeStrengthBars
                        ? STRENGTH_COLORS[activeStrengthBars]
                        : 'bg-muted',
                    )}
                  />
                ))}
              </div>
              <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                <span aria-live="polite">
                  密码强度：{password ? strengthLabel : '未设置'}
                </span>
                <span>8 字符起 · bcrypt 72 字节上限</span>
              </div>
            </div>
          </div>

          <div className="flex items-start gap-2.5 rounded-md border border-border bg-muted/40 px-3 py-2.5">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
            <p className="text-[11px] leading-5 text-muted-foreground">
              所有新注册账号默认开通完整买卖家权限，无需选择角色。
            </p>
          </div>

          <Button
            type="submit"
            className="h-10 w-full"
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                正在创建
              </>
            ) : (
              <>
                创建账户
                <ArrowRight className="size-4" />
              </>
            )}
          </Button>
        </form>
      </CardContent>

      <CardFooter className="justify-center border-t border-border/70 pt-4 text-xs text-muted-foreground">
        已有账户？
        <Link
          to="/login"
          className="ml-1 font-medium text-foreground underline-offset-4 hover:underline"
        >
          直接登录
        </Link>
      </CardFooter>
    </Card>
  )
}

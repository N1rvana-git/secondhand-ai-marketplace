import { Component, type ErrorInfo, type ReactNode } from 'react'
import { RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'

export type ErrorBoundaryFallback =
  | ReactNode
  | ((error: Error, reset: () => void) => ReactNode)

interface ErrorBoundaryProps {
  children: ReactNode
  /** 自定义降级 UI；函数形式可拿到错误与重置方法。 */
  fallback?: ErrorBoundaryFallback
  /** 任意一项变化时自动重置错误态（例如路由 pathname 变化）。 */
  resetKeys?: readonly unknown[]
  onError?: (error: Error, info: ErrorInfo) => void
}

interface ErrorBoundaryState {
  error: Error | null
}

function haveResetKeysChanged(
  previous: readonly unknown[] = [],
  next: readonly unknown[] = [],
): boolean {
  if (previous.length !== next.length) return true
  return previous.some((key, index) => !Object.is(key, next[index]))
}

/**
 * 干净的 React Class ErrorBoundary：
 * - 支持自定义 fallback 与 resetKeys；
 * - 不依赖路由 / Store，可安全用于路由层与 Markdown 局部隔离层。
 */
export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.props.onError?.(error, info)
  }

  componentDidUpdate(previousProps: ErrorBoundaryProps): void {
    if (!this.state.error) return
    if (
      haveResetKeysChanged(previousProps.resetKeys, this.props.resetKeys)
    ) {
      this.reset()
    }
  }

  reset = (): void => {
    this.setState({ error: null })
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children

    const { fallback } = this.props
    if (typeof fallback === 'function') return fallback(error, this.reset)
    if (fallback !== undefined) return fallback

    return (
      <div
        role="alert"
        className="rounded-xl border border-border bg-card px-4 py-4"
      >
        <p className="text-[12px] font-medium text-foreground">
          当前内容渲染失败
        </p>
        <p className="mt-1 break-words text-[11px] leading-5 text-muted-foreground">
          {error.message || '页面遇到未知渲染异常。'}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={this.reset}
          className="mt-3 h-7 gap-1.5 px-2 text-[11px]"
        >
          <RotateCcw className="size-3" />
          重试
        </Button>
      </div>
    )
  }
}

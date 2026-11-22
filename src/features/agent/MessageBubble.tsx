import { useRef, useState, type ReactNode } from 'react'
import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  AlertCircle,
  Bot,
  Check,
  Copy,
  Loader2,
  RotateCcw,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { ToolStepTimeline } from '@/features/agent/ToolStepTimeline'
import { formatMessageTime } from '@/features/agent/agent-meta'
import { cn } from '@/lib/utils'
import type { AgentChatMessage } from '@/stores/agent'

function CodeBlock({ children }: { children?: ReactNode }) {
  const preRef = useRef<HTMLPreElement>(null)
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    const text = preRef.current?.textContent ?? ''
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // 剪贴板权限不可用：保持安静，不打断阅读
    }
  }

  return (
    <div className="group/code relative my-3">
      <pre
        ref={preRef}
        className="overflow-x-auto rounded-lg border border-border/80 bg-muted/40 p-3 font-mono text-[11.5px] leading-6 text-foreground/90 [&_code]:border-0 [&_code]:bg-transparent [&_code]:p-0 [&_code]:text-[inherit]"
      >
        {children}
      </pre>
      <button
        type="button"
        onClick={() => void handleCopy()}
        aria-label="复制代码"
        className="absolute right-2 top-2 inline-flex h-6 items-center gap-1 rounded-md border border-border/80 bg-background/90 px-1.5 text-[9.5px] text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover/code:opacity-100"
      >
        {copied ? (
          <Check className="size-2.5 text-emerald-600" />
        ) : (
          <Copy className="size-2.5" />
        )}
        {copied ? '已复制' : '复制'}
      </button>
    </div>
  )
}

const markdownComponents: Components = {
  p: ({ children }) => (
    <p className="my-2 text-[13px] leading-6 text-foreground/90 first:mt-0 last:mb-0">
      {children}
    </p>
  ),
  h1: ({ children }) => (
    <h1 className="mt-4 mb-1.5 text-[15px] font-semibold tracking-tight text-foreground first:mt-0">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="mt-4 mb-1.5 text-[14px] font-semibold tracking-tight text-foreground first:mt-0">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="mt-3 mb-1 text-[13px] font-semibold text-foreground first:mt-0">
      {children}
    </h3>
  ),
  ul: ({ children }) => (
    <ul className="my-2 list-disc space-y-1 pl-5 text-[13px] leading-6 marker:text-muted-foreground/60">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="my-2 list-decimal space-y-1 pl-5 text-[13px] leading-6 marker:text-muted-foreground/60">
      {children}
    </ol>
  ),
  li: ({ children }) => <li className="pl-0.5">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-border pl-3 text-[12.5px] italic leading-6 text-muted-foreground">
      {children}
    </blockquote>
  ),
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="font-medium text-foreground underline decoration-border underline-offset-2 transition-colors hover:decoration-foreground"
    >
      {children}
    </a>
  ),
  strong: ({ children }) => (
    <strong className="font-semibold text-foreground">{children}</strong>
  ),
  code: ({ children }) => (
    <code className="rounded border border-border/70 bg-muted px-1 py-0.5 font-mono text-[11.5px] text-foreground/90">
      {children}
    </code>
  ),
  pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
  table: ({ children }) => (
    <div className="my-3 w-full overflow-x-auto rounded-lg border border-border/80">
      <table className="w-full min-w-[420px] border-collapse text-left text-[11.5px]">
        {children}
      </table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="border-b border-border/80 bg-muted/40">{children}</thead>
  ),
  th: ({ children }) => (
    <th className="whitespace-nowrap px-2.5 py-1.5 text-[10.5px] font-semibold text-foreground">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border-t border-border/60 px-2.5 py-1.5 align-top text-foreground/85">
      {children}
    </td>
  ),
  hr: () => <hr className="my-4 border-border/70" />,
  img: ({ src, alt }) => (
    <img
      src={typeof src === 'string' ? src : undefined}
      alt={alt ?? ''}
      loading="lazy"
      className="my-2 max-h-64 rounded-md border border-border object-contain"
    />
  ),
}

function StreamingCursor() {
  return (
    <span
      aria-hidden="true"
      className="ml-0.5 inline-block h-3.5 w-[2px] animate-pulse bg-foreground/60 align-[-2px]"
    />
  )
}

interface MessageBubbleProps {
  message: AgentChatMessage
  onRetry: (messageId: string) => void
}

export function MessageBubble({ message, onRetry }: MessageBubbleProps) {
  const isUser = message.role === 'user'
  const time = formatMessageTime(message.createdAt)

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[88%] whitespace-pre-wrap break-words rounded-2xl rounded-br-sm bg-primary px-3.5 py-2 text-[13px] leading-6 text-primary-foreground shadow-xs">
          {message.content}
        </div>
      </div>
    )
  }

  const isStreaming = message.status === 'streaming'
  const isThinking =
    isStreaming &&
    !message.content &&
    message.tools.length === 0 &&
    !message.intent

  return (
    <article className="flex w-full flex-col items-start">
      <div className="mb-1 flex items-center gap-1.5 text-[9.5px] text-muted-foreground">
        <Bot className="size-3" />
        <span className="font-medium">AI 导购</span>
        {time ? (
          <>
            <span className="text-border">·</span>
            <span className="font-mono tabular-nums">{time}</span>
          </>
        ) : null}
      </div>

      <ToolStepTimeline intent={message.intent} tools={message.tools} />

      {message.content ? (
        <div
          className={cn(
            'mt-1 w-full min-w-0',
            // 流式时把最后一段变成行内，让光标紧跟在最后一个字符后
            isStreaming && '[&>p:last-child]:inline',
          )}
        >
          <ErrorBoundary
            resetKeys={[message.id, message.status]}
            fallback={() => (
              <pre className="whitespace-pre-wrap text-sm">
                {message.content}
              </pre>
            )}
          >
            <Markdown
              remarkPlugins={[remarkGfm]}
              components={markdownComponents}
            >
              {message.content}
            </Markdown>
          </ErrorBoundary>
          {isStreaming ? <StreamingCursor /> : null}
        </div>
      ) : null}

      {isThinking ? (
        <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Loader2 className="size-3 animate-spin" />
          正在思考…
        </div>
      ) : null}

      {message.status === 'aborted' ? (
        <p className="mt-1 text-[10.5px] text-muted-foreground">
          已停止生成
        </p>
      ) : null}

      {message.error ? (
        <div className="mt-2 flex w-full items-start gap-2 rounded-lg border border-destructive/25 bg-destructive/5 px-2.5 py-2">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0 text-destructive" />
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-medium leading-4 text-destructive">
              {message.error.message}
            </p>
            {message.error.code ? (
              <p className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.14em] text-destructive/70">
                {message.error.code}
              </p>
            ) : null}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onRetry(message.id)}
            className="h-6 shrink-0 gap-1 px-1.5 text-[10.5px] text-destructive hover:bg-destructive/10"
          >
            <RotateCcw className="size-3" />
            重试
          </Button>
        </div>
      ) : null}
    </article>
  )
}

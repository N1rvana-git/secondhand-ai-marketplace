import {
  CheckCircle2,
  ChevronDown,
  Loader2,
  Sparkles,
  Wrench,
  XCircle,
} from 'lucide-react'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  getIntentLabel,
  getToolLabel,
} from '@/features/agent/agent-meta'
import { cn } from '@/lib/utils'
import type { AgentIntent, ToolCallStep } from '@/stores/agent'

interface ToolStepTimelineProps {
  intent: AgentIntent | null
  tools: ToolCallStep[]
}

const TOOL_STATUS_LABEL: Record<ToolCallStep['status'], string> = {
  running: '执行中',
  success: '完成',
  error: '失败',
}

function ToolStatusIcon({ status }: { status: ToolCallStep['status'] }) {
  if (status === 'running') {
    return (
      <Loader2 className="size-3 animate-spin text-sky-600 dark:text-sky-400" />
    )
  }
  if (status === 'success') {
    return (
      <CheckCircle2 className="size-3 text-emerald-600 dark:text-emerald-400" />
    )
  }
  return <XCircle className="size-3 text-rose-600 dark:text-rose-400" />
}

function ToolStepRow({ step }: { step: ToolCallStep }) {
  const argsText = JSON.stringify(step.arguments ?? {}, null, 2)

  return (
    <Collapsible>
      <div className="overflow-hidden rounded-lg border border-border/80 bg-muted/40">
        <CollapsibleTrigger className="group flex w-full items-center gap-2 px-2.5 py-1.5 text-left outline-none transition-colors hover:bg-muted/70 focus-visible:ring-[2px] focus-visible:ring-ring/40">
          <Wrench className="size-3 shrink-0 text-muted-foreground" />
          <span className="truncate text-[11px] font-medium text-foreground">
            {getToolLabel(step.name)}
          </span>
          <span className="hidden truncate font-mono text-[9.5px] text-muted-foreground/70 sm:inline">
            {step.name}
          </span>
          <span className="ml-auto flex shrink-0 items-center gap-1.5">
            <ToolStatusIcon status={step.status} />
            <span
              className={cn(
                'hidden text-[10px] sm:inline',
                step.status === 'running'
                  ? 'text-muted-foreground'
                  : step.status === 'success'
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : 'text-rose-700 dark:text-rose-400',
              )}
            >
              {TOOL_STATUS_LABEL[step.status]}
            </span>
            <ChevronDown className="size-3 text-muted-foreground transition-transform duration-150 group-data-[state=open]:rotate-180" />
          </span>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="border-t border-border/70 px-2.5 py-2">
            <p className="mb-1 font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
              arguments
            </p>
            <pre className="max-h-40 overflow-auto rounded-md border border-border/60 bg-background/70 p-2 font-mono text-[10px] leading-5 text-foreground/90">
              <code>{argsText}</code>
            </pre>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  )
}

export function ToolStepTimeline({ intent, tools }: ToolStepTimelineProps) {
  if (!intent && tools.length === 0) return null

  return (
    <div className="mt-2.5 space-y-1.5">
      {intent ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center gap-1 rounded-full border border-border/80 bg-muted/40 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
            <Sparkles className="size-2.5" />
            <span>意图 · {getIntentLabel(intent.intent)}</span>
          </span>
          {intent.tools.length > 0 ? (
            <span className="font-mono text-[9.5px] uppercase tracking-[0.12em] text-muted-foreground/70">
              {intent.tools.length} tools planned
            </span>
          ) : null}
        </div>
      ) : null}

      {tools.length > 0 ? (
        <div className="space-y-1">
          {tools.map((step) => (
            <ToolStepRow key={step.id} step={step} />
          ))}
        </div>
      ) : null}
    </div>
  )
}

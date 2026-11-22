import { Outlet } from 'react-router-dom'
import {
  ScanSearch,
  ShieldCheck,
  Sparkles,
  type LucideIcon,
} from 'lucide-react'
import { Brand } from '@/components/brand'
import { ThemeToggle } from '@/components/app/theme-toggle'

interface Capability {
  icon: LucideIcon
  title: string
  description: string
}

const capabilities: Capability[] = [
  {
    icon: ScanSearch,
    title: '混合语义与视觉检索',
    description: '用一句话或一张图，找到真正相近的闲置。',
  },
  {
    icon: Sparkles,
    title: 'SSE 流式 AI 导购',
    description: '过程可见、可中断的选品建议与商品解释。',
  },
  {
    icon: ShieldCheck,
    title: '高额交易人工审批闭环',
    description: '关键动作进入审批队列，结果与理由全程留痕。',
  },
]

export function AuthLayout() {
  return (
    <div className="grid min-h-svh lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
      <aside className="relative hidden min-h-svh flex-col overflow-hidden border-r border-zinc-800 bg-zinc-950 p-10 text-zinc-50 lg:flex xl:p-14">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-[0.055]"
          style={{
            backgroundImage:
              'linear-gradient(to right, #ffffff 1px, transparent 1px), linear-gradient(to bottom, #ffffff 1px, transparent 1px)',
            backgroundSize: '48px 48px',
            maskImage:
              'radial-gradient(ellipse at 18% 0%, black 0%, transparent 72%)',
            WebkitMaskImage:
              'radial-gradient(ellipse at 18% 0%, black 0%, transparent 72%)',
          }}
        />

        <div className="relative z-10 flex items-center justify-between">
          <Brand
            markClassName="border-white/15 bg-zinc-50 text-zinc-950"
            wordmarkClassName="text-zinc-50"
          />
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-600">
            Marketplace / AI
          </span>
        </div>

        <div className="relative z-10 my-auto max-w-lg py-16">
          <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.035] px-3 py-1">
            <span className="size-1.5 rounded-full bg-emerald-400" />
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-400">
              AI-Native Secondhand Marketplace
            </span>
          </div>

          <h1 className="text-balance text-[40px] font-semibold leading-[1.08] tracking-[-0.035em] xl:text-[46px]">
            把闲置，交给
            <br />
            <span className="text-zinc-400">更懂它的人。</span>
          </h1>

          <p className="mt-5 max-w-md text-sm leading-6 text-zinc-400">
            闲小宝把语义检索、流式 AI 导购与交易审批放进同一条安静的流程里。少一点噪音，多一点确定。
          </p>

          <div className="mt-10 space-y-3">
            {capabilities.map((capability) => {
              const Icon = capability.icon

              return (
                <div
                  key={capability.title}
                  className="flex gap-3 rounded-lg border border-white/10 bg-white/[0.025] p-3.5"
                >
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-md border border-white/10 bg-white/[0.04]">
                    <Icon className="size-4 text-zinc-300" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium text-zinc-100">
                      {capability.title}
                    </p>
                    <p className="mt-0.5 text-xs leading-5 text-zinc-500">
                      {capability.description}
                    </p>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        <div className="relative z-10 flex items-center justify-between border-t border-white/10 pt-5 text-[10px] text-zinc-600">
          <span>交易有据 · 决策有据</span>
          <span className="tabular-nums">闲小宝 V1.0</span>
        </div>
      </aside>

      <main className="relative flex min-h-svh flex-col bg-[#fafafa] dark:bg-background">
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-border/70 px-5 lg:justify-end lg:border-b-0 lg:px-8">
          <Brand className="lg:hidden" />
          <ThemeToggle />
        </div>

        <div className="flex flex-1 items-center justify-center px-5 py-8 sm:px-8">
          <div className="w-full max-w-[400px]">
            <Outlet />
          </div>
        </div>

        <div className="px-6 pb-6 text-center text-[10px] leading-5 text-muted-foreground">
          登录即表示你同意平台的交易与隐私规范
        </div>
      </main>
    </div>
  )
}

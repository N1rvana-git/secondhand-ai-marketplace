import { Link } from 'react-router-dom'
import { ArrowRight, ShieldAlert, ShieldCheck } from 'lucide-react'
import { PageHeader } from '@/components/app/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { SystemReadinessCard } from '@/features/admin/SystemReadinessCard'
import { TagGovernancePanel } from '@/features/admin/TagGovernancePanel'
import { UserManagementPanel } from '@/features/admin/UserManagementPanel'
import { useAuthStore } from '@/stores/auth'

export default function AdminPage() {
  const user = useAuthStore((state) => state.user)

  if (user?.role !== 'admin') {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-16 sm:px-6">
        <div className="rounded-xl border border-border bg-card px-6 py-14 text-center">
          <div className="mx-auto flex size-10 items-center justify-center rounded-full border border-rose-200 bg-rose-50 dark:border-rose-900/60 dark:bg-rose-950/30">
            <ShieldAlert className="size-4 text-rose-600 dark:text-rose-400" />
          </div>
          <h1 className="mt-4 text-base font-semibold tracking-tight text-foreground">
            无权限访问管理控制台
          </h1>
          <p className="mx-auto mt-1.5 max-w-md text-xs leading-5 text-muted-foreground">
            当前账号不是管理员。系统不会清除你的登录态，你可以返回交易广场继续浏览或管理个人工作台。
          </p>
          <div className="mt-5 flex items-center justify-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link to="/studio">返回工作台</Link>
            </Button>
            <Button asChild size="sm">
              <Link to="/market">
                去交易广场
                <ArrowRight className="size-3.5" />
              </Link>
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-16 pt-6 sm:px-6 sm:pt-8">
      <PageHeader
        eyebrow="Admin / Phase 4"
        title="管理控制台"
        description="系统就绪探针、用户 RBAC 角色与全站标签治理的统一入口。所有破坏性操作均需二次确认。"
        badge={
          <Badge variant="default" className="gap-1">
            <ShieldCheck className="size-3" />
            管理员
          </Badge>
        }
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to="/studio">
              返回工作台
              <ArrowRight className="size-3.5" />
            </Link>
          </Button>
        }
      />

      <div className="space-y-4">
        <SystemReadinessCard />
        <UserManagementPanel />
        <TagGovernancePanel />
      </div>
    </div>
  )
}

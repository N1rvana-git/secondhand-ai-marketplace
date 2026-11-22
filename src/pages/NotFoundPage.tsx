import { Link } from 'react-router-dom'
import { ArrowLeft, Compass } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

export default function NotFoundPage() {
  return (
    <div className="mx-auto flex min-h-[60svh] w-full max-w-6xl items-center justify-center px-4 py-16 sm:px-6">
      <div className="flex max-w-sm flex-col items-center text-center">
        <div className="flex size-11 items-center justify-center rounded-xl border border-border bg-muted/30">
          <Compass className="size-5 text-muted-foreground" />
        </div>
        <Badge variant="outline" className="mt-5">
          404
        </Badge>
        <h1 className="mt-3 text-2xl font-semibold tracking-[-0.025em]">
          页面不存在
        </h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          你访问的地址可能已被移动或尚未开放。
        </p>
        <Button asChild variant="outline" size="sm" className="mt-6">
          <Link to="/market">
            <ArrowLeft className="size-3.5" />
            返回交易广场
          </Link>
        </Button>
      </div>
    </div>
  )
}

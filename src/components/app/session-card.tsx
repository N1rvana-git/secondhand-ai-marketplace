import { Link } from 'react-router-dom'
import { CalendarDays, Fingerprint, UserRound } from 'lucide-react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { formatDate, getInitials, roleLabel } from '@/lib/format'
import { useAuthStore } from '@/stores/auth'

export function SessionCard() {
  const user = useAuthStore((state) => state.user)

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle>当前会话</CardTitle>
          <Badge variant={user ? 'secondary' : 'outline'}>
            {user ? roleLabel(user.role) : '访客'}
          </Badge>
        </div>
        <CardDescription>
          {user
            ? '身份信息来自 GET /auth/me，由认证状态统一维护。'
            : '当前为公开浏览状态，登录后可进入个人工作台。'}
        </CardDescription>
      </CardHeader>

      <CardContent>
        {user ? (
          <div>
            <div className="flex items-center gap-3">
              <Avatar className="size-10 border border-border">
                <AvatarFallback className="bg-secondary text-xs">
                  {getInitials(user.username, user.email)}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">
                  {user.username}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {user.email ?? '未绑定邮箱'}
                </p>
              </div>
            </div>

            <Separator className="my-4" />

            <dl className="space-y-3 text-xs">
              <div className="flex items-center justify-between gap-3">
                <dt className="flex items-center gap-2 text-muted-foreground">
                  <Fingerprint className="size-3.5" />
                  用户 ID
                </dt>
                <dd className="tabular-nums text-foreground">
                  #{user.id}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="flex items-center gap-2 text-muted-foreground">
                  <CalendarDays className="size-3.5" />
                  注册时间
                </dt>
                <dd className="text-right text-foreground">
                  {formatDate(user.created_at)}
                </dd>
              </div>
            </dl>
          </div>
        ) : (
          <div className="flex flex-col items-center rounded-lg border border-dashed border-border px-5 py-7 text-center">
            <div className="flex size-9 items-center justify-center rounded-full border border-border bg-muted/40">
              <UserRound className="size-4 text-muted-foreground" />
            </div>
            <p className="mt-3 text-sm font-medium text-foreground">
              尚未登录
            </p>
            <p className="mt-1 max-w-[220px] text-xs leading-5 text-muted-foreground">
              登录后即可发布闲置、收藏商品并查看订单。
            </p>
          </div>
        )}
      </CardContent>

      {!user ? (
        <CardFooter className="grid grid-cols-2 gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to="/login">登录</Link>
          </Button>
          <Button asChild size="sm">
            <Link to="/register">注册</Link>
          </Button>
        </CardFooter>
      ) : null}
    </Card>
  )
}

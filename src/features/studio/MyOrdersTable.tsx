import { Link } from 'react-router-dom'
import { ReceiptText, ShoppingBag } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatPrice } from '@/features/market/market-utils'
import {
  formatOrderTime,
  getOrderStatusMeta,
} from '@/features/studio/studio-utils'
import type { DashboardResponse } from '@/types/api'

type StudioOrder = DashboardResponse['my_orders'][number]

interface MyOrdersTableProps {
  orders: StudioOrder[]
}

export function MyOrdersTable({ orders }: MyOrdersTableProps) {
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <header className="flex items-start justify-between gap-3 border-b border-border/70 px-4 py-3.5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <ReceiptText className="size-3.5 text-muted-foreground" />
            <h2 className="text-[13px] font-semibold tracking-tight text-foreground">
              我的订单
            </h2>
          </div>
          <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
            包含 AI 审批通过后自动生成的订单，状态以后端为准。
          </p>
        </div>
        <Badge variant="outline" className="shrink-0 tabular-nums">
          {orders.length} 笔
        </Badge>
      </header>

      {orders.length === 0 ? (
        <div className="px-6 py-16 text-center">
          <div className="mx-auto flex size-10 items-center justify-center rounded-full border border-border bg-muted/30">
            <ShoppingBag className="size-4 text-muted-foreground" />
          </div>
          <p className="mt-4 text-sm font-medium text-foreground">
            还没有任何订单
          </p>
          <p className="mx-auto mt-1.5 max-w-sm text-xs leading-5 text-muted-foreground">
            在交易广场挑一件好物，或让 AI 导购帮你完成一次高额交易审批。
          </p>
          <Button asChild size="sm" className="mt-4">
            <Link to="/market">去交易广场逛逛</Link>
          </Button>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="pl-4">订单号</TableHead>
              <TableHead>商品名称</TableHead>
              <TableHead className="text-right">单价</TableHead>
              <TableHead className="text-right">数量</TableHead>
              <TableHead className="text-right">小计</TableHead>
              <TableHead>状态</TableHead>
              <TableHead className="pr-4 text-right">下单时间</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {orders.map((order) => {
              const status = getOrderStatusMeta(order.status)
              const subtotal = order.price * order.quantity

              return (
                <TableRow key={order.order_id}>
                  <TableCell className="pl-4 font-mono text-[11.5px] tabular-nums text-muted-foreground">
                    #{order.order_id}
                  </TableCell>
                  <TableCell className="max-w-[260px]">
                    <span className="line-clamp-2 text-[12.5px] font-medium leading-5 text-foreground">
                      {order.item_name}
                    </span>
                  </TableCell>
                  <TableCell className="text-right font-mono text-[12px] tabular-nums text-muted-foreground">
                    ¥{formatPrice(order.price)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-[12px] tabular-nums text-muted-foreground">
                    {order.quantity}
                  </TableCell>
                  <TableCell className="text-right font-mono text-[12px] font-semibold tabular-nums text-foreground">
                    ¥{formatPrice(subtotal)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={status.variant} className="text-[10px]">
                      {status.label}
                    </Badge>
                  </TableCell>
                  <TableCell className="pr-4 text-right font-mono text-[11px] tabular-nums text-muted-foreground">
                    {formatOrderTime(order.time)}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      )}
    </section>
  )
}

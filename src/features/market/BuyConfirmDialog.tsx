import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  ImageOff,
  Loader2,
  ShieldCheck,
  ShoppingBag,
} from 'lucide-react'
import { ApiError, getApiErrorMessage, resolveMediaUrl } from '@/api/client'
import { buyItem } from '@/api/items'
import { showApiErrorToast } from '@/lib/errorToast'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import type { BuyItemResponse } from '@/types/api'
import {
  createIdempotencyKey,
  formatPrice,
  type MarketItem,
} from '@/features/market/market-utils'

interface BuyConfirmDialogProps {
  item: MarketItem | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onPurchased: (itemId: number, remainingInventory: number) => void
  onOutOfStock: (itemId: number) => void
}

type PurchaseStatus = 'idle' | 'submitting' | 'success' | 'error'

function errorTitle(code: string | null): string {
  switch (code) {
    case 'OUT_OF_STOCK':
      return '库存不足'
    case 'IDEMPOTENCY_IN_PROGRESS':
      return '订单处理中'
    case 'RATE_LIMITED':
      return '请求过于频繁'
    default:
      return '下单未完成'
  }
}

export function BuyConfirmDialog({
  item,
  open,
  onOpenChange,
  onPurchased,
  onOutOfStock,
}: BuyConfirmDialogProps) {
  const [actionKey, setActionKey] = useState<string | null>(null)
  const [status, setStatus] = useState<PurchaseStatus>('idle')
  const [receipt, setReceipt] = useState<BuyItemResponse | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [errorCode, setErrorCode] = useState<string | null>(null)
  const [cooldown, setCooldown] = useState(0)
  const [isKeyVisible, setIsKeyVisible] = useState(false)
  const [imageFailed, setImageFailed] = useState(false)

  // 连击防重：React 状态更新是异步的，极端连点可能在同一帧内多次进入
  // handleConfirm；用同步 ref 做 single-flight，保证只发一次购买请求。
  const submittingRef = useRef(false)

  const itemId = item?.id ?? null
  const isUnavailable = Boolean(
    item && (item.is_offer === false || item.is_sold || item.inventory <= 0),
  )

  useEffect(() => {
    if (!open) return
    submittingRef.current = false
    setActionKey(createIdempotencyKey())
    setStatus('idle')
    setReceipt(null)
    setErrorMessage(null)
    setErrorCode(null)
    setCooldown(0)
    setIsKeyVisible(false)
    setImageFailed(false)
  }, [open, itemId])

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = window.setTimeout(() => {
      setCooldown((seconds) => Math.max(0, seconds - 1))
    }, 1000)
    return () => window.clearTimeout(timer)
  }, [cooldown])

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      submittingRef.current = false
      setActionKey(null)
      setStatus('idle')
      setReceipt(null)
      setErrorMessage(null)
      setErrorCode(null)
      setCooldown(0)
      setIsKeyVisible(false)
    }
    onOpenChange(nextOpen)
  }

  const handleConfirm = async () => {
    if (
      !item ||
      !actionKey ||
      submittingRef.current ||
      status === 'submitting' ||
      cooldown > 0 ||
      isUnavailable
    ) {
      return
    }

    submittingRef.current = true
    setStatus('submitting')
    setErrorMessage(null)
    setErrorCode(null)

    try {
      const result = await buyItem(item.id, actionKey)
      setReceipt(result)
      setStatus('success')
      onPurchased(item.id, result.remaining_inventory)
    } catch (error) {
      const apiError = error instanceof ApiError ? error : null
      const code = apiError?.code ?? null
      setErrorCode(code)
      showApiErrorToast(error, errorTitle(code))

      if (code === 'OUT_OF_STOCK') {
        setErrorMessage('库存不足，商品可能刚刚被抢完。列表已为你刷新。')
        setStatus('error')
        onOutOfStock(item.id)
        return
      }

      if (code === 'IDEMPOTENCY_IN_PROGRESS') {
        setErrorMessage(
          '同一订单仍在处理中，请勿重复点击。稍后重试会复用同一防重键。',
        )
        setStatus('error')
        return
      }

      if (apiError?.status === 429 || code === 'RATE_LIMITED') {
        const seconds = apiError?.retryAfter ?? 30
        setCooldown(seconds)
        setErrorMessage(`请求过于频繁，请在 ${seconds} 秒后重试。`)
        setStatus('error')
        return
      }

      setErrorMessage(getApiErrorMessage(error))
      setStatus('error')
    } finally {
      // 失败后允许「重试支付」继续复用同一个 actionKey；连击期间的重复
      // 进入已被 submittingRef 拦截。
      submittingRef.current = false
    }
  }

  const confirmLabel = isUnavailable
    ? '已售罄'
    : status === 'submitting'
      ? '正在锁定库存'
      : cooldown > 0
        ? `请等待 ${cooldown}s`
        : status === 'error'
          ? '重试支付'
          : '确认支付'

  return (
    <Dialog open={open && Boolean(item)} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md" showCloseButton={status !== 'submitting'}>
        {status === 'success' && receipt && item ? (
          <div className="space-y-5">
            <div className="text-center">
              <div className="mx-auto flex size-12 items-center justify-center rounded-full border border-emerald-200 bg-emerald-50 dark:border-emerald-900/60 dark:bg-emerald-950/40">
                <CheckCircle2 className="size-6 text-emerald-600 dark:text-emerald-400" />
              </div>
              <DialogTitle className="mt-4 text-lg tracking-[-0.02em]">
                抢购成功
              </DialogTitle>
              <DialogDescription className="mt-1 text-xs">
                订单已生成，库存已为你锁定。
              </DialogDescription>
            </div>

            <div className="rounded-xl border border-border/80 bg-card">
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-[11px] text-muted-foreground">订单号</span>
                <span className="font-mono text-sm font-semibold tabular-nums text-foreground">
                  #{receipt.order_id}
                </span>
              </div>
              <Separator />
              <dl className="space-y-2 px-4 py-3 text-[11px]">
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted-foreground">商品</dt>
                  <dd className="max-w-[220px] truncate text-right font-medium text-foreground">
                    {receipt.item_name}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted-foreground">单价 × 数量</dt>
                  <dd className="font-mono tabular-nums text-foreground">
                    ¥{formatPrice(receipt.unit_price)} × {receipt.quantity}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted-foreground">剩余库存</dt>
                  <dd className="font-mono tabular-nums text-foreground">
                    {receipt.remaining_inventory > 0
                      ? `${receipt.remaining_inventory} 件`
                      : '已售罄'}
                  </dd>
                </div>
              </dl>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <Button asChild className="sm:flex-1">
                <Link to="/studio" onClick={() => handleOpenChange(false)}>
                  去工作台看订单
                  <ArrowRight className="size-3.5" />
                </Link>
              </Button>
              <Button
                type="button"
                variant="outline"
                className="sm:flex-1"
                onClick={() => handleOpenChange(false)}
              >
                继续逛逛
              </Button>
            </div>
          </div>
        ) : item ? (
          <>
            <DialogHeader>
              <DialogTitle>确认下单</DialogTitle>
              <DialogDescription>
                提交后将锁定 1 件库存，请确认商品与金额。
              </DialogDescription>
            </DialogHeader>

            <div className="rounded-xl border border-border/80 bg-card p-3.5">
              <div className="flex gap-3">
                <div className="relative size-16 shrink-0 overflow-hidden rounded-lg border border-border/70 bg-muted">
                  {item.image_path && !imageFailed ? (
                    <img
                      src={resolveMediaUrl(item.image_path)}
                      alt={item.name}
                      onError={() => setImageFailed(true)}
                      className="size-full object-cover"
                    />
                  ) : (
                    <div className="flex size-full items-center justify-center">
                      <ImageOff className="size-4 text-muted-foreground/60" />
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-[13px] font-medium leading-5 text-foreground">
                    {item.name}
                  </p>
                  <p className="mt-1 font-mono text-xs font-semibold tabular-nums text-foreground">
                    ¥{formatPrice(item.price)}
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    <Badge
                      variant="outline"
                      className="border-border/70 bg-transparent px-1.5 py-0 text-[10px] font-normal text-muted-foreground"
                    >
                      库存 {item.inventory}
                    </Badge>
                    <Badge
                      variant="outline"
                      className="border-border/70 bg-transparent px-1.5 py-0 text-[10px] font-normal text-muted-foreground"
                    >
                      {item.is_offer === false ? '求购' : '出售'}
                    </Badge>
                  </div>
                </div>
              </div>

              <Separator className="my-3" />

              <dl className="space-y-2 text-[11px]">
                <div className="flex items-center justify-between">
                  <dt className="text-muted-foreground">单价</dt>
                  <dd className="font-mono tabular-nums text-foreground">
                    ¥{formatPrice(item.price)}
                  </dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-muted-foreground">数量</dt>
                  <dd className="font-mono tabular-nums text-foreground">
                    1 件
                  </dd>
                </div>
                <div className="flex items-center justify-between border-t border-border/70 pt-2">
                  <dt className="text-xs font-medium text-foreground">
                    应付合计
                  </dt>
                  <dd className="font-mono text-sm font-semibold tabular-nums text-foreground">
                    ¥{formatPrice(item.price)}
                  </dd>
                </div>
              </dl>
            </div>

            <div className="rounded-lg border border-border/70 bg-muted/25 px-3 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <ShieldCheck className="size-3.5" />
                  防重复提交保障
                </p>
                <button
                  type="button"
                  onClick={() => setIsKeyVisible((visible) => !visible)}
                  className="text-[10px] font-medium text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
                >
                  {isKeyVisible ? '收起' : '查看 Key'}
                </button>
              </div>
              <p className="mt-1.5 break-all font-mono text-[10px] leading-4 text-muted-foreground">
                {actionKey
                  ? isKeyVisible
                    ? actionKey
                    : `${actionKey.slice(0, 8)}...${actionKey.slice(-4)}`
                  : '正在生成...'}
              </p>
            </div>

            {errorMessage ? (
              <Alert
                variant={
                  errorCode === 'OUT_OF_STOCK' ? 'destructive' : 'default'
                }
                className="py-2.5"
              >
                <AlertCircle />
                <AlertTitle className="text-xs">
                  {errorTitle(errorCode)}
                </AlertTitle>
                <AlertDescription className="text-[11px] leading-5">
                  {errorMessage}
                  {errorCode !== 'OUT_OF_STOCK' &&
                  errorCode !== 'RATE_LIMITED' &&
                  errorCode !== 'IDEMPOTENCY_IN_PROGRESS'
                    ? ' 重试会复用同一防重键，不会重复扣减库存。'
                    : null}
                </AlertDescription>
              </Alert>
            ) : null}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => handleOpenChange(false)}
                disabled={status === 'submitting'}
              >
                取消
              </Button>
              <Button
                type="button"
                onClick={() => void handleConfirm()}
                disabled={
                  isUnavailable ||
                  status === 'submitting' ||
                  cooldown > 0
                }
                className={cn(isUnavailable && 'opacity-60')}
              >
                {status === 'submitting' ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <ShoppingBag className="size-4" />
                )}
                {confirmLabel}
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

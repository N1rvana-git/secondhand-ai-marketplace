import { Link } from 'react-router-dom'
import { Package2 } from 'lucide-react'
import { cn } from '@/lib/utils'

interface BrandMarkProps {
  className?: string
}

export function BrandMark({ className }: BrandMarkProps) {
  return (
    <span
      className={cn(
        'flex size-7 shrink-0 items-center justify-center rounded-md border border-transparent bg-foreground text-background',
        className,
      )}
      aria-hidden="true"
    >
      <Package2 className="size-4" />
    </span>
  )
}

interface BrandProps {
  className?: string
  markClassName?: string
  wordmarkClassName?: string
}

export function Brand({
  className,
  markClassName,
  wordmarkClassName,
}: BrandProps) {
  return (
    <Link
      to="/market"
      className={cn(
        'inline-flex items-center gap-2 rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
        className,
      )}
      aria-label="闲小宝交易广场"
    >
      <BrandMark className={markClassName} />
      <span
        className={cn(
          'text-sm font-semibold tracking-[-0.01em]',
          wordmarkClassName,
        )}
      >
        闲小宝
      </span>
    </Link>
  )
}

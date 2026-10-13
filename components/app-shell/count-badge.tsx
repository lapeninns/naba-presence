import { cn } from "@/lib/utils"

/**
 * The count that rides on a chrome icon: the tab bar's tabs, the rail's
 * tiles and the notifications bell. Set in the count role (13px on touch,
 * 12px on a desk, the smallest the type scale allows), in the mono figure
 * face, so the pill is 20px tall to hold it. Above 99 it reads "99+".
 *
 * Decorative (`aria-hidden`): every caller carries the count in the link's
 * accessible name or description instead. The caller places the badge
 * (`absolute` plus offsets) through `className`.
 */
export function CountBadge({
  count,
  slot,
  className,
}: {
  count: number
  /** The `data-slot` tests and CSS key on, e.g. "tab-count". */
  slot: string
  className?: string
}) {
  return (
    <span
      aria-hidden
      data-slot={slot}
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 font-mono text-count leading-none font-semibold text-primary-foreground tabular-nums",
        className
      )}
    >
      {count > 99 ? "99+" : count}
    </span>
  )
}

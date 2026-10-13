import { cn } from "@/lib/utils"

/**
 * Purely decorative. The busy-region contract: the CONTAINER swapping
 * between skeletons and content sets aria-busy while loading — Skeleton
 * itself is always aria-hidden.
 *
 * Reference `.skeleton`: the hover-fill grey, the tag radius, at least 12px
 * tall, with a soft highlight travelling across it. Reduced motion freezes it.
 */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn(
        "relative min-h-3 overflow-hidden rounded-(--np-radius-tag) bg-fill before:absolute before:inset-0 before:animate-shimmer before:bg-linear-to-r before:from-transparent before:via-surface/55 before:to-transparent motion-reduce:before:animate-none dark:before:via-ink/6",
        className
      )}
      {...props}
    />
  )
}

/**
 * Placeholder rows for a list that is loading, drawn at the size the real
 * rows will take: each row is `--np-row-h` tall (52px on touch, 44px on a
 * desk) with a title bar and a shorter meta bar, inset by the card padding.
 * So the swap from skeleton to content does not shift the page. Hidden from
 * assistive tech like every skeleton: the container that swaps (QueryPending)
 * says what is loading.
 */
function SkeletonList({
  rows = 3,
  className,
  ...props
}: React.ComponentProps<"div"> & { rows?: number }) {
  return (
    <div
      data-slot="skeleton-list"
      aria-hidden="true"
      className={cn(
        "flex flex-col divide-y divide-line overflow-hidden rounded-(--np-radius-card) border border-line bg-surface",
        className
      )}
      {...props}
    >
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          className="flex min-h-(--np-row-h) flex-col justify-center gap-1.5 px-(--np-card-pad) py-2"
        >
          <Skeleton className="h-3.5 w-2/5" />
          <Skeleton className="h-3 w-3/5" />
        </div>
      ))}
    </div>
  )
}

export { Skeleton, SkeletonList }

import { cn } from "@/lib/utils"

/**
 * Purely decorative. The busy-region contract: the CONTAINER swapping
 * between skeletons and content sets aria-busy while loading — Skeleton
 * itself is always aria-hidden.
 *
 * Drawing (taste pilot P4, "loading looks like the finished layout"): a flat
 * bar in the fill grey (visible on a card and on the canvas in both themes),
 * the tag radius, at least 12px tall, sized by the caller to the line it
 * stands in for. No gradient and no travelling highlight: under
 * `motion-safe` it breathes slowly in opacity only (`animate-pulse`, 2s);
 * with reduced motion it is a still bar.
 */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn(
        "min-h-3 rounded-(--np-radius-tag) bg-fill motion-safe:animate-pulse motion-reduce:animate-none",
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

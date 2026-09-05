import { cn } from "@/lib/utils"

/**
 * Purely decorative. The busy-region contract: the CONTAINER swapping
 * between skeletons and content sets aria-busy while loading — Skeleton
 * itself is always aria-hidden.
 *
 * A quiet block on the fill ladder with a highlight that travels across it
 * once every two seconds, the way the platform's placeholders shimmer.
 * Reduced motion freezes it globally.
 */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn(
        "relative overflow-hidden rounded-(--np-radius-tag) bg-fill-secondary before:absolute before:inset-0 before:animate-shimmer before:bg-linear-to-r before:from-transparent before:via-surface/70 before:to-transparent motion-reduce:before:animate-none",
        className
      )}
      {...props}
    />
  )
}

export { Skeleton }

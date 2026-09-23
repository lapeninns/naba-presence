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

export { Skeleton }

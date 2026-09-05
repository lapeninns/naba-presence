import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

/**
 * One block of the Home summary: a headline, one line of context and, on the
 * trailing edge, an optional aside (a count, a "caught up" note). Headline is
 * the body size at semibold, so the page title stays the only bold thing.
 */
function HomeSection({
  id,
  title,
  description,
  aside,
  className,
  children,
}: {
  id: string
  title: string
  description?: React.ReactNode
  aside?: React.ReactNode
  className?: string
  children: React.ReactNode
}) {
  return (
    <section
      aria-labelledby={id}
      className={cn("flex min-w-0 flex-col gap-3", className)}
    >
      <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-1">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 id={id} className="text-title font-semibold text-ink">
            {title}
          </h2>
          {description ? (
            <p className="text-caption text-ink-muted">{description}</p>
          ) : null}
        </div>
        {aside}
      </div>
      {children}
    </section>
  )
}

/**
 * The skeleton of a Mac-style list: a white card of row-height bars divided
 * by hairlines, so the loading state has the same shape as the list it
 * becomes. The caller's container carries `aria-busy`.
 */
function ListRowsSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div
      aria-busy="true"
      className="divide-y divide-line-subtle overflow-hidden rounded-(--np-radius-card) bg-surface"
    >
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          className="flex h-(--np-row-h) items-center gap-3 px-(--np-card-pad)"
        >
          <Skeleton className="size-2 rounded-(--np-radius-pill)" />
          <Skeleton className="h-3.5 w-40 max-w-[40%]" />
          <Skeleton className="ml-auto h-3.5 w-10" />
        </div>
      ))}
    </div>
  )
}

/** The hairline-divided white card every Home list sits on. */
const listCardClassName =
  "divide-y divide-line-subtle overflow-hidden rounded-(--np-radius-card) bg-surface"

/**
 * A navigational list row: full-width target, hover on the hover ground, an
 * inset focus halo because the card clips its corners.
 */
const listRowClassName =
  "flex min-h-(--np-row-h) w-full items-center gap-3 px-(--np-card-pad) py-2 text-left transition-colors duration-(--np-duration-fast) ease-spring-snappy hover:bg-(--np-hover-bg) active:bg-fill-tertiary focus-visible:outline-none focus-visible:[box-shadow:inset_var(--np-focus-halo)]"

export { HomeSection, ListRowsSkeleton, listCardClassName, listRowClassName }

import { ChevronLeftIcon } from "lucide-react"
import Link from "next/link"
import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * The page header (app bar content, brief §4.3): an optional neutral icon,
 * the h1, and a count after it on the same line, then at most two trailing
 * actions (one is usually the scope switcher).
 *
 * - The count is `text-count`, weight 400, `ink-muted` (never NM's 2.5:1
 *   grey). The figure alone means little to a screen reader, so
 *   `countLabel` replaces it there ("12 need a reply").
 * - Deep pages pass `back`: a LABELLED link ("‹ Inbox", named "Back to
 *   Inbox"), at least 44px tall. Never an unlabelled circle.
 * - `sticky`: pinned to the top of the scroller under the safe area, on the
 *   page surface.
 */
export type ViewHeaderProps = Omit<React.ComponentProps<"header">, "title"> & {
  title: React.ReactNode
  /** The heading element. `p` when another element is the page's h1. */
  titleAs?: "h1" | "h2" | "p"
  /** A neutral leading icon (decorative). */
  icon?: React.ReactNode
  /** A count after the title ("12", "99+"). */
  count?: React.ReactNode
  /** What the count means, for screen readers ("12 need a reply"). */
  countLabel?: string
  /** Up to two trailing actions (44px buttons, the scope switcher). */
  actions?: React.ReactNode
  /** A labelled back link for deep pages. */
  back?: { href: string; label: string }
  sticky?: boolean
}

function ViewHeader({
  title,
  titleAs: Title = "h1",
  icon,
  count,
  countLabel,
  actions,
  back,
  sticky = false,
  className,
  ...props
}: ViewHeaderProps) {
  return (
    <header
      data-slot="view-header"
      data-sticky={sticky || undefined}
      className={cn(
        "flex min-w-0 items-center gap-3",
        sticky && "sticky top-0 z-sticky bg-surface pt-safe",
        className
      )}
      {...props}
    >
      {back ? <ViewHeaderBack {...back} /> : null}
      <div
        data-slot="view-header-title"
        className="flex min-w-0 flex-1 items-center gap-2"
      >
        {icon ? (
          <span
            aria-hidden
            data-slot="view-header-icon"
            className="grid shrink-0 place-items-center text-ink-secondary [&_svg]:[stroke-width:1.75] [&_svg:not([class*='size-'])]:size-5"
          >
            {icon}
          </span>
        ) : null}
        <Title className="min-w-0 truncate font-display text-page-title font-semibold text-ink outline-none">
          {title}
        </Title>
        {count !== undefined && count !== null ? (
          <span
            data-slot="view-header-count"
            className="shrink-0 text-count font-normal whitespace-nowrap text-ink-muted tabular-nums"
          >
            {countLabel ? (
              <>
                <span aria-hidden>{count}</span>
                <span className="sr-only">({countLabel})</span>
              </>
            ) : (
              count
            )}
          </span>
        ) : null}
      </div>
      {actions ? (
        <div
          data-slot="view-header-actions"
          className="flex shrink-0 items-center gap-2"
        >
          {actions}
        </div>
      ) : null}
    </header>
  )
}

/** "‹ Inbox": the visible label is the destination; the name adds "Back to". */
function ViewHeaderBack({
  href,
  label,
  className,
}: {
  href: string
  label: string
  className?: string
}) {
  return (
    <Link
      href={href}
      data-slot="view-header-back"
      // The visible destination stays in the name (label in name, 2.5.3).
      aria-label={`Back to ${label}`}
      className={cn(
        "-ms-2 inline-flex min-h-(--np-touch) shrink-0 items-center gap-0.5 rounded-(--np-radius-control) ps-1 pe-2 text-ui font-medium text-ink-secondary no-underline focus-halo transition-colors duration-(--np-duration-fast) ease-spring-snappy hover-fine:hover:text-ink",
        className
      )}
    >
      <ChevronLeftIcon aria-hidden className="size-5" strokeWidth={1.75} />
      {label}
    </Link>
  )
}

export { ViewHeader, ViewHeaderBack }

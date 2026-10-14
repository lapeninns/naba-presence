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
 *   `countLabel` says what it counts and the header reads the sentence:
 *   `count={12} countLabel="need a reply"` → "(12 need a reply)". A label
 *   that already starts with the figure ("12 need a reply") is read as it
 *   is, so the number is never dropped and never said twice.
 * - Deep pages pass `back`: a LABELLED link ("‹ Inbox", named "Back to
 *   Inbox"), at least 44px tall. Never an unlabelled circle.
 * - Narrow phones: below `desk` the row wraps. The title keeps a 12rem
 *   basis, so when the actions no longer fit beside it they drop to a line
 *   of their own under the title instead of squeezing it; the actions may
 *   themselves wrap and never overflow the header. On a desk the row never
 *   wraps (the title takes the rest of the line, as before).
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
  /**
   * What the count means, for screen readers: "need a reply" (the figure
   * is put in front) or the whole sentence "12 need a reply".
   */
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
        "flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 desk:flex-nowrap",
        sticky && "sticky top-0 z-sticky bg-surface pt-safe",
        className
      )}
      {...props}
    >
      {back ? <ViewHeaderBack {...back} /> : null}
      <div
        data-slot="view-header-title"
        className="flex min-w-0 flex-1 basis-48 items-center gap-2 desk:basis-0"
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
                <span className="sr-only">
                  ({countSentence(count, countLabel)})
                </span>
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
          className="flex max-w-full min-w-0 shrink-0 flex-wrap items-center gap-2"
        >
          {actions}
        </div>
      ) : null}
    </header>
  )
}

/**
 * The screen-reader sentence for the count: the figure, then what it
 * counts. A label that already leads with the figure (followed by a space
 * or nothing, so "12" is not mistaken for the start of "120") is kept as it
 * is. A count that is not plain text (a node) cannot be read back, so its
 * label is used alone, as before.
 */
function countSentence(count: React.ReactNode, label: string) {
  if (typeof count !== "string" && typeof count !== "number") return label
  const figure = String(count).trim()
  if (!figure) return label
  const text = label.trim()
  const leads =
    text === figure ||
    (text.startsWith(figure) && /^\s/.test(text.slice(figure.length)))
  return leads ? text : `${figure} ${text}`
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

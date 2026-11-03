"use client"

import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { formatNumber } from "@/lib/format"
import { cn } from "@/lib/utils"

/** Page numbers appear only past this many pages (a desk table's pager). */
const PAGE_NUMBERS_FROM = 5

/**
 * The pages to offer as numbers: always the first and the last, the current
 * page and its neighbours, and a gap (`null`) wherever pages are skipped, so
 * a 40-page table shows "1 … 6 7 8 … 40" rather than forty buttons.
 */
function pageWindow(page: number, pageCount: number): Array<number | null> {
  const wanted = new Set([1, pageCount, page - 1, page, page + 1])
  const pages = [...wanted]
    .filter((n) => n >= 1 && n <= pageCount)
    .sort((a, b) => a - b)
  const out: Array<number | null> = []
  pages.forEach((n, index) => {
    const previous = pages[index - 1]
    if (previous !== undefined && n - previous > 1) out.push(null)
    out.push(n)
  })
  return out
}

/**
 * The footer of a paged table (SYSTEM §10): a status line, "Showing 5 of 9
 * listings · sorted by name", then Previous and Next as small secondary
 * buttons. Lists that grow in place keep `LoadMore` ("Load more reviews");
 * this is for tables that turn a page.
 *
 * - The whole pager is a `<nav>` named "Pagination" (or `aria-label` when a
 *   view has two pagers), and the status line is polite and ends with an
 *   sr-only "page 2 of 3", so every page turn is announced, even when the
 *   count is unchanged, without moving focus.
 * - `page` is clamped to the pages there are, so a stale page after a filter
 *   never reads "page 5 of 2" or enables a Next past the end.
 * - The buttons are named "Previous page" and "Next page": the name starts
 *   with the visible word, so voice control still finds them. At either end
 *   the button stays in place, drawn disabled (never faded), focusable, with
 *   the reason as its description: "This is the first page".
 * - `pageNumbers` opts in to numbered pages, and only when there are more
 *   than five pages. They are a desk affordance: below `md` they are hidden
 *   and Previous/Next do the work. The current page has `aria-current`.
 * - Figures are tabular, so the line does not shift as the counts change.
 *
 * Words are props: `noun` is the singular and plural ("listing",
 * "listings") or a function of the total for anything irregular;
 * `sortLabel` is the sort's own words ("name", "most views").
 */
export function Pagination({
  shown,
  total,
  noun,
  sortLabel,
  page: requestedPage,
  pageCount: requestedPageCount,
  onPageChange,
  pageNumbers = false,
  "aria-label": ariaLabel = "Pagination",
  className,
}: {
  /** The rows on this page. */
  shown: number
  /** All the rows there are. */
  total: number
  /** Singular and plural, e.g. `["listing", "listings"]`, or a formatter. */
  noun: readonly [string, string] | ((total: number) => string)
  /** How the rows are sorted, in words; adds "· sorted by …". */
  sortLabel?: string
  /** The current page, from 1. */
  page: number
  pageCount: number
  onPageChange: (page: number) => void
  /** Numbered pages on desk tables with more than five pages. */
  pageNumbers?: boolean
  /** The nav's name; give each pager its own when a view has two. */
  "aria-label"?: string
  className?: string
}) {
  const pageCount = Math.max(1, Math.floor(requestedPageCount) || 1)
  const page = Math.min(pageCount, Math.max(1, Math.floor(requestedPage) || 1))
  const word =
    typeof noun === "function" ? noun(total) : total === 1 ? noun[0] : noun[1]
  const count =
    shown >= total
      ? `Showing all ${formatNumber(total)} ${word}`
      : `Showing ${formatNumber(shown)} of ${formatNumber(total)} ${word}`
  const atStart = page <= 1
  const atEnd = page >= pageCount
  const numbered = pageNumbers && pageCount > PAGE_NUMBERS_FROM

  return (
    <nav
      aria-label={ariaLabel}
      data-slot="pagination"
      className={cn(
        "flex flex-wrap items-center justify-between gap-2",
        className
      )}
    >
      <p
        data-slot="pagination-status"
        aria-live="polite"
        className="text-caption text-ink-muted tabular-nums"
      >
        {count}
        {sortLabel ? ` · sorted by ${sortLabel}` : null}
        <span className="sr-only">
          {` · page ${formatNumber(page)} of ${formatNumber(pageCount)}`}
        </span>
      </p>
      <div className="flex items-center gap-1.5">
        <Button
          variant="secondary"
          size="sm"
          aria-label="Previous page"
          disabledReason={atStart ? "This is the first page" : undefined}
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronLeftIcon aria-hidden />
          Previous
        </Button>
        {numbered ? (
          <ol
            data-slot="pagination-pages"
            className="hidden items-center gap-1 md:flex"
          >
            {pageWindow(page, pageCount).map((n, index) =>
              n === null ? (
                <li
                  key={`gap-${index}`}
                  aria-hidden
                  className="px-1 text-caption text-ink-muted"
                >
                  …
                </li>
              ) : (
                <li key={n}>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Page ${n}`}
                    aria-current={n === page ? "page" : undefined}
                    // The current page reads as the current place does
                    // everywhere else: the neutral fill and weight.
                    className={cn(
                      "min-w-(--np-control-h-sm) justify-center font-medium tabular-nums",
                      n === page && "bg-fill font-semibold"
                    )}
                    onClick={() => {
                      if (n !== page) onPageChange(n)
                    }}
                  >
                    {formatNumber(n)}
                  </Button>
                </li>
              )
            )}
          </ol>
        ) : null}
        <Button
          variant="secondary"
          size="sm"
          aria-label="Next page"
          disabledReason={atEnd ? "This is the last page" : undefined}
          onClick={() => onPageChange(page + 1)}
        >
          Next
          <ChevronRightIcon aria-hidden />
        </Button>
      </div>
    </nav>
  )
}

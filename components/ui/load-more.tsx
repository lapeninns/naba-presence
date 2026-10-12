"use client"

import { useEffect, useRef } from "react"

import { Button } from "@/components/ui/button"
import { formatNumber } from "@/lib/format"
import type { ListPaging } from "@/lib/queries/paged-list"
import { cn } from "@/lib/utils"

/**
 * The footer of a keyset-paged list: how many rows are on screen out of how
 * many there are, and a "Load more" button while another page follows.
 *
 * The count is a polite status region, so a screen reader hears the new
 * count when a page lands (not on first render, which is the list itself).
 * The button keeps focus while more remain; when the last page lands and the
 * button goes, focus moves to the count rather than falling to the page.
 */
export function LoadMore({
  shown,
  total,
  noun,
  paging,
  className,
}: {
  shown: number
  total: number
  /** Singular and plural, e.g. `["photo", "photos"]`. */
  noun: readonly [string, string]
  paging: ListPaging
  className?: string
}) {
  const statusRef = useRef<HTMLParagraphElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const hadFocus = useRef(false)
  const { hasMore } = paging

  useEffect(() => {
    if (!hasMore && hadFocus.current) {
      hadFocus.current = false
      statusRef.current?.focus()
    }
  }, [hasMore])

  const word = total === 1 ? noun[0] : noun[1]
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-2",
        className
      )}
    >
      <p
        ref={statusRef}
        role="status"
        tabIndex={-1}
        className="text-caption text-ink-muted tabular-nums outline-none"
      >
        {shown >= total
          ? `Showing all ${formatNumber(total)} ${word}`
          : `Showing ${formatNumber(shown)} of ${formatNumber(total)} ${word}`}
      </p>
      {paging.loadMoreFailed ? (
        <p role="alert" className="text-caption text-danger-ink">
          We couldn’t load more {noun[1]}. Try again.
        </p>
      ) : null}
      {hasMore ? (
        <Button
          ref={buttonRef}
          variant="secondary"
          size="sm"
          aria-disabled={paging.loadingMore || undefined}
          onClick={() => {
            hadFocus.current = document.activeElement === buttonRef.current
            paging.loadMore()
          }}
        >
          {paging.loadingMore ? "Loading…" : `Load more ${noun[1]}`}
        </Button>
      ) : null}
    </div>
  )
}

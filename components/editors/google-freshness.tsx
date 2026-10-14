"use client"

import { RefreshCw } from "lucide-react"

import { Button } from "@/components/ui/button"
import { formatRelativeTime } from "@/lib/format/date"

/**
 * When the editor last saw Google, with "Check Google now" (W3-2). Within
 * the staleness budget an editor is served from its last Google read, so the
 * comparison can be a few minutes old; publishing still reads Google first.
 * Renders nothing for a payload without `observedAt`.
 */
export function GoogleFreshness({
  observedAt,
  onRefresh,
  refreshing,
  disabled,
}: {
  observedAt: string | undefined
  onRefresh: () => void
  refreshing: boolean
  disabled?: boolean
}) {
  if (!observedAt) return null
  const relative = formatRelativeTime(observedAt)
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-ui text-ink-secondary">
      <span>
        Checked with Google{" "}
        {/* Relative to the reader's clock, so the server's render may differ. */}
        <time dateTime={observedAt} suppressHydrationWarning>
          {relative === "Just now" ? "just now" : relative}
        </time>
        .
      </span>
      <Button
        type="button"
        variant="link"
        size="sm"
        disabled={disabled || refreshing}
        onClick={onRefresh}
      >
        <RefreshCw
          className={refreshing ? "size-3.5 animate-spin" : "size-3.5"}
          strokeWidth={1.75}
          aria-hidden
        />
        {refreshing ? "Checking Google…" : "Check Google now"}
      </Button>
    </p>
  )
}

"use client"

import { useEffect, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"

import { Spinner } from "@/components/ui/spinner"
import { useToastManager } from "@/components/ui/toast"
import { triggerKeywordsSync, triggerPerformanceSync } from "@/lib/api/sync"
import { ApiClientError } from "@/lib/api/client"
import { describeActionError } from "@/lib/errors/action-errors"
import { queryKeys } from "@/lib/queries/keys"

/** What went wrong, in the words the operator can act on. */
export function refreshErrorCopy(caught: unknown): string {
  const status = caught instanceof ApiClientError ? caught.status : 0
  if (status === 503)
    return "Refreshing is paused right now. Please try again later."
  if (status === 409)
    return "A refresh is already running. Please try again in a moment."
  return describeActionError(caught)
}

/** How often the figures are re-read while a refresh is waiting for Google. */
const POLL_MS = 5_000
/** After this long the wait ends, so a quiet sync is never polled for ever. */
const POLL_LIMIT_MS = 90_000
/**
 * The keywords response carries no fetch time, so a sync that leaves the terms
 * as they were cannot be told from one still running: wait less for it.
 */
const KEYWORDS_POLL_LIMIT_MS = 30_000

type Kind = "performance" | "keywords"

/**
 * Follows one refresh to its result. `signature` summarises the figures on
 * screen (when they were fetched, what they total); `onStart` records the
 * signature the press began with. Until the figures change, `refreshing` is
 * true and the tab's query is re-read every few seconds (only while the page
 * is visible), for at most `POLL_LIMIT_MS`. A sync that finishes while the
 * request is still open changes the signature at once, so nothing is polled.
 */
export function useRefreshWatch(kind: Kind, signature: string | null) {
  const queryClient = useQueryClient()
  const [watch, setWatch] = useState<{ baseline: string | null } | null>(null)
  const refreshing = watch !== null && signature === watch.baseline

  useEffect(() => {
    if (!refreshing) return
    const poll = setInterval(() => {
      if (document.visibilityState === "hidden") return
      void queryClient.invalidateQueries({
        queryKey: queryKeys.analytics(
          kind === "performance" ? "presence" : "keywords",
          {}
        ),
        exact: false,
      })
    }, POLL_MS)
    const stop = setTimeout(
      () => setWatch(null),
      kind === "keywords" ? KEYWORDS_POLL_LIMIT_MS : POLL_LIMIT_MS
    )
    return () => {
      clearInterval(poll)
      clearTimeout(stop)
    }
  }, [refreshing, kind, queryClient])

  return {
    refreshing,
    onStart: () => setWatch({ baseline: signature }),
    onFailed: () => setWatch(null),
  }
}

/** "Refreshing…", for the tab's caption line while a refresh is in flight. */
export function RefreshStatus() {
  return (
    <p
      role="status"
      data-slot="refresh-status"
      className="flex items-center gap-1.5 text-caption text-ink-muted"
    >
      <Spinner decorative size="sm" />
      Refreshing…
    </p>
  )
}

/**
 * Asks Google for new figures now, rather than at the next scheduled pull.
 * The press itself lives in the report's actions menu (ReportActionsMenu),
 * which calls `run`; this hook owns the request and what it says back.
 *
 * The refresh covers the whole organisation's due listings: the sync
 * endpoints take no client scope (only one Google location, for the
 * scheduler), so a client-scoped report refreshes every client's figures.
 */
export function useRefreshGoogle({
  kind,
  onStart,
  onFailed,
}: {
  kind: Kind
  /** The press began: the tab starts following the refresh. */
  onStart?: () => void
  /** The request failed, so there is nothing to wait for. */
  onFailed?: () => void
}) {
  const queryClient = useQueryClient()
  const toast = useToastManager()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run() {
    setPending(true)
    setError(null)
    onStart?.()
    try {
      if (kind === "performance") await triggerPerformanceSync()
      else await triggerKeywordsSync()
      await queryClient.invalidateQueries({
        queryKey: queryKeys.analytics(
          kind === "performance" ? "presence" : "keywords",
          {}
        ),
        exact: false,
      })
      toast.add({
        type: "success",
        title: "Refresh started",
        description:
          kind === "performance"
            ? "New figures appear here as Google sends them."
            : "New search terms appear here as Google sends them.",
      })
    } catch (caught) {
      onFailed?.()
      setError(refreshErrorCopy(caught))
    } finally {
      setPending(false)
    }
  }

  return { run, pending, error }
}

"use client"

import { useEffect, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"

import { Spinner } from "@/components/ui/spinner"
import { useToastManager } from "@/components/ui/toast"
import {
  triggerKeywordsSync,
  triggerPerformanceSync,
  type ManualSyncResult,
} from "@/lib/api/sync"
import { ApiClientError } from "@/lib/api/client"
import { describeActionError } from "@/lib/errors/action-errors"
import { formatNumber } from "@/lib/format"
import { queryKeys } from "@/lib/queries/keys"
import { LISTING_TERMS } from "@/lib/workspace/terms"

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
 *
 * The server's answer usually ends the wait at once (`onSettled`): only a
 * sync it cut short leaves listings for the job runner to fetch. When that
 * wait runs out with the figures unchanged, `stillWaiting` says so rather
 * than the status vanishing as if they had arrived.
 */
export function useRefreshWatch(kind: Kind, signature: string | null) {
  const queryClient = useQueryClient()
  const [watch, setWatch] = useState<{
    baseline: string | null
    expired: boolean
  } | null>(null)
  const unchanged = watch !== null && signature === watch.baseline
  const refreshing = unchanged && !watch.expired
  const stillWaiting = unchanged && watch.expired

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
      () => setWatch((current) => current && { ...current, expired: true }),
      kind === "keywords" ? KEYWORDS_POLL_LIMIT_MS : POLL_LIMIT_MS
    )
    return () => {
      clearInterval(poll)
      clearTimeout(stop)
    }
  }, [refreshing, kind, queryClient])

  return {
    refreshing,
    stillWaiting,
    onStart: () => setWatch({ baseline: signature, expired: false }),
    onFailed: () => setWatch(null),
    onSettled: () => setWatch(null),
  }
}

/**
 * "Refreshing…", for the tab's caption line while a refresh is in flight;
 * "Still waiting for Google…" (no spinner: nothing is being re-read) when
 * the wait ran out before new figures came.
 */
export function RefreshStatus({
  stillWaiting = false,
}: {
  stillWaiting?: boolean
}) {
  return (
    <p
      role="status"
      data-slot="refresh-status"
      className="flex items-center gap-1.5 text-caption text-ink-muted"
    >
      {stillWaiting ? (
        "Still waiting for Google…"
      ) : (
        <>
          <Spinner decorative size="sm" />
          Refreshing…
        </>
      )}
    </p>
  )
}

/** The listings one manual request checks at most, by kind (the routes' defaults). */
const SYNC_CAP: Record<Kind, number> = { performance: 25, keywords: 10 }

function countListings(count: number) {
  return `${formatNumber(count)} ${count === 1 ? LISTING_TERMS.place : LISTING_TERMS.placePlural}`
}

/**
 * What a finished sync found, in the server's own counts, or null when the
 * answer does not say (an older server) or the sync was cut short and the
 * rest is still to come: then the refresh is only "started".
 *
 * `reloadFailed`: Google answered, but re-reading the figures afterwards did
 * not, so the ones on screen predate this check (the tab's StaleFiguresAlert
 * says the same). The toast then says so instead of "include this check".
 */
export function refreshResultToast(
  result: ManualSyncResult | null | undefined,
  {
    kind,
    scopedToClient = false,
    reloadFailed = false,
  }: { kind: Kind; scopedToClient?: boolean; reloadFailed?: boolean }
): {
  type: "success" | "info" | "warning"
  title: string
  description: string
} | null {
  if (!result || result.truncated || !Array.isArray(result.organisations))
    return null
  const outcomes = result.organisations.flatMap((entry) =>
    Array.isArray(entry?.outcomes) ? entry.outcomes : []
  )
  const checked = outcomes.length
  // The walk also stops at a per-request cap (25 listings for performance,
  // 10 for keywords; lib/server/performance.ts, lib/server/keywords.ts)
  // without saying so. A walk that reached the cap may have left listings
  // due, so it is only "started", and the tab keeps following it.
  if (checked >= SYNC_CAP[kind]) return null
  const failed = outcomes.filter(
    (outcome) => outcome.status === "failed"
  ).length
  if (checked === 0)
    return {
      type: "info",
      title: "Nothing to refresh yet",
      description: `No ${LISTING_TERMS.place} was due for a check. NabaPresence checks Google again automatically.`,
    }
  const shown = kind === "performance" ? "figures" : "search terms"
  const notReloaded = `The ${shown} couldn’t be reloaded; those shown are from the last successful load.`
  if (failed > 0)
    return {
      type: "warning",
      title: `${failed} of ${countListings(checked)} could not be refreshed`,
      description: reloadFailed ? notReloaded : "The report says why.",
    }
  const across = `Checked ${countListings(checked)}${
    scopedToClient ? " across your clients" : ""
  }.`
  if (reloadFailed)
    return {
      type: "warning",
      title: "Refreshed from Google",
      description: `${across} ${notReloaded}`,
    }
  return {
    type: "success",
    title: "Refreshed from Google",
    description: `${across} The ${shown} shown include this check.`,
  }
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
  scopedToClient,
  onStart,
  onFailed,
  onSettled,
}: {
  kind: Kind
  /** The report is one client's; the sync covers every client's listings. */
  scopedToClient?: boolean
  /** The press began: the tab starts following the refresh. */
  onStart?: () => void
  /** The request failed, so there is nothing to wait for. */
  onFailed?: () => void
  /** The server says the sync has finished, so there is nothing to wait for. */
  onSettled?: () => void
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
      const result =
        kind === "performance"
          ? await triggerPerformanceSync()
          : await triggerKeywordsSync()
      // Awaits the re-read, so a "Refreshed" below is said over the
      // figures the server has just returned.
      const figures = {
        queryKey: queryKeys.analytics(
          kind === "performance" ? "presence" : "keywords",
          {}
        ),
        exact: false,
      }
      const rereadFrom = Date.now()
      await queryClient.invalidateQueries(figures)
      // The re-read's own failure is swallowed (no `throwOnError`): read it
      // off the tab's queries, so "include this check" is never said over
      // figures that are still the last successful load's.
      const reloadFailed = queryClient
        .getQueryCache()
        .findAll({ ...figures, type: "active" })
        .some(
          (query) =>
            query.state.status === "error" &&
            query.state.errorUpdatedAt >= rereadFrom
        )
      const finished = refreshResultToast(result, {
        kind,
        scopedToClient,
        reloadFailed,
      })
      if (finished) {
        onSettled?.()
        toast.add(finished)
      } else {
        // Cut short (or an answer that does not say): the rest arrives
        // later, and the tab keeps following it.
        toast.add({
          type: "success",
          title: "Refresh started",
          description:
            kind === "performance"
              ? "New figures appear here as Google sends them."
              : "New search terms appear here as Google sends them.",
        })
      }
    } catch (caught) {
      onFailed?.()
      setError(refreshErrorCopy(caught))
    } finally {
      setPending(false)
    }
  }

  return { run, pending, error }
}

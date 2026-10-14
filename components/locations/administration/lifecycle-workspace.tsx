"use client"

import { createContext, useContext, useState, type Dispatch, type SetStateAction, type ReactNode } from "react"
import { useInfiniteQuery, useQuery } from "@tanstack/react-query"
import { SavedWorkList, type SavedWorkItem } from "@/components/reviewed-write"
import { ApiClientError } from "@/lib/api/client"
import { fetchLifecycleAttempt, fetchLifecycleWorkflows } from "@/lib/api/google-lifecycle"
import { useLocationCapabilities } from "@/lib/queries/use-location-capabilities"
import { useLocationDirectory } from "@/lib/queries/use-locations"
import { useSessionRole } from "@/lib/queries/use-session"
import { lifecycleEnded, type LifecycleEnded } from "./lifecycle-ended"
import { LifecycleOutcome } from "./lifecycle-outcome"
import { LifecycleReview } from "./lifecycle-review"
import { useLifecycle } from "./use-lifecycle"

/**
 * Why saved lifecycle work could not be read, in words that name the real
 * failure: a read that never reached the server rejects with a TypeError
 * (apiFetch wraps only writes as `network_error`), and only a 403 is about
 * the operator's access.
 */
export function savedLifecycleErrorText(error: unknown): string {
  const lead = "Saved lifecycle work could not be loaded."
  if (error instanceof TypeError || (error instanceof ApiClientError && error.code === "network_error")) return `${lead} We couldn’t reach NabaPresence. Check your connection and try again.`
  if (error instanceof ApiClientError && error.status === 403) return `${lead} Check your current access.`
  return `${lead} Try again.`
}

const Context = createContext<(ReturnType<typeof useLifecycle> & { setAccessBlocked: Dispatch<SetStateAction<boolean>>; ended: LifecycleEnded | null }) | null>(null)
export const useLifecycleContext = () => useContext(Context)
export function LifecycleWorkspace({ locationId, locationName, children }: {
  readonly locationId: string; readonly locationName?: string; readonly children: ReactNode
}) {
  const [accessBlocked, setAccessBlocked] = useState(false)
  const workflow = useLifecycle(locationId, accessBlocked), capabilities = useLocationCapabilities(locationId)
  const role = useSessionRole(), directory = useLocationDirectory(role)
  const name = locationName ?? directory.data?.find((entry) => entry.id === locationId)?.name ?? ""
  const visible = (role === "owner" || role === "admin") && capabilities.data?.canEditCanonical === true
  const saved = useInfiniteQuery({ queryKey: ["lifecycle-workflows", locationId], enabled: visible, initialPageParam: "",
    queryFn: ({ pageParam, signal }) => fetchLifecycleWorkflows(locationId, pageParam, { signal }), getNextPageParam: (page) => page.nextCursor ?? undefined,
  })
  const items = saved.data?.pages.flatMap((page) => page.items) ?? []
  // The latest recorded lifecycle outcome decides whether this account still
  // manages the location, so a confirmed deletion survives a reload or reset.
  const latestIndex = items.findIndex((item) => item.attemptId)
  const latestRecorded = latestIndex >= 0 ? items[latestIndex] : undefined
  const latest = useQuery({
    queryKey: ["lifecycle-latest-attempt", locationId, latestRecorded?.reviewId], enabled: visible && Boolean(latestRecorded), retry: false,
    queryFn: ({ signal }) => fetchLifecycleAttempt(locationId, latestRecorded?.reviewId ?? "", { signal }),
  })
  // An outcome held in this session counts unless it belongs to work that is
  // known to be older than the latest recorded outcome.
  const olderReviewIds = new Set(latestIndex >= 0 ? items.slice(latestIndex + 1).map((item) => item.reviewId) : [])
  const sessionAttempt = workflow.attempt && !olderReviewIds.has(workflow.attempt.reviewId) ? workflow.attempt : null
  const ended = visible ? lifecycleEnded(sessionAttempt) ?? lifecycleEnded(latest.data) : null
  // Each time a review is prepared or a saved item is opened, the panel takes
  // focus again, even when it is the same review (see ReviewedWritePanel).
  const [opened, setOpened] = useState(0)
  const context = {
    ...workflow,
    preview: async (request: Parameters<typeof workflow.preview>[0]) => { await workflow.preview(request); setOpened((value) => value + 1) },
    open: (item: Parameters<typeof workflow.open>[0]) => { setOpened((value) => value + 1); workflow.open(item) },
    setAccessBlocked,
    ended,
  }
  const focusKey = workflow.attempt ? `attempt:${workflow.attempt.reviewId}:${opened}` : workflow.review ? `review:${workflow.review.changeSet.id}:${opened}` : null
  const savedItems: SavedWorkItem[] = items.map((item) => ({
    id: item.reviewId,
    operation: item.request.operation === "transfer_location" ? "Account transfer" : "Managed-location deletion",
    stage: item.attemptId ? "Recorded outcome" : "Saved review",
    createdAt: item.createdAt,
    actionLabel: item.attemptId ? "Open lifecycle outcome" : "Open lifecycle review",
    disabled: workflow.busy || Boolean(workflow.unresolved && (workflow.review?.changeSet.id ?? workflow.attempt?.reviewId) !== item.reviewId),
    onOpen: () => context.open(item),
  }))
  return <Context.Provider value={context}><div className="flex min-w-0 flex-col gap-6">
    {visible && (workflow.review || workflow.attempt || workflow.error) ? <div className="flex min-w-0 flex-col gap-3">
      {workflow.error ? <p role="alert" className="text-ui text-danger-ink">{workflow.error}</p> : null}
      {accessBlocked ? <p role="status" className="text-ui text-ink-secondary">Resolve the current access action before approving or sending a lifecycle request.</p> : null}
      {workflow.attempt ? <LifecycleOutcome workflow={workflow} focusKey={focusKey} /> : <LifecycleReview workflow={workflow} locationName={name} disabled={!capabilities.data?.canPublish || accessBlocked} focusKey={focusKey} />}
    </div> : null}
    {children}
    {visible ? <SavedWorkList
      id="lifecycle-saved-work"
      title="Saved lifecycle work"
      description="Read recorded outcomes after reloading, expiry or disconnection. Sending and independent confirmation remain separate."
      items={savedItems}
      pending={saved.isPending}
      failed={saved.isError}
      loadingText="Loading saved lifecycle work…"
      errorText={savedLifecycleErrorText(saved.error)}
      emptyText="No saved lifecycle work."
      reloadLabel="Reload saved lifecycle work"
      reloading={saved.isFetching}
      onReload={() => { void saved.refetch() }}
      loadMoreLabel="Load earlier lifecycle work"
      hasMore={saved.hasNextPage}
      loadingMore={saved.isFetchingNextPage}
      onLoadMore={() => { void saved.fetchNextPage() }}
    /> : null}
  </div></Context.Provider>
}

"use client"

import { useInfiniteQuery } from "@tanstack/react-query"
import { useCallback, useMemo, useSyncExternalStore } from "react"
import { SavedWorkList } from "@/components/reviewed-write"
import { fetchGoogleVerificationWorkflows } from "@/lib/api/google-verification-workflows"
import type { VerificationWorkflowItem } from "@/lib/contracts/google-verification-workflows"
import { queryKeys } from "@/lib/queries/keys"
import { verificationMethodName } from "./verification-method"

/**
 * Which of `deadlines` have passed, re-rendering when the next one does: the
 * list form of `useDeadline`, so every row's stage follows the clock without
 * a hook per row. On the server every deadline counts as passed, so nothing
 * renders as a current approval before the client has checked.
 */
function usePassedDeadlines(deadlines: readonly string[]): ReadonlySet<string> {
  const key = deadlines.join("|")
  const times = useMemo(
    () => (key ? key.split("|") : []).map((value) => new Date(value).getTime()),
    [key]
  )
  // One timer at a time, for the next deadline still ahead; when it fires
  // the one after it is armed, so every deadline is seen as it passes. (A
  // timer clamped to setTimeout's limit fires early and simply re-arms.)
  const subscribe = useCallback(
    (notify: () => void) => {
      let timer: ReturnType<typeof setTimeout> | undefined
      const arm = () => {
        const now = Date.now(),
          next = Math.min(...times.filter((time) => time > now))
        if (!Number.isFinite(next)) return
        timer = setTimeout(() => {
          notify()
          arm()
        }, Math.min(2_147_483_647, next - now))
      }
      arm()
      return () => clearTimeout(timer)
    },
    [times]
  )
  const passed = useSyncExternalStore(
    subscribe,
    () => times.map((time) => (time <= Date.now() ? "1" : "0")).join(""),
    () => times.map(() => "1").join("")
  )
  return useMemo(
    () =>
      new Set(
        (key ? key.split("|") : []).filter((_, index) => passed[index] === "1")
      ),
    [key, passed]
  )
}

export function SavedVerificationWorkflows({
  locationId,
  busy,
  operation = "start",
  expiredReviewIds = [],
  lostSendReviewIds = [],
  invalidReviewIds = [],
  onSelect,
}: {
  readonly locationId: string
  readonly busy: boolean
  readonly operation?: "start" | "complete"
  readonly onSelect: (item: VerificationWorkflowItem) => void
  /** Reviews the server has already refused as expired in this session. */
  readonly expiredReviewIds?: readonly string[]
  /** Reviews whose send response was lost in this session, so their outcome is unknown. */
  readonly lostSendReviewIds?: readonly string[]
  /** Reviews the server refused in this session because their approval is no longer valid. */
  readonly invalidReviewIds?: readonly string[]
}) {
  const start = operation === "start"
  const saved = useInfiniteQuery({
    queryKey: queryKeys.locationVerificationWorkflows(locationId, operation),
    initialPageParam: "",
    queryFn: ({ pageParam, signal }) =>
      fetchGoogleVerificationWorkflows(
        locationId,
        { operation, ...(pageParam ? { cursor: pageParam } : {}) },
        { signal, background: true }
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  })
  const workflows = saved.data?.pages.flatMap((page) => page.workflows) ?? []
  const passed = usePassedDeadlines(workflows.map((item) => item.expiresAt))
  const items = workflows.map((item) => ({
    id: item.reviewId,
    operation: verificationMethodName(item.method),
    stage: savedWorkflowStage(item, {
      expired:
        passed.has(item.expiresAt) ||
        expiredReviewIds.includes(item.reviewId) ||
        item.reviewReason === "expired",
      lostSend: lostSendReviewIds.includes(item.reviewId),
      invalidated: invalidReviewIds.includes(item.reviewId),
    }),
    createdAt: item.createdAt,
    actionLabel: item.attempt ? "Open saved outcome" : "Open saved review",
    onOpen: () => onSelect(item),
    disabled: busy,
  }))
  return (
    <>
      <SavedWorkList
        id={`verification-saved-${operation}`}
        headingLevel="h3"
        title={start ? "Saved verification requests" : "Saved PIN completions"}
        description="Resume an exact team review or inspect a recorded outcome, including when publishing is paused."
        items={items}
        pending={saved.isPending}
        failed={saved.isError}
        loadingText="Loading saved requests…"
        errorText="Saved requests could not be loaded. Reconnect if needed, then reload."
        staleText="The latest reload failed. These saved requests are from the previous load."
        emptyText={
          start
            ? "No current saved start requests."
            : "No current saved PIN completions."
        }
        reloadLabel={
          start ? "Reload saved start requests" : "Reload saved PIN completions"
        }
        reloading={busy || saved.isFetching}
        onReload={() => void saved.refetch()}
        loadMoreLabel={
          start
            ? "Load more saved start requests"
            : "Load more saved PIN completions"
        }
        hasMore={saved.hasNextPage}
        loadingMore={busy || saved.isFetching}
        onLoadMore={() => void saved.fetchNextPage()}
      />
    </>
  )
}

const pausedStages = {
  reconnect_required: "Reconnect Google to continue",
  publish_not_allowed: "Sending not allowed",
} as const

/** The row's stage, from the same state its detail card uses; never "Approved review" for an unusable approval. */
export function savedWorkflowStage(
  item: VerificationWorkflowItem,
  {
    expired,
    lostSend,
    invalidated,
  }: {
    readonly expired: boolean
    readonly lostSend: boolean
    readonly invalidated: boolean
  }
): string {
  if (item.attempt)
    return item.attempt.executionState === "unknown"
      ? "Send outcome unknown"
      : item.attempt.executionState === "pending"
        ? "Request in progress"
        : "Recorded outcome"
  if (lostSend) return "Send outcome unknown"
  if (expired) return item.approvedBy ? "Approval expired" : "Review expired"
  if (
    invalidated ||
    (item.reviewReason &&
      item.reviewReason !== "reconnect_required" &&
      item.reviewReason !== "publish_not_allowed")
  )
    return item.approvedBy
      ? "Approval no longer valid"
      : "Review no longer valid"
  if (item.reviewReason) return pausedStages[item.reviewReason]
  return item.approvedBy ? "Approved review" : "Awaiting approval"
}

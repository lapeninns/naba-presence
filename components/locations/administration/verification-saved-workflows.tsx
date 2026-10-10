"use client"

import { useInfiniteQuery } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { fetchGoogleVerificationWorkflows } from "@/lib/api/google-verification-workflows"
import type { VerificationWorkflowItem } from "@/lib/contracts/google-verification-workflows"
import { useVerificationExpiry } from "./use-verification-expiry"
import { verificationMethodName } from "./verification-method"

export function SavedVerificationWorkflows({ locationId, busy, operation = "start", expiredReviewIds = [], lostSendReviewIds = [], invalidReviewIds = [], onSelect }: {
  readonly locationId: string; readonly busy: boolean; readonly operation?: "start" | "complete"; readonly onSelect: (item: VerificationWorkflowItem) => void
  /** Reviews the server has already refused as expired in this session. */
  readonly expiredReviewIds?: readonly string[]
  /** Reviews whose send response was lost in this session, so their outcome is unknown. */
  readonly lostSendReviewIds?: readonly string[]
  /** Reviews the server refused in this session because their approval is no longer valid. */
  readonly invalidReviewIds?: readonly string[]
}) {
  const heading = operation === "start" ? "Saved verification requests" : "Saved PIN completions"
  const saved = useInfiniteQuery({ queryKey: ["verification-workflows", locationId, operation],
    initialPageParam: "", queryFn: ({ pageParam, signal }) => fetchGoogleVerificationWorkflows(locationId, { operation, ...(pageParam ? { cursor: pageParam } : {}) }, { signal, background: true }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  })
  return <section aria-label={heading} className="flex min-w-0 flex-col gap-3 border-t border-line pt-4">
    <h3 className="text-title font-semibold">{heading}</h3>
    <p className="text-caption text-ink-muted">Resume an exact team review or inspect a recorded outcome, including when publishing is paused.</p>
    {saved.isPending && <p role="status" className="text-ui text-ink-muted">Loading saved requests…</p>}
    {saved.isError && <p role="alert" className="text-ui text-danger-ink">Saved requests could not be loaded. Reconnect if needed, then reload.</p>}
    {saved.data && !saved.data.pages.some((page) => page.workflows.length) && <p className="text-ui text-ink-muted">{operation === "start" ? "No current saved start requests." : "No current saved PIN completions."}</p>}
    <ul className="flex list-none flex-col gap-2">{saved.data?.pages.flatMap((page) => page.workflows).map((item) => <SavedWorkflowRow key={item.reviewId} item={item} busy={busy} reportedExpired={expiredReviewIds.includes(item.reviewId)} lostSend={lostSendReviewIds.includes(item.reviewId)} invalidated={invalidReviewIds.includes(item.reviewId)} onSelect={onSelect} />)}</ul>
    <div className="flex flex-wrap gap-2"><Button variant="ghost" disabled={busy || saved.isFetching} onClick={() => void saved.refetch()}>{operation === "start" ? "Reload saved start requests" : "Reload saved PIN completions"}</Button>{saved.hasNextPage && <Button variant="secondary" disabled={busy || saved.isFetching} onClick={() => void saved.fetchNextPage()}>{operation === "start" ? "Load more saved start requests" : "Load more saved PIN completions"}</Button>}</div>
  </section>
}

const pausedStages = { reconnect_required: "Reconnect Google to continue", publish_not_allowed: "Sending not allowed" } as const

/** The row's stage, from the same state its detail card uses; never "Approved review" for an unusable approval. */
export function savedWorkflowStage(item: VerificationWorkflowItem, { expired, lostSend, invalidated }: { readonly expired: boolean; readonly lostSend: boolean; readonly invalidated: boolean }): string {
  if (item.attempt) return item.attempt.executionState === "unknown" ? "Send outcome unknown" : item.attempt.executionState === "pending" ? "Request in progress" : "Recorded outcome"
  if (lostSend) return "Send outcome unknown"
  if (expired) return item.approvedBy ? "Approval expired" : "Review expired"
  if (invalidated || (item.reviewReason && item.reviewReason !== "reconnect_required" && item.reviewReason !== "publish_not_allowed")) return item.approvedBy ? "Approval no longer valid" : "Review no longer valid"
  if (item.reviewReason) return pausedStages[item.reviewReason]
  return item.approvedBy ? "Approved review" : "Awaiting approval"
}

function SavedWorkflowRow({ item, busy, reportedExpired, lostSend, invalidated, onSelect }: {
  readonly item: VerificationWorkflowItem; readonly busy: boolean; readonly reportedExpired: boolean; readonly lostSend: boolean; readonly invalidated: boolean
  readonly onSelect: (item: VerificationWorkflowItem) => void
}) {
  const expired = useVerificationExpiry(item.expiresAt) || reportedExpired || item.reviewReason === "expired"
  const stage = savedWorkflowStage(item, { expired, lostSend, invalidated })
  return <li className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-(--np-radius-card) border border-line bg-surface p-3">
    <div className="min-w-0"><p className="text-ui font-semibold">{verificationMethodName(item.method)} · {stage}</p><p className="font-mono text-caption text-ink-muted">{new Date(item.createdAt).toLocaleString("en-GB")}</p></div>
    <Button variant="outline" disabled={busy} onClick={() => onSelect(item)}>{item.attempt ? "Open saved outcome" : "Open saved review"}</Button>
  </li>
}

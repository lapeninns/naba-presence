"use client"

import { Button } from "@/components/ui/button"
import type { GbpChangeSet } from "@/lib/contracts/gbp-change-set"
import { LodgingApprovalSheet } from "./lodging-approval-sheet"
import { useLodgingReview } from "./use-lodging-review"
import { useLodgingWorkspace } from "./lodging-workspace"

export function LodgingReview({ locationId, payload, updateMask, googleHash, saved, disabled, previewDisabled = false, onLock }: {
  readonly locationId: string; readonly payload: Record<string, unknown>; readonly updateMask: string[]
  readonly googleHash?: string; readonly saved: GbpChangeSet[]; readonly disabled: boolean
  readonly onLock?: (locked: boolean) => void
  readonly previewDisabled?: boolean
}) {
  const fallback = useLodgingReview(locationId, onLock), workspace = useLodgingWorkspace()
  const workflow = workspace ?? fallback
  const pendingReviews = workflow.review && !saved.some((change) => change.id === workflow.review?.id) ? [workflow.review, ...saved] : saved
  return <div className="flex min-w-0 flex-col gap-3">
    <Button onClick={() => workflow.preview(payload, updateMask, googleHash ?? "")} disabled={disabled || previewDisabled || !googleHash || updateMask.length === 0 || workflow.busy || workflow.unresolved}>
      {workflow.busy ? "Preparing request…" : "Review lodging changes"}
    </Button>
    {pendingReviews.map((change) => <Button key={change.id} variant="outline" onClick={() => workflow.restore(change)} disabled={workflow.busy || workflow.unresolved && workflow.review?.id !== change.id}>
      {workflow.outcome && workflow.review?.id === change.id ? "Open saved lodging outcome" : change.approvedBy ? "Review approved lodging change" : "Review saved lodging change"}
    </Button>)}
    {workflow.error && !workflow.open ? <p role="alert" className="text-ui text-danger-ink">{workflow.error}</p> : null}
    {workspace ? null : <LodgingApprovalSheet workflow={workflow} disabled={disabled} />}
  </div>
}

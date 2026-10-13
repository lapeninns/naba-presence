"use client"

import { instantCell } from "@/components/editors/change-diff"
import { lodgingReviewRows } from "@/lib/locations/forms/lodging-review"
import { ReviewedChangeSheet } from "./reviewed-change-sheet"
import type { useLodgingReview } from "./use-lodging-review"

/** The saved lodging review: approve, consent, send and read its outcome. */
export function LodgingApprovalSheet({ workflow, disabled }: {
  readonly workflow: ReturnType<typeof useLodgingReview>; readonly disabled: boolean
}) {
  const review = workflow.review
  return <ReviewedChangeSheet
    workflow={workflow}
    noun="lodging"
    reviewTitle="Review changes"
    rows={review ? lodgingReviewRows(review).map((row) => ({ ...row, before: instantCell(row.before), after: instantCell(row.after) })) : []}
    disabled={disabled}
  />
}

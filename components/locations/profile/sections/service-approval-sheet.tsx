"use client"

import { ReviewedChangeSheet } from "./reviewed-change-sheet"
import type { useServiceReview } from "./use-service-review"

/** The saved service review: approve, consent, send and read its outcome. */
export function ServiceApprovalSheet({ workflow, rows, disabled }: {
  readonly workflow: ReturnType<typeof useServiceReview>
  readonly rows: { field: string; before: string; after: string }[]
  readonly disabled: boolean
}) {
  return <ReviewedChangeSheet
    workflow={workflow}
    noun="service"
    rows={rows}
    disabled={disabled}
    // A change in whether sending is allowed clears the consent, as before.
    resetKey={String(disabled)}
  />
}

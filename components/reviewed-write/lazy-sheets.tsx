"use client"

import dynamic from "next/dynamic"
import * as React from "react"

import {
  LazyDialogBoundary,
  whileLoading,
} from "@/components/inbox/lazy-dialog-boundary"
import type { ReviewChangesSheet as ReviewChangesSheetType } from "@/components/editors/review-changes-sheet"
import type { ServiceApprovalSheet as ServiceApprovalSheetType } from "@/components/locations/profile/sections/service-approval-sheet"
import type { CombinedReviewSheet as CombinedReviewSheetType } from "@/components/reviewed-write/combined-review"

/**
 * A review sheet whose code loads the first time it opens.
 *
 * The profile page draws its review sheets closed, and a closed sheet shows
 * nothing, yet a statically imported one put its diff, consent and outcome
 * code in the page's first load. Until the sheet is first opened nothing is
 * rendered (so the server names no chunk for it); from then on it stays
 * mounted, so it closes with its own animation and returns focus as before.
 * If its code cannot be fetched the sheet is closed, a toast says so, and a
 * fresh lazy component is ready for the next open (React caches a failure).
 */
function lazySheet<P extends object>(
  load: () => Promise<React.ComponentType<P>>,
  isOpen: (props: P) => boolean,
  close: (props: P) => void,
  what: string
) {
  const create = () => dynamic<P>(load, { loading: whileLoading(null) })
  const lazy = { Sheet: create() }
  function LazySheet(props: P) {
    const open = isOpen(props)
    const [armed, setArmed] = React.useState(open)
    if (open && !armed) setArmed(true)
    if (!armed) return null
    return (
      <LazyDialogBoundary
        what={what}
        onFail={() => {
          lazy.Sheet = create()
          setArmed(false)
          close(props)
        }}
      >
        <lazy.Sheet {...props} />
      </LazyDialogBoundary>
    )
  }
  return LazySheet
}

type WithOpen = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const CombinedReviewSheet = lazySheet<
  React.ComponentProps<typeof CombinedReviewSheetType> & WithOpen
>(
  () =>
    import("@/components/reviewed-write/combined-review").then(
      (m) => m.CombinedReviewSheet
    ),
  (props) => props.open,
  (props) => props.onOpenChange(false),
  "the review"
)

const ReviewChangesSheet = lazySheet<
  React.ComponentProps<typeof ReviewChangesSheetType> & WithOpen
>(
  () =>
    import("@/components/editors/review-changes-sheet").then(
      (m) => m.ReviewChangesSheet
    ),
  (props) => props.open,
  (props) => props.onOpenChange(false),
  "the saved review"
)

const ServiceApprovalSheet = lazySheet<
  React.ComponentProps<typeof ServiceApprovalSheetType>
>(
  () =>
    import("@/components/locations/profile/sections/service-approval-sheet").then(
      (m) => m.ServiceApprovalSheet
    ),
  (props) => props.workflow.open,
  (props) => props.workflow.setOpen(false),
  "the service review"
)

export { CombinedReviewSheet, ReviewChangesSheet, ServiceApprovalSheet }

"use client"

import type { ComponentProps } from "react"

import { ActionBar } from "@/components/inbox/action-bar"
import { ReplyComposer } from "@/components/inbox/reply-composer"
import { ReviewDetail } from "@/components/inbox/review-detail"

type ReviewPaneProps = Omit<
  ComponentProps<typeof ReviewDetail>,
  "composer" | "actions"
> & {
  /** Whether the publish bar is drawn (not for a viewer, who has nothing to press). */
  withActions: boolean
}

/**
 * The open review with its reply workspace and publish bar: everything the
 * Inbox draws only once a review is selected. It is one module so that
 * `lazy-review-pane.tsx` can keep it out of the list's first load.
 */
function ReviewPane({ reviewId, withActions, ...props }: ReviewPaneProps) {
  return (
    <ReviewDetail
      {...props}
      reviewId={reviewId}
      composer={<ReplyComposer reviewId={reviewId} />}
      actions={withActions ? <ActionBar reviewId={reviewId} /> : undefined}
    />
  )
}

export { ReviewPane, type ReviewPaneProps }

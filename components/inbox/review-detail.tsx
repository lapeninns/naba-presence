"use client"

import type { ReactNode } from "react"
import { CornerDownRightIcon, QuoteIcon } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { ActivityTimeline } from "@/components/inbox/activity-timeline"
import { StarRating } from "@/components/inbox/star-rating"
import { formatDateTime } from "@/lib/format"
import type { ReviewDetail as ReviewDetailData } from "@/lib/api/reviews"
import { useReviewDetail } from "@/lib/queries/use-review-detail"

function initials(name: string | null): string {
  if (!name) return "?"
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2)
  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("") || "?"
}

type StatusBadgeSpec = {
  label: string
  variant: "secondary" | "info" | "warning" | "success" | "destructive"
}

// The workflow state is the one fact the old layout never surfaced (it was
// sr-only inside the verification panel). The pinned header is where an
// operator glances to answer "who is this and where is it up to?".
const STATUS_BADGE: Record<string, StatusBadgeSpec> = {
  new: { label: "New", variant: "secondary" },
  drafted: { label: "Drafted", variant: "secondary" },
  verified: { label: "Verified", variant: "info" },
  publish_requested: { label: "Publishing", variant: "info" },
  awaiting_approval: { label: "Awaiting approval", variant: "warning" },
  escalated: { label: "Escalated", variant: "warning" },
  published: { label: "Published", variant: "success" },
  rejected: { label: "Rejected", variant: "destructive" },
  failed: { label: "Failed", variant: "destructive" },
}

function statusBadge(status: string): StatusBadgeSpec {
  const known = STATUS_BADGE[status]
  if (known) return known
  const label = status.replace(/_/g, " ")
  return { label: label.charAt(0).toUpperCase() + label.slice(1), variant: "secondary" }
}

function PaneHeader({ leading, children }: { leading?: ReactNode; children?: ReactNode }) {
  return (
    <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border/60 px-4 py-3">
      {leading}
      {children}
    </header>
  )
}

function ReviewerIdentity({ review }: { review: ReviewDetailData["review"] }) {
  const displayName = review.reviewerIsAnonymous
    ? "Anonymous"
    : (review.reviewerDisplayName ?? "Anonymous")
  const badge = statusBadge(review.workflowStatus)
  return (
    <>
      <Avatar className="size-10 text-ui">
        <AvatarFallback>{initials(displayName)}</AvatarFallback>
      </Avatar>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <h2 className="truncate text-title font-semibold">{displayName}</h2>
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-caption text-muted-foreground">
          <StarRating rating={review.rating} size="md" />
          <span aria-hidden className="text-muted-foreground/60">·</span>
          <span>{review.locationName}</span>
          <span aria-hidden className="text-muted-foreground/60">·</span>
          <span>{formatDateTime(review.createTime, review.timezone)}</span>
        </div>
      </div>
      <Badge variant={badge.variant} className="ml-auto shrink-0">
        {badge.label}
      </Badge>
    </>
  )
}

function ReviewDetail({
  reviewId,
  leading,
  composer,
  actions,
}: {
  reviewId: string
  /** Slot at the head of the pinned header (the mobile return-to-list control). */
  leading?: ReactNode
  /** Reply workspace, rendered at the end of the scroll region. */
  composer?: ReactNode
  /** Lifecycle actions, pinned below the scroll region so the CTA never scrolls away. */
  actions?: ReactNode
}) {
  const query = useReviewDetail(reviewId)

  if (query.isPending) {
    return (
      <div aria-busy="true" className="flex min-h-0 flex-1 flex-col">
        <PaneHeader leading={leading}>
          <Skeleton className="size-10 rounded-full" />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Skeleton className="h-4 w-36 rounded-(--nr-radius-tag)" />
            <Skeleton className="h-3 w-52 rounded-(--nr-radius-tag)" />
          </div>
        </PaneHeader>
        <div className="flex flex-col gap-4 p-6">
          <Skeleton className="h-24 w-full rounded-(--nr-radius-card)" />
          <Skeleton className="h-40 w-full rounded-(--nr-radius-card)" />
        </div>
      </div>
    )
  }
  if (query.isError || !query.data) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <PaneHeader leading={leading} />
        <div className="p-6">
          <Alert variant="destructive">
            <AlertTitle>We could not load this review.</AlertTitle>
            <AlertDescription className="flex flex-col items-start gap-2">
              <span>Check your connection, then try again.</span>
              <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
                Try again
              </Button>
            </AlertDescription>
          </Alert>
        </div>
      </div>
    )
  }

  const review = query.data.review

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PaneHeader leading={leading}>
        <ReviewerIdentity review={review} />
      </PaneHeader>

      {/* One scroll region, ordered to mirror the task: read the conversation,
          write the reply, with the audit trail last as reference. */}
      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-6">
        <div className="flex flex-col gap-4">
          <blockquote
            lang={review.detectedLanguageCode ?? undefined}
            dir="auto"
            className="relative rounded-(--nr-radius-card) bg-muted px-4 py-3.5 text-body"
          >
            <QuoteIcon
              aria-hidden
              className="absolute top-3 right-3 size-4 text-muted-foreground/30"
            />
            {review.text ?? "This review has no written text."}
          </blockquote>

          {review.media.length > 0 ? (
            <ul className="flex flex-wrap gap-2">
              {review.media.map((item) => (
                <li key={item.id}>
                  {item.thumbnailUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={item.thumbnailUrl}
                      alt={item.thumbnailLabel ?? "Review photo"}
                      className="size-20 rounded-(--nr-radius-control) border border-border/60 object-cover"
                    />
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}

          {review.reply?.body ? (
            <div className="flex gap-3 rounded-(--nr-radius-card) border border-border bg-card p-4">
              <CornerDownRightIcon
                aria-hidden
                className="mt-0.5 size-4 shrink-0 text-muted-foreground"
              />
              <div className="flex min-w-0 flex-col gap-1">
                <p className="text-caption font-medium text-muted-foreground">
                  Your published reply
                </p>
                <p dir="auto" className="text-body">
                  {review.reply.body}
                </p>
              </div>
            </div>
          ) : null}
        </div>

        {composer ? (
          <div className="rounded-(--nr-radius-card) border border-border/60 bg-muted/30 p-4">
            {composer}
          </div>
        ) : null}

        {/* The audit trail is reference info, not a step in the reply task —
            it goes last, collapsed, so the conversation → composer → action
            footer path runs uninterrupted. The heading doubles as the
            toggle. */}
        <ActivityTimeline
          timeline={review.timeline}
          timezone={review.timezone}
          collapsible
        />
      </div>

      {actions ? (
        <footer className="shrink-0 border-t border-border/60 px-4 py-3">
          {actions}
        </footer>
      ) : null}
    </div>
  )
}

export { ReviewDetail }

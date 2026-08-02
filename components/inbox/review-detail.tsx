"use client"

import type { ReactNode } from "react"
import { CornerDownRightIcon, QuoteIcon } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { ActivityTimeline } from "@/components/inbox/activity-timeline"
import { StarRating } from "@/components/inbox/star-rating"
import { formatDateTime } from "@/lib/format"
import { useReviewDetail } from "@/lib/queries/use-review-detail"

function initials(name: string | null): string {
  if (!name) return "?"
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2)
  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("") || "?"
}

function ReviewDetail({
  reviewId,
  footer,
}: {
  reviewId: string
  footer?: ReactNode
}) {
  const query = useReviewDetail(reviewId)

  if (query.isPending) {
    return (
      <div aria-busy="true" className="flex flex-col gap-4 p-6">
        <div className="flex items-center gap-3">
          <Skeleton className="size-10 rounded-full" />
          <div className="flex flex-col gap-2">
            <Skeleton className="h-4 w-36 rounded-(--nr-radius-tag)" />
            <Skeleton className="h-3 w-52 rounded-(--nr-radius-tag)" />
          </div>
        </div>
        <Skeleton className="h-24 w-full rounded-(--nr-radius-card)" />
        <Skeleton className="h-40 w-full rounded-(--nr-radius-card)" />
      </div>
    )
  }
  if (query.isError || !query.data) {
    return (
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
    )
  }

  const review = query.data.review
  const displayName = review.reviewerIsAnonymous
    ? "Anonymous"
    : (review.reviewerDisplayName ?? "Anonymous")

  return (
    <div className="flex min-h-0 flex-col overflow-y-auto">
      <div className="flex flex-col gap-4 p-6">
        {/* Reviewer header: avatar carries identity, star rating carries
            sentiment, and the meta line anchors place + time — the three
            things an operator scans before reading the body. */}
        <header className="flex items-start gap-3">
          <Avatar className="size-10 text-ui">
            <AvatarFallback>{initials(displayName)}</AvatarFallback>
          </Avatar>
          <div className="flex min-w-0 flex-col gap-1">
            <h2 className="text-title font-semibold">{displayName}</h2>
            <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-caption text-muted-foreground">
              <StarRating rating={review.rating} size="md" />
              <span aria-hidden className="text-muted-foreground/60">·</span>
              <span>{review.locationName}</span>
              <span aria-hidden className="text-muted-foreground/60">·</span>
              <span>{formatDateTime(review.createTime, review.timezone)}</span>
            </div>
          </div>
        </header>

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

        <ActivityTimeline timeline={review.timeline} timezone={review.timezone} />
      </div>

      {footer ? (
        <div className="mt-auto border-t border-border/60 bg-muted/30 p-6">
          {footer}
        </div>
      ) : null}
    </div>
  )
}

export { ReviewDetail }

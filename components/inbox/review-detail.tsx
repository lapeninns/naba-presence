"use client"

import type { ReactNode } from "react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { ActivityTimeline } from "@/components/inbox/activity-timeline"
import { formatDateTime } from "@/lib/format"
import { useReviewDetail } from "@/lib/queries/use-review-detail"

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
        <Skeleton className="h-6 w-40 rounded-(--nr-radius-control)" />
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

  return (
    <div className="flex min-h-0 flex-col overflow-y-auto">
      <div className="flex flex-col gap-4 p-6">
        <header className="flex flex-col gap-1">
          <h2 className="text-title font-semibold">
            {review.reviewerIsAnonymous
              ? "Anonymous"
              : (review.reviewerDisplayName ?? "Anonymous")}
          </h2>
          <p className="text-caption text-muted-foreground">
            <span aria-label={review.rating === null ? "No rating" : `${review.rating} stars`}>
              {review.rating === null ? "—" : "★".repeat(review.rating)}
            </span>{" "}
            · <span>{review.locationName}</span> ·{" "}
            {formatDateTime(review.createTime, review.timezone)}
          </p>
        </header>

        <blockquote
          lang={review.detectedLanguageCode ?? undefined}
          dir="auto"
          className="rounded-(--nr-radius-card) bg-muted p-4 text-body"
        >
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
                    className="size-20 rounded-(--nr-radius-control) object-cover"
                  />
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}

        {review.reply?.body ? (
          <div className="rounded-(--nr-radius-card) border border-border bg-card p-4">
            <p className="mb-1 text-caption font-medium text-muted-foreground">
              Your published reply
            </p>
            <p dir="auto" className="text-body">
              {review.reply.body}
            </p>
          </div>
        ) : null}

        <ActivityTimeline timeline={review.timeline} timezone={review.timezone} />
      </div>

      {footer ? (
        <div className="mt-auto border-t border-border/60 p-6">{footer}</div>
      ) : null}
    </div>
  )
}

export { ReviewDetail }

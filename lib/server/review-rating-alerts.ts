import "server-only"

import type { TransactionSql } from "postgres"

import { log } from "@/lib/server/logger"
import { queueDeliveries } from "@/lib/server/notifications/evaluate"

/**
 * The low-rating alert for a review edited down (S3). The health tick's scan
 * (lib/server/notifications/evaluate.ts) announces reviews both written and
 * first stored in the last 48 hours, so a review edited from 4 or 5 stars to
 * 3 or fewer days later was never announced. Sync and Pub/Sub both store
 * reviews through upsertGoogleReview (lib/server/reviews.ts), which calls
 * this when it rewrites a stored review.
 *
 * The rule is adapted from context/opengmb/reviews/negative-alert.ts
 * (isNegativeChange): the new rating is 3 or fewer and the stored one was
 * above 3 or unrated. Adapted from OpenGMB (MIT, © 2026 Synectus Private
 * Limited)
 *
 * The incident is the same `low_rating_review` kind, recorded once per
 * review (0050 notification_incident_review_once_idx), so a review already
 * announced when it was new is not announced again.
 */

export const LOW_RATING_MAX_STARS = 3

/**
 * An edit Google made longer ago than this is history (a listing that was
 * out of sync for a while catching up), not news.
 */
export const RATING_DROP_MAX_AGE_DAYS = 7

const DAY_MS = 86_400_000

export function isRatingDrop(
  previous: number | null,
  next: number | null
): boolean {
  if (next === null || next > LOW_RATING_MAX_STARS) return false
  return previous === null || previous > LOW_RATING_MAX_STARS
}

/**
 * Records and queues the alert when a stored review's rating dropped to 3
 * stars or fewer. Runs in the sync's tenant transaction, inside a savepoint:
 * a failure here is logged and never fails the review write. Returns the
 * deliveries queued.
 */
export async function alertOnLoweredRating(
  sql: TransactionSql,
  input: {
    organisationId: string
    reviewId: string
    previousRating: number | null
    rating: number | null
    /** Google's updateTime for the edit. */
    updateTime: string
    now?: Date
  }
): Promise<number> {
  if (!isRatingDrop(input.previousRating, input.rating)) return 0
  const edited = Date.parse(input.updateTime)
  const now = (input.now ?? new Date()).getTime()
  if (
    !Number.isFinite(edited) ||
    edited < now - RATING_DROP_MAX_AGE_DAYS * DAY_MS
  ) {
    return 0
  }
  try {
    return await sql.savepoint(async (sp) => {
      const opened = await sp<{ id: string }[]>`
        insert into notification_incident (
          organisation_id, kind, subject_type, subject_id, status, resolved_at,
          summary, location_id
        )
        select
          r.organisation_id,
          'low_rating_review',
          'review',
          r.id::text,
          'resolved',
          now(),
          jsonb_build_object(
            'rating', r.star_rating,
            'title', e.title,
            'edited', true,
            'previousRating', ${input.previousRating}::smallint
          ),
          ll.location_id
        from review r
        join external_location e on e.id = r.external_location_id
        join location_link ll on ll.external_location_id = e.id and ll.is_active
        where r.id = ${input.reviewId}
          and r.star_rating <= ${LOW_RATING_MAX_STARS}
          and r.provider_deleted_at is null
        on conflict (organisation_id, subject_id) where kind = 'low_rating_review'
        do nothing
        returning id::text as id
      `
      return queueDeliveries(
        sp,
        input.organisationId,
        opened.map((row) => row.id)
      )
    })
  } catch (error) {
    log.error("notifications.lowered_rating_failed", {
      organisationId: input.organisationId,
      reviewId: input.reviewId,
      error: error instanceof Error ? error.message : String(error),
    })
    return 0
  }
}

import "server-only"

import type { TransactionSql } from "postgres"

import {
  newestReviewTarget,
  type ReviewTargetObservation,
} from "@/lib/domain/review-link"

/**
 * Google's review form as the stored reads hold it: shared by the review
 * link area (lib/server/review-links.ts) and the listing summary
 * (lib/server/location-summary.ts), so both read the same columns and pick
 * by the same rule (`newestReviewTarget`).
 */

/** The stored reads that can carry `metadata.newReviewUri`, in tie order. */
export const REVIEW_TARGET_RESOURCES = [
  "profile",
  "businessInformation",
] as const

/**
 * A `presence_resource_reconcile_state` row's review form and its times,
 * selected as `<prefix>Target`, `<prefix>PayloadObservedAt` and
 * `<prefix>ObservedAt`; `alias` names the row in the query.
 */
export function reviewTargetObservationColumns(
  sql: TransactionSql,
  alias: string,
  prefix: string
) {
  return sql`
    ${sql(alias)}.observed_google_payload -> 'location' -> 'metadata' ->> 'newReviewUri'
      as ${sql(`${prefix}Target`)},
    ${sql(alias)}.observed_google_payload ->> 'observedAt'
      as ${sql(`${prefix}PayloadObservedAt`)},
    ${sql(alias)}.observed_at as ${sql(`${prefix}ObservedAt`)}
  `
}

/**
 * Google's review form from the listing's stored reads, or null: the newest
 * read that carries a Google review address (`newestReviewTarget`).
 */
export async function storedGoogleReviewTarget(
  sql: TransactionSql,
  organisationId: string,
  locationId: string
): Promise<string | null> {
  const rows = await sql<
    {
      resource: string
      rowTarget: string | null
      rowPayloadObservedAt: string | null
      rowObservedAt: Date | null
    }[]
  >`
    select s.resource, ${reviewTargetObservationColumns(sql, "s", "row")}
    from presence_resource_reconcile_state s
    where s.organisation_id = ${organisationId}
      and s.location_id = ${locationId}
      and s.resource = any(${[...REVIEW_TARGET_RESOURCES]}::text[])
  `
  const byResource = new Map(rows.map((row) => [row.resource, row]))
  return newestReviewTarget(
    REVIEW_TARGET_RESOURCES.map((resource): ReviewTargetObservation | null => {
      const row = byResource.get(resource)
      return row
        ? {
            target: row.rowTarget,
            payloadObservedAt: row.rowPayloadObservedAt,
            observedAt: row.rowObservedAt,
          }
        : null
    })
  )
}

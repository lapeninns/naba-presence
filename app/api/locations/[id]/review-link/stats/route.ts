import { NextResponse } from "next/server"

import { parseReviewLinkPeriod } from "@/lib/domain/review-link"
import {
  reviewLinkParamsSchema,
  reviewLinkStatsQuerySchema,
  type ReviewLinkStatsResponse,
} from "@/lib/domain/review-link-contract"
import { requireLocationAccess } from "@/lib/server/permissions"
import {
  readReviewLinkStats,
  REVIEW_LINK_LOCATION_NOT_FOUND,
} from "@/lib/server/review-links"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"

/**
 * Review link clicks beside new reviews, per day at the venue, over the
 * last 30 (default) or 90 days. DB-only.
 */
export const GET = route({
  params: reviewLinkParamsSchema,
  query: reviewLinkStatsQuerySchema,
  handler: async ({ session, params, query, tenant }) => {
    const stats = await tenant(async (sql) => {
      await requireLocationAccess(
        sql,
        session,
        params.id,
        REVIEW_LINK_LOCATION_NOT_FOUND
      )
      return readReviewLinkStats(
        sql,
        params.id,
        parseReviewLinkPeriod(query.days)
      )
    })
    return NextResponse.json({ stats } satisfies ReviewLinkStatsResponse, {
      headers: { "Cache-Control": "no-store" },
    })
  },
})

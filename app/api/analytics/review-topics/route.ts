import { reviewTopicReportQuerySchema } from "@/lib/domain/review-topics-report"
import { ApiError } from "@/lib/server/http"
import { isOrgFeatureEnabled } from "@/lib/server/org-features"
import { loadReviewTopicReport } from "@/lib/server/review-topics"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"

// S3: the Reports "What guests talk about" panel. Database only; the SQL
// lives in lib/server/review-topics.ts. Not served while the organisation's
// review_topics feature is off.
export const GET = route({
  query: (searchParams) =>
    reviewTopicReportQuerySchema.parse({
      clientId: searchParams.get("client_id") ?? undefined,
      locationId: searchParams.get("location_id") ?? undefined,
    }),
  handler: ({ session, query, tenant }) =>
    tenant(async (sql) => {
      if (
        !(await isOrgFeatureEnabled(
          sql,
          session.organisationId,
          "review_topics"
        ))
      ) {
        throw new ApiError(404, "not_found", "Not found.")
      }
      return loadReviewTopicReport(sql, session, query)
    }),
})

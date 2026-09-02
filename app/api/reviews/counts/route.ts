import {
  REVIEW_WORKFLOW_STATES,
  reviewCountsQuerySchema,
  type ReviewCounts,
  type ReviewWorkflowState,
} from "@/lib/contracts/reviews"
import {
  requireLocationAccess,
  visibilityPredicate,
} from "@/lib/server/permissions"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"

export const GET = route({
  query: reviewCountsQuerySchema,
  handler: async ({ session, query, tenant }) => {
    const rows = await tenant(async (sql) => {
      if (query.locationId) {
        await requireLocationAccess(sql, session, query.locationId)
      }
      return sql<{ workflowStatus: ReviewWorkflowState; count: number }[]>`
        select
          r.workflow_status as "workflowStatus",
          count(*)::integer as count
        from review r
        where r.provider_deleted_at is null
          ${
            query.locationId
              ? sql`and r.location_id = ${query.locationId}`
              : sql``
          }
          and ${visibilityPredicate(sql, session, sql`r.location_id`)}
        group by r.workflow_status
      `
    })
    const byStatus = Object.fromEntries(
      REVIEW_WORKFLOW_STATES.map((status) => [status, 0])
    ) as Record<ReviewWorkflowState, number>
    for (const row of rows) byStatus[row.workflowStatus] = row.count
    return {
      total: rows.reduce((total, row) => total + row.count, 0),
      byStatus,
    } satisfies ReviewCounts
  },
})

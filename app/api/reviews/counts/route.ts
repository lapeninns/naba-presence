import { NextResponse } from "next/server"
import { z } from "zod"

import {
  REVIEW_WORKFLOW_STATES,
  type ReviewWorkflowState,
} from "@/lib/domain/workflow"
import { withTenant } from "@/lib/server/db"
import { apiError } from "@/lib/server/http"
import { requireLocationAccess } from "@/lib/server/permissions"
import { requireSession } from "@/lib/server/session"

export const runtime = "nodejs"

const querySchema = z.object({
  locationId: z.uuid().optional(),
})

export async function GET(request: Request) {
  try {
    const session = await requireSession()
    const params = new URL(request.url).searchParams
    const query = querySchema.parse({
      locationId: params.get("locationId") ?? undefined,
    })
    const rows = await withTenant(session.organisationId, async (sql) => {
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
          ${
            session.role === "owner" || session.role === "admin"
              ? sql``
              : sql`and (
                  not exists (
                    select 1
                    from location_member lm
                    where lm.user_id = ${session.userId}
                  )
                  or exists (
                    select 1
                    from location_member lm
                    where lm.user_id = ${session.userId}
                      and lm.location_id = r.location_id
                  )
                )`
          }
        group by r.workflow_status
      `
    })
    const byStatus = Object.fromEntries(
      REVIEW_WORKFLOW_STATES.map((status) => [status, 0])
    ) as Record<ReviewWorkflowState, number>
    for (const row of rows) byStatus[row.workflowStatus] = row.count
    return NextResponse.json({
      total: rows.reduce((total, row) => total + row.count, 0),
      byStatus,
    })
  } catch (error) {
    return apiError(error)
  }
}

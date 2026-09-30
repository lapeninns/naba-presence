import "server-only"
import type { z } from "zod"
import { administrationWorkflowCursorSchema, administrationWorkflowsResponseSchema, administrationWorkflowsQuerySchema } from "@/lib/contracts/google-administration-workflows"
import { reviewedAdministrationPayloadSchema } from "@/lib/contracts/google-administration-review"
import { withTenant } from "@/lib/server/db"
import { currentAdministrationContext } from "@/lib/server/google-administration-state"
import type { Session } from "@/lib/server/session"
import { ApiError } from "@/lib/server/http"

function decodeCursor(value: string | undefined) {
  if (!value) return undefined
  try { return administrationWorkflowCursorSchema.parse(JSON.parse(Buffer.from(value, "base64url").toString("utf8"))) }
  catch { throw new ApiError(400, "invalid_request", "Invalid saved-work cursor.") }
}

export async function listAdministrationWorkflows(session: Session, locationId: string, query: z.infer<typeof administrationWorkflowsQuerySchema>) {
  await currentAdministrationContext(session, locationId, false)
  const cursor = decodeCursor(query.cursor)
  const rows = await withTenant(session.organisationId, (sql) => sql<{ reviewId: string; createdAt: string; payload: unknown; attemptId: string | null; executionState: string | null; confirmationState: string | null }[]>`
    select c.id as "reviewId", to_char(c.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "createdAt", c.payload,
      m.id as "attemptId", m.execution_state as "executionState", m.confirmation_state as "confirmationState"
    from gbp_change_set c left join gbp_management_mutation m on m.change_set_id = c.id
    where c.location_id = ${locationId} and c.resource_type = 'administration_access'
      and (c.approval_expires_at > now() or m.id is not null)
      and (${!cursor} or (c.created_at, c.id) < (${cursor?.createdAt ?? "9999-01-01T00:00:00.000Z"}::text::timestamptz, ${cursor?.id ?? "ffffffff-ffff-ffff-ffff-ffffffffffff"}::uuid))
    order by c.created_at desc, c.id desc limit ${query.limit + 1}
  `)
  const visible = rows.slice(0, query.limit), last = visible.at(-1)
  return administrationWorkflowsResponseSchema.parse({ items: visible.map((row) => ({ ...row, request: reviewedAdministrationPayloadSchema.parse(row.payload).request })),
    nextCursor: rows.length > query.limit && last ? Buffer.from(JSON.stringify({ createdAt: last.createdAt, id: last.reviewId })).toString("base64url") : null })
}

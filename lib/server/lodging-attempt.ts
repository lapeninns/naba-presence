import "server-only"
import { lodgingAttemptSchema, type LodgingAttempt } from "@/lib/contracts/lodging-attempt"
import { withTenant } from "@/lib/server/db"
import { ApiError } from "@/lib/server/http"
import { requireLocationAccess } from "@/lib/server/permissions"
import type { Session } from "@/lib/server/session"

export async function readLodgingAttempt(session: Session, locationId: string, reviewId: string) {
  return withTenant(session.organisationId, async (sql) => {
    await requireLocationAccess(sql, session, locationId)
    const [row] = await sql<(Omit<LodgingAttempt, "createdAt" | "observedAt"> & { createdAt: Date; observedAt: Date | null })[]>`
      select m.id, m.status, true as idempotent, c.id as "reviewId",
        m.target_resource_name as "targetResourceName", m.execution_state as "executionState",
        m.confirmation_state as "confirmationState", m.created_at as "createdAt",
        m.confirmation_observed_at as "observedAt", m.confirmation_error_code as "errorCode"
      from gbp_management_mutation m join gbp_change_set c on c.id = m.change_set_id
      where m.location_id = ${locationId} and c.location_id = ${locationId}
        and c.id = ${reviewId} and c.resource_type = 'lodging' and m.resource_type = 'lodging'
    `
    if (!row) throw new ApiError(404, "lodging_attempt_not_found", "No lodging request is recorded for this review.")
    return lodgingAttemptSchema.parse({ ...row, createdAt: new Date(row.createdAt).toISOString(), observedAt: row.observedAt ? new Date(row.observedAt).toISOString() : null })
  })
}

import "server-only"
import { serviceAttemptSchema, type ServiceAttempt } from "@/lib/contracts/service-attempt"
import { withTenant } from "./db"
import { ApiError } from "./http"
import { requireLocationAccess } from "./permissions"
import { requireRole, type Session } from "./session"

export async function readServiceAttempt(session: Session, locationId: string, reviewId: string) {
  requireRole(session, ["owner", "admin"])
  return withTenant(session.organisationId, async (sql) => {
    await requireLocationAccess(sql, session, locationId)
    const [row] = await sql<(Omit<ServiceAttempt, "createdAt" | "observedAt"> & { createdAt: Date; observedAt: Date | null })[]>`
      select m.id, m.status, true as idempotent, c.id as "reviewId",
        m.target_resource_name as "targetResourceName", m.execution_state as "executionState",
        m.confirmation_state as "confirmationState", m.created_at as "createdAt",
        m.confirmation_observed_at as "observedAt", m.confirmation_error_code as "errorCode"
      from gbp_management_mutation m join gbp_change_set c on c.id = m.change_set_id
      where m.location_id = ${locationId} and c.location_id = ${locationId}
        and c.id = ${reviewId} and c.resource_type = 'business_info' and m.resource_type = 'business_info'
        and c.update_mask = array['serviceItems']::text[] and m.update_mask = c.update_mask
    `
    if (!row) throw new ApiError(404, "service_attempt_not_found", "No service request is recorded for this review.")
    return serviceAttemptSchema.parse({ ...row, createdAt: new Date(row.createdAt).toISOString(), observedAt: row.observedAt ? new Date(row.observedAt).toISOString() : null })
  })
}

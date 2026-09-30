import "server-only"
import { withSessionConnection, withTenant } from "@/lib/server/db"
import { resolveGbpLocationContext } from "@/lib/server/gbp-management"
import { ApiError } from "@/lib/server/http"
import type { Session } from "@/lib/server/session"

export async function withGoogleAccountChangeLock<T>(session: Session, locationId: string, work: () => Promise<T>) {
  const linked = await withTenant(session.organisationId, (sql) => resolveGbpLocationContext(sql, session, locationId))
  return withSessionConnection((connection) => connection.begin(async (sql) => {
    const [claim] = await sql<{ acquired: boolean }[]>`select pg_try_advisory_xact_lock(hashtextextended(${`${session.organisationId}:${linked.googleAccountId}:administration_access`}, 0)) as acquired`
    if (!claim?.acquired) throw new ApiError(409, "administration_in_progress", "Another Google account change is in progress. Read its saved outcome.")
    return work()
  }))
}
export async function requireNoUnresolvedPlaceAction(session: Session, googleAccountId: string) {
  return withTenant(session.organisationId, async (sql) => {
    const [row] = await sql`select id from place_action_mutation where google_account_id = ${googleAccountId}
      and (status in ('started', 'ambiguous') or confirmation_state in ('pending', 'unresolved')) limit 1`
    if (row) throw new ApiError(409, "google_confirmation_unresolved", "An action link change for this Google account awaits confirmation. Read its saved outcome before another write.")
  })
}

/** Access, lifecycle and action-link writes on one Google account wait for each other's unresolved outcomes. */
export async function requireNoUnresolvedAccountChange(session: Session, googleAccountId: string) {
  await requireNoUnresolvedPlaceAction(session, googleAccountId)
  await withTenant(session.organisationId, async (sql) => {
    const [row] = await sql`select id from gbp_management_mutation where google_account_id = ${googleAccountId}
      and resource_type in ('account_admin', 'location_admin', 'invitation', 'location_lifecycle')
      and (status in ('started', 'validated', 'ambiguous') or confirmation_state in ('pending', 'unresolved') or local_reconciliation_state in ('pending', 'conflict')) limit 1`
    if (row) throw new ApiError(409, "google_confirmation_unresolved", "An access or lifecycle change awaits confirmation. Read its saved outcome before changing action links.")
  })
}

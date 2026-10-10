import "server-only"
import type { GoogleLifecycleBaseline, GoogleLifecycleObservation } from "@/lib/contracts/google-lifecycle"
import type { z } from "zod"
import type { reviewedLifecyclePayloadSchema } from "@/lib/contracts/google-lifecycle-review"
import { withTenant } from "@/lib/server/db"
import type { Session } from "@/lib/server/session"

export async function reconcileLifecycleTransfer(session: Session, locationId: string,
  payload: z.infer<typeof reviewedLifecyclePayloadSchema>, baseline: GoogleLifecycleBaseline,
  observation: GoogleLifecycleObservation) {
  if (payload.request.operation !== "transfer_location") return "not_required"
  const destination = payload.request.payload.destinationAccount
  return withTenant(session.organisationId, async (sql) => {
    const [linked] = await sql<{ id: string; account: string }[]>`
      select e.id, e.google_account_name as account from location_link ll
      join external_location e on e.id = ll.external_location_id
      join google_connection c on c.id = e.google_connection_id
      where ll.location_id = ${locationId} and ll.is_active
        and e.google_connection_id = ${payload.connectionId}
        and e.google_location_name = ${baseline.location.name}
        and c.credential_generation = ${payload.credentialGeneration}
      for update of ll, e, c`
    if (!linked || ![baseline.source.account.name, destination].includes(linked.account)) return "conflict"
    const [account] = await sql<{ id: string }[]>`
      insert into google_account (organisation_id, google_connection_id, google_account_name, role, is_active)
      values (${session.organisationId}, ${payload.connectionId}, ${destination}, ${observation.destination?.account.role ?? null}, true)
      on conflict (organisation_id, google_account_name) do update
        set role = excluded.role, is_active = true, updated_at = now()
        where google_account.google_connection_id = excluded.google_connection_id
      returning id`
    if (!account) return "conflict"
    await sql`update external_location set google_account_name = ${destination}, updated_at = now() where id = ${linked.id}`
    return "applied"
  })
}

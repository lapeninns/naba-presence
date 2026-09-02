import "server-only"

import type { DirectoryRow } from "@/lib/contracts/location-links"
import { withTenant } from "@/lib/server/db"
import { visibilityPredicate } from "@/lib/server/permissions"
import type { Session } from "@/lib/server/session"

// The role-scoped location directory query, shared by GET /api/location-links
// and by the dashboard layout's RSC hydration. It lives here rather than
// inline in the route so the two paths cannot drift — the same reasoning as
// listConnections in lib/server/connections.ts.
//
// `session` is an explicit argument, deliberately: getSession() writes
// (it bumps app_session.last_seen_at on every call), so a helper that
// reached for it internally would turn each extra caller into an extra write.
export async function listLocationDirectoryRows(
  session: Session
): Promise<DirectoryRow[]> {
  return withTenant(
    session.organisationId,
    (sql) => sql<DirectoryRow[]>`
      select
        l.id::text as "locationId",
        l.name,
        l.address_json as address,
        l.timezone,
        ll.id::text as "linkId",
        e.id::text as "externalLocationId",
        e.google_location_name as "googleLocationName",
        e.title as "googleTitle",
        e.verified
      from location l
      left join location_link ll
        on ll.location_id = l.id
       and ll.is_active = true
      left join external_location e on e.id = ll.external_location_id
      where ${visibilityPredicate(sql, session, sql`l.id`)}
      -- Human-facing display order for the API response and the /locations
      -- table. Primary-location resolution deliberately does NOT depend on it:
      -- see comparePrimaryCandidates in lib/locations/primary-location.ts.
      order by lower(l.name)
    `
  )
}

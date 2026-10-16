import "server-only"

import type { TransactionSql } from "postgres"

import type { MemberClientTotal } from "@/lib/contracts/members"
import { loadClientCatalogue } from "@/lib/server/client-access"

/**
 * What `GET /api/members` answers: every membership in the tenant, owners
 * first, and each client with how many listings it holds (the Client access
 * column's denominator). Shared with the /team prefetch (lib/server/prefetch.ts)
 * so the hydrated list and a refetch are read the same way. Dates are still
 * `Date`s here; the response (or `throughWire`) makes them strings.
 */
export async function loadMembers(sql: TransactionSql) {
  const members = await sql`
    select
      u.id::text as "userId",
      u.email,
      u.display_name as "displayName",
      m.role,
      m.can_publish as "canPublish",
      m.location_scope as "locationScope",
      m.created_at as "createdAt",
      coalesce(
        json_agg(
          json_build_object(
            'locationId', lm.location_id::text,
            'canPublish', lm.can_publish,
            'clientId', l.client_id::text
          )
        ) filter (where lm.location_id is not null),
        '[]'::json
      ) as locations
    from member m
    join app_user u on u.id = m.user_id
    left join location_member lm
      on lm.organisation_id = m.organisation_id
     and lm.user_id = m.user_id
    left join location l on l.id = lm.location_id
    group by u.id, m.role, m.can_publish, m.location_scope, m.created_at
    order by
      case m.role
        when 'owner' then 1
        when 'admin' then 2
        when 'member' then 3
        else 4
      end,
      lower(u.display_name)
  `
  const clients: MemberClientTotal[] = (await loadClientCatalogue(sql)).map(
    ({ listingIds, ...client }) => ({
      ...client,
      archived: client.archived ?? false,
      total: listingIds.length,
    })
  )
  return { members, clients }
}

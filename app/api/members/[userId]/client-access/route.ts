import type { TransactionSql } from "postgres"

import {
  clientAccessParamsSchema,
  clientAccessUpdateSchema,
  type ClientAccessResponse,
} from "@/lib/contracts/client-access"
import type { LocationScope, MemberRole } from "@/lib/contracts/members"
import { writeAudit } from "@/lib/server/audit"
import { loadClientCatalogue, loadGrants } from "@/lib/server/client-access"
import { ApiError } from "@/lib/server/http"
import { route } from "@/lib/server/route"
import {
  planClientAccess,
  summariseClientAccess,
  type AccessGrant,
  type ClientCatalogueEntry,
} from "@/lib/settings/client-access"

export const runtime = "nodejs"

/**
 * Which clients one member or viewer can see, edited a client at a time.
 *
 * Stored as location_member rows plus the membership's location_scope
 * (lib/server/permissions.ts is the only reader). PUT replaces the member's
 * rows and sets the scope in one transaction, with exactly the listings of
 * the chosen clients; `listings: "unchanged"`
 * keeps older per-listing grants for a client as they are. Owners and admins
 * are refused: they see every client whatever rows they hold.
 */

async function loadMember(sql: TransactionSql, userId: string, lock: boolean) {
  const [member] = lock
    ? await sql<{ role: MemberRole; locationScope: LocationScope }[]>`
        select role, location_scope as "locationScope"
        from member where user_id = ${userId} limit 1 for update
      `
    : await sql<{ role: MemberRole; locationScope: LocationScope }[]>`
        select role, location_scope as "locationScope"
        from member where user_id = ${userId} limit 1
      `
  if (!member) {
    throw new ApiError(404, "member_not_found", "Member not found.")
  }
  return member
}

function respond(
  userId: string,
  role: MemberRole,
  locationScope: LocationScope,
  grants: AccessGrant[],
  catalogue: ClientCatalogueEntry[]
): ClientAccessResponse {
  const summary = summariseClientAccess(
    grants,
    catalogue.map((entry) => ({
      clientId: entry.clientId,
      name: entry.name,
      archived: entry.archived,
      total: entry.listingIds.length,
    })),
    locationScope
  )
  return {
    userId,
    role,
    ...summary,
    locationGrants: grants.map(({ locationId, canPublish }) => ({
      locationId,
      canPublish,
    })),
  }
}

export const GET = route({
  roles: ["owner", "admin"],
  params: clientAccessParamsSchema,
  handler: async ({ params, tenant }) =>
    tenant(async (sql) => {
      const member = await loadMember(sql, params.userId, false)
      const grants = await loadGrants(sql, params.userId)
      const catalogue = await loadClientCatalogue(sql)
      return respond(
        params.userId,
        member.role,
        member.locationScope,
        grants,
        catalogue
      )
    }),
})

export const PUT = route({
  mfa: "step_up",
  roles: ["owner", "admin"],
  params: clientAccessParamsSchema,
  body: clientAccessUpdateSchema,
  handler: async ({
    session,
    params,
    body,
    requestId,
    clientRequestId,
    tenant,
  }) =>
    tenant(async (sql) => {
      // Locking the membership row serialises two admins saving access for
      // the same person at once; without it both delete-then-insert runs
      // interleave into a primary-key conflict.
      const member = await loadMember(sql, params.userId, true)
      const before = await loadGrants(sql, params.userId)
      const catalogue = await loadClientCatalogue(sql)
      const plan = planClientAccess({
        role: member.role,
        workspaceMode: session.workspaceMode,
        request: body,
        catalogue,
        current: before,
      })
      if (!plan.ok) throw new ApiError(plan.status, plan.code, plan.message)

      // The scope is written with the rows it describes (supabase 0082):
      // "every client" is `all`, anything narrower is exactly these rows,
      // and no rows on `assigned` is no access.
      const locationScope: LocationScope = plan.allClients ? "all" : "assigned"
      await sql`
        update member set location_scope = ${locationScope}
        where user_id = ${params.userId}
      `
      await sql`delete from location_member where user_id = ${params.userId}`
      if (plan.rows.length > 0) {
        await sql`
          insert into location_member ${sql(
            plan.rows.map((row) => ({
              organisation_id: session.organisationId,
              location_id: row.locationId,
              user_id: params.userId,
              can_publish: row.canPublish,
            }))
          )}
        `
      }
      const after = await loadGrants(sql, params.userId)
      await writeAudit(sql, {
        organisationId: session.organisationId,
        actorUserId: session.userId,
        action: "member.client_access_changed",
        subjectType: "member",
        subjectId: params.userId,
        requestId,
        metadata: {
          request: body,
          before: {
            allClients: member.locationScope === "all",
            locationScope: member.locationScope,
            grants: before.map(({ locationId, canPublish }) => ({
              locationId,
              canPublish,
            })),
          },
          after: {
            allClients: plan.allClients,
            locationScope,
            grants: plan.rows,
          },
          clientRequestId,
        },
      })
      return respond(
        params.userId,
        member.role,
        locationScope,
        after,
        catalogue
      )
    }),
})

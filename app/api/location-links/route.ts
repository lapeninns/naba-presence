import { NextResponse } from "next/server"

import {
  linkLocationRequestSchema,
  unlinkLocationQuerySchema,
  type LinkLocationResponse,
  type LocationLink,
  type LocationsResponse,
  type ManagementLocationsResponse,
  type UnlinkLocationResponse,
} from "@/lib/contracts/location-links"
import { projectDefault, projectManagement } from "@/lib/locations/directory"
import { writeAudit } from "@/lib/server/audit"
import {
  auditExtendedGrants,
  extendClientHolders,
} from "@/lib/server/client-access"
import { ApiError } from "@/lib/server/http"
import { listLocationDirectoryRows } from "@/lib/server/location-directory"
import { route } from "@/lib/server/route"
import { requireRole } from "@/lib/server/session"

export const runtime = "nodejs"

export const GET = route({
  query: (searchParams) => ({
    managementView: searchParams.get("view") === "management",
  }),
  handler: async ({ session, query }) => {
    // The role gate is conditional on `?view=management`, so it cannot be
    // declared as `roles` on the route and stays in the handler.
    if (query.managementView) requireRole(session, ["owner", "admin"])
    // Query and projections are shared with the dashboard layout's RSC
    // hydration (lib/server/location-directory.ts, lib/locations/directory.ts)
    // so the HTTP and RSC paths cannot emit different shapes for the same org.
    const rows = await listLocationDirectoryRows(session)
    if (query.managementView) {
      return {
        locations: projectManagement(rows),
      } satisfies ManagementLocationsResponse
    }
    return {
      locations: projectDefault(rows, session.role),
    } satisfies LocationsResponse
  },
})

export const POST = route({
  roles: ["owner", "admin"],
  body: linkLocationRequestSchema,
  handler: async ({
    session,
    body: input,
    requestId,
    clientRequestId,
    tenant,
  }) => {
    const link = await tenant(async (sql) => {
      const [external] = await sql<
        {
          id: string
          title: string
          address: Record<string, unknown> | null
          currentLinkId: string | null
          currentLocationId: string | null
        }[]
      >`
        select
          e.id::text as id,
          e.title,
          e.address_json as address,
          ll.id::text as "currentLinkId",
          ll.location_id::text as "currentLocationId"
        from external_location e
        left join location_link ll
          on ll.external_location_id = e.id
         and ll.is_active = true
        where e.id = ${input.externalLocationId}
        limit 1
      `
      if (!external) {
        throw new ApiError(
          404,
          "external_location_not_found",
          "Google location not found."
        )
      }
      let locationId = input.locationId
      // Set when THIS request filed the listing under input.clientId, so the
      // client's existing holders can be given it (extendClientHolders).
      let filedIntoClient = false
      if (!locationId) {
        const name = input.name ?? external.title
        const [prior] = await sql<{ clientId: string | null }[]>`
          select client_id::text as "clientId" from location where name = ${name}
        `
        const [location] = await sql<{ id: string; clientId: string | null }[]>`
          insert into location (organisation_id, name, address_json, timezone, client_id)
          values (
            ${session.organisationId},
            ${name},
            ${
              external.address
                ? sql.json(JSON.parse(JSON.stringify(external.address)))
                : null
            },
            ${input.timezone},
            ${input.clientId ?? null}
          )
          on conflict (organisation_id, name) do update
          set
            address_json = coalesce(location.address_json, excluded.address_json),
            timezone = excluded.timezone,
            -- Only fills a gap. Re-importing must never move a location that
            -- already belongs to another client.
            client_id = coalesce(location.client_id, excluded.client_id)
          returning id::text as id, client_id::text as "clientId"
        `
        locationId = location.id
        filedIntoClient =
          Boolean(input.clientId) &&
          location.clientId === input.clientId &&
          !prior?.clientId
      } else {
        const [location] = await sql<{ id: string }[]>`
          select id::text as id
          from location
          where id = ${locationId}
          limit 1
        `
        if (!location) {
          throw new ApiError(
            404,
            "location_not_found",
            "Internal location not found."
          )
        }
        // Linking an EXISTING location from the setup flow files it under the
        // client, but only when it has none — reassigning silently would move
        // someone else's listing.
        if (input.clientId) {
          const filed = await sql`
            update location
               set client_id = ${input.clientId}
             where id = ${locationId} and client_id is null
            returning id
          `
          filedIntoClient = filed.length > 0
        }
        await sql`
          update location
          set address_json = coalesce(
            address_json,
            ${
              external.address
                ? sql.json(JSON.parse(JSON.stringify(external.address)))
                : null
            }
          )
          where id = ${locationId}
        `
      }
      const isRelink =
        Boolean(external.currentLocationId) &&
        external.currentLocationId !== locationId
      if (isRelink && !input.confirmRelink) {
        throw new ApiError(
          409,
          "relink_confirmation_required",
          "Confirm the location change before moving historical reviews."
        )
      }
      const [occupied] = await sql<{ id: string }[]>`
        select id::text as id
        from location_link
        where location_id = ${locationId}
          and external_location_id <> ${external.id}
          and is_active = true
        limit 1
      `
      if (occupied) {
        throw new ApiError(
          409,
          "location_already_linked",
          "That internal location is already linked to another Google location."
        )
      }
      const [row] = await sql<LocationLink[]>`
        insert into location_link (
          organisation_id,
          location_id,
          external_location_id,
          is_active
        )
        values (
          ${session.organisationId},
          ${locationId},
          ${external.id},
          true
        )
        on conflict (organisation_id, external_location_id) do update
        set location_id = excluded.location_id, is_active = true
        returning
          id::text as id,
          location_id::text as "locationId",
          external_location_id::text as "externalLocationId",
          is_active as "isActive"
      `
      if (isRelink) {
        await sql`
          update review
          set location_id = ${locationId}
          where external_location_id = ${external.id}
        `
      }
      await sql`
        insert into sync_checkpoint (
          organisation_id,
          external_location_id,
          sync_type,
          status,
          next_attempt_at
        )
        values (
          ${session.organisationId},
          ${external.id},
          'performance',
          'pending',
          now()
        )
        on conflict (organisation_id, external_location_id, sync_type)
        do update set
          status = 'pending',
          next_attempt_at = now(),
          last_error_code = null,
          finished_at = null
      `
      await writeAudit(sql, {
        organisationId: session.organisationId,
        actorUserId: session.userId,
        action: isRelink ? "location.relinked" : "location.linked",
        subjectType: "location_link",
        subjectId: row.id,
        requestId,
        metadata: {
          locationId,
          externalLocationId: external.id,
          previousLocationId: external.currentLocationId,
          historicalReviewsMoved: isRelink,
          clientRequestId,
        },
      })
      if (filedIntoClient && input.clientId) {
        await auditExtendedGrants(sql, {
          organisationId: session.organisationId,
          actorUserId: session.userId,
          clientId: input.clientId,
          requestId,
          extended: await extendClientHolders(sql, {
            organisationId: session.organisationId,
            clientId: input.clientId,
            locationIds: [locationId],
          }),
        })
      }
      return row
    })
    return NextResponse.json({ link } satisfies LinkLocationResponse, {
      status: 201,
    })
  },
})

export const DELETE = route({
  roles: ["owner", "admin"],
  // A bare uuid (see unlinkLocationQuerySchema) so a missing/invalid value
  // keeps producing the `_root` field error the old handler emitted.
  query: (searchParams) =>
    unlinkLocationQuerySchema.parse(searchParams.get("externalLocationId")),
  handler: async ({
    session,
    query: externalLocationId,
    requestId,
    clientRequestId,
    tenant,
  }) => {
    await tenant(async (sql) => {
      const [link] = await sql<{ id: string; locationId: string }[]>`
        update location_link
        set is_active = false
        where external_location_id = ${externalLocationId}
        returning
          id::text as id,
          location_id::text as "locationId"
      `
      if (!link) {
        throw new ApiError(
          404,
          "location_link_not_found",
          "Linked location not found."
        )
      }
      const removedRoutes = await sql`
        delete from webhook_route
        where external_location_id = ${externalLocationId}
        returning google_location_name
      `
      await sql`
        update sync_checkpoint
        set
          status = 'cancelled',
          finished_at = now(),
          next_attempt_at = null
        where external_location_id = ${externalLocationId}
          and status in ('pending', 'running', 'failed')
      `
      await writeAudit(sql, {
        organisationId: session.organisationId,
        actorUserId: session.userId,
        action: "location.unlinked",
        subjectType: "location_link",
        subjectId: link.id,
        requestId,
        metadata: {
          locationId: link.locationId,
          externalLocationId,
          routesRemoved: removedRoutes.length,
          clientRequestId,
        },
      })
    })
    return { unlinked: true } satisfies UnlinkLocationResponse
  },
})

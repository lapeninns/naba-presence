import { NextResponse } from "next/server"
import { z } from "zod"

import { writeAudit } from "@/lib/server/audit"
import { withTenant } from "@/lib/server/db"
import { ApiError, apiError, serverRequestId } from "@/lib/server/http"
import { requireRole, requireSession } from "@/lib/server/session"

export const runtime = "nodejs"

const linkSchema = z.object({
  externalLocationId: z.uuid(),
  locationId: z.uuid().optional(),
  name: z.string().trim().min(1).max(160).optional(),
  timezone: z.string().trim().min(1).max(80).default("Europe/London"),
  confirmRelink: z.boolean().default(false),
})

export async function GET(request: Request) {
  try {
    const session = await requireSession()
    const managementView =
      new URL(request.url).searchParams.get("view") === "management"
    if (managementView) requireRole(session, ["owner", "admin"])
    const locations = await withTenant(
      session.organisationId,
      (sql) => sql`
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
        ${
          session.role === "owner" || session.role === "admin"
            ? sql``
            : sql`
                where not exists (
                  select 1
                  from location_member lm
                  where lm.user_id = ${session.userId}
                )
                or exists (
                  select 1
                  from location_member lm
                  where lm.user_id = ${session.userId}
                    and lm.location_id = l.id
                )
              `
        }
        order by lower(l.name)
      `
    )
    if (managementView) return NextResponse.json({ locations })
    return NextResponse.json({
      locations: locations.map((location) => {
        const record = location as {
          locationId: string
          name: string
          googleLocationName: string | null
        }
        return {
          id: record.locationId,
          name: record.name,
          ...(session.role === "owner" || session.role === "admin"
            ? { googleLocationName: record.googleLocationName }
            : {}),
        }
      }),
    })
  } catch (error) {
    return apiError(error)
  }
}

export async function POST(request: Request) {
  try {
    const rid = serverRequestId(request)
    const session = requireRole(await requireSession(), ["owner", "admin"])
    const input = linkSchema.parse(await request.json())
    const link = await withTenant(session.organisationId, async (sql) => {
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
      if (!locationId) {
        const [location] = await sql<{ id: string }[]>`
          insert into location (organisation_id, name, address_json, timezone)
          values (
            ${session.organisationId},
            ${input.name ?? external.title},
            ${
              external.address
                ? sql.json(JSON.parse(JSON.stringify(external.address)))
                : null
            },
            ${input.timezone}
          )
          on conflict (organisation_id, name) do update
          set
            address_json = coalesce(location.address_json, excluded.address_json),
            timezone = excluded.timezone
          returning id::text as id
        `
        locationId = location.id
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
      const [row] = await sql`
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
        subjectId: String(row.id),
        requestId: rid.id,
        metadata: {
          locationId,
          externalLocationId: external.id,
          previousLocationId: external.currentLocationId,
          historicalReviewsMoved: isRelink,
          clientRequestId: rid.clientId,
        },
      })
      return row
    })
    return NextResponse.json({ link }, { status: 201 })
  } catch (error) {
    return apiError(error)
  }
}

export async function DELETE(request: Request) {
  try {
    const rid = serverRequestId(request)
    const session = requireRole(await requireSession(), ["owner", "admin"])
    const externalLocationId = z
      .uuid()
      .parse(new URL(request.url).searchParams.get("externalLocationId"))
    await withTenant(session.organisationId, async (sql) => {
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
        requestId: rid.id,
        metadata: {
          locationId: link.locationId,
          externalLocationId,
          routesRemoved: removedRoutes.length,
          clientRequestId: rid.clientId,
        },
      })
    })
    return NextResponse.json({ unlinked: true })
  } catch (error) {
    return apiError(error)
  }
}

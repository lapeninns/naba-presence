import { NextResponse } from "next/server"
import { z } from "zod"

import { secretEqual } from "@/lib/server/crypto"
import { getDatabase, withTenant } from "@/lib/server/db"
import { getServerEnv } from "@/lib/server/env"
import { readLiveFoodMenus } from "@/lib/server/food-menus"
import { getHoursState } from "@/lib/server/hours"
import { ApiError, apiError } from "@/lib/server/http"
import {
  raiseFoodMenuProposals,
  raiseProfileProposals,
} from "@/lib/server/import-review"
import { withAdvisoryLock } from "@/lib/server/leases"
import { loadMedia } from "@/lib/server/media"
import { loadPlaceActions } from "@/lib/server/place-actions"
import { listLocalPosts } from "@/lib/server/posts"
import { readProfileStateBundle } from "@/lib/server/profile"
import type { Session } from "@/lib/server/session"

export const runtime = "nodejs"
export const maxDuration = 60

const schema = z.object({
  organisationCursor: z.uuid().optional(),
  maxOrganisations: z.number().int().min(1).max(25).default(10),
  maxLocations: z.number().int().min(1).max(10).default(5),
})

const resources = ["hours", "profile", "posts", "media", "foodMenus", "placeActions"] as const

async function tenantContext(organisationId: string, maxLocations: number) {
  return withTenant(organisationId, async (sql) => {
    const [identity] = await sql<{
      userId: string
      organisationName: string
      displayName: string
      email: string
      role: Session["role"]
      canPublish: boolean
    }[]>`
      select m.user_id::text as "userId", o.name as "organisationName",
        u.display_name as "displayName", u.email, m.role, m.can_publish as "canPublish"
      from member m
      join app_user u on u.id = m.user_id
      join organisation o on o.id = m.organisation_id
      where m.organisation_id = ${organisationId}
        and m.role in ('owner', 'admin')
      order by case m.role when 'owner' then 0 when 'admin' then 1 else 2 end, m.created_at
      limit 1`
    if (!identity) return null
    const locations = await sql<{ id: string }[]>`
      select l.id::text as id
      from location l
      join location_link ll on ll.location_id = l.id and ll.is_active = true
      left join presence_resource_reconcile_state prs on prs.location_id = l.id
      group by l.id
      order by min(prs.last_attempt_at) nulls first, l.id
      limit ${maxLocations}`
    const session: Session = {
      sessionId: "system:presence-resource-reconciliation",
      organisationId,
      ...identity,
    }
    return { session, locations }
  })
}

async function recordOutcome(input: {
  organisationId: string
  locationId: string
  resource: typeof resources[number]
  status: "succeeded" | "failed"
  errorCode?: string
}) {
  await withTenant(input.organisationId, (sql) => sql`
    insert into presence_resource_reconcile_state (
      organisation_id, location_id, resource, status, last_error_code,
      last_attempt_at, last_succeeded_at
    )
    select
      o.id, l.id, ${input.resource}, ${input.status},
      ${input.errorCode ?? null}, now(),
      ${input.status === "succeeded" ? new Date() : null}
    from organisation o
    join location l
      on l.organisation_id = o.id
     and l.id = ${input.locationId}
    where o.id = ${input.organisationId}
    on conflict (organisation_id, location_id, resource) do update set
      status = excluded.status, last_error_code = excluded.last_error_code,
      last_attempt_at = now(),
      last_succeeded_at = case when excluded.status = 'succeeded' then now()
        else presence_resource_reconcile_state.last_succeeded_at end`)
}

async function reconcileResource(
  resource: typeof resources[number],
  session: Session,
  locationId: string
) {
  if (resource === "hours") return getHoursState(session, locationId)
  if (resource === "profile") {
    const bundle = await readProfileStateBundle(session, locationId)
    // Proposal raising is isolated: a raise failure must not poison the
    // state observation itself.
    if (getServerEnv().IMPORT_REVIEW_ENABLED) {
      try {
        await raiseProfileProposals({
          session,
          locationId,
          bundle,
          via: "sweep",
          requestId: "system:presence-resources",
        })
      } catch {
        throw new ApiError(502, "proposal_raise_failed", "Import proposals could not be refreshed.")
      }
    }
    return bundle.state
  }
  if (resource === "posts") return listLocalPosts(session.organisationId, session, locationId)
  if (resource === "media") return loadMedia(session.organisationId, session, locationId)
  if (resource === "foodMenus") {
    const live = await readLiveFoodMenus(session, locationId)
    if (getServerEnv().IMPORT_REVIEW_ENABLED) {
      try {
        await raiseFoodMenuProposals({
          session,
          locationId,
          live,
          via: "sweep",
          requestId: "system:presence-resources",
        })
      } catch {
        throw new ApiError(502, "proposal_raise_failed", "Import proposals could not be refreshed.")
      }
    }
    return live.state
  }
  return loadPlaceActions(session.organisationId, session, locationId)
}

export async function POST(request: Request) {
  try {
    const token = request.headers.get("authorization")?.replace(/^Bearer /, "")
    if (!secretEqual(token, getServerEnv().CRON_SECRET)) {
      throw new ApiError(401, "invalid_cron_token", "Invalid cron token.")
    }
    const input = schema.parse(await request.json().catch(() => ({})))
    const result = await withAdvisoryLock("naba:presence-resources", async () => {
      const database = getDatabase()
      const organisations = await database<{ id: string }[]>`
        select organisation_id::text as id from organisation_job_route
        ${input.organisationCursor ? database`where organisation_id > ${input.organisationCursor}` : database``}
        order by organisation_id limit ${input.maxOrganisations}`
      const outcomes = []
      for (const organisation of organisations) {
        const context = await tenantContext(organisation.id, input.maxLocations)
        if (!context) continue
        for (const location of context.locations) {
          for (const resource of resources) {
            try {
              await reconcileResource(resource, context.session, location.id)
              await recordOutcome({ organisationId: organisation.id, locationId: location.id, resource, status: "succeeded" })
              outcomes.push({ organisationId: organisation.id, locationId: location.id, resource, status: "succeeded" })
            } catch (error) {
              const errorCode = error && typeof error === "object" && "code" in error
                ? String(error.code)
                : "presence_reconciliation_failed"
              await recordOutcome({ organisationId: organisation.id, locationId: location.id, resource, status: "failed", errorCode })
              outcomes.push({
                organisationId: organisation.id,
                locationId: location.id,
                resource,
                status: "failed",
                errorCode,
              })
            }
          }
        }
      }
      return {
        outcomes,
        nextCursor: organisations.length === input.maxOrganisations ? organisations.at(-1)?.id ?? null : null,
      }
    })
    return NextResponse.json("skipped" in result ? { skipped: true, outcomes: [], nextCursor: null } : { skipped: false, ...result })
  } catch (error) {
    return apiError(error)
  }
}

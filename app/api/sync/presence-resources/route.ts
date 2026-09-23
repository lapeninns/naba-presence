import {
  presenceResourcesSyncSchema,
  type PresenceResourcesSyncInput,
} from "@/lib/contracts/sync"
import { getDatabase, withTenant } from "@/lib/server/db"
import { getServerEnv } from "@/lib/server/env"
import { readLiveFoodMenus } from "@/lib/server/food-menus"
import { getHoursState } from "@/lib/server/hours"
import { ApiError } from "@/lib/server/http"
import {
  raiseFoodMenuProposals,
  raiseProfileProposals,
  reapStrandedProposals,
} from "@/lib/server/import-review"
import { withAdvisoryLock } from "@/lib/server/leases"
import { loadMedia } from "@/lib/server/media"
import { loadPlaceActions } from "@/lib/server/place-actions"
import { listLocalPosts } from "@/lib/server/posts"
import { readProfileStateBundle } from "@/lib/server/profile"
import { cronPageInput } from "@/lib/server/cron-query"
import { followCronCursor } from "@/lib/server/cron-cursor"
import { route } from "@/lib/server/route"
import type { Session } from "@/lib/server/session"

export const runtime = "nodejs"
export const maxDuration = 60

const resources = [
  "hours",
  "profile",
  "posts",
  "media",
  "foodMenus",
  "placeActions",
] as const

// Dueness, not just ordering. Without it the sweep re-walked its head-of-order
// organisations on every tick — six live Google reads per location, seconds of
// pacing each — so a fleet larger than one page never reached its tail. Ten
// minutes is deliberately under the 15-minute tick, so scheduler jitter cannot
// push a location into the next cycle. Dueness is per location because the
// sweep walks a location as a unit: one due resource pulls its five siblings
// along, so the longer failure interval bites when a whole location is broken
// (a revoked grant, an unlinked location) — the case that was burning six
// paced Google reads every tick.
const DUE_AFTER_SUCCESS_MS = 10 * 60_000
const DUE_AFTER_FAILURE_MS = 60 * 60_000

// The scheduler aborts at 55s and Next stops the handler at maxDuration, but
// neither cancels work already in flight; the budget is what returns a usable
// cursor before either fires. Matches the performance sweep's default.
function budgetMs() {
  const configured = Number(process.env.PRESENCE_RESOURCE_BUDGET_MS ?? 45_000)
  return Number.isFinite(configured) && configured >= 0 ? configured : 45_000
}

async function tenantContext(organisationId: string, maxLocations: number) {
  return withTenant(organisationId, async (sql) => {
    const [identity] = await sql<
      {
        userId: string
        organisationName: string
        displayName: string
        email: string
        role: Session["role"]
        canPublish: boolean
      }[]
    >`
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
      having min(prs.next_attempt_at) is null or min(prs.next_attempt_at) <= now()
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
  resource: (typeof resources)[number]
  status: "succeeded" | "failed"
  errorCode?: string
}) {
  const nextAttemptAt = new Date(
    Date.now() +
      (input.status === "succeeded"
        ? DUE_AFTER_SUCCESS_MS
        : DUE_AFTER_FAILURE_MS)
  )
  await withTenant(
    input.organisationId,
    (sql) => sql`
    insert into presence_resource_reconcile_state (
      organisation_id, location_id, resource, status, last_error_code,
      last_attempt_at, last_succeeded_at, next_attempt_at
    )
    select
      o.id, l.id, ${input.resource}, ${input.status},
      ${input.errorCode ?? null}, now(),
      ${input.status === "succeeded" ? new Date() : null},
      ${nextAttemptAt}
    from organisation o
    join location l
      on l.organisation_id = o.id
     and l.id = ${input.locationId}
    where o.id = ${input.organisationId}
    on conflict (organisation_id, location_id, resource) do update set
      status = excluded.status, last_error_code = excluded.last_error_code,
      last_attempt_at = now(),
      next_attempt_at = excluded.next_attempt_at,
      last_succeeded_at = case when excluded.status = 'succeeded' then now()
        else presence_resource_reconcile_state.last_succeeded_at end`
  )
}

async function reconcileResource(
  resource: (typeof resources)[number],
  session: Session,
  locationId: string,
  requestId: string
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
          requestId,
        })
      } catch {
        throw new ApiError(
          502,
          "proposal_raise_failed",
          "Import proposals could not be refreshed."
        )
      }
    }
    return bundle.state
  }
  if (resource === "posts")
    return listLocalPosts(session.organisationId, session, locationId)
  if (resource === "media")
    return loadMedia(session.organisationId, session, locationId)
  if (resource === "foodMenus") {
    const live = await readLiveFoodMenus(session, locationId)
    if (getServerEnv().IMPORT_REVIEW_ENABLED) {
      try {
        await raiseFoodMenuProposals({
          session,
          locationId,
          live,
          via: "sweep",
          requestId,
        })
      } catch {
        throw new ApiError(
          502,
          "proposal_raise_failed",
          "Import proposals could not be refreshed."
        )
      }
    }
    return live.state
  }
  return loadPlaceActions(session.organisationId, session, locationId)
}

async function reconcileOrganisations(
  input: PresenceResourcesSyncInput,
  requestId: string
) {
  // Cross-tenant enumeration: the cron walks every organisation that has a
  // job route, so this one read deliberately runs outside withTenant.
  const database = getDatabase()
  const organisations = await database<{ id: string }[]>`
    select organisation_id::text as id from organisation_job_route
    ${input.organisationCursor ? database`where organisation_id > ${input.organisationCursor}` : database``}
    order by organisation_id limit ${input.maxOrganisations}`
  const deadline = Date.now() + budgetMs()
  const outcomes = []
  let processed = 0
  let reaped = 0
  let budgetExhausted = false
  let lastProcessedOrganisationId: string | null = null
  for (const organisation of organisations) {
    // At least one organisation per page, or a fleet whose first organisation
    // is slower than the budget never advances at all.
    if (processed > 0 && Date.now() >= deadline) {
      budgetExhausted = true
      break
    }
    processed += 1
    lastProcessedOrganisationId = organisation.id
    // Repair before work, and before the due filter can skip every location:
    // a proposal stranded in `processing` blocks any fresh proposal for its
    // identity, and this is the only tick whose cadence matches the fifteen
    // minutes that reaper was written for.
    reaped += await reapStrandedProposals(organisation.id)
    const context = await tenantContext(organisation.id, input.maxLocations)
    if (!context) continue
    for (const location of context.locations) {
      // Between locations too, not only between organisations: one
      // organisation is up to maxLocations x 6 paced Google reads, minutes of
      // work on its own. What is left of this organisation waits for the next
      // tick, where the due filter and the least-recently-attempted ordering
      // put it back at the head of the queue.
      if (outcomes.length > 0 && Date.now() >= deadline) {
        budgetExhausted = true
        break
      }
      for (const resource of resources) {
        try {
          await reconcileResource(
            resource,
            context.session,
            location.id,
            requestId
          )
          await recordOutcome({
            organisationId: organisation.id,
            locationId: location.id,
            resource,
            status: "succeeded",
          })
          outcomes.push({
            organisationId: organisation.id,
            locationId: location.id,
            resource,
            status: "succeeded",
          })
        } catch (error) {
          const errorCode =
            error && typeof error === "object" && "code" in error
              ? String(error.code)
              : "presence_reconciliation_failed"
          await recordOutcome({
            organisationId: organisation.id,
            locationId: location.id,
            resource,
            status: "failed",
            errorCode,
          })
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
    if (budgetExhausted) break
  }
  return {
    outcomes,
    reapedProposals: reaped,
    truncated: budgetExhausted,
    skippedOrganisations: organisations.length - processed,
    // A partial page must still hand back a usable resume point, or the walk
    // restarts at the head on every tick and the tail is never reached. When
    // the budget stopped us inside an organisation the cursor is that
    // organisation: the rest of its locations are the next tick's work, and
    // the organisations after it are this walk's.
    nextCursor:
      budgetExhausted || organisations.length === input.maxOrganisations
        ? lastProcessedOrganisationId
        : null,
  }
}

async function runPresenceResourcesPage(
  input: PresenceResourcesSyncInput,
  requestId: string
) {
  const result = await withAdvisoryLock("naba:presence-resources", () =>
    reconcileOrganisations(input, requestId)
  )
  return "skipped" in result
    ? {
        skipped: true,
        outcomes: [],
        reapedProposals: 0,
        truncated: false,
        skippedOrganisations: 0,
        nextCursor: null,
      }
    : { skipped: false, ...result }
}

export const POST = route({
  auth: "cron",
  body: presenceResourcesSyncSchema,
  handler: async ({ body, requestId }) =>
    runPresenceResourcesPage(body, requestId),
})

// Vercel Cron entry point: the same single page the scheduler POSTed every
// 15 minutes, with the schema fields as query params
// (`?maxOrganisations=10&maxLocations=5`). Cron-only like POST — a session
// caller keeps using POST.
export const GET = route({
  auth: "cron",
  query: (searchParams) => cronPageInput(searchParams),
  handler: async ({ query, requestId }) =>
    followCronCursor("presence-resources", query, (input) =>
      runPresenceResourcesPage(
        presenceResourcesSyncSchema.parse(input),
        requestId
      )
    ),
})

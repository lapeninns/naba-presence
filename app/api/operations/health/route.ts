import { NextResponse } from "next/server"

import type {
  PlatformHealthCoverage,
  PlatformRelease,
} from "@/lib/contracts/operations"
import { getDatabase, withTenant } from "@/lib/server/db"
import {
  loadOrganisationHealth,
  tenantAlerting,
  type AlertingFields,
} from "@/lib/server/operations-health"
import { schedulerLiveness } from "@/lib/server/ops-liveness"
import { releaseInfo } from "@/lib/server/release"
import {
  missingMigrations,
  readAppliedMigrations,
} from "@/lib/server/schema-compat"
import { REQUIRED_MIGRATIONS } from "@/lib/server/schema-manifest"
import { requireCronToken, route } from "@/lib/server/route"
import { requireRole, requireSession } from "@/lib/server/session"

export const runtime = "nodejs"

/**
 * Sustained quota pressure on the shared Google budget (0049): which buckets
 * Google has answered 429 on recently, and which are blocked right now.
 * Platform-level, like ops_heartbeat; bucket names carry no tenant data.
 */
async function googleQuotaPressure() {
  const rows = await getDatabase()<
    {
      bucket: string
      blocked: boolean
      throttledCount: number
      lastThrottledAt: Date | null
    }[]
  >`
    select
      bucket,
      coalesce(blocked_until > now(), false) as blocked,
      throttled_count as "throttledCount",
      last_throttled_at as "lastThrottledAt"
    from google_rate_bucket
    where last_throttled_at >= now() - interval '1 hour'
       or blocked_until > now()
    order by last_throttled_at desc nulls last
    limit 20
  `
  return rows.map((row) => ({
    bucket: row.bucket,
    blocked: row.blocked,
    throttledCount: row.throttledCount,
    lastThrottledAt: row.lastThrottledAt?.toISOString() ?? null,
  }))
}

// The tenant walk is serial and its cost grows with the fleet; the budget is
// what keeps a monitor's poll from running into the function timeout and
// returning nothing at all. Read per call, like the sync routes' budgets.
function budgetMs() {
  const configured = Number(process.env.OPERATIONS_HEALTH_BUDGET_MS ?? 20_000)
  return Number.isFinite(configured) && configured >= 0 ? configured : 20_000
}

/**
 * The deployed commit and whether the database still satisfies this build's
 * required migrations. Startup already refuses an incompatible schema; this
 * reports it while serving, so a restore or a failed migration after boot is
 * visible to the monitor. One indexed read of `schema_migration`, outside the
 * tenant walk's budget.
 */
async function platformRelease(): Promise<PlatformRelease> {
  let schema: PlatformRelease["schema"]
  try {
    const missing = missingMigrations(await readAppliedMigrations())
    schema = {
      compatible: missing.length === 0,
      requiredCount: REQUIRED_MIGRATIONS.length,
      missing,
    }
  } catch {
    schema = {
      compatible: null,
      requiredCount: REQUIRED_MIGRATIONS.length,
      missing: [],
    }
  }
  return { release: releaseInfo(), schema }
}

async function platformHealth() {
  // Cross-tenant enumeration: the platform monitor walks every organisation
  // that has a job route, so this one read deliberately runs outside
  // withTenant; each organisation's counters are then read inside its tenant.
  const ordered = await getDatabase()<{ id: string }[]>`
    select organisation_id::text as id
    from organisation_job_route
    order by organisation_id
  `
  // Start at a random organisation, as the health tick does: a budget that
  // always ran out at the same point would never report the fleet's tail.
  // A complete walk is order-independent, so this changes nothing unless
  // the response is partial.
  const start = ordered.length ? Math.floor(Math.random() * ordered.length) : 0
  const organisations = [...ordered.slice(start), ...ordered.slice(0, start)]
  const deadline = Date.now() + budgetMs()
  const totals: AlertingFields = {
    failedWebhookEvents: 0,
    deadWebhookEvents: 0,
    oldestFailedEventAgeSeconds: null,
    ambiguousPublishAttempts: 0,
    staleStartedAttempts: 0,
    dueJobBacklog: 0,
    dueWebhookBacklog: 0,
    dueRunnerCheckpointBacklog: 0,
    dueMetricsCheckpointBacklog: 0,
    dueUnclaimedCheckpointBacklog: 0,
    dueReconcileBacklog: 0,
    duePublishBacklog: 0,
    checkpointFailures24h: 0,
    connectionErrors24h: 0,
    refreshTokensExpiringSoon: 0,
    reconcileStalenessSeconds: null,
    sweepStalenessSeconds: null,
    listingsAccessLost: 0,
    heldPurgeLocations: 0,
    pendingPurgeAgeSeconds: null,
  }
  // Counters add across the fleet; the three age/staleness fields are
  // "the worst tenant", so they take the maximum and stay null until some
  // tenant reports one.
  const SUMMED = [
    "failedWebhookEvents",
    "deadWebhookEvents",
    "ambiguousPublishAttempts",
    "staleStartedAttempts",
    "dueJobBacklog",
    "dueWebhookBacklog",
    "dueRunnerCheckpointBacklog",
    "dueMetricsCheckpointBacklog",
    "dueUnclaimedCheckpointBacklog",
    "dueReconcileBacklog",
    "duePublishBacklog",
    "checkpointFailures24h",
    "connectionErrors24h",
    "refreshTokensExpiringSoon",
    "listingsAccessLost",
    "heldPurgeLocations",
  ] as const
  const MAXIMISED = [
    "oldestFailedEventAgeSeconds",
    "reconcileStalenessSeconds",
    "sweepStalenessSeconds",
    "pendingPurgeAgeSeconds",
  ] as const
  let organisationsCovered = 0
  for (const organisation of organisations) {
    // At least one organisation per call, or a budget shorter than one
    // tenant's read reports nothing and calls it complete.
    if (organisationsCovered > 0 && Date.now() >= deadline) break
    organisationsCovered += 1
    const fields = await withTenant(organisation.id, tenantAlerting)
    for (const key of SUMMED) totals[key] += fields[key]
    for (const key of MAXIMISED) {
      const value = fields[key]
      if (value !== null) {
        totals[key] = Math.max(totals[key] ?? 0, value)
      }
    }
  }
  // Totals cover only `organisationsCovered` tenants when partial: counters
  // are lower bounds and the worst-tenant ages may be understated.
  const coverage: PlatformHealthCoverage = {
    partial: organisationsCovered < organisations.length,
    organisationsCovered,
  }
  return {
    scope: "platform",
    generatedAt: new Date().toISOString(),
    organisationCount: organisations.length,
    ...coverage,
    ...totals,
    ...(await schedulerLiveness()),
    googleQuota: await googleQuotaPressure(),
    ...(await platformRelease()),
  }
}

// Session-or-cron hybrid: `?scope=platform` is authenticated with the cron
// bearer token, everything else with an owner/admin session. Neither wrapper
// mode covers both, so the route is "public" and does its own auth per branch.
export const GET = route({
  auth: "public",
  query: (searchParams) => ({
    platform: searchParams.get("scope") === "platform",
  }),
  handler: async ({ request, query }) => {
    if (query.platform) {
      requireCronToken(request)
      return NextResponse.json(await platformHealth(), {
        headers: { "cache-control": "no-store" },
      })
    }

    const session = requireRole(await requireSession(), ["owner", "admin"])
    const liveness = await schedulerLiveness()
    const health = await withTenant(session.organisationId, (sql) =>
      loadOrganisationHealth(sql, liveness)
    )
    return NextResponse.json(health, {
      headers: { "cache-control": "private, no-store" },
    })
  },
})

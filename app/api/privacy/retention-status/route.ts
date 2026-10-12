import type {
  RetentionCycleSummary,
  RetentionStatusResponse,
} from "@/lib/contracts/privacy"
import { getDatabase } from "@/lib/server/db"
import { getServerEnv } from "@/lib/server/env"
import { ApiError } from "@/lib/server/http"
import { isOrgFeatureEnabled } from "@/lib/server/org-features"
import { countHeldDisconnectedLocations } from "@/lib/server/retention/purge"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"

type CycleRow = {
  cycleDate: string
  startedAt: Date
  completedAt: Date | null
  orgStatus: "pending" | "succeeded" | "failed" | null
  attempts: number | null
  lastErrorCode: string | null
  finishedAt: Date | null
}

function summary(row: CycleRow | undefined): RetentionCycleSummary | null {
  if (!row) return null
  return {
    cycleDate: row.cycleDate,
    startedAt: row.startedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    organisation: row.orgStatus
      ? {
          status: row.orgStatus,
          attempts: row.attempts ?? 0,
          lastErrorCode: row.lastErrorCode,
          finishedAt: row.finishedAt?.toISOString() ?? null,
        }
      : null,
  }
}

/**
 * The Data and privacy area's retention panel (plan P04-7): when the daily
 * retention cycle (lib/server/retention/cycle.ts, 0097) last completed and
 * how this organisation fared in it, the cycle open now, and what legal
 * holds are keeping back.
 *
 * retention_cycle and retention_cycle_org are platform tables with no RLS,
 * read outside the tenant transaction like the dispatcher reads them, so
 * every read of retention_cycle_org filters by the session's organisation
 * explicitly and nothing fleet-wide (the cycle's enumerated, succeeded and
 * failed counts) is returned. Served only while the organisation's
 * `privacy_settings` feature is on, like the page it feeds.
 */
export const GET = route({
  roles: ["owner", "admin"],
  handler: async ({ session, tenant }) => {
    const tenantState = await tenant(async (sql) => {
      if (
        !(await isOrgFeatureEnabled(
          sql,
          session.organisationId,
          "privacy_settings"
        ))
      ) {
        return null
      }
      const [{ heldReviews, rawContentRetentionDays }] = await sql<
        { heldReviews: number; rawContentRetentionDays: number }[]
      >`
        select
          (
            select count(*)::int
            from legal_hold
            where released_at is null
          ) as "heldReviews",
          (
            select raw_content_retention_days
            from organisation
            where id = ${session.organisationId}
          ) as "rawContentRetentionDays"
      `
      const heldLocations = await countHeldDisconnectedLocations(sql)
      return { heldReviews, heldLocations, rawContentRetentionDays }
    })
    if (!tenantState) {
      throw new ApiError(404, "not_found", "Not found.")
    }

    const database = getDatabase()
    const cycleColumns = database`
      to_char(c.cycle_date, 'YYYY-MM-DD') as "cycleDate",
      c.started_at as "startedAt",
      c.completed_at as "completedAt",
      o.status as "orgStatus",
      o.attempts,
      o.last_error_code as "lastErrorCode",
      o.finished_at as "finishedAt"
    `
    const [lastCompleted] = await database<CycleRow[]>`
      select ${cycleColumns}
      from retention_cycle c
      left join retention_cycle_org o
        on o.cycle_id = c.id
        and o.organisation_id = ${session.organisationId}
      where c.status = 'completed'
      order by c.cycle_date desc
      limit 1
    `
    // The dispatcher works the oldest running cycle first.
    const [current] = await database<CycleRow[]>`
      select ${cycleColumns}
      from retention_cycle c
      left join retention_cycle_org o
        on o.cycle_id = c.id
        and o.organisation_id = ${session.organisationId}
      where c.status = 'running'
      order by c.cycle_date asc
      limit 1
    `

    return {
      lastCompletedCycle: summary(lastCompleted),
      currentCycle: summary(current),
      heldReviews: tenantState.heldReviews,
      heldLocations: tenantState.heldLocations,
      rawContentRetentionDays: tenantState.rawContentRetentionDays,
      deletesEnabled: getServerEnv().RETENTION_DELETES_ENABLED,
    } satisfies RetentionStatusResponse
  },
})

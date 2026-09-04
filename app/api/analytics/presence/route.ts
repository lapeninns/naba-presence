import {
  presenceQuerySchema,
  type PresenceRange,
  type PresenceResponse,
} from "@/lib/contracts/analytics"
import {
  GOOGLE_PERFORMANCE_METRICS,
  type GooglePerformanceMetric,
} from "@/lib/domain/google-contract"
import { gbpIngestionEnabled, getServerEnv } from "@/lib/server/env"
import { visibilityPredicate } from "@/lib/server/permissions"
import { route } from "@/lib/server/route"

const RANGE_DAYS: Record<PresenceRange, number> = {
  "28d": 28,
  "90d": 90,
  "12m": 365,
  "18m": 548,
}

type MetricRow = {
  metric: GooglePerformanceMetric
  metricDate: string
  value: string
}

type LocationRow = { id: string; name: string }
type CheckpointRow = { status: string; lastErrorCode: string | null }

export const GET = route({
  query: (searchParams) =>
    presenceQuerySchema.parse({
      range: searchParams.get("range") ?? undefined,
      locationId: searchParams.get("locationId") ?? undefined,
      clientId: searchParams.get("clientId") ?? undefined,
    }),
  handler: async ({ session, query, tenant }) => {
    const env = getServerEnv()
    const endDate = new Date()
    const startDate = new Date(endDate)
    startDate.setUTCDate(startDate.getUTCDate() - RANGE_DAYS[query.range] + 1)
    const start = startDate.toISOString().slice(0, 10)
    const end = endDate.toISOString().slice(0, 10)
    const payload = await tenant(async (sql) => {
      const visibility = visibilityPredicate(sql, session, sql`l.id`)
      const locations = await sql<LocationRow[]>`
        select l.id::text as id, l.name
        from location l
        join location_link ll on ll.location_id = l.id and ll.is_active = true
        where 1 = 1
          ${query.locationId ? sql`and l.id = ${query.locationId}` : sql``}
          ${query.clientId ? sql`and l.client_id = ${query.clientId}` : sql``}
          and ${visibility}
        order by l.name
      `
      const rows = await sql<MetricRow[]>`
        select
          p.metric,
          p.metric_date::text as "metricDate",
          sum(p.value)::text as value
        from performance_metric_daily p
        join location_link ll
          on ll.external_location_id = p.external_location_id
         and ll.is_active = true
        join location l on l.id = ll.location_id
        where p.metric_date between ${start}::date and ${end}::date
          ${query.locationId ? sql`and l.id = ${query.locationId}` : sql``}
          ${query.clientId ? sql`and l.client_id = ${query.clientId}` : sql``}
          and ${visibility}
        group by p.metric, p.metric_date
        order by p.metric_date, p.metric
      `
      const checkpoints = await sql<CheckpointRow[]>`
        select
          sc.status,
          sc.last_error_code as "lastErrorCode"
        from sync_checkpoint sc
        join location_link ll
          on ll.external_location_id = sc.external_location_id
         and ll.is_active = true
        join location l on l.id = ll.location_id
        where sc.sync_type = 'performance'
          ${query.locationId ? sql`and l.id = ${query.locationId}` : sql``}
          ${query.clientId ? sql`and l.client_id = ${query.clientId}` : sql``}
          and ${visibility}
      `
      return { locations, rows, checkpoints }
    })
    const totals = Object.fromEntries(
      GOOGLE_PERFORMANCE_METRICS.map((metric) => [metric, 0])
    ) as Record<GooglePerformanceMetric, number>
    const byDate = new Map<
      string,
      Partial<Record<GooglePerformanceMetric, number>>
    >()
    let freshThrough: string | null = null
    for (const row of payload.rows) {
      const value = Number(row.value)
      totals[row.metric] += value
      const metrics = byDate.get(row.metricDate) ?? {}
      metrics[row.metric] = value
      byDate.set(row.metricDate, metrics)
      if (!freshThrough || row.metricDate > freshThrough) {
        freshThrough = row.metricDate
      }
    }
    const state = !payload.locations.length
      ? "no_link"
      : payload.rows.length
        ? "ready"
        : payload.checkpoints.some(
              (checkpoint) => checkpoint.status === "failed"
            )
          ? "unavailable"
          : payload.checkpoints.some((checkpoint) =>
                ["pending", "running"].includes(checkpoint.status)
              ) || !payload.checkpoints.length
            ? "pending"
            : "empty"
    return {
      range: query.range,
      from: start,
      to: end,
      state,
      freshThrough,
      locations: payload.locations,
      totals,
      series: Array.from(byDate, ([date, metrics]) => ({ date, metrics })),
      unavailableReasons: Array.from(
        new Set(
          payload.checkpoints
            .map((checkpoint) => checkpoint.lastErrorCode)
            .filter((value): value is string => Boolean(value))
        )
      ),
      keywordsEnabled: gbpIngestionEnabled(env, "keywords"),
      ingestionEnabled: gbpIngestionEnabled(env, "performance"),
    } satisfies PresenceResponse
  },
})

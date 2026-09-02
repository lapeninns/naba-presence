import {
  keywordsQuerySchema,
  type KeywordRange,
  type KeywordsResponse,
} from "@/lib/contracts/analytics"
import { visibilityPredicate } from "@/lib/server/permissions"
import { route } from "@/lib/server/route"

const RANGE_MONTHS: Record<KeywordRange, number> = {
  "1m": 1,
  "6m": 6,
  "12m": 12,
  "18m": 18,
}

type KeywordRow = {
  keyword: string
  exactImpressions: string
  thresholdUpperBound: string
  firstMonth: string
  latestMonth: string
}

type LocationRow = { id: string; name: string }
type CheckpointRow = { status: string; lastErrorCode: string | null }

export const GET = route({
  query: (searchParams) =>
    keywordsQuerySchema.parse({
      range: searchParams.get("range") ?? undefined,
      locationId: searchParams.get("locationId") ?? undefined,
    }),
  handler: async ({ session, query, tenant }) => {
    const now = new Date()
    const from = new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth() - RANGE_MONTHS[query.range] + 1,
        1
      )
    )
      .toISOString()
      .slice(0, 10)
    const payload = await tenant(async (sql) => {
      const visibility = visibilityPredicate(sql, session, sql`l.id`)
      const locations = await sql<LocationRow[]>`
        select l.id::text as id, l.name
        from location l
        join location_link ll on ll.location_id = l.id and ll.is_active = true
        where 1 = 1
          ${query.locationId ? sql`and l.id = ${query.locationId}` : sql``}
          and ${visibility}
        order by l.name
      `
      const rows = await sql<KeywordRow[]>`
        select
          k.keyword,
          coalesce(sum(k.impressions), 0)::text as "exactImpressions",
          coalesce(sum(k.threshold), 0)::text as "thresholdUpperBound",
          min(k.metric_month)::text as "firstMonth",
          max(k.metric_month)::text as "latestMonth"
        from performance_search_keyword_monthly k
        join location_link ll
          on ll.external_location_id = k.external_location_id
         and ll.is_active = true
        join location l on l.id = ll.location_id
        where k.metric_month >= ${from}::date
          ${query.locationId ? sql`and l.id = ${query.locationId}` : sql``}
          and ${visibility}
        group by k.keyword
        order by
          sum(coalesce(k.impressions, k.threshold, 0)) desc,
          k.keyword
        limit 100
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
        where sc.sync_type = 'keywords'
          ${query.locationId ? sql`and l.id = ${query.locationId}` : sql``}
          and ${visibility}
      `
      return { locations, rows, checkpoints }
    })
    const state = !payload.locations.length
      ? "no_link"
      : payload.rows.length
        ? "ready"
        : payload.checkpoints.some((checkpoint) => checkpoint.status === "failed")
          ? "unavailable"
          : payload.checkpoints.some((checkpoint) =>
                ["pending", "running"].includes(checkpoint.status)
              ) || !payload.checkpoints.length
            ? "pending"
            : "empty"
    return {
      range: query.range,
      from,
      state,
      locations: payload.locations,
      keywords: payload.rows.map((row, index) => {
        const exactImpressions = Number(row.exactImpressions)
        const thresholdUpperBound = Number(row.thresholdUpperBound)
        return {
          rank: index + 1,
          keyword: row.keyword,
          impressions: exactImpressions,
          upperBound: exactImpressions + thresholdUpperBound,
          thresholded: thresholdUpperBound > 0,
          firstMonth: row.firstMonth.slice(0, 7),
          latestMonth: row.latestMonth.slice(0, 7),
        }
      }),
      unavailableReasons: Array.from(
        new Set(
          payload.checkpoints
            .map((checkpoint) => checkpoint.lastErrorCode)
            .filter((value): value is string => Boolean(value))
        )
      ),
    } satisfies KeywordsResponse
  },
})

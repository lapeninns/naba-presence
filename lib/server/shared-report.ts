import "server-only"

import type { TransactionSql } from "postgres"

import {
  SHARE_PERIODS,
  type SharedClientReport,
  type SharedReplySummary,
  type SharePeriodId,
} from "@/lib/contracts/report-shares"
import {
  GOOGLE_PERFORMANCE_METRICS,
  type GooglePerformanceMetric,
} from "@/lib/domain/google-contract"
import { resolveReplyRange } from "@/lib/reporting/ranges"
import { loadAnalyticsOverview } from "@/lib/server/analytics-overview"
import {
  visibilityPredicate,
  type ClientShareVisibility,
  type ReportViewer,
} from "@/lib/server/permissions"
import { loadPresenceReport } from "@/lib/server/presence-report"

/**
 * The public client report behind `/share/report/[token]`.
 *
 * Reads with the SAME loaders as Reports (loadAnalyticsOverview for reply
 * performance, loadPresenceReport for Google performance), run by the page
 * inside withTenant(share.organisationId). The one difference is who they
 * read for: not a member's session but a client share viewer
 * (lib/server/permissions.ts), whose visibility is exactly the locations
 * filed under the link's client. The client id is ALSO passed as the loaders'
 * own clientId filter, so the report is narrowed twice, independently: a
 * mistake in either still leaves the other.
 *
 * The result is then copied field by field into SharedClientReport, the
 * public DTO. Nothing is spread from a loader row, so a column added to a
 * loader later does not reach the public page unless someone adds it here.
 */

export type ReportShareScope = {
  organisationId: string
  clientId: string
}

function shareViewer(share: ReportShareScope): ReportViewer {
  if (!share.clientId || !share.organisationId) {
    // A share without its client would read as the whole agency.
    throw new Error("A shared report needs its organisation and client.")
  }
  const scope: ClientShareVisibility = {
    kind: "client_share",
    clientId: share.clientId,
  }
  return { ...scope, organisationId: share.organisationId }
}

function replySummary(summary: {
  reviewVolume: number
  averageRating: number | null
  responseRate: number | null
  medianFirstResponseSeconds: number | null
}): SharedReplySummary {
  return {
    reviewVolume: Number(summary.reviewVolume ?? 0),
    averageRating: summary.averageRating ?? null,
    responseRate: summary.responseRate ?? null,
    medianFirstResponseSeconds: summary.medianFirstResponseSeconds ?? null,
  }
}

type OverviewSummaryRow = Parameters<typeof replySummary>[0]
type OverviewSeriesRow = {
  period: Date | string
  reviewCount: number
  replies: number
  averageRating: number | null
}
type OverviewLocationRow = {
  name: string
  reviews: number
  averageRating: number | null
  responseRate: number | null
  medianFirstResponseSeconds: number | null
  unresolvedComplaints: number
}

const isoOf = (value: Date | string) =>
  value instanceof Date ? value.toISOString() : String(value)

/**
 * Loads one client's shared report. `sql` must be the tenant transaction for
 * `share.organisationId`; the period must already be an allowlisted id.
 */
export async function loadSharedClientReport(
  sql: TransactionSql,
  share: ReportShareScope,
  periodId: SharePeriodId,
  now: Date = new Date()
): Promise<SharedClientReport | null> {
  const viewer = shareViewer(share)
  const period =
    SHARE_PERIODS.find((entry) => entry.id === periodId) ?? SHARE_PERIODS[0]

  const [heading] = await sql<{ agencyName: string; clientName: string }[]>`
    select o.name as "agencyName", c.name as "clientName"
    from client c
    join organisation o on o.id = c.organisation_id
    where c.id = ${share.clientId}
      and c.organisation_id = ${share.organisationId}
      and c.archived_at is null
  `
  if (!heading) return null

  const venues = await sql<{ name: string }[]>`
    select l.name
    from location l
    where l.client_id = ${share.clientId}
      and ${visibilityPredicate(sql, viewer, sql`l.id`)}
    order by lower(l.name)
  `

  // The same windows Reports uses for this period, and the equal-length
  // window before it for the deltas.
  const windows = resolveReplyRange(period.id, now)
  const current = await loadAnalyticsOverview(sql, viewer, {
    ...windows.current,
    granularity: period.granularity,
    clientId: share.clientId,
  })
  const previous = await loadAnalyticsOverview(sql, viewer, {
    ...windows.previous,
    granularity: period.granularity,
    clientId: share.clientId,
  })
  const presence = await loadPresenceReport(
    sql,
    viewer,
    { range: period.id, clientId: share.clientId },
    now
  )

  const summary = current.summary as unknown as OverviewSummaryRow
  const previousSummary = previous.summary as unknown as
    OverviewSummaryRow | undefined

  return {
    agencyName: heading.agencyName,
    clientName: heading.clientName,
    venues: venues.map((venue) => venue.name),
    period: {
      id: period.id,
      label: period.label,
      from: windows.current.from,
      to: windows.current.to,
      granularity: period.granularity,
    },
    timezone: current.timezone,
    generatedAt: now.toISOString(),
    replies: {
      summary: replySummary(summary),
      previous: previousSummary ? replySummary(previousSummary) : null,
      series: (current.series as unknown as OverviewSeriesRow[]).map(
        (point) => ({
          period: isoOf(point.period),
          reviewCount: Number(point.reviewCount),
          replies: Number(point.replies),
          averageRating: point.averageRating ?? null,
        })
      ),
      locations: (current.locations as unknown as OverviewLocationRow[]).map(
        (location) => ({
          name: location.name,
          reviews: Number(location.reviews),
          averageRating: location.averageRating ?? null,
          responseRate: location.responseRate ?? null,
          medianFirstResponseSeconds:
            location.medianFirstResponseSeconds ?? null,
          unresolvedComplaints: Number(location.unresolvedComplaints),
        })
      ),
      incomplete: Boolean(current.providerTotals.divergence),
    },
    google:
      presence.ingestionEnabled && presence.state === "ready"
        ? {
            from: presence.from,
            to: presence.to,
            freshThrough: presence.freshThrough,
            totals: Object.fromEntries(
              GOOGLE_PERFORMANCE_METRICS.map((metric) => [
                metric,
                Number(presence.totals[metric] ?? 0),
              ])
            ) as Record<GooglePerformanceMetric, number>,
            series: presence.series.map((point) => ({
              date: point.date,
              metrics: Object.fromEntries(
                GOOGLE_PERFORMANCE_METRICS.flatMap((metric) =>
                  point.metrics[metric] === undefined
                    ? []
                    : [[metric, Number(point.metrics[metric])]]
                )
              ),
            })),
          }
        : null,
  }
}

import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { startAppServer } from "../helpers/app-server"
import { startGoogleStub, type GoogleStub } from "../helpers/google-stub"
import {
  createTestTenant,
  destroyTenants,
  seedGoogleConnection,
  seedLinkedLocation,
  seedLinkedReview,
} from "../helpers/tenant"

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip

describeDatabase("Google Performance analytics", () => {
  let admin: ReturnType<typeof postgres>
  let google: GoogleStub
  let server: Awaited<ReturnType<typeof startAppServer>>
  const organisations: string[] = []

  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 1 })
    google = await startGoogleStub()
    server = await startAppServer({
      GOOGLE_API_PROXY_BASE: google.baseUrl,
      GBP_PERFORMANCE_ENABLED: "true",
    })
  })

  afterAll(async () => {
    await server.stop()
    await google.stop()
    await destroyTenants(admin, organisations)
    await admin.end()
  })

  it("backfills, reports, restates, and isolates daily metrics", async () => {
    const owner = await createTestTenant(admin)
    const other = await createTestTenant(admin)
    organisations.push(owner.organisationId, other.organisationId)
    const connection = await seedGoogleConnection(admin, {
      organisationId: owner.organisationId,
    })
    const linked = await seedLinkedReview(admin, {
      organisationId: owner.organisationId,
      connectionId: connection.connectionId,
      googleAccountName: connection.googleAccountName,
    })
    let calls = 12
    google.respond(
      {
        method: "GET",
        pathIncludes: ":fetchMultiDailyMetricsTimeSeries",
      },
      () => ({
        status: 200,
        json: {
          multiDailyMetricTimeSeries: [
            series("CALL_CLICKS", calls),
            series("WEBSITE_CLICKS", 7),
            series("BUSINESS_IMPRESSIONS_MOBILE_SEARCH", 101),
            series("A_FUTURE_GOOGLE_METRIC", 999),
          ],
        },
      })
    )

    const firstSync = await fetch(`${server.baseUrl}/api/sync/performance`, {
      method: "POST",
      headers: jsonHeaders(owner.cookie),
      body: JSON.stringify({ externalLocationId: linked.externalLocationId }),
    })
    expect(firstSync.status, await firstSync.clone().text()).toBe(200)
    expect((await firstSync.json()).organisations[0].outcomes[0]).toMatchObject(
      {
        status: "succeeded",
        upserted: 3,
      }
    )
    const providerCall = google.calls.find((call) =>
      call.path.includes(":fetchMultiDailyMetricsTimeSeries")
    )
    expect(providerCall?.path).toContain("dailyMetrics=CALL_CLICKS")
    expect(providerCall?.path).toContain("dailyRange.startDate.year=")

    const report = await fetch(
      `${server.baseUrl}/api/analytics/presence?range=28d`,
      { headers: { cookie: owner.cookie } }
    )
    expect(report.status, await report.clone().text()).toBe(200)
    expect(await report.json()).toMatchObject({
      state: "ready",
      totals: {
        CALL_CLICKS: 12,
        WEBSITE_CLICKS: 7,
        BUSINESS_IMPRESSIONS_MOBILE_SEARCH: 101,
      },
    })

    const isolated = await fetch(`${server.baseUrl}/api/analytics/presence`, {
      headers: { cookie: other.cookie },
    })
    expect(isolated.status).toBe(200)
    expect(await isolated.json()).toMatchObject({
      state: "no_link",
      totals: { CALL_CLICKS: 0 },
    })

    calls = 18
    await admin`
      update sync_checkpoint
      set next_attempt_at = now()
      where organisation_id = ${owner.organisationId}
        and external_location_id = ${linked.externalLocationId}
        and sync_type = 'performance'
    `
    const restatement = await fetch(`${server.baseUrl}/api/sync/performance`, {
      method: "POST",
      headers: jsonHeaders(owner.cookie),
      body: JSON.stringify({ externalLocationId: linked.externalLocationId }),
    })
    expect(restatement.status, await restatement.clone().text()).toBe(200)
    const updated = await fetch(`${server.baseUrl}/api/analytics/presence`, {
      headers: { cookie: owner.cookie },
    })
    expect((await updated.json()).totals.CALL_CLICKS).toBe(18)
  })

  it("isolates a provider failure to the location that caused it", async () => {
    const owner = await createTestTenant(admin)
    organisations.push(owner.organisationId)
    const connection = await seedGoogleConnection(admin, {
      organisationId: owner.organisationId,
    })
    const seed = {
      organisationId: owner.organisationId,
      connectionId: connection.connectionId,
      googleAccountName: connection.googleAccountName,
    }
    const first = await seedLinkedLocation(admin, seed)
    const denied = await seedLinkedLocation(admin, seed)
    const third = await seedLinkedLocation(admin, seed)
    google.reset()
    google.respond(
      { method: "GET", pathIncludes: ":fetchMultiDailyMetricsTimeSeries" },
      (call) =>
        call.path.includes(denied.googleLocationName)
          ? {
              status: 403,
              json: {
                error: {
                  status: "PERMISSION_DENIED",
                  message: "The caller does not have permission.",
                },
              },
            }
          : {
              status: 200,
              json: { multiDailyMetricTimeSeries: [series("CALL_CLICKS", 5)] },
            }
    )

    const response = await fetch(`${server.baseUrl}/api/sync/performance`, {
      method: "POST",
      headers: jsonHeaders(owner.cookie),
      body: JSON.stringify({}),
    })
    expect(response.status, await response.clone().text()).toBe(200)
    const outcomes = (await response.json()).organisations[0]
      .outcomes as Array<{
      externalLocationId: string
      status: string
      errorCode?: string
    }>
    expect(outcomes).toHaveLength(3)
    expect(
      outcomes
        .filter((outcome) => outcome.status === "succeeded")
        .map((outcome) => outcome.externalLocationId)
        .sort()
    ).toEqual([first.externalLocationId, third.externalLocationId].sort())
    expect(
      outcomes.find((outcome) => outcome.status === "failed")
    ).toMatchObject({
      externalLocationId: denied.externalLocationId,
      errorCode: "PERMISSION_DENIED",
    })

    const [checkpoint] = await admin<
      {
        status: string
        lastErrorCode: string | null
        nextAttemptAt: Date | null
        deadLetteredAt: Date | null
      }[]
    >`
      select
        status,
        last_error_code as "lastErrorCode",
        next_attempt_at as "nextAttemptAt",
        dead_lettered_at as "deadLetteredAt"
      from sync_checkpoint
      where organisation_id = ${owner.organisationId}
        and external_location_id = ${denied.externalLocationId}
        and sync_type = 'performance'
    `
    expect(checkpoint.status).toBe("failed")
    expect(checkpoint.lastErrorCode).toBe("PERMISSION_DENIED")
    expect(checkpoint.deadLetteredAt).toBeNull()
    // The backoff is a real schedule now, not the constant hour the dead
    // Math.max(1h, Math.min(24h, retryDelayMs(n))) always produced.
    expect(checkpoint.nextAttemptAt!.getTime()).toBeGreaterThan(
      Date.now() + 20 * 60_000
    )

    const [failureAudit] = await admin<{ count: number }[]>`
      select count(*)::int as count
      from audit_log
      where organisation_id = ${owner.organisationId}
        and action = 'performance.sync_failed'
        and subject_id = ${denied.externalLocationId}
    `
    expect(failureAudit.count).toBe(1)
  }, 30_000)

  it("re-requests every day back to a stale watermark", async () => {
    const owner = await createTestTenant(admin)
    organisations.push(owner.organisationId)
    const connection = await seedGoogleConnection(admin, {
      organisationId: owner.organisationId,
    })
    const location = await seedLinkedLocation(admin, {
      organisationId: owner.organisationId,
      connectionId: connection.connectionId,
      googleAccountName: connection.googleAccountName,
    })
    // A checkpoint that stopped advancing 30 days ago — an ingestion pause,
    // or a grant the owner took a month to restore.
    await admin`
      insert into sync_checkpoint (
        organisation_id,
        external_location_id,
        sync_type,
        status,
        next_attempt_at,
        last_metric_date
      )
      values (
        ${owner.organisationId},
        ${location.externalLocationId},
        'performance',
        'succeeded',
        now(),
        (now() at time zone 'utc' - interval '30 days')::date
      )
    `
    google.reset()
    google.respond(
      { method: "GET", pathIncludes: ":fetchMultiDailyMetricsTimeSeries" },
      () => ({
        status: 200,
        json: { multiDailyMetricTimeSeries: [series("CALL_CLICKS", 6)] },
      })
    )

    const response = await fetch(`${server.baseUrl}/api/sync/performance`, {
      method: "POST",
      headers: jsonHeaders(owner.cookie),
      body: JSON.stringify({
        externalLocationId: location.externalLocationId,
      }),
    })
    expect(response.status, await response.clone().text()).toBe(200)

    const providerCall = google.calls.find((call) =>
      call.path.includes(":fetchMultiDailyMetricsTimeSeries")
    )
    const params = new URLSearchParams(providerCall!.path.split("?")[1])
    const requestedStart = Date.UTC(
      Number(params.get("dailyRange.startDate.year")),
      Number(params.get("dailyRange.startDate.month")) - 1,
      Number(params.get("dailyRange.startDate.day"))
    )
    const today = new Date()
    const daysRequested = Math.round(
      (Date.UTC(
        today.getUTCFullYear(),
        today.getUTCMonth(),
        today.getUTCDate()
      ) -
        requestedStart) /
        DAY_MS
    )
    // A fixed ten-day restatement window would ask for 9; the watermark has
    // to widen it or those 20 days are lost for good.
    expect(daysRequested).toBeGreaterThanOrEqual(29)
    expect(daysRequested).toBeLessThanOrEqual(31)
  }, 30_000)

  it("returns a continuation cursor when the runtime budget is exhausted", async () => {
    const budgetServer = await startAppServer({
      GOOGLE_API_PROXY_BASE: google.baseUrl,
      GBP_PERFORMANCE_ENABLED: "true",
      PERFORMANCE_BUDGET_MS: "1",
    })
    try {
      const response = await fetch(
        `${budgetServer.baseUrl}/api/sync/performance`,
        {
          method: "POST",
          headers: {
            authorization: "Bearer route-harness-cron-secret",
            "content-type": "application/json",
          },
          body: JSON.stringify({ maxOrganisations: 100, maxLocations: 1 }),
        }
      )
      expect(response.status, await response.clone().text()).toBe(200)
      const body = (await response.json()) as {
        organisations: unknown[]
        truncated: boolean
        nextCursor: string | null
      }
      expect(body.organisations.length).toBeLessThanOrEqual(1)
      expect(body.truncated).toBe(true)
      // The cursor used to be returned only on a full page, so a fleet larger
      // than maxOrganisations never got past its first page.
      expect(body.nextCursor).not.toBeNull()
    } finally {
      await budgetServer.stop()
    }
  }, 60_000)
})

const DAY_MS = 86_400_000

// The presence report filters on a UTC calendar window ending today (28d
// here) and the restatement sync re-requests the trailing 10 days, so the
// stubbed metric date must be relative to "now" rather than a fixed day.
// Three days ago sits inside both windows and survives a UTC midnight
// rollover between this computation and the server's own clock.
function metricDate(daysAgo = 3) {
  const date = new Date(Date.now() - daysAgo * DAY_MS)
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  }
}

function series(metric: string, value: number) {
  return {
    dailyMetricTimeSeries: {
      dailyMetric: metric,
      timeSeries: {
        datedValues: [
          {
            date: metricDate(),
            value: String(value),
          },
        ],
      },
    },
  }
}

function jsonHeaders(cookie: string) {
  return { cookie, "content-type": "application/json" }
}

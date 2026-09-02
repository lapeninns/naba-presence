import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { startAppServer } from "../helpers/app-server"
import { startGoogleStub, type GoogleStub } from "../helpers/google-stub"
import {
  createTestTenant,
  destroyTenants,
  seedGoogleConnection,
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
    expect((await firstSync.json()).organisations[0].outcomes[0]).toMatchObject({
      status: "succeeded",
      upserted: 3,
    })
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
    const restatement = await fetch(
      `${server.baseUrl}/api/sync/performance`,
      {
        method: "POST",
        headers: jsonHeaders(owner.cookie),
        body: JSON.stringify({ externalLocationId: linked.externalLocationId }),
      }
    )
    expect(restatement.status, await restatement.clone().text()).toBe(200)
    const updated = await fetch(`${server.baseUrl}/api/analytics/presence`, {
      headers: { cookie: owner.cookie },
    })
    expect((await updated.json()).totals.CALL_CLICKS).toBe(18)
  })
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

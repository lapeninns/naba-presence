import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { presenceResponseSchema } from "@/lib/contracts/analytics"
import { startAppServer } from "../helpers/app-server"
import {
  createTestTenant,
  destroyTenants,
  seedGoogleConnection,
  seedLinkedLocation,
} from "../helpers/tenant"

const describeDatabase =
  process.env.RUN_DB_TESTS === "true" ? describe : describe.skip

// WP9: missing is not zero, the prior window is equal length, and coverage
// and fetch time are reported separately from the data-through date.
describeDatabase("Google presence report provenance", () => {
  let admin: ReturnType<typeof postgres>
  let server: Awaited<ReturnType<typeof startAppServer>>
  const organisations: string[] = []
  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 1 })
    server = await startAppServer({ GBP_PERFORMANCE_ENABLED: "true" })
  })
  afterAll(async () => {
    await server.stop()
    await destroyTenants(admin, organisations)
    await admin.end()
  })
  const day = (offset: number) =>
    new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10)

  it("separates missing, zero, prior window, coverage and fetch time", async () => {
    const owner = await createTestTenant(admin)
    organisations.push(owner.organisationId)
    const connection = await seedGoogleConnection(admin, {
      organisationId: owner.organisationId,
    })
    const reporting = await seedLinkedLocation(admin, {
      organisationId: owner.organisationId,
      ...connection,
    })
    const stale = await seedLinkedLocation(admin, {
      organisationId: owner.organisationId,
      ...connection,
    })
    const failed = await seedLinkedLocation(admin, {
      organisationId: owner.organisationId,
      ...connection,
    })
    await seedLinkedLocation(admin, {
      organisationId: owner.organisationId,
      ...connection,
    })
    const metric = (
      externalLocationId: string,
      name: string,
      date: string,
      value: number
    ) => admin`
      insert into performance_metric_daily (organisation_id, external_location_id, metric, metric_date, value)
      values (${owner.organisationId}, ${externalLocationId}, ${name}, ${date}::date, ${value})`
    await metric(reporting.externalLocationId, "CALL_CLICKS", day(2), 0)
    await metric(reporting.externalLocationId, "WEBSITE_CLICKS", day(2), 7)
    await metric(reporting.externalLocationId, "WEBSITE_CLICKS", day(40), 4)
    const checkpoint = (
      externalLocationId: string,
      status: string,
      succeeded: string | null
    ) => admin`
      insert into sync_checkpoint (organisation_id, external_location_id, sync_type, status, next_attempt_at, last_succeeded_at)
      values (${owner.organisationId}, ${externalLocationId}, 'performance', ${status}, now(), ${succeeded}::timestamptz)`
    await checkpoint(
      reporting.externalLocationId,
      "succeeded",
      new Date(Date.now() - 3_600_000).toISOString()
    )
    await checkpoint(
      stale.externalLocationId,
      "succeeded",
      new Date(Date.now() - 5 * 86_400_000).toISOString()
    )
    await checkpoint(failed.externalLocationId, "failed", null)

    const response = await fetch(
      `${server.baseUrl}/api/analytics/presence?range=28d`,
      { headers: { cookie: owner.cookie } }
    )
    expect(response.status, await response.clone().text()).toBe(200)
    const report = presenceResponseSchema.parse(await response.json())
    expect(report.state).toBe("ready")
    expect(report.totals.CALL_CLICKS).toBe(0)
    expect(report.totals.WEBSITE_CLICKS).toBe(7)
    expect(report.totals.BUSINESS_BOOKINGS).toBeNull()
    expect(report.previous?.totals.WEBSITE_CLICKS).toBe(4)
    expect(report.previous?.totals.CALL_CLICKS).toBeNull()
    const length = (from: string, to: string) =>
      (Date.parse(to) - Date.parse(from)) / 86_400_000
    expect(length(report.previous!.from, report.previous!.to)).toBe(
      length(report.from, report.to)
    )
    expect(Date.parse(report.previous!.to) + 86_400_000).toBe(
      Date.parse(report.from)
    )
    expect(report.coverage).toEqual({
      eligible: 4,
      reporting: 1,
      unavailable: 1,
      stale: 1,
      pending: 1,
    })
    expect(report.freshThrough).toBe(day(2))
    expect(Date.parse(report.fetchedAt!.newest!)).toBeGreaterThan(
      Date.parse(report.fetchedAt!.oldest!)
    )
    expect(report.dateBasis).toBe("google_daily")
  })
})

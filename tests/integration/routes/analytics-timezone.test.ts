import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { startAppServer } from "../helpers/app-server"
import {
  createTestTenant,
  destroyTenants,
  seedGoogleConnection,
  seedLinkedReview,
} from "../helpers/tenant"

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip

type SeriesPoint = {
  period: string
  reviewCount: number
  reviews: number
}

describeDatabase("analytics timezone bucketing", () => {
  let admin: ReturnType<typeof postgres>
  let server: Awaited<ReturnType<typeof startAppServer>>
  const organisationIds: string[] = []

  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 1 })
    server = await startAppServer()
  })

  afterAll(async () => {
    await server.stop()
    await destroyTenants(admin, organisationIds)
    await admin.end()
  })

  async function seedTimezoneFixture(
    timezone: string,
    timestamps: string[]
  ) {
    const owner = await createTestTenant(admin)
    organisationIds.push(owner.organisationId)
    await admin`
      update organisation
      set default_timezone = ${timezone}
      where id = ${owner.organisationId}
    `
    const connection = await seedGoogleConnection(admin, {
      organisationId: owner.organisationId,
    })
    const locationIds: string[] = []
    for (const [index, timestamp] of timestamps.entries()) {
      const review = await seedLinkedReview(admin, {
        organisationId: owner.organisationId,
        connectionId: connection.connectionId,
        googleAccountName: connection.googleAccountName,
        text: `Timezone fixture ${index}`,
      })
      locationIds.push(review.locationId)
      await admin`
        update location set timezone = ${timezone}
        where id = ${review.locationId}
      `
      await admin`
        update review
        set create_time = ${timestamp}, update_time = ${timestamp}
        where id = ${review.reviewId}
      `
    }
    return { ...owner, locationIds }
  }

  async function overview(
    cookie: string,
    from: string,
    to: string
  ): Promise<{ timezone: string; series: SeriesPoint[] }> {
    const response = await fetch(
      `${server.baseUrl}/api/analytics/overview?granularity=day&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      { headers: { cookie } }
    )
    if (!response.ok) {
      throw new Error(`Analytics failed: ${await response.text()}`)
    }
    return response.json()
  }

  it("uses London-local day starts across both DST transitions", async () => {
    const fixture = await seedTimezoneFixture("Europe/London", [
      "2026-03-29T00:30:00.000Z",
      "2026-03-28T23:30:00.000Z",
      "2026-10-25T00:30:00.000Z",
    ])

    const spring = await overview(
      fixture.cookie,
      "2026-03-28T00:00:00.000Z",
      "2026-03-30T23:59:59.999Z"
    )
    expect(spring.timezone).toBe("Europe/London")
    expect(
      spring.series
        .filter((point) => point.reviewCount > 0)
        .map((point) => point.period)
    ).toEqual([
      "2026-03-28T00:00:00.000Z",
      "2026-03-29T00:00:00.000Z",
    ])

    const autumn = await overview(
      fixture.cookie,
      "2026-10-24T00:00:00.000Z",
      "2026-10-26T23:59:59.999Z"
    )
    expect(
      autumn.series.find((point) => point.reviewCount === 1)?.period
    ).toBe("2026-10-24T23:00:00.000Z")
  })

  it("zero-fills every day in a seven-day range", async () => {
    const fixture = await seedTimezoneFixture("Europe/London", [
      "2026-06-01T10:00:00.000Z",
      "2026-06-07T10:00:00.000Z",
    ])
    const result = await overview(
      fixture.cookie,
      "2026-06-01T00:00:00.000Z",
      "2026-06-07T22:59:59.999Z"
    )
    expect(result.series).toHaveLength(7)
    expect(result.series.map((point) => point.reviewCount)).toEqual([
      1, 0, 0, 0, 0, 0, 1,
    ])
  })

  it("buckets a New York review into the prior local day", async () => {
    const fixture = await seedTimezoneFixture("America/New_York", [
      "2026-09-15T02:00:00.000Z",
    ])
    const result = await overview(
      fixture.cookie,
      "2026-09-14T00:00:00.000Z",
      "2026-09-16T23:59:59.999Z"
    )
    expect(result.timezone).toBe("America/New_York")
    expect(
      result.series.find((point) => point.reviewCount === 1)?.period
    ).toBe("2026-09-14T04:00:00.000Z")
  })

  it("uses the organisation timezone for cross-location series", async () => {
    const fixture = await seedTimezoneFixture("Europe/London", [
      "2026-10-25T00:30:00.000Z",
    ])
    await admin`
      update location set timezone = 'UTC'
      where id = ${fixture.locationIds[0]}
    `

    const result = await overview(
      fixture.cookie,
      "2026-10-24T00:00:00.000Z",
      "2026-10-26T23:59:59.999Z"
    )

    expect(result.timezone).toBe("Europe/London")
    expect(
      result.series.find((point) => point.reviewCount === 1)?.period
    ).toBe("2026-10-24T23:00:00.000Z")
  })
})

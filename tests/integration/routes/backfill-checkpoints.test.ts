import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { startAppServer } from "../helpers/app-server"
import {
  startGoogleStub,
  type GoogleStub,
  type GoogleStubCall,
  type GoogleStubResponse,
} from "../helpers/google-stub"
import {
  createTestTenant,
  destroyTenants,
  seedGoogleConnection,
  seedLinkedReview,
} from "../helpers/tenant"

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip

type LocationFixture = {
  externalLocationId: string
  googleLocationName: string
}

type Fixture = {
  owner: Awaited<ReturnType<typeof createTestTenant>>
  googleAccountName: string
  locationA: LocationFixture
  locationB: LocationFixture
}

describeDatabase("per-location backfill checkpoints", () => {
  let admin: ReturnType<typeof postgres>
  let stub: GoogleStub
  let server: Awaited<ReturnType<typeof startAppServer>>
  const organisations: string[] = []

  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 1 })
    stub = await startGoogleStub()
    server = await startAppServer({
      GOOGLE_API_PROXY_BASE: stub.baseUrl,
      GOOGLE_TIMEOUT_MS: "3000",
    })
  })

  afterAll(async () => {
    await server.stop()
    await stub.stop()
    await destroyTenants(admin, organisations)
    await admin.end()
  })

  async function locationFixture(
    externalLocationId: string
  ): Promise<LocationFixture> {
    const [location] = await admin<{ google_location_name: string }[]>`
      select google_location_name
      from external_location
      where id = ${externalLocationId}
    `
    return {
      externalLocationId,
      googleLocationName: location.google_location_name,
    }
  }

  async function createFixture(): Promise<Fixture> {
    stub.reset()
    const owner = await createTestTenant(admin)
    organisations.push(owner.organisationId)
    const connection = await seedGoogleConnection(admin, {
      organisationId: owner.organisationId,
    })
    const reviewA = await seedLinkedReview(admin, {
      organisationId: owner.organisationId,
      connectionId: connection.connectionId,
      googleAccountName: connection.googleAccountName,
    })
    const reviewB = await seedLinkedReview(admin, {
      organisationId: owner.organisationId,
      connectionId: connection.connectionId,
      googleAccountName: connection.googleAccountName,
    })
    return {
      owner,
      googleAccountName: connection.googleAccountName,
      locationA: await locationFixture(reviewA.externalLocationId),
      locationB: await locationFixture(reviewB.externalLocationId),
    }
  }

  function pageToken(call: GoogleStubCall) {
    return new URL(call.path, stub.baseUrl).searchParams.get("pageToken")
  }

  function reviewPayload(
    fixture: Fixture,
    location: LocationFixture,
    id: string,
    updateTime: string
  ) {
    return {
      name: `${fixture.googleAccountName}/${location.googleLocationName}/reviews/${id}`,
      reviewId: id,
      reviewer: { displayName: "Checkpoint reviewer" },
      starRating: "FOUR",
      comment: `Checkpoint body ${id}`,
      createTime: "2026-08-01T10:00:00.000Z",
      updateTime,
    }
  }

  function locationForCall(fixture: Fixture, call: GoogleStubCall) {
    return call.path.includes(
      `/${fixture.locationA.googleLocationName.replace("locations/", "")}/`
    )
      ? fixture.locationA
      : fixture.locationB
  }

  function healthyPages(
    fixture: Fixture,
    call: GoogleStubCall
  ): GoogleStubResponse {
    const location = locationForCall(fixture, call)
    const token = pageToken(call)
    if (location === fixture.locationB) {
      return {
        status: 200,
        json: {
          reviews: [
            reviewPayload(
              fixture,
              location,
              "B1",
              "2026-08-04T10:00:00.000Z"
            ),
          ],
        },
      }
    }
    if (token === "A3") {
      return {
        status: 200,
        json: {
          reviews: [
            reviewPayload(
              fixture,
              location,
              "A3",
              "2026-08-03T10:00:00.000Z"
            ),
          ],
        },
      }
    }
    if (token === "A2") {
      return {
        status: 200,
        json: {
          reviews: [
            reviewPayload(
              fixture,
              location,
              "A2",
              "2026-08-02T10:00:00.000Z"
            ),
          ],
          nextPageToken: "A3",
        },
      }
    }
    return {
      status: 200,
      json: {
        reviews: [
          reviewPayload(
            fixture,
            location,
            "A1",
            "2026-08-01T10:00:00.000Z"
          ),
        ],
        nextPageToken: "A2",
      },
    }
  }

  function runBackfill(
    fixture: Fixture,
    externalLocationIds: string[],
    maxPagesPerLocation = 2
  ) {
    return fetch(`${server.baseUrl}/api/sync/backfill`, {
      method: "POST",
      headers: {
        cookie: fixture.owner.cookie,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        externalLocationIds,
        maxPagesPerLocation,
      }),
    })
  }

  async function checkpoints(fixture: Fixture) {
    return admin<
      {
        external_location_id: string
        status: string
        page_token: string | null
        high_water_update_time: Date | null
      }[]
    >`
      select
        external_location_id::text,
        status,
        page_token,
        high_water_update_time
      from sync_checkpoint
      where organisation_id = ${fixture.owner.organisationId}
        and sync_type = 'backfill'
      order by external_location_id
    `
  }

  it("keeps continuation tokens and watermarks location-scoped", async () => {
    const fixture = await createFixture()
    stub.respond(
      { method: "GET", pathIncludes: "/reviews" },
      (call) => healthyPages(fixture, call)
    )

    const first = await runBackfill(fixture, [
      fixture.locationA.externalLocationId,
      fixture.locationB.externalLocationId,
    ])
    expect(first.status, await first.clone().text()).toBe(200)
    const firstCheckpoints = await checkpoints(fixture)
    expect(
      firstCheckpoints.find(
        (item) =>
          item.external_location_id ===
          fixture.locationA.externalLocationId
      )
    ).toMatchObject({
      status: "pending",
      page_token: "A3",
    })
    expect(
      firstCheckpoints.find(
        (item) =>
          item.external_location_id ===
          fixture.locationB.externalLocationId
      )
    ).toMatchObject({
      status: "succeeded",
      page_token: null,
    })
    expect(
      firstCheckpoints.every(
        (checkpoint) => checkpoint.high_water_update_time instanceof Date
      )
    ).toBe(true)

    const callCount = stub.calls.length
    const continuation = await runBackfill(
      fixture,
      [fixture.locationA.externalLocationId],
      2
    )
    expect(
      continuation.status,
      await continuation.clone().text()
    ).toBe(200)
    const nextCalls = stub.calls.slice(callCount)
    expect(nextCalls[0]?.path).toContain("pageToken=A3")
    expect(nextCalls).toHaveLength(1)
  })

  it("retains one location's continuation after another page fails", async () => {
    const fixture = await createFixture()
    stub.respond(
      { method: "GET", pathIncludes: "/reviews" },
      (call) => {
        const location = locationForCall(fixture, call)
        if (
          location === fixture.locationA &&
          pageToken(call) === "A2"
        ) {
          return {
            status: 500,
            json: { error: { status: "INTERNAL" } },
          }
        }
        return healthyPages(fixture, call)
      }
    )

    const response = await runBackfill(fixture, [
      fixture.locationA.externalLocationId,
      fixture.locationB.externalLocationId,
    ])
    expect(response.status, await response.clone().text()).toBe(200)
    const state = await checkpoints(fixture)
    expect(
      state.find(
        (item) =>
          item.external_location_id ===
          fixture.locationA.externalLocationId
      )
    ).toMatchObject({
      status: "failed",
      page_token: "A2",
    })
    expect(
      state.find(
        (item) =>
          item.external_location_id ===
          fixture.locationB.externalLocationId
      )
    ).toMatchObject({
      status: "succeeded",
      page_token: null,
    })
  }, 20_000)
})

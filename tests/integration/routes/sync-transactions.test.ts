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

type Fixture = {
  owner: Awaited<ReturnType<typeof createTestTenant>>
  externalLocationId: string
  googleAccountName: string
  googleLocationName: string
}

describeDatabase("sync transaction boundaries", () => {
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

  async function createFixture(): Promise<Fixture> {
    stub.reset()
    const owner = await createTestTenant(admin)
    organisations.push(owner.organisationId)
    const connection = await seedGoogleConnection(admin, {
      organisationId: owner.organisationId,
    })
    const review = await seedLinkedReview(admin, {
      organisationId: owner.organisationId,
      connectionId: connection.connectionId,
      googleAccountName: connection.googleAccountName,
    })
    const [location] = await admin<{ google_location_name: string }[]>`
      select google_location_name
      from external_location
      where id = ${review.externalLocationId}
    `
    return {
      owner,
      externalLocationId: review.externalLocationId,
      googleAccountName: connection.googleAccountName,
      googleLocationName: location.google_location_name,
    }
  }

  function pageToken(call: GoogleStubCall): string | null {
    if (call.method === "POST") {
      const body = call.body as { pageToken?: string }
      return body.pageToken ?? null
    }
    return new URL(call.path, stub.baseUrl).searchParams.get("pageToken")
  }

  function providerReview(name: string, updateTime: string) {
    return {
      name,
      reviewId: name.split("/").at(-1),
      reviewer: { displayName: "Provider reviewer" },
      starRating: "FIVE",
      comment: `Provider body for ${name}`,
      createTime: "2026-08-01T10:00:00.000Z",
      updateTime,
    }
  }

  function pagedResponse(
    fixture: Fixture,
    call: GoogleStubCall,
    options: { delayMs?: number; invalidSecondPage?: boolean } = {}
  ): GoogleStubResponse {
    const secondPage = pageToken(call) === "page-2"
    const review = providerReview(
      `${fixture.googleAccountName}/${fixture.googleLocationName}/reviews/${secondPage ? "tx-page-2" : "tx-page-1"}`,
      secondPage && options.invalidSecondPage
        ? "not-a-provider-timestamp"
        : secondPage
          ? "2026-08-02T10:00:00.000Z"
          : "2026-08-01T10:00:00.000Z"
    )
    const page = {
      ...(secondPage ? {} : { nextPageToken: "page-2" }),
    }
    return call.method === "POST"
      ? {
          status: 200,
          json: {
            ...page,
            locationReviews: [
              {
                name: `${fixture.googleAccountName}/${fixture.googleLocationName}`,
                review,
              },
            ],
          },
          delayMs: options.delayMs,
        }
      : {
          status: 200,
          json: { ...page, reviews: [review] },
          delayMs: options.delayMs,
        }
  }

  function respondWithPages(
    fixture: Fixture,
    options: { delayMs?: number; invalidSecondPage?: boolean } = {}
  ) {
    const handler = (call: GoogleStubCall) =>
      pagedResponse(fixture, call, options)
    stub.respond(
      { method: "POST", pathIncludes: "locations:batchGetReviews" },
      handler
    )
    stub.respond(
      { method: "GET", pathIncludes: "/reviews" },
      handler
    )
  }

  function runBackfill(fixture: Fixture) {
    return fetch(`${server.baseUrl}/api/sync/backfill`, {
      method: "POST",
      headers: {
        cookie: fixture.owner.cookie,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        externalLocationIds: [fixture.externalLocationId],
        maxPagesPerLocation: 2,
      }),
    })
  }

  async function waitForProviderCall() {
    const deadline = Date.now() + 10_000
    while (stub.calls.length === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    expect(stub.calls.length).toBeGreaterThan(0)
  }

  it("holds no database transaction open while Google responds", async () => {
    const fixture = await createFixture()
    respondWithPages(fixture, { delayMs: 1_000 })

    const responsePromise = runBackfill(fixture)
    await waitForProviderCall()
    const [{ count }] = await admin<{ count: number }[]>`
      select count(*)::int as count
      from pg_stat_activity
      where state = 'idle in transaction'
        and usename = 'naba_test_runtime'
    `
    const response = await responsePromise

    expect(count).toBe(0)
    expect(response.status, await response.clone().text()).toBe(200)
    const [state] = await admin<
      { review_count: number; checkpoint_status: string }[]
    >`
      select
        count(r.id)::int as review_count,
        max(sc.status) as checkpoint_status
      from sync_checkpoint sc
      left join review r
        on r.external_location_id = sc.external_location_id
       and r.google_review_id_hash in (
         encode(digest('tx-page-1', 'sha256'), 'hex'),
         encode(digest('tx-page-2', 'sha256'), 'hex')
       )
      where sc.organisation_id = ${fixture.owner.organisationId}
        and sc.external_location_id = ${fixture.externalLocationId}
        and sc.sync_type = 'backfill'
      group by sc.id
    `
    expect(state).toEqual({
      review_count: 2,
      checkpoint_status: "succeeded",
    })
  }, 20_000)

  it("commits page one when processing page two fails", async () => {
    const fixture = await createFixture()
    respondWithPages(fixture, { invalidSecondPage: true })

    const response = await runBackfill(fixture)
    expect(response.status, await response.clone().text()).toBe(200)
    const [pageOne] = await admin<{ count: number }[]>`
      select count(*)::int as count
      from review
      where organisation_id = ${fixture.owner.organisationId}
        and external_location_id = ${fixture.externalLocationId}
        and google_review_id_hash =
          encode(digest('tx-page-1', 'sha256'), 'hex')
    `
    const [checkpoint] = await admin<
      { status: string; page_token: string | null }[]
    >`
      select status, page_token
      from sync_checkpoint
      where organisation_id = ${fixture.owner.organisationId}
        and external_location_id = ${fixture.externalLocationId}
        and sync_type = 'backfill'
    `
    expect(pageOne.count).toBe(1)
    expect(checkpoint).toEqual({
      status: "failed",
      page_token: "page-2",
    })
  }, 20_000)
})

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

describeDatabase("provider request timeouts", () => {
  let admin: ReturnType<typeof postgres>
  let stub: GoogleStub
  let server: Awaited<ReturnType<typeof startAppServer>>
  let owner: Awaited<ReturnType<typeof createTestTenant>>
  let review: Awaited<ReturnType<typeof seedLinkedReview>>

  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 1 })
    stub = await startGoogleStub()
    owner = await createTestTenant(admin)
    const connection = await seedGoogleConnection(admin, {
      organisationId: owner.organisationId,
    })
    review = await seedLinkedReview(admin, {
      organisationId: owner.organisationId,
      connectionId: connection.connectionId,
      googleAccountName: connection.googleAccountName,
    })
    stub.respond(
      { method: "POST", pathIncludes: "locations:batchGetReviews" },
      () => ({
        status: 200,
        json: { locationReviews: [] },
        delayMs: 20_000,
      })
    )
    stub.respond(
      { method: "POST", pathIncludes: "/v1/responses" },
      () => ({
        status: 200,
        json: {
          output_text: JSON.stringify({
            reply: "Thank you for your review.",
            language: "en",
          }),
        },
        delayMs: 20_000,
      })
    )
    server = await startAppServer({
      GOOGLE_API_PROXY_BASE: stub.baseUrl,
      GOOGLE_TIMEOUT_MS: "1500",
      OPENAI_API_KEY: "route-harness-dummy-openai-key",
      OPENAI_BASE_URL: stub.baseUrl,
      OPENAI_TIMEOUT_MS: "1000",
    })
  })

  afterAll(async () => {
    await server.stop()
    await stub.stop()
    await destroyTenants(admin, [owner.organisationId])
    await admin.end()
  })

  it("fails a stalled Google backfill within the route budget", async () => {
    const startedAt = performance.now()
    const response = await fetch(`${server.baseUrl}/api/sync/backfill`, {
      method: "POST",
      headers: {
        cookie: owner.cookie,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        externalLocationIds: [review.externalLocationId],
        maxPagesPerLocation: 1,
      }),
    })
    const elapsedMs = performance.now() - startedAt

    expect(response.status, await response.clone().text()).toBe(200)
    expect(elapsedMs).toBeLessThan(10_000)
    const [checkpoint] = await admin<
      { status: string; last_error_code: string | null }[]
    >`
      select status, last_error_code
      from sync_checkpoint
      where organisation_id = ${owner.organisationId}
        and external_location_id = ${review.externalLocationId}
        and sync_type = 'backfill'
    `
    expect(checkpoint.status).toBe("failed")
    expect(checkpoint.last_error_code).toMatch(/timeout|google/i)
  }, 30_000)

  it("fails a stalled OpenAI draft request with a bounded 502", async () => {
    const startedAt = performance.now()
    const response = await fetch(
      `${server.baseUrl}/api/reviews/${review.reviewId}/drafts`,
      {
        method: "POST",
        headers: {
          cookie: owner.cookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({ tone: "warm_professional" }),
      }
    )
    const elapsedMs = performance.now() - startedAt
    const body = (await response.json()) as { error?: string }

    expect(response.status).toBe(502)
    expect(body.error).toBe("ai_timeout")
    expect(elapsedMs).toBeLessThan(10_000)
    expect(
      stub.calls.some(
        (call) =>
          call.method === "POST" && call.path.includes("/v1/responses")
      )
    ).toBe(true)
  }, 30_000)
})

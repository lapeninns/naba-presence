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
    stub.respond({ method: "GET", pathIncludes: "/reviews" }, () => ({
      status: 200,
      json: { reviews: [] },
      delayMs: 20_000,
    }))
    stub.respond(
      { method: "POST", pathIncludes: "/ai/v1/chat/completions" },
      () => ({
        status: 200,
        json: {
          choices: [
            {
              finish_reason: "stop",
              message: {
                content: JSON.stringify({
                  reply: "Thank you for your review.",
                  language: "en",
                }),
              },
            },
          ],
        },
        delayMs: 20_000,
      })
    )
    server = await startAppServer({
      GOOGLE_API_PROXY_BASE: stub.baseUrl,
      GOOGLE_TIMEOUT_MS: "1500",
      WORKERS_AI_API_TOKEN: "route-harness-dummy-workers-ai-token",
      WORKERS_AI_ACCOUNT_ID: "a".repeat(32),
      WORKERS_AI_BASE_URL: stub.baseUrl,
      WORKERS_AI_TIMEOUT_MS: "1000",
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

  // Drafts contract (lib/api/drafts.ts, app/api/reviews/[id]/drafts/route.ts):
  // omitting `body` asks the server to generate. The seeded review has text,
  // so this is the AI path, not the rating-only template.
  it("attempts AI generation when body is omitted and fails a stalled Workers AI call within the route budget", async () => {
    const callsBefore = workersAiCalls()
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

    expect(response.status, JSON.stringify(body)).toBe(502)
    expect(body.error).toBe("ai_timeout")
    expect(elapsedMs).toBeLessThan(10_000)
    expect(workersAiCalls()).toBe(callsBefore + 1)
  }, 30_000)

  it("returns 503 ai_not_configured without calling Workers AI when body is omitted and no token is set", async () => {
    // Credentials retain the keyless harness defaults; leaked calls hit the stub.
    const unconfigured = await startAppServer({
      GOOGLE_API_PROXY_BASE: stub.baseUrl,
      WORKERS_AI_BASE_URL: stub.baseUrl,
    })
    try {
      const callsBefore = workersAiCalls()
      const response = await fetch(
        `${unconfigured.baseUrl}/api/reviews/${review.reviewId}/drafts`,
        {
          method: "POST",
          headers: {
            cookie: owner.cookie,
            "content-type": "application/json",
          },
          body: JSON.stringify({ tone: "warm_professional" }),
        }
      )
      const body = (await response.json()) as { error?: string }

      expect(response.status, JSON.stringify(body)).toBe(503)
      expect(body.error).toBe("ai_not_configured")
      expect(workersAiCalls()).toBe(callsBefore)
    } finally {
      await unconfigured.stop()
    }
  }, 60_000)

  function workersAiCalls(): number {
    return stub.calls.filter(
      (call) =>
        call.method === "POST" && call.path.includes("/ai/v1/chat/completions")
    ).length
  }

  it("generates and verifies through GLM and records the Cloudflare model", async () => {
    const draft = {
      reply:
        "Thank you for your kind review. We hope to welcome you back soon.",
      language: "en",
    }
    stub.respond(
      { method: "POST", pathIncludes: "/ai/v1/chat/completions" },
      (call) => {
        const isVerification = JSON.stringify(call.body).includes(
          "review_reply_verification"
        )
        return {
          status: 200,
          json: {
            choices: [
              {
                finish_reason: "stop",
                message: {
                  content: JSON.stringify(
                    isVerification
                      ? {
                          unsupportedClaims: [],
                          unsafeEscalation: false,
                          toneMismatch: false,
                        }
                      : draft
                  ),
                },
              },
            ],
          },
        }
      }
    )
    const callsBefore = workersAiCalls()
    const response = await fetch(
      `${server.baseUrl}/api/reviews/${review.reviewId}/drafts`,
      {
        method: "POST",
        headers: { cookie: owner.cookie, "content-type": "application/json" },
        body: JSON.stringify({ tone: "warm_professional" }),
      }
    )
    expect(response.status, await response.clone().text()).toBe(201)
    expect(workersAiCalls()).toBe(callsBefore + 2)
    const [stored] = await admin<
      { model_name: string; body: string; verification_status: string }[]
    >`
      select model_name, body, verification_status from draft
      where organisation_id = ${owner.organisationId} and review_id = ${review.reviewId}
      order by created_at desc limit 1
    `
    expect(stored).toMatchObject({
      model_name: "@cf/zai-org/glm-5.3-flash",
      body: draft.reply,
    })
    expect(stored?.verification_status).toMatch(/^(pass|warn)$/)
  })
})
